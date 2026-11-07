// 势力围攻分城的数据库读写（AISLG-240，v100）：选目标、发起 / 到期取行、节奏判定（在围一座 /
// 每周上限 / 同城 6 小时 / 打输 24 小时）、结果回写。纯规则与数值在 faction-siege.ts。
// 表结构见 faction-siege-schema.ts：每次围攻一行，随换季清空。
// 锁序沿用全栈：cities → world_tiles（选目标只读，不改地块；结算在 worker 里加锁）。

import type pg from 'pg';
import { factionOwnsTileSql } from './faction';
import { effectiveLevelSql } from './production';
import type { TroopKind } from './protocol';
import type { FactionKey } from './protocol-faction';

type Queryable = pg.Pool | pg.PoolClient;

/** faction_sieges 的一行 */
export interface FactionSiegeRow {
  id: string;
  faction: FactionKey;
  city_id: string | null;
  account_id: string | null;
  x: number;
  y: number;
  level: number;
  army: Partial<Record<TroopKind, number>>;
  power: number;
  warn_at: Date;
  arrive_at: Date;
  resolved_at: Date | null;
  outcome: string | null;
  week_index: number | null;
}

/** 围攻结果（结算写库用） */
export type SiegeOutcome = 'repelled' | 'hit' | 'swallowed' | 'cancelled';

/** 围攻的候选目标（发起时选一家要打的城） */
export interface SiegeCandidate {
  cityId: string;
  accountId: string;
  x: number;
  y: number;
  governmentLevel: number;
  /** 目标城当前城防值（尚未做惰性回涨，进预警文案时按结算口径再算一次） */
  durability: number | null;
  durabilitySettledAt: Date | null;
  truceUntil: Date | null;
  /** 这家上次打这座城的到达时刻（打赢或打输的；作废的不算），从没打过为 null */
  lastArriveAt: Date | null;
}

/**
 * 选一家势力范围内的围攻目标：玩家**分城**（不是主城）、不是名城、离这家老巢最近（距离相同随机）；
 * 目标账号不在新手保护 / 主动免战；排除正在被围、守方守住后 24 小时内的城。
 * 同城 6 小时和被动免战算的是到达时刻：这里按最长预警放宽（maxLeadMs），精确判定在发起时用
 * factionSiegeArrival。返回 null = 范围内没有可打的城。
 */
export async function pickSiegeTarget(
  q: Queryable,
  args: {
    faction: FactionKey;
    lair: { x: number; y: number };
    radius: number;
    /** 同一座城两次到达之间的最小间隔（毫秒，已按缩放；6 小时） */
    intervalMs: number;
    /** 最长预警提前量（毫秒，已按缩放；满级烽火台） */
    maxLeadMs: number;
    /** 打输（守方守住）后同一座城的冷却（毫秒，已按缩放；24 小时） */
    lossCooldownMs: number;
    now?: Date;
  },
): Promise<SiegeCandidate | null> {
  const now = args.now ?? new Date();
  const res = await q.query(
    `SELECT c.id, c.account_id, c.x, c.y,
            ${effectiveLevelSql('g.level', "'government'", 'c.famous_name')} AS government_level,
            c.durability, c.durability_settled_at, c.truce_until, last.arrive_at AS last_arrive_at
     FROM cities c
     JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government'
     JOIN accounts a ON a.id = c.account_id
     LEFT JOIN (SELECT account_id, MIN(created_at) AS first_created FROM cities GROUP BY account_id) m
       ON m.account_id = c.account_id AND m.first_created = c.created_at
     LEFT JOIN LATERAL (
       SELECT max(s.arrive_at) AS arrive_at FROM faction_sieges s
       WHERE s.faction = $4 AND s.x = c.x AND s.y = c.y AND s.outcome IN ('hit', 'repelled')
     ) last ON true
     WHERE c.x IS NOT NULL AND c.famous_name IS NULL
       AND m.account_id IS NULL
       AND abs(c.x - $1) <= $3 AND abs(c.y - $2) <= $3 AND ${factionOwnsTileSql(args.faction, 'c.x', 'c.y')}
       AND (c.truce_until IS NULL OR c.truce_until <= $7::timestamptz + make_interval(secs => $8 / 1000.0))
       AND (a.newbie_until IS NULL OR a.newbie_until <= $7::timestamptz)
       AND (a.self_truce_until IS NULL OR a.self_truce_until <= $7::timestamptz)
       AND (last.arrive_at IS NULL
            OR last.arrive_at + make_interval(secs => $5 / 1000.0) <= $7::timestamptz + make_interval(secs => $8 / 1000.0))
       AND NOT EXISTS (
         SELECT 1 FROM faction_sieges s
         WHERE s.faction = $4 AND s.x = c.x AND s.y = c.y
           AND (
             s.resolved_at IS NULL
             OR (s.outcome = 'repelled' AND s.resolved_at > $7::timestamptz - make_interval(secs => $6 / 1000.0))
           )
       )
     ORDER BY GREATEST(ABS(c.x - $1), ABS(c.y - $2)), random()
     LIMIT 1`,
    [
      args.lair.x,
      args.lair.y,
      args.radius,
      args.faction,
      Math.max(1000, Math.floor(args.intervalMs)),
      Math.max(1000, Math.floor(args.lossCooldownMs)),
      now,
      Math.max(0, Math.floor(args.maxLeadMs)),
    ],
  );
  const row = res.rows[0] as
    | {
        id: string;
        account_id: string;
        x: number;
        y: number;
        government_level: number;
        durability: number | null;
        durability_settled_at: Date | null;
        truce_until: Date | null;
        last_arrive_at: Date | null;
      }
    | undefined;
  if (!row) {
    return null;
  }
  return {
    cityId: row.id,
    accountId: row.account_id,
    x: row.x,
    y: row.y,
    governmentLevel: row.government_level,
    durability: row.durability,
    durabilitySettledAt: row.durability_settled_at,
    truceUntil: row.truce_until,
    lastArriveAt: row.last_arrive_at,
  };
}

