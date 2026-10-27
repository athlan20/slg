// 剧本战场（v75，AISLG-198；v80，AISLG-199）的读取与视图：API 的查询 / 操作响应共用一套口径，
// Worker 的结算只复用行类型与通知载荷。规则与数值见 battlefield.ts。

import type pg from 'pg';
import type { ArmyCounts, TroopKind } from './protocol';
import { TROOP_KINDS } from './protocol';
import { armyPower, toFullArmyCounts } from './battle';
import {
  BATTLEFIELD_DONGZHUO_TIERS,
  BATTLEFIELD_RANK_REWARDS,
  BATTLEFIELD_SCRIPT_NAMES,
  battlefieldCampName,
  battlefieldScriptForWindow,
  battlefieldShopItems,
  battlefieldStrongholds,
  battlefieldUnlocked,
  battlefieldWindBonusCamp,
  battlefieldWindLabel,
  type BattlefieldWind,
  BATTLEFIELD_LOSE_REWARD,
  BATTLEFIELD_WIN_REWARD,
  battlefieldWindow,
  type BattlefieldCamp,
  type BattlefieldStrongholdKind,
} from './battlefield';
import type {
  BattlefieldCampView,
  BattlefieldEventView,
  BattlefieldProgressRewardView,
  BattlefieldScript,
  BattlefieldMeView,
  BattlefieldMeritEntryView,
  BattlefieldShopItemView,
  BattlefieldSquadView,
  BattlefieldStrongholdView,
  GetBattlefieldResponseData,
} from './protocol-battlefield';

type Queryable = pg.Pool | pg.PoolClient;

export interface BattlefieldEventRow {
  id: string;
  script: string;
  signup_start: Date;
  start_at: Date;
  end_at: Date;
  status: string;
  winner_camp: string | null;
  finish_reason: string | null;
  score_yuan: string | number;
  score_cao: string | number;
  underdog_camp: string | null;
  underdog_multiplier: string | number;
  last_score_at: Date | null;
  last_food_at: Date | null;
  wind: string | null;
  wind_next_at: Date | null;
  wind_notice_at: Date | null;
  signup_announced_at: Date | null;
  start_announced_at: Date | null;
  finished_at: Date | null;
}

export interface BattlefieldStrongholdRow {
  event_id: string;
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  owner_camp: string | null;
  points_per_hour: number;
  garrison: Partial<Record<TroopKind, number>>;
  wall_level: number;
  tower_level: number;
  first_captured_at: Date | null;
  captured_at: Date | null;
  chain_until: Date | null;
  fire_next_at: Date | null;
  /** 火攻余伤池：兵种 → 未折算成阵亡的小数伤害（v80） */
  fire_wounds: Record<string, number> | null;
}

export interface BattlefieldParticipantRow {
  event_id: string;
  account_id: string;
  camp: string;
  main_city_id: string;
  merit: string | number;
  joined_at: Date;
  entered_at: Date | null;
  rewarded_at: Date | null;
}

export interface BattlefieldSquadRow {
  id: string;
  event_id: string;
  account_id: string;
  camp: string;
  x: number;
  y: number;
  origin_x: number;
  origin_y: number;
  troops: Partial<Record<TroopKind, number>>;
  status: string;
  stronghold_id: string | null;
  target_x: number | null;
  target_y: number | null;
  target_stronghold_id: string | null;
  arrive_at: Date | null;
}

/** 行数据里的剧本字段收窄（未知值按官渡处理，兼容旧行） */
function asScript(value: unknown): BattlefieldScript {
  return value === 'dongzhuo' || value === 'chibi' ? value : 'guandu';
}

function asCamp(value: unknown): BattlefieldCamp | null {
  return value === 'yuan' || value === 'cao' ? value : null;
}

function asKind(value: string): BattlefieldStrongholdKind {
  return value === 'base' || value === 'ford' || value === 'granary' ? value : 'post';
}

export async function loadLatestBattlefieldEvent(q: Queryable): Promise<BattlefieldEventRow | null> {
  const res = await q.query(
    `SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1`,
  );
  return (res.rows[0] as BattlefieldEventRow | undefined) ?? null;
}

export async function loadBattlefieldEvent(q: Queryable, id: string): Promise<BattlefieldEventRow | null> {
  const res = await q.query(`SELECT * FROM battlefield_events WHERE id = $1`, [id]);
  return (res.rows[0] as BattlefieldEventRow | undefined) ?? null;
}

