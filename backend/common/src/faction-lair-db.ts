// 攻破老巢的数据库读写（AISLG-241，v101；AISLG-247 起每营战力按营序号取梯度值）：本季老巢战况、
// 贡献榜、每天刷新两个战力锚点、24 小时无人进攻恢复 1 营。纯规则与数值在 faction-lair.ts，
// 全服战力第 3 / 第 10 名的查询在 faction-lair-rank-db.ts。
// 表结构见 faction-lair-schema.ts：faction_lairs / faction_contrib，都随换季清空。
// 注意：战斗结算的事务在 worker/src/faction-lair-battle.ts，每日刷新与恢复由 Worker 的定时器调用，
// 不放进战斗结算的事务里（需求「全服战力前 10 名每天算一次，放 Worker」）。

import type pg from 'pg';
import type { TroopKind } from './protocol';
import { FACTION_LAIR_CAMPS, factionLairAnchorPower, factionLairCampNo, factionLairCampPowerAt, factionLairPowerRefreshMs, factionLairRecoveredCamps, factionLairRecoverMs, rescaledLairRemaining } from './faction-lair';
import { serverAnchorPowers } from './faction-lair-rank-db';
import { FACTIONS } from './faction';
import type { FactionKey } from './protocol-faction';

type Queryable = pg.Pool | pg.PoolClient;
type Writer = pg.Pool | pg.PoolClient;

/** faction_lairs 的一行 */
export interface FactionLairRow {
  key: FactionKey;
  camps_total: number;
  camps_remaining: number;
  /** 当前营的残血编成（null = 满营） */
  remaining: Partial<Record<TroopKind, number>> | null;
  remaining_at: Date | null;
  /** v101 的单一「每营战力」（前 10 名合计 ÷ 15）：AISLG-247 起不再写入，只留给迁移回填与排查 */
  camp_power: number;
  /** 第 1 营战力锚点 G1（只升不降，下限 10,000） */
  camp_power_g1: number;
  /** 第 20 营战力锚点 G20（只升不降，不小于 G1） */
  camp_power_g20: number;
  power_at: Date | null;
  /** 最后一次被玩家进攻的时刻（从没被打过为 null；恢复 1 营后按恢复的时刻往后推） */
  last_battle_at: Date | null;
  destroyed_at: Date | null;
  destroyed_by: string | null;
}

const LAIR_COLUMNS = `key, camps_total, camps_remaining, remaining, remaining_at, camp_power,
                      camp_power_g1, camp_power_g20, power_at,
                      last_battle_at, destroyed_at, destroyed_by`;

/**
 * 生成本季五家的老巢战况行（幂等；开关关闭时调用方本就不会走到这里）。
 * 开季全服没有部队，两个锚点都是下限 10,000（每天由 Worker 按第 3 / 第 10 名的战力刷新）。
 * keys 缺省为五家；当季启用（AISLG-243）时只给本季真放下的那几家建行，跳过的势力不留任何战况数据。
 */
