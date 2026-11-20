// 势力围攻分城的数据库读写（AISLG-240，v100）：发起 / 到期取行、节奏判定（在围一座 / 每周上限 /
// 同城 6 小时 / 打输 24 小时）、结果回写与作废。纯规则与数值在 faction-siege.ts。
// 选目标单独一份（v116，AISLG-264 起有仇恨与回落两条路）：见 faction-siege-target-db.ts；
// 仇恨榜与「不看范围」的选法见 faction-hatred-db.ts。
// 表结构见 faction-siege-schema.ts：每次围攻一行，随换季清空。
// 锁序沿用全栈：cities → world_tiles（选目标只读，不改地块；结算在 worker 里加锁）。

import type pg from 'pg';
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