/** 这家当前是否已有一座在围（到达未结算）的城：同一时间最多围 1 座 */
export async function hasActiveSiege(q: Queryable, faction: FactionKey): Promise<boolean> {
  const res = await q.query(`SELECT 1 FROM faction_sieges WHERE faction = $1 AND resolved_at IS NULL LIMIT 1`, [faction]);
  return (res.rowCount ?? 0) > 0;
}

/** 本周（本季第 8 / 15 / 22 天起算的一周）这家已吞下的玩家分城数 */
export async function countWeekSwallows(q: Queryable, faction: FactionKey, weekIndex: number): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM faction_sieges
     WHERE faction = $1 AND outcome = 'swallowed' AND week_index = $2`,
    [faction, weekIndex],
  );
  return (res.rows[0] as { n: number }).n;
}

/** 落库一次围攻（发起时固定编成与战力）；返回新行 id */
export async function insertSiege(
  client: pg.PoolClient,
  args: {
    faction: FactionKey;
    cityId: string;
    accountId: string;
    x: number;
    y: number;
    level: number;
    army: Partial<Record<TroopKind, number>>;
    power: number;
    warnAt: Date;
    arriveAt: Date;
    weekIndex: number | null;
  },
): Promise<string> {
  const res = await client.query(
    `INSERT INTO faction_sieges (faction, city_id, account_id, x, y, level, army, power, warn_at, arrive_at, week_index)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11) RETURNING id`,
    [
      args.faction,
      args.cityId,
      args.accountId,
      args.x,
      args.y,
      args.level,
      JSON.stringify(args.army),
      args.power,
      args.warnAt,
      args.arriveAt,
      args.weekIndex,
    ],
  );
  return (res.rows[0] as { id: string }).id;
}

/** 到期的围攻（到了到达时刻、还没结算），按到达时刻先后取一批并加行锁 */
export async function lockDueSieges(client: pg.PoolClient, now: Date, limit = 10): Promise<FactionSiegeRow[]> {
  const res = await client.query(
    `SELECT id, faction, city_id, account_id, x, y, level, army, power, warn_at, arrive_at, resolved_at, outcome, week_index
     FROM faction_sieges
     WHERE resolved_at IS NULL AND arrive_at <= $2
     ORDER BY arrive_at
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [limit, now],
  );
  return res.rows as FactionSiegeRow[];
}

/** 结算回写（结果 / 城防前后值 / 吞下时刻） */
export async function markSiegeResolved(
  client: pg.PoolClient,
  args: {
    id: string;
    outcome: SiegeOutcome;
    durabilityBefore?: number | null;
    durabilityAfter?: number | null;
    now: Date;
  },
): Promise<void> {
  await client.query(
    `UPDATE faction_sieges
     SET resolved_at = $5, outcome = $2, durability_before = $3, durability_after = $4,
         swallowed_at = CASE WHEN $2 = 'swallowed' THEN $5 ELSE swallowed_at END
     WHERE id = $1`,
    [args.id, args.outcome, args.durabilityBefore ?? null, args.durabilityAfter ?? null, args.now],
  );
}

/** 作废在途的围攻（目标失效等）：不战斗，直接记为 cancelled */
export async function cancelSiegesForCity(client: pg.PoolClient, cityId: string, outcome: SiegeOutcome = 'cancelled'): Promise<number> {
  const res = await client.query(
    `UPDATE faction_sieges SET resolved_at = clock_timestamp(), outcome = $2
     WHERE city_id = $1 AND resolved_at IS NULL`,
    [cityId, outcome],
  );
  return res.rowCount ?? 0;
}

