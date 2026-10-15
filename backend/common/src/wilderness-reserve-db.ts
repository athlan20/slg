// 野地储量的数据库读写（v61，AISLG-165）：纯规则在 wilderness-reserve.ts，这里只负责落库、
// 采空事件与推送。城池结算（production.ts）、掠夺（plunder-tick）与流寇（moving-tick）共用这里的函数。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from './db';
import { insertEvent } from './events';
import { advanceTile, type TileReserveStep, type TerritorySettle } from './wilderness-reserve';
import type { TerritoryRow } from './world';

type Queryable = pg.PoolClient;

/** 批量写回城池名下野地的储量（一条语句；与结算同一事务） */
export async function persistTileReserves(client: Queryable, updates: TerritorySettle['updates']): Promise<void> {
  if (updates.length === 0) {
    return;
  }
  await client.query(
    `UPDATE world_tiles t
     SET reserve = v.reserve, reserve_at = v.reserve_at, reserve_empty_at = v.empty_at
     FROM unnest($1::int[], $2::int[], $3::float8[], $4::timestamptz[], $5::timestamptz[])
       AS v(x, y, reserve, reserve_at, empty_at)
     WHERE t.x = v.x AND t.y = v.y`,
    [
      updates.map((u) => u.x),
      updates.map((u) => u.y),
      updates.map((u) => u.reserve),
      updates.map((u) => u.reserveAt),
      updates.map((u) => u.emptyAt),
    ],
  );
}

/**
 * 采空事件：写入归属方账号的事件流（wilderness_depleted）并经 pg_notify 推送地块变化（PUSH_TILE_STATE，
 * reserve_depleted）。与结算同一事务，COMMIT 后才投递。
 */
export async function emitReserveDepletions(client: Queryable, cityId: string, settle: TerritorySettle): Promise<void> {
  if (settle.depletions.length === 0) {
    return;
  }
  const owner = await client.query(`SELECT account_id FROM cities WHERE id = $1`, [cityId]);
  const accountId = (owner.rows[0] as { account_id: string } | undefined)?.account_id;
  if (!accountId) {
    return;
  }
  for (const depletion of settle.depletions) {
    await insertEvent(client, {
      accountId,
      cityId,
      type: 'wilderness_depleted',
      detail: {
        x: depletion.x,
        y: depletion.y,
        terrain: depletion.terrain,
        level: depletion.level,
        at: depletion.at.toISOString(),
      },
    });
    await client.query(`SELECT pg_notify($1, $2)`, [
      NOTIFY_CHANNEL,
      JSON.stringify({ reason: 'tile_changed', accountId, x: depletion.x, y: depletion.y, tileReason: 'reserve_depleted' }),
    ]);
  }
}

interface TileReserveRow extends TerritoryRow {
  owner_city_id: string | null;
  garrison: number;
}

/** 读取地块并推进到 at（只读；未加锁，调用方在同一事务内锁定或已由城池结算锁定） */
async function loadTileForReserve(client: Queryable, x: number, y: number): Promise<TileReserveRow | null> {
  const res = await client.query(
    `SELECT wt.x, wt.y, wt.terrain, wt.level, wt.owner_city_id, wt.reserve, wt.reserve_at,
            COALESCE((SELECT sum(count) FROM tile_army ta WHERE ta.x = wt.x AND ta.y = wt.y), 0)::int AS garrison
     FROM world_tiles wt WHERE wt.x = $1 AND wt.y = $2`,
    [x, y],
  );
  return (res.rows[0] as TileReserveRow | undefined) ?? null;
}

/**
 * 地块在 at 时刻的当前储量（基准单位）。无主野地按恢复推进；归属方地块须是 at 已由城池结算到的时刻
 *（掠夺 / 流寇调用前先结算归属方城池）。地块不存在返回 null。
 */
export async function readTileReserve(client: Queryable, x: number, y: number, at: Date): Promise<number | null> {
  const tile = await loadTileForReserve(client, x, y);
  if (!tile) {
    return null;
  }
  return advanceTile(tile, tile.reserve_at ?? at, at, tile.owner_city_id !== null).reserve;
}

/**
 * 把地块储量写为 reserve（基准单位，钳 0）并记录 at 为落库时刻；同时按当前驻军重算预计采空时刻，
 * 供 Worker 到点结算。用于掠夺 / 流寇扣减，不改归属。
 */
export async function writeTileReserve(client: Queryable, x: number, y: number, reserve: number, at: Date): Promise<void> {
  const tile = await loadTileForReserve(client, x, y);
  if (!tile) {
    return;
  }
  const next = Math.max(0, reserve);
  const step: TileReserveStep = advanceTile({ ...tile, reserve: next, reserve_at: at }, at, at, tile.owner_city_id !== null);
  await persistTileReserves(client, [{ x, y, reserve: next, reserveAt: at, emptyAt: step.emptyAt }]);
}