export async function loadBattlefieldStrongholds(q: Queryable, eventId: string): Promise<BattlefieldStrongholdRow[]> {
  const res = await q.query(
    `SELECT * FROM battlefield_strongholds WHERE event_id = $1
     ORDER BY CASE kind WHEN 'base' THEN 0 WHEN 'granary' THEN 1 WHEN 'ford' THEN 2 ELSE 3 END, y, x`,
    [eventId],
  );
  return res.rows as BattlefieldStrongholdRow[];
}

export async function loadBattlefieldParticipant(
  q: Queryable,
  eventId: string,
  accountId: string,
): Promise<BattlefieldParticipantRow | null> {
  const res = await q.query(
    `SELECT * FROM battlefield_participants WHERE event_id = $1 AND account_id = $2`,
    [eventId, accountId],
  );
  return (res.rows[0] as BattlefieldParticipantRow | undefined) ?? null;
}

export async function loadBattlefieldSquads(
  q: Queryable,
  eventId: string,
  accountId: string,
): Promise<BattlefieldSquadRow[]> {
  const res = await q.query(
    `SELECT * FROM battlefield_squads WHERE event_id = $1 AND account_id = $2 ORDER BY created_at`,
    [eventId, accountId],
  );
  return res.rows as BattlefieldSquadRow[];
}

/** 全战场的据守队伍（按据点合并守军时用） */
export async function loadBattlefieldGarrisonSquads(
  q: Queryable,
  eventId: string,
): Promise<BattlefieldSquadRow[]> {
  const res = await q.query(
    `SELECT * FROM battlefield_squads
     WHERE event_id = $1 AND status = 'garrison' AND stronghold_id IS NOT NULL
     ORDER BY created_at`,
    [eventId],
  );
  return res.rows as BattlefieldSquadRow[];
}

export async function loadBattlefieldCumulativeMerit(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(`SELECT merit FROM battlefield_merit WHERE account_id = $1`, [accountId]);
  return Number((res.rows[0] as { merit: string | number } | undefined)?.merit ?? 0);
}

export async function loadBattlefieldShopCounts(
  q: Queryable,
  eventId: string,
  accountId: string,
): Promise<Record<string, number>> {
  const res = await q.query(
    `SELECT item, count FROM battlefield_purchases WHERE event_id = $1 AND account_id = $2`,
    [eventId, accountId],
  );
  const counts: Record<string, number> = {};
  for (const row of res.rows as Array<{ item: string; count: number }>) {
    counts[row.item] = row.count;
  }
  return counts;
}

interface CampCounts {
  signups: number;
  entered: number;
}

export async function loadBattlefieldCampCounts(q: Queryable, eventId: string): Promise<Record<BattlefieldCamp, CampCounts>> {
  const res = await q.query(
    `SELECT camp, count(*)::int AS signups, count(entered_at)::int AS entered
     FROM battlefield_participants WHERE event_id = $1 GROUP BY camp`,
    [eventId],
  );
  const counts: Record<BattlefieldCamp, CampCounts> = {
    yuan: { signups: 0, entered: 0 },
    cao: { signups: 0, entered: 0 },
  };
  for (const row of res.rows as Array<{ camp: string; signups: number; entered: number }>) {
    const camp = asCamp(row.camp);
    if (camp) {
      counts[camp] = { signups: Number(row.signups), entered: Number(row.entered) };
    }
  }
  return counts;
}

export function battlefieldEventView(row: BattlefieldEventRow, counts: Record<BattlefieldCamp, CampCounts>): BattlefieldEventView {
  const script = asScript(row.script);
  const wind = row.wind === 'se' || row.wind === 'nw' ? (row.wind as BattlefieldWind) : null;
  const campView = (camp: BattlefieldCamp): BattlefieldCampView => ({
    camp,
    name: battlefieldCampName(script, camp),
    signups: counts[camp].signups,
    entered: counts[camp].entered,
    score: Math.floor(Number(camp === 'yuan' ? row.score_yuan : row.score_cao)),
  });
  const underdogCamp = asCamp(row.underdog_camp);
  return {
    id: row.id,
    script,
    name: BATTLEFIELD_SCRIPT_NAMES[script],
    status: row.status === 'active' || row.status === 'finished' ? row.status : 'signup',
    signupStartAt: row.signup_start.toISOString(),
    startAt: row.start_at.toISOString(),
    endAt: row.end_at.toISOString(),
    camps: { yuan: campView('yuan'), cao: campView('cao') },
    winner: asCamp(row.winner_camp),
    finishReason: row.finish_reason === 'base_captured' ? 'base_captured' : row.finish_reason === 'score' ? 'score' : null,
    underdog: underdogCamp ? { camp: underdogCamp, multiplier: Number(row.underdog_multiplier) } : null,
    wind:
      script === 'chibi' && wind && row.wind_next_at
        ? {
            direction: wind,
            label: battlefieldWindLabel(wind),
            bonusCamp: battlefieldWindBonusCamp(wind),
            nextAt: row.wind_next_at.toISOString(),
            noticeAt: new Date(row.wind_next_at.getTime() - 30 * 60 * 1000).toISOString(),
          }
        : null,
  };
}

