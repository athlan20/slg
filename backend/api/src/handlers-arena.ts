// 竞技场协议的处理逻辑（v53，AISLG-145）：GET_ARENA / SET_ARENA_LINEUP / ARENA_CHALLENGE /
// GET_ARENA_REPORTS。规则与数值见 common/src/arena.ts，存取见 arena-db.ts。
// 玩家与 Agent 同一套规则。所有可能改名次的事务先 lockArena（咨询锁）串行化，
// 对战在事务里当场算完（纯函数，不碰真实兵力与武将状态）。

import { randomInt } from 'node:crypto';
import pg from 'pg';
import { Op, type ArenaChallengeResponseData, type ArenaOpponentView, type ArenaRulesView, type ArenaStateView, type ErrorCode } from '../../common/src/protocol';
import {
  ARENA_ARMY_BASE,
  ARENA_ARMY_KINDS,
  ARENA_ARMY_PER_LEAD,
  ARENA_DAILY_CHALLENGES,
  ARENA_DAILY_DEFENDED_MAX,
  ARENA_DAILY_REWARDS,
  ARENA_MAX_RANK_GAP,
  ARENA_MILESTONE_REWARDS,
  ARENA_SLOTS,
  ARENA_TOP_COUNT,
  arenaDayIndex,
  arenaNextDayAt,
  arenaPairCooldownMs,
  canChallengeRank,
  dailyRewardForRank,
  playArenaMatch,
  seededRng,
} from '../../common/src/arena';
import {
  bumpDaily,
  countEntries,
  ensureArenaNpcs,
  settleMilestone,
  entryLineup,
  entryLineups,
  insertMatch,
  joinArena,
  lastChallengeAt,
  loadDaily,
  loadDefendedMap,
  loadEntryByAccount,
  loadEntryById,
  loadMatchById,
  loadMatches,
  loadOpponentRows,
  loadTop,
  lockArena,
  saveLineup,
  swapRanks,
} from '../../common/src/arena-db';
import { loadHero } from '../../common/src/hero-db';
import { insertServerBroadcast } from '../../common/src/server-broadcast';
import type { ArenaFighterView } from '../../common/src/protocol-arena';
import { readIntInRange, readOptionalNonNegativeInt, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 对外下发的规则常量（数值直引 arena.ts，不在这里另写一份） */
export function arenaRulesView(): ArenaRulesView {
  return {
    slots: ARENA_SLOTS,
    dailyChallenges: ARENA_DAILY_CHALLENGES,
    dailyDefendedMax: ARENA_DAILY_DEFENDED_MAX,
    maxRankGap: ARENA_MAX_RANK_GAP,
    pairCooldownSeconds: Math.ceil(arenaPairCooldownMs() / 1000),
    dailyRewards: ARENA_DAILY_REWARDS.map((t) => ({ upTo: Number.isFinite(t.upTo) ? t.upTo : null, gold: t.gold })),
    milestoneRewards: ARENA_MILESTONE_REWARDS.map((t) => ({ upTo: t.upTo, gold: t.gold })),
    armyBase: ARENA_ARMY_BASE,
    armyPerLead: ARENA_ARMY_PER_LEAD,
    armyKinds: [...ARENA_ARMY_KINDS],
  };
}

/** 战报里不暴露他人武将的 id */
function anonymous(view: ArenaFighterView | null): ArenaFighterView | null {
  return view ? { ...view, heroId: null } : null;
}

/** 我的完整竞技场状态（只读；可在普通事务或已 lockArena 的事务里调用） */
export async function buildArenaState(client: pg.PoolClient, accountId: string, now: Date): Promise<ArenaStateView> {
  const entry = await loadEntryByAccount(client, accountId);
  const day = arenaDayIndex(now);
  const daily = entry ? await loadDaily(client, accountId, day) : { challenges: 0, defended: 0 };
  let opponents: ArenaOpponentView[] = [];
  let lineup: Array<ArenaFighterView | null> = Array.from({ length: ARENA_SLOTS }, () => null);
  if (entry) {
    const rows = await loadOpponentRows(client, entry.rank, ARENA_MAX_RANK_GAP);
    // 我的阵容 + 所有对手阵容：武将一次查完
    const lineups = await entryLineups(client, [entry, ...rows]);
    lineup = lineups.get(entry.id) ?? lineup;
    const defended = await loadDefendedMap(
      client,
      rows.map((r) => r.account_id).filter((id): id is string => id !== null),
      day,
    );
    opponents = rows.map((row) => ({
      entryId: row.id,
      rank: row.rank,
      username: row.username,
      npc: row.account_id === null,
      lineup: (lineups.get(row.id) ?? []).map(anonymous),
      defendedToday: row.account_id ? (defended.get(row.account_id) ?? 0) : 0,
    }));
  }
  return {
    joined: entry !== null,
    rank: entry?.rank ?? null,
    bestRank: entry?.best_rank ?? null,
    totalEntries: await countEntries(client),
    lineup,
    challengesLeft: Math.max(0, ARENA_DAILY_CHALLENGES - daily.challenges),
    challengesMax: ARENA_DAILY_CHALLENGES,
    defendedToday: daily.defended,
    defendedMax: ARENA_DAILY_DEFENDED_MAX,
    nextDayAt: arenaNextDayAt(now).toISOString(),
    dailyReward: entry ? dailyRewardForRank(entry.rank) : 0,
    opponents,
    top: await loadTop(client, ARENA_TOP_COUNT),
    rules: arenaRulesView(),
  };
}

/** 在事务里（BEGIN + 竞技场锁 + 补守擂者）跑 fn，成功提交；fn 抛错回滚 */
async function inArenaTx<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockArena(client);
    await ensureArenaNpcs(client);
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 业务拒绝：在事务里抛出，外层回滚后按 code 回错误帧 */
class ArenaReject extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly data?: Record<string, unknown>,
  ) {
    super(code);
  }
}

