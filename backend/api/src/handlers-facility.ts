// 望楼（野地设施）的协议处理（v97，AISLG-232）：FACILITY_BUILD 一条——没盖过就新建 1 级，盖过就升一级。
// 规则与数值见 common/src/facility.ts，落库 / 视图 / 丢失见 common/src/facility-db.ts，
// 到期完成见 worker/src/facility-tick.ts。
//
// 要点：
// - 只能盖在**自己已占领的野地**上（kind = 'wilderness' 且归本账号的城池）；城池 / NPC 城 / 无主地 / 别人的野地
//   一律 FACILITY_TILE_INVALID；
// - 每块地最多一座，最高 3 级（FACILITY_MAX_LEVEL）；每座城名下的野地最多 2 座（新建时计名额，升级已有望楼不受影响）；
// - 同一块地同一时间只能有一个进行中的建造 / 升级（FACILITY_BUILDING）；
// - 资源从**占着这块地的那座城**扣（城池行锁 + 生产结算后按最新余额校验；不足返回 INSUFFICIENT_RESOURCES 且不扣任何东西）；
// - 不占城池建造队列：只有 wilderness_facilities.finish_at，由 Worker 的到期探针完成。
// 锁序与召回驻军一致：城池（lockCitySnapshot）→ 地块 → 设施行。
import type pg from 'pg';
import type { Resources } from '../../common/src/protocol';
import { applyCost } from '../../common/src/rules';
import { FACILITY_PER_CITY_LIMIT, facilityUpgradeCost, facilityUpgradeSeconds } from '../../common/src/facility';
import { countCityFacilities, lockFacility, territoryFacilityView, type FacilityRow } from '../../common/src/facility-db';
import { loadTile, type TileRow } from '../../common/src/world-db';
import { respondError, respondOk } from './frames';
import { insufficientResourcesDetail } from './handlers-city';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { lockCitySnapshot, toCityView, type CitySnapshot } from './views';

/** 资源是否够（金币 / 木 / 石；望楼不花粮与铁） */
function affordable(resources: Resources, cost: Resources): boolean {
  return resources.gold >= cost.gold && resources.wood >= cost.wood && resources.stone >= cost.stone;
}

/** 目标格是否是「本账号的城池占领着的野地」；返回占领城 id，否则 null */
async function ownedWildernessCityId(
  q: pg.Pool | pg.PoolClient,
  accountId: string,
  tile: TileRow | null,
): Promise<string | null> {
  if (!tile || tile.kind !== 'wilderness' || !tile.owner_city_id) {
    return null;
  }
  const res = await q.query(`SELECT id FROM cities WHERE id = $1 AND account_id = $2`, [tile.owner_city_id, accountId]);
  return res.rowCount ? tile.owner_city_id : null;
}

/**
 * FACILITY_BUILD：在自己占领的野地上建望楼 / 升级望楼。
 * 成功返回该地块的设施（含进行中的建造）与扣费后的城池状态；失败不改任何数据。
 */
export async function handleFacilityBuild(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  x: number,
  y: number,
): Promise<void> {
  const accountId = conn.accountId as string;
  // 先无锁读地块定位占领城（锁序：城 → 地块，与召回 / 出征一致）
  const cityId = await ownedWildernessCityId(ctx.pool, accountId, await loadTile(ctx.pool, x, y));
  if (!cityId) {
    respondError(ctx.registry, conn, op, seq, 'FACILITY_TILE_INVALID');
    return;
  }

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId, cityId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    // 复核地块仍归这座城（并发被抢 / 被召回时由行锁串开）
    const tileRes = await client.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [x, y]);
    const tile = tileRes.rows[0] as TileRow | undefined;
    if (!tile || tile.kind !== 'wilderness' || tile.owner_city_id !== cityId) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'FACILITY_TILE_INVALID');
      return;
    }
    const existing = await lockFacility(client, x, y);
    if (existing && existing.finish_at !== null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'FACILITY_BUILDING');
      return;
    }
    const currentLevel = existing?.level ?? 0;
    const cost = facilityUpgradeCost('watchtower', currentLevel);
    const seconds = facilityUpgradeSeconds('watchtower', currentLevel);
    if (!cost || seconds === null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'FACILITY_MAX_LEVEL');
      return;
    }
    // 每城最多 2 座：只对新建计名额（升级已有的望楼不受影响）
    if (!existing) {
      const count = await countCityFacilities(client, cityId);
      if (count >= FACILITY_PER_CITY_LIMIT) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'FACILITY_LIMIT', {
          limit: FACILITY_PER_CITY_LIMIT,
          count,
        });
        return;
      }
    }
    if (!affordable(snap.resources, cost)) {
      await client.query('ROLLBACK');
      // 失败附当前城池状态（含本次读取触发的生产结算）+ 缺口 / 预计等待（与 BUILD 同口径）
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_RESOURCES', {
        city: toCityView(snap),
        ...insufficientResourcesDetail(cost, snap),
      });
      return;
    }

    const afterCost = applyCost(snap.resources, cost);
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [cityId, afterCost.gold, afterCost.wood, afterCost.food, afterCost.stone, afterCost.iron],
    );
    // 没盖过：先插入一行 level = 0（进行中的那一级在 building_to）；盖过：只写进行中的那一级。
    // 同一块地同一时间只有一个进行中的建造 / 升级，上面的行锁保证不会被并发覆盖。
    const saved = await client.query(
      `INSERT INTO wilderness_facilities (x, y, kind, level, city_id, building_to, finish_at)
       VALUES ($1, $2, 'watchtower', 0, $3, $4, now() + make_interval(secs => $5))
       ON CONFLICT (x, y) DO UPDATE
         SET kind = EXCLUDED.kind, city_id = EXCLUDED.city_id, building_to = EXCLUDED.building_to,
             finish_at = EXCLUDED.finish_at, updated_at = now()
       RETURNING x, y, kind, level, city_id, building_to, finish_at`,
      [x, y, cityId, currentLevel + 1, seconds],
    );
    const row = saved.rows[0] as FacilityRow;
    await client.query('COMMIT');

    // 回包：设施（含进行中的建造）+ 扣费后的城池状态（领地里的设施同步为最新）
    const facilities = new Map(snap.facilities);
    facilities.set(`${x},${y}`, row);
    const view = toCityView({ ...(snap as CitySnapshot), resources: afterCost, facilities });
    respondOk(ctx.registry, conn, op, seq, { facility: territoryFacilityView(row), city: view });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