export function battlefieldSquadView(row: BattlefieldSquadRow): BattlefieldSquadView {
  return {
    id: row.id,
    x: row.x,
    y: row.y,
    status: row.status === 'marching' || row.status === 'garrison' ? row.status : 'idle',
    troops: toFullArmyCounts(row.troops),
    targetX: row.target_x,
    targetY: row.target_y,
    targetStrongholdId: row.target_stronghold_id,
    arriveAt: row.arrive_at ? row.arrive_at.toISOString() : null,
    originX: row.origin_x,
    originY: row.origin_y,
    strongholdId: row.stronghold_id,
  };
}

/** 据点的守军 = NPC 存量 + 据守队伍（按兵种相加） */
export function mergeStrongholdGarrison(
  row: BattlefieldStrongholdRow,
  squads: readonly BattlefieldSquadRow[],
): ArmyCounts {
  const merged = toFullArmyCounts(row.garrison ?? {});
  for (const squad of squads) {
    if (squad.stronghold_id !== row.id) {
      continue;
    }
    for (const kind of TROOP_KINDS) {
      merged[kind] += Math.max(0, Math.floor(squad.troops[kind] ?? 0));
    }
  }
  return merged;
}

export function battlefieldStrongholdView(
  row: BattlefieldStrongholdRow,
  squads: readonly BattlefieldSquadRow[],
  unlocked = true,
): BattlefieldStrongholdView {
  const garrison = mergeStrongholdGarrison(row, squads);
  return {
    id: row.id,
    name: row.name,
    kind: asKind(row.kind),
    x: row.x,
    y: row.y,
    ownerCamp: asCamp(row.owner_camp),
    pointsPerHour: Number(row.points_per_hour),
    garrison,
    garrisonPower: armyPower(garrison),
    wallLevel: Number(row.wall_level),
    towerLevel: Number(row.tower_level),
    firstCaptureAvailable: row.first_captured_at === null,
    capturedAt: row.captured_at ? row.captured_at.toISOString() : null,
    unlocked,
    chainUntil: row.chain_until ? row.chain_until.toISOString() : null,
    fireNextAt: row.fire_next_at ? row.fire_next_at.toISOString() : null,
  };
}

export function battlefieldShopView(
  counts: Record<string, number>,
  cumulativeMerit: number,
  script: BattlefieldScript = 'guandu',
): { items: BattlefieldShopItemView[]; cumulativeMerit: number } {
  return {
    cumulativeMerit,
    items: battlefieldShopItems(script).map((def) => ({
      item: def.item,
      label: def.label,
      cost: def.cost,
      limit: def.limit,
      bought: counts[def.item] ?? 0,
      reward:
        def.item === 'resources'
          ? { resources: { gold: 0, wood: def.resourcesEach ?? 0, food: def.resourcesEach ?? 0, stone: def.resourcesEach ?? 0, iron: def.resourcesEach ?? 0 } }
          : def.item === 'hero_exp'
            ? { heroExp: def.heroExp }
            : { troop: def.troop, count: def.count },
    })),
  };
}

export function battlefieldRewardsView(): GetBattlefieldResponseData['rewards'] {
  const progressTiers: BattlefieldProgressRewardView[] = BATTLEFIELD_DONGZHUO_TIERS.map((tier) => ({
    label: tier.label,
    progress: tier.progress,
    gold: tier.gold,
    resourcesEach: tier.resourcesEach,
  }));
  return {
    progressTiers,
    winner: {
      label: '胜方每人',
      rank: null,
      maxRank: null,
      gold: BATTLEFIELD_WIN_REWARD.gold,
      resourcesEach: BATTLEFIELD_WIN_REWARD.wood,
    },
    loser: {
      label: '败方每人',
      rank: null,
      maxRank: null,
      gold: BATTLEFIELD_LOSE_REWARD.gold,
      resourcesEach: BATTLEFIELD_LOSE_REWARD.wood,
    },
    rankTiers: BATTLEFIELD_RANK_REWARDS.map((tier, index) => ({
      label: tier.label,
      rank: index === 0 ? 1 : index === 1 ? 2 : 4,
      maxRank: tier.maxRank,
      gold: tier.gold,
      resourcesEach: tier.resourcesEach,
    })),
  };
}