/** GET_ARENA：只读快照（REPEATABLE READ READ ONLY），不抢竞技场锁；守擂者在启动时已补齐 */
export async function handleGetArena(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  let state: ArenaStateView;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    state = await buildArenaState(client, accountId, new Date());
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  respondOk(ctx.registry, conn, op, seq, { ...state });
}

/** 读 data.heroIds：长度 ≤ 3 的数组，元素为 UUID 或 null，不重复，至少 1 名；不合法返回 null */
export function readLineupParams(data: Record<string, unknown> | undefined): Array<string | null> | null {
  const raw = data?.heroIds;
  if (!Array.isArray(raw) || raw.length > ARENA_SLOTS) {
    return null;
  }
  const slots: Array<string | null> = [];
  for (const item of raw) {
    if (item === null) {
      slots.push(null);
    } else if (typeof item === 'string' && UUID_RE.test(item)) {
      slots.push(item.toLowerCase());
    } else {
      return null;
    }
  }
  while (slots.length < ARENA_SLOTS) {
    slots.push(null);
  }
  const ids = slots.filter((s): s is string => s !== null);
  if (ids.length === 0 || new Set(ids).size !== ids.length) {
    return null;
  }
  return slots;
}

/** SET_ARENA_LINEUP：保存阵容；第一次保存即入榜（排最后一名） */
export async function handleSetArenaLineup(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const slots = readLineupParams(data);
  if (!slots) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  try {
    const state = await inArenaTx(ctx.pool, async (client) => {
      for (const id of slots) {
        if (id === null) {
          continue;
        }
        // 加行锁：与同时进行的遣散互斥，避免外键撞车返回 INTERNAL
        const hero = await loadHero(client, id, true);
        if (!hero || hero.account_id !== accountId) {
          throw new ArenaReject('HERO_NOT_FOUND');
        }
      }
      const now = new Date();
      const entry = await loadEntryByAccount(client, accountId, true);
      if (entry) {
        await saveLineup(client, entry.id, slots);
      } else {
        // 入榜不发进档奖励：入榜名次即基线，之后名次升进新档才发（见 joinArena / settleMilestone）
        await joinArena(client, accountId, slots, now);
      }
      return buildArenaState(client, accountId, now);
    });
    respondOk(ctx.registry, conn, op, seq, { ...state });
  } catch (err) {
    if (err instanceof ArenaReject) {
      respondError(ctx.registry, conn, op, seq, err.code, err.data);
      return;
    }
    throw err;
  }
}