export async function ensureFactionLairs(
  client: pg.PoolClient,
  keys: readonly FactionKey[] = FACTIONS.map((def) => def.key),
): Promise<number> {
  let created = 0;
  for (const key of keys) {
    const res = await client.query(
      `INSERT INTO faction_lairs (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [key],
    );
    if (res.rowCount) {
      created += 1;
    }
  }
  return created;
}

/** 本季全部老巢战况（顺序按需求表的势力顺序；本季还没生成时为空数组） */
export async function loadFactionLairs(q: Queryable): Promise<FactionLairRow[]> {
  const res = await q.query(`SELECT ${LAIR_COLUMNS} FROM faction_lairs`);
  const order = new Map<string, number>(FACTIONS.map((def, index) => [def.key, index]));
  return (res.rows as FactionLairRow[])
    .filter((row) => order.has(row.key))
    .sort((a, b) => (order.get(a.key) as number) - (order.get(b.key) as number));
}

/** 一家老巢的战况（不存在返回 null） */
export async function loadFactionLairRow(q: Queryable, key: string): Promise<FactionLairRow | null> {
  const res = await q.query(`SELECT ${LAIR_COLUMNS} FROM faction_lairs WHERE key = $1`, [key]);
  return (res.rows[0] as FactionLairRow | undefined) ?? null;
}

/**
 * 加行锁读一家老巢（战斗结算用；调用方持有事务）。
 * 本季中途打开开关（老巢已放、战况行还没生成）时补一行默认值（20 营、两个锚点都是 10,000），
 * 不让「数据没生成」变成「老巢打不了」。
 */
export async function lockFactionLairRow(client: pg.PoolClient, key: string): Promise<FactionLairRow | null> {
  let res = await client.query(`SELECT ${LAIR_COLUMNS} FROM faction_lairs WHERE key = $1 FOR UPDATE`, [key]);
  if (!res.rowCount) {
    const inserted = await client.query(
      `INSERT INTO faction_lairs (key) VALUES ($1) ON CONFLICT (key) DO NOTHING RETURNING key`,
      [key],
    );
    if (!inserted.rowCount) {
      return null;
    }
    res = await client.query(`SELECT ${LAIR_COLUMNS} FROM faction_lairs WHERE key = $1 FOR UPDATE`, [key]);
  }
  return (res.rows[0] as FactionLairRow | undefined) ?? null;
}

/** 本季已灭亡的势力（范围、旗号、吞城、围攻都按它判定） */
export async function destroyedFactionKeys(q: Queryable): Promise<Set<string>> {
  const res = await q.query(`SELECT key FROM faction_lairs WHERE destroyed_at IS NOT NULL`);
  return new Set((res.rows as Array<{ key: string }>).map((row) => row.key));
}

/**
 * 每天刷新一次 20 营的战力锚点（两个锚点各自只升不降，下限 10,000），当前营保留残血比例。
 * 只有到了刷新时刻（faction_lairs.power_at + 间隔）的行才更新；返回本轮的锚点（无更新时都为 0）。
 * 残血缩放按“当前营序号”取新旧锚点对应的 Gk：旧行（G1 = G20 = 旧 camp_power）行为与 v101 一致。
 * 调用方持有事务：Worker 的定时器（faction-lair-tick.ts）单独一个事务，不在战斗结算里算。
 */
export async function refreshFactionLairPower(
  client: pg.PoolClient,
  now: Date,
): Promise<{ refreshed: number; g1: number; g20: number }> {
  const res = await client.query(
    `SELECT ${LAIR_COLUMNS} FROM faction_lairs WHERE destroyed_at IS NULL FOR UPDATE`,
  );
  const rows = res.rows as FactionLairRow[];
  const refreshMs = factionLairPowerRefreshMs();
  const due = rows.filter((row) => !row.power_at || now.getTime() - row.power_at.getTime() >= refreshMs);
  if (due.length === 0) {
    return { refreshed: 0, g1: 0, g20: 0 };
  }
  const anchors = await serverAnchorPowers(client);
  const next = factionLairAnchorPower(anchors.r10, anchors.r3);
  for (const row of due) {
    // 只升不降：两个锚点各自取历史最大；G20 不会低于 G1
    const g1 = Math.max(row.camp_power_g1, next.g1);
    const g20 = Math.max(row.camp_power_g20, next.g20, g1);
    const campNo = factionLairCampNo(row.camps_total || FACTION_LAIR_CAMPS, row.camps_remaining);
    const oldPower = factionLairCampPowerAt(row.camp_power_g1, row.camp_power_g20, campNo);
    const newPower = factionLairCampPowerAt(g1, g20, campNo);
    const remaining = newPower === oldPower ? row.remaining : rescaledLairRemaining(row.remaining, oldPower, newPower);
    await client.query(
      `UPDATE faction_lairs SET camp_power_g1 = $2, camp_power_g20 = $3, power_at = $4, remaining = $5::jsonb,
              remaining_at = CASE WHEN $5::jsonb IS NULL THEN NULL ELSE remaining_at END
       WHERE key = $1`,
      [row.key, g1, g20, now, remaining ? JSON.stringify(remaining) : null],
    );
  }
  return { refreshed: due.length, g1: next.g1, g20: next.g20 };
}

/**
 * 单行「24 小时没人进攻恢复 1 营」：返回更新后的行（不恢复则原样返回）。
 * 战斗结算与定时器共用同一口径（faction-lair.ts 的 factionLairRecoveredCamps）。
 */
export async function recoverLairRow(
  client: Writer,
  row: FactionLairRow,
  now: Date,
  recoverMs: number = factionLairRecoverMs(),
): Promise<FactionLairRow> {
  if (row.destroyed_at) {
    return row;
  }
  const camps = factionLairRecoveredCamps({
    campsRemaining: row.camps_remaining,
    campsTotal: row.camps_total,
    lastBattleAt: row.last_battle_at,
    now,
    recoverMs,
  });
  if (camps <= 0) {
    return row;
  }
  // 恢复后把 last_battle_at 往后推一个恢复间隔，避免重复计算
  const nextBattleAt = new Date((row.last_battle_at as Date).getTime() + camps * Math.max(1, recoverMs));
  await client.query(
    `UPDATE faction_lairs
     SET camps_remaining = LEAST(camps_total, camps_remaining + $2), remaining = NULL, remaining_at = NULL,
         last_battle_at = $3
     WHERE key = $1`,
    [row.key, camps, nextBattleAt],
  );
  return {
    ...row,
    camps_remaining: Math.min(row.camps_total, row.camps_remaining + camps),
    remaining: null,
    remaining_at: null,
    last_battle_at: nextBattleAt,
  };
}

/**
 * 连续 24 小时（随缩放）没人进攻的老巢恢复 1 营，当前营残血同时回满（总数不超过 20）。
 * 从没被打过的老巢不恢复。返回本次恢复的营数合计。
 */
export async function recoverFactionLairs(client: Queryable, now: Date): Promise<number> {
  const res = await client.query(
    `SELECT ${LAIR_COLUMNS} FROM faction_lairs
     WHERE destroyed_at IS NULL AND last_battle_at IS NOT NULL AND camps_remaining < camps_total
     FOR UPDATE`,
  );
  let recovered = 0;
  for (const row of res.rows as FactionLairRow[]) {
    const before = row.camps_remaining;
    const next = await recoverLairRow(client, row, now);
    recovered += next.camps_remaining - before;
  }
  return recovered;
}

/** 贡献榜：给某人累加歼灭的守军战力（每场战斗结算时写） */
export async function addFactionContribution(
  client: Writer,
  key: string,
  accountId: string,
  power: number,
): Promise<void> {
  const amount = Math.max(0, Math.floor(power));
  if (amount <= 0) {
    return;
  }
  await client.query(
    `INSERT INTO faction_contrib (key, account_id, power, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (key, account_id) DO UPDATE SET power = faction_contrib.power + EXCLUDED.power, updated_at = now()`,
    [key, accountId, amount],
  );
}

/** 贡献榜（按歼灭战力倒序；同名次按账号 id 稳定排序） */
export async function loadFactionContributions(
  q: Queryable,
  key: string,
): Promise<Array<{ accountId: string; power: number }>> {
  const res = await q.query(
    `SELECT account_id, power FROM faction_contrib WHERE key = $1 AND power > 0 ORDER BY power DESC, account_id`,
    [key],
  );
  return (res.rows as Array<{ account_id: string; power: string | number }>).map((row) => ({
    accountId: row.account_id,
    power: Number(row.power),
  }));
}

/** 玩家在某家老巢贡献榜上的名次与累计战力（没打过返回 null） */
export async function factionContributionOf(
  q: Queryable,
  key: string,
  accountId: string,
): Promise<{ rank: number; power: number } | null> {
  const rows = await loadFactionContributions(q, key);
  const index = rows.findIndex((row) => row.accountId === accountId);
  return index >= 0 ? { rank: index + 1, power: rows[index].power } : null;
}