/** 本场军功榜前 N 与我的名次（同分并列） */
export async function loadBattlefieldMeritBoard(
  q: Queryable,
  eventId: string,
  accountId: string,
  limit = 10,
): Promise<{ top: BattlefieldMeritEntryView[]; rank: number | null }> {
  const res = await q.query(
    `SELECT p.account_id, a.username, p.camp, p.merit,
            RANK() OVER (ORDER BY p.merit DESC) AS rank
     FROM battlefield_participants p JOIN accounts a ON a.id = p.account_id
     WHERE p.event_id = $1 AND p.merit > 0
     ORDER BY p.merit DESC, p.joined_at`,
    [eventId],
  );
  const rows = res.rows as Array<{
    account_id: string;
    username: string;
    camp: string;
    merit: string | number;
    rank: string | number;
  }>;
  const top = rows.slice(0, limit).map((row) => ({
    rank: Number(row.rank),
    accountId: row.account_id,
    username: row.username,
    camp: asCamp(row.camp) ?? 'yuan',
    merit: Number(row.merit),
  }));
  const mine = rows.find((row) => row.account_id === accountId);
  return { top, rank: mine ? Number(mine.rank) : null };
}

/** 一次查询返回 GET_BATTLEFIELD 的完整响应（操作成功后也用它刷新客户端） */
export async function loadBattlefieldState(
  pool: pg.Pool,
  accountId: string,
  event: BattlefieldEventRow | null,
  now: Date = new Date(),
): Promise<GetBattlefieldResponseData> {
  const window = battlefieldWindow(now);
  const nextSignupAt = window.signupStart.toISOString();
  const nextScript = battlefieldScriptForWindow(window);
  if (!event) {
    const cumulativeMerit = await loadBattlefieldCumulativeMerit(pool, accountId);
    return {
      event: null,
      nextSignupAt,
      nextScript,
      strongholds: [],
      me: null,
      top: [],
      shop: battlefieldShopView({}, cumulativeMerit),
      rewards: battlefieldRewardsView(),
    };
  }
  const script = asScript(event.script);
  const [counts, strongholds, garrisonSquads, participant, squads, cumulativeMerit, shopCounts, board] = await Promise.all([
    loadBattlefieldCampCounts(pool, event.id),
    loadBattlefieldStrongholds(pool, event.id),
    loadBattlefieldGarrisonSquads(pool, event.id),
    loadBattlefieldParticipant(pool, event.id, accountId),
    loadBattlefieldSquads(pool, event.id, accountId),
    loadBattlefieldCumulativeMerit(pool, accountId),
    loadBattlefieldShopCounts(pool, event.id, accountId),
    loadBattlefieldMeritBoard(pool, event.id, accountId),
  ]);
  let me: BattlefieldMeView | null = null;
  if (participant) {
    const account = await pool.query(`SELECT username FROM accounts WHERE id = $1`, [accountId]);
    me = {
      accountId,
      username: (account.rows[0] as { username: string } | undefined)?.username ?? '',
      camp: asCamp(participant.camp) ?? 'yuan',
      merit: Number(participant.merit),
      rank: board.rank,
      entered: participant.entered_at !== null,
      squads: squads.map(battlefieldSquadView),
      cumulativeMerit,
    };
  }
  // 据点按剧本的定义顺序输出；讨董按推进线（汜水关 → 虎牢关 → 洛阳）算解锁状态
  const defs = battlefieldStrongholds(script);
  const rowById = new Map(strongholds.map((row) => [row.id, row]));
  const ownerById = new Map(strongholds.map((row) => [row.id, asCamp(row.owner_camp)]));
  const ordered =
    script === 'dongzhuo'
      ? defs.flatMap((def) => (rowById.has(def.id) ? [rowById.get(def.id) as BattlefieldStrongholdRow] : []))
      : strongholds;
  return {
    event: battlefieldEventView(event, counts),
    nextSignupAt,
    nextScript,
    strongholds: ordered.map((row) => {
      const index = defs.findIndex((def) => def.id === row.id);
      const previous = index > 0 ? (ownerById.get(defs[index - 1].id) ?? null) : null;
      return battlefieldStrongholdView(row, garrisonSquads, battlefieldUnlocked(script, Math.max(0, index), previous));
    }),
    me,
    top: board.top,
    shop: battlefieldShopView(shopCounts, cumulativeMerit, script),
    rewards: battlefieldRewardsView(),
  };
}