/** ARENA_CHALLENGE：三局两胜，赢了与对手互换名次 */
export async function handleArenaChallenge(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const entryId = typeof data?.entryId === 'string' && UUID_RE.test(data.entryId) ? data.entryId.toLowerCase() : null;
  if (!entryId) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  try {
    const out = await inArenaTx(ctx.pool, async (client) => {
      // 拿到锁之后再取时间：等锁期间跨过零点，次数记在新的竞技日上
      const now = new Date();
      const day = arenaDayIndex(now);
      const me = await loadEntryByAccount(client, accountId, true);
      if (!me) {
        throw new ArenaReject('ARENA_NOT_JOINED');
      }
      const target = await loadEntryById(client, entryId, true);
      if (!target || target.id === me.id || !canChallengeRank(me.rank, target.rank)) {
        throw new ArenaReject('ARENA_TARGET_INVALID');
      }
      const nextDayAt = arenaNextDayAt(now);
      const resetData = { nextDayAt: nextDayAt.toISOString(), retryAfterSeconds: Math.ceil((nextDayAt.getTime() - now.getTime()) / 1000) };
      const mine = await loadDaily(client, accountId, day);
      if (mine.challenges >= ARENA_DAILY_CHALLENGES) {
        throw new ArenaReject('ARENA_NO_CHALLENGES', resetData);
      }
      if (target.account_id) {
        const theirs = await loadDaily(client, target.account_id, day);
        if (theirs.defended >= ARENA_DAILY_DEFENDED_MAX) {
          throw new ArenaReject('ARENA_TARGET_BUSY', resetData);
        }
      }
      const last = await lastChallengeAt(client, accountId, target.id);
      if (last) {
        const waitMs = last.getTime() + arenaPairCooldownMs() - now.getTime();
        if (waitMs > 0) {
          throw new ArenaReject('ARENA_PAIR_COOLDOWN', { retryAfterSeconds: Math.ceil(waitMs / 1000) });
        }
      }
      // 战报与对战只用匿名快照（不带武将 id）：战报里会出现对手的阵容
      const myLineup = (await entryLineup(client, me)).map(anonymous);
      if (myLineup.every((f) => f === null)) {
        throw new ArenaReject('ARENA_NOT_JOINED');
      }
      const theirLineup = (await entryLineup(client, target)).map(anonymous);

      const seed = randomInt(0, 2 ** 31);
      const result = playArenaMatch(myLineup, theirLineup, seededRng(seed));

      const rankBefore = me.rank;
      const targetRankBefore = target.rank;
      let rankAfter = rankBefore;
      const defenderRankAfter = result.challengerWon ? rankBefore : targetRankBefore;
      if (result.challengerWon) {
        await swapRanks(client, { id: me.id, rank: rankBefore }, { id: target.id, rank: targetRankBefore });
        rankAfter = targetRankBefore;
      }
      await bumpDaily(client, accountId, day, 'challenges');
      if (target.account_id) {
        await bumpDaily(client, target.account_id, day, 'defended');
      }

      // 首次进入新名次档的一次性奖励（以历史最好名次为准）
      const bestAfter = Math.min(me.best_rank, rankAfter);
      const ms = await settleMilestone(client, accountId, me, bestAfter);
      const milestoneGold = ms.gold;
      const milestoneTiers = ms.tiers;

      const stored = {
        challengerWins: result.challengerWins,
        defenderWins: result.defenderWins,
        rounds: result.rounds,
        challengerLineup: myLineup,
        defenderLineup: theirLineup,
      };
      const saved = await insertMatch(client, {
        challengerAccountId: accountId,
        challengerName: me.username,
        challengerRankBefore: rankBefore,
        challengerRankAfter: rankAfter,
        defender: target,
        defenderRankAfter,
        challengerWon: result.challengerWon,
        seed,
        stored,
      });

      // 登上第 1 名：全服播报（必达）
      let broadcast = null;
      if (result.challengerWon && rankAfter === 1) {
        broadcast = await insertServerBroadcast(
          client,
          'arena_champion',
          { username: me.username, previous: target.username },
          { force: true },
        );
      }
      const match = await loadMatchById(client, saved.id, accountId);
      const left = Math.max(0, ARENA_DAILY_CHALLENGES - mine.challenges - 1);
      return { match, rankAfter, defenderRankAfter, bestAfter, left, milestoneGold, milestoneTiers, broadcast, target, matchId: saved.id, won: result.challengerWon, meName: me.username };
    });

    const body: ArenaChallengeResponseData = {
      match: out.match as NonNullable<typeof out.match>,
      rank: out.rankAfter,
      bestRank: out.bestAfter,
      challengesLeft: out.left,
      milestoneGold: out.milestoneGold,
      milestoneTiers: out.milestoneTiers,
    };
    respondOk(ctx.registry, conn, op, seq, { ...body });
    // 提交后的推送：被挑战方（玩家）、本人的其他连接（首次进档奖励）、全服播报
    if (out.target.account_id) {
      ctx.registry.broadcast(out.target.account_id, {
        op: Op.PUSH_ARENA_STATE,
        push: true,
        data: {
          reason: 'challenged',
          challenger: out.meName,
          defeated: out.won,
          rank: out.defenderRankAfter,
          matchId: out.matchId,
        },
      });
    }
    if (out.milestoneGold > 0) {
      ctx.registry.broadcast(
        accountId,
        { op: Op.PUSH_ARENA_STATE, push: true, data: { reason: 'milestone', gold: out.milestoneGold, tiers: out.milestoneTiers } },
        conn,
      );
    }
    if (out.broadcast) {
      ctx.registry.broadcastAll({ op: Op.PUSH_SERVER_BROADCAST, push: true, data: { broadcast: out.broadcast } });
    }
  } catch (err) {
    if (err instanceof ArenaReject) {
      respondError(ctx.registry, conn, op, seq, err.code, err.data);
      return;
    }
    throw err;
  }
}

/** GET_ARENA_REPORTS */
export async function handleGetArenaReports(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const limit = readIntInRange(data, 'limit', 1, 50, 20);
  const beforeId = readOptionalNonNegativeInt(data, 'beforeId') ?? null;
  const out = await loadMatches(ctx.pool, conn.accountId as string, limit, beforeId);
  respondOk(ctx.registry, conn, op, seq, { ...out });
}
