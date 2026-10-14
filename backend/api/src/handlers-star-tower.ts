// 将星塔协议的处理逻辑（v55，AISLG-146）：GET_STAR_TOWER / STAR_TOWER_CHALLENGE / GET_STAR_TOWER_REPORTS。
// 规则与数值见 common/src/star-tower.ts，存取见 star-tower-db.ts，阵容与竞技场共用（arena-db）。
// 玩家与 Agent 同一套规则。挑战在事务里当场算完，进度行加 FOR UPDATE 串行化同一账号的挑战。

import { randomInt } from 'node:crypto';
import { formationCatalog } from '../../common/src/army-formation';
import pg from 'pg';
import { Op, type ErrorCode, type GetStarTowerReportsResponseData, type StarTowerChallengeResponseData, type StarTowerStateView } from '../../common/src/protocol';
import { ARENA_ARMY_BASE, ARENA_ARMY_PER_LEAD, playArenaMatch, seededRng, type ArenaFighter } from '../../common/src/arena';
import { creditCapitalGold, entryLineup, loadEntryByAccount } from '../../common/src/arena-db';
import { grantHeroExp } from '../../common/src/hero-db';
import {
  isStarTowerBossFloor,
  nextStarTowerFloor,
  starTowerFloorEnemies,
  starTowerReward,
  STAR_TOWER_BOSS_EVERY,
  STAR_TOWER_FLOORS,
} from '../../common/src/star-tower';
import {
  hasAnyCity,
  insertStarTowerMatch,
  loadStarTowerBestFloor,
  loadStarTowerReports,
  lockStarTowerProgress,
  setStarTowerBestFloor,
  starTowerEnemyViews,
} from '../../common/src/star-tower-db';
import { insertServerBroadcast } from '../../common/src/server-broadcast';
import type { ArenaFighterView } from '../../common/src/protocol-arena';
import { readLimitOrNull, readOptionalNonNegativeInt, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

const EMPTY_LINEUP: Array<ArenaFighterView | null> = [null, null, null];

/** 业务拒绝：在事务里抛出，外层回滚后按 code 回错误帧 */
class StarTowerReject extends Error {
  constructor(readonly code: ErrorCode) {
    super(code);
  }
}

/** 战报与敌方快照里不暴露武将 id（自己的阵容也匿名，与竞技场战报一致） */
function anonymous(view: ArenaFighterView | null): ArenaFighterView | null {
  return view ? { ...view, heroId: null } : null;
}

/** 我的爬塔状态（只读；可在普通事务里调用） */
export async function buildStarTowerState(client: pg.PoolClient, accountId: string): Promise<StarTowerStateView> {
  const bestFloor = await loadStarTowerBestFloor(client, accountId);
  const nextFloor = nextStarTowerFloor(bestFloor);
  const entry = await loadEntryByAccount(client, accountId);
  const lineup = entry ? await entryLineup(client, entry) : [...EMPTY_LINEUP];
  return {
    bestFloor,
    formations: entry?.formations ?? ['balanced', 'balanced', 'balanced'],
    cleared: nextFloor === null,
    nextFloor,
    nextBoss: nextFloor !== null && isStarTowerBossFloor(nextFloor),
    nextEnemies: nextFloor === null ? [] : starTowerEnemyViews(nextFloor),
    nextReward: nextFloor === null ? null : starTowerReward(nextFloor),
    lineup,
    lineupReady: lineup.some((f) => f !== null),
    hasCity: await hasAnyCity(client, accountId),
    rules: { floors: STAR_TOWER_FLOORS, bossEvery: STAR_TOWER_BOSS_EVERY, slots: 3, winRounds: 2,
      armyBase: ARENA_ARMY_BASE, armyPerLead: ARENA_ARMY_PER_LEAD, ...formationCatalog() },
  };
}

/** GET_STAR_TOWER：只读快照（REPEATABLE READ READ ONLY），不抢进度行锁 */
export async function handleGetStarTower(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  let state: StarTowerStateView;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    state = await buildStarTowerState(client, accountId);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  respondOk(ctx.registry, conn, op, seq, { ...state });
}

/** STAR_TOWER_CHALLENGE：挑战下一层；赢了首通发奖励并推进进度，全服 Boss 层播报 */
export async function handleStarTowerChallenge(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  let out: {
    body: StarTowerChallengeResponseData;
    broadcast: unknown;
  };
  try {
    await client.query('BEGIN');
    const bestBefore = await lockStarTowerProgress(client, accountId);
    const floor = nextStarTowerFloor(bestBefore);
    if (floor === null) {
      throw new StarTowerReject('STAR_TOWER_CLEARED');
    }
    if (!(await hasAnyCity(client, accountId))) {
      throw new StarTowerReject('STAR_TOWER_NO_CITY');
    }
    const entry = await loadEntryByAccount(client, accountId);
    const lineup = entry ? await entryLineup(client, entry) : [...EMPTY_LINEUP];
    if (!lineup.some((f) => f !== null)) {
      throw new StarTowerReject('STAR_TOWER_NO_LINEUP');
    }
    // 只用匿名快照对战：战报里的我方阵容不带武将 id，对战只看属性
    const mine = lineup.map(anonymous);
    const enemies: ArenaFighter[] = starTowerFloorEnemies(floor);
    const seed = randomInt(0, 2 ** 31);
    const result = playArenaMatch(mine, enemies, seededRng(seed));
    const boss = isStarTowerBossFloor(floor);
    await insertStarTowerMatch(client, accountId, floor, seed, result, enemies, mine, boss);

    let reward: StarTowerChallengeResponseData['reward'] = null;
    const levelUps: StarTowerChallengeResponseData['levelUps'] = [];
    let broadcast: unknown = null;
    let bestAfter = bestBefore;
    if (result.challengerWon) {
      // 有城才会走到这里（上面已校验），金币进主城；进度与金币同事务提交
      const r = starTowerReward(floor);
      await creditCapitalGold(client, accountId, r.gold);
      for (const f of lineup) {
        if (!f) {
          continue;
        }
        const granted = await grantHeroExp(client, f.heroId as string, r.exp);
        if (granted?.leveledTo) {
          levelUps.push({ heroId: f.heroId as string, name: f.name, leveledTo: granted.leveledTo });
        }
      }
      await setStarTowerBestFloor(client, accountId, floor);
      bestAfter = floor;
      reward = r;
      if (boss) {
        const user = await client.query(`SELECT username FROM accounts WHERE id = $1`, [accountId]);
        const username = (user.rows[0] as { username: string }).username;
        broadcast = await insertServerBroadcast(client, 'star_tower_cleared', { username, floor }, { force: true });
      }
    }
    const { reports } = await loadStarTowerReports(client, accountId, 1, null);
    await client.query('COMMIT');
    out = {
      body: {
        match: reports[0],
        floor,
        won: result.challengerWon,
        bestFloor: bestAfter,
        reward,
        levelUps,
      },
      broadcast,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (err instanceof StarTowerReject) {
      respondError(ctx.registry, conn, op, seq, err.code);
      return;
    }
    throw err;
  } finally {
    client.release();
  }
  respondOk(ctx.registry, conn, op, seq, { ...out.body });
  // 提交后的全服播报（Boss 层首通，必达）
  if (out.broadcast) {
    ctx.registry.broadcastAll({ op: Op.PUSH_SERVER_BROADCAST, push: true, data: { broadcast: out.broadcast } });
  }
}

/** GET_STAR_TOWER_REPORTS */
export async function handleGetStarTowerReports(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const limit = readLimitOrNull(data, 'limit', 1, 50, 20);
  if (limit === null) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const beforeId = readOptionalNonNegativeInt(data, 'beforeId') ?? null;
  const out: GetStarTowerReportsResponseData = await loadStarTowerReports(ctx.pool, conn.accountId as string, limit, beforeId);
  respondOk(ctx.registry, conn, op, seq, { ...out });
}
