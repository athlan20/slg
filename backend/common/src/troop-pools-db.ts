// 城池部队池（伤兵 / 俘虏 / 逃兵，AISLG-212）的表结构与读写。所有世界地图战斗的
// 结算出口共用 recordPoolTroops 入账（wounded / captive），断粮兵变共用 deserter 入账；
// 治疗 / 招降 / 劝回与放弃 / 释放按「最早一批优先」的 FIFO 从池子里扣（先扣快过期的）。
// 入账、消耗都与征兵 / 遣散同一把城池行锁（lockCitySnapshot 的 FOR UPDATE），同域串行。
// 过期（expires_at <= now()）由 Worker 周期清理；读取时也过滤过期行，两边都兜住。

import type pg from 'pg';
import { TROOP_KINDS, type ArmyCounts, type TroopKind, type TroopPoolKind, type TroopPoolView } from './protocol';
import { scaledMs } from './time-scale';
import { CAPTIVE_TTL_HOURS, DESERTER_TTL_HOURS, WOUNDED_TTL_HOURS } from './battle-casualties';

export type { TroopPoolKind, TroopPoolView };

export const TROOP_POOL_KINDS: readonly TroopPoolKind[] = ['wounded', 'captive', 'deserter'];

export function isTroopPoolKind(value: unknown): value is TroopPoolKind {
  return typeof value === 'string' && (TROOP_POOL_KINDS as readonly string[]).includes(value);
}

/** 各池子的过期时长（小时基准，入账时按当时全局时间缩放换算成 wall-clock 写死） */
export function poolTtlHours(pool: TroopPoolKind): number {
  if (pool === 'wounded') {
    return WOUNDED_TTL_HOURS;
  }
  return pool === 'captive' ? CAPTIVE_TTL_HOURS : DESERTER_TTL_HOURS;
}

export function emptyPoolView(): TroopPoolView {
  const troops = {} as ArmyCounts;
  for (const kind of TROOP_KINDS) {
    troops[kind] = 0;
  }
  return { troops, earliestExpireAt: null };
}

/** 过滤出「兵种 → 正整数」的非空记录（入账用）；空编队返回 null（不写行） */
export function normalizePoolTroops(value: unknown): Partial<Record<TroopKind, number>> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const out: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const raw = (value as Record<string, unknown>)[kind];
    const count = typeof raw === 'number' && Number.isInteger(raw) ? raw : Math.floor(Number(raw));
    if (Number.isFinite(count) && count > 0) {
      out[kind] = count;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * 战斗 / 兵变入账：一次一行（一批），过期时刻 = 数据库 now() + 时长 ÷ 时间缩放。
 * 空编队不写行。调用方持有城池行锁（世界地图战斗的结算事务 / 断粮哗变事务）。
 */
export async function recordPoolTroops(
  client: pg.PoolClient,
  cityId: string,
  pool: TroopPoolKind,
  troops: Partial<Record<TroopKind, number>>,
): Promise<void> {
  const filtered = normalizePoolTroops(troops);
  if (!filtered) {
    return;
  }
  const ttlMs = scaledMs(poolTtlHours(pool) * 3_600_000);
  await client.query(
    `INSERT INTO city_troop_pools (city_id, pool, troops, expires_at)
     VALUES ($1, $2, $3::jsonb, now() + make_interval(secs => $4::double precision / 1000))`,
    [cityId, pool, JSON.stringify(filtered), ttlMs],
  );
}

/** 读取一城三个池子的聚合视图（过期行过滤掉，不入账也不报错） */
export async function loadCityTroopPools(
  q: pg.Pool | pg.PoolClient,
  cityId: string,
): Promise<Record<TroopPoolKind, TroopPoolView>> {
  const res = await q.query(
    `SELECT pool, troops, expires_at FROM city_troop_pools
     WHERE city_id = $1 AND expires_at > now()
     ORDER BY expires_at, created_at, id`,
    [cityId],
  );
  const out: Record<TroopPoolKind, TroopPoolView> = {
    wounded: emptyPoolView(),
    captive: emptyPoolView(),
    deserter: emptyPoolView(),
  };
  for (const row of res.rows as Array<{ pool: TroopPoolKind; troops: Partial<Record<TroopKind, number>>; expires_at: Date }>) {
    const view = out[row.pool];
    if (!view) {
      continue;
    }
    for (const kind of TROOP_KINDS) {
      view.troops[kind] += Math.max(0, Math.floor(row.troops?.[kind] ?? 0));
    }
    if (view.earliestExpireAt === null) {
      view.earliestExpireAt = row.expires_at.toISOString();
    }
  }
  return out;
}

/** 某兵种在池子里的现有量（handler 校验「数量超过现有」用） */
export function poolCountOf(view: TroopPoolView, kind: TroopKind): number {
  return Math.max(0, Math.floor(view.troops[kind] ?? 0));
}

/**
 * FIFO 扣减：按最早一批优先（先扣快过期的），逐行 UPDATE / DELETE。
 * 调用方已校验数量充足（handler 在同一城池行锁内先读后扣）；扣到负数不会发生。
 */
export async function consumePoolTroops(
  client: pg.PoolClient,
  cityId: string,
  pool: TroopPoolKind,
  troops: Partial<Record<TroopKind, number>>,
): Promise<void> {
  for (const kind of TROOP_KINDS) {
    let remaining = Math.floor(troops[kind] ?? 0);
    if (remaining <= 0) {
      continue;
    }
    const res = await client.query(
      `SELECT id, troops FROM city_troop_pools
       WHERE city_id = $1 AND pool = $2 AND expires_at > now()
       ORDER BY expires_at, created_at, id`,
      [cityId, pool],
    );
    for (const row of res.rows as Array<{ id: string; troops: Partial<Record<TroopKind, number>> }>) {
      if (remaining <= 0) {
        break;
      }
      const have = Math.max(0, Math.floor(row.troops?.[kind] ?? 0));
      if (have <= 0) {
        continue;
      }
      const take = Math.min(have, remaining);
      remaining -= take;
      const left = have - take;
      if (left <= 0) {
        const next = { ...row.troops, [kind]: 0 };
        const stillHas = TROOP_KINDS.some((k) => Math.max(0, Math.floor(next[k] ?? 0)) > 0);
        if (!stillHas) {
          await client.query(`DELETE FROM city_troop_pools WHERE id = $1`, [row.id]);
        } else {
          await client.query(`UPDATE city_troop_pools SET troops = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify(next)]);
        }
      } else {
        await client.query(
          `UPDATE city_troop_pools SET troops = jsonb_set(troops, ARRAY[$2::text], to_jsonb($3::int)) WHERE id = $1`,
          [row.id, kind, left],
        );
      }
    }
  }
}

/** 城池易主（被占 / 放弃 / 合并 / 换主）时清空三池：伤兵、俘虏、逃兵一起消失 */
export async function clearCityTroopPools(client: pg.PoolClient, cityId: string): Promise<void> {
  await client.query(`DELETE FROM city_troop_pools WHERE city_id = $1`, [cityId]);
}

/** Worker 周期清理：删除已过期的批次（读取侧也过滤，两边都兜住） */
export async function cleanupExpiredTroopPools(pool: pg.Pool): Promise<number> {
  const res = await pool.query(`DELETE FROM city_troop_pools WHERE expires_at <= now()`);
  return res.rowCount ?? 0;
}
