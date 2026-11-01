// 伤兵 / 俘虏 / 逃兵的操作协议（v85，AISLG-212）：RESTORE_TROOPS（治疗 / 招降 / 劝回）
// 与 RELEASE_TROOPS（放弃治疗 / 释放俘虏）。从 handlers-army.ts 独立出来，只处理这两条。
// 规则要点（数值见 common/src/battle-casualties.ts，评审定稿不得自行更改）：
// - 立即完成，无等待时间；治好 / 招降 / 劝回的兵直接进该城城内驻军；
// - 治疗（wounded）花征兵资源 × 50%，不扣人口（治好再遣散不赚不亏）；
// - 招降（captive）花征兵资源 × 60%，要扣人口（与征兵同口径，人口不足
//   INSUFFICIENT_POPULATION）；军营等级不够征募该兵种也能招降（俘虏是现成的兵）；
// - 劝回（deserter）花征兵资源 × 50%，不扣人口；该城正在断粮时拒绝（CITY_STARVING）；
// - 消耗按最早一批优先（FIFO，先扣快过期的）；
// - 数量超过池内现有 / troops 为空 / 未知兵种 / 非正整数 → INVALID_PARAMS，不改任何数据；
// - 资源不足 → INSUFFICIENT_RESOURCES（附 shortfall 缺口，v22 AISLG-69 口径）；
// - 放弃 / 释放免费，池子直接消失，不返还任何东西。
// 锁序：与征兵 / 遣散同一把城池行锁（lockCitySnapshot 内含生产结算）。

import { Op, RESOURCE_KEYS, TROOP_KINDS, isTroopKind, type Resources, type TroopKind } from '../../common/src/protocol';
import {
  CAPTIVE_RECRUIT_COST_PERCENT,
  DESERTER_RECALL_COST_PERCENT,
  HEAL_COST_PERCENT,
  restoreCost,
  restorePopulationCost,
} from '../../common/src/battle-casualties';
import type pg from 'pg';
import { consumePoolTroops, isTroopPoolKind, loadCityTroopPools, type TroopPoolKind } from '../../common/src/troop-pools-db';
import { loadArmyFoodUsePerHour, productionPerHour } from '../../common/src/production';
import { territoryDisplayRates } from '../../common/src/wilderness-reserve';
import { projectStarvation } from '../../common/src/starvation';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { insufficientPopulationDetail, insufficientResourcesDetail } from './handlers-city';
import { loadCityState, lockCitySnapshot } from './views';

type Troops = Partial<Record<TroopKind, number>>;

/**
 * RESTORE_TROOPS / RELEASE_TROOPS 的请求解析（v85）：pool 必须是已知池子（RELEASE 只认
 * wounded / captive——逃兵不能释放，只能劝回或等过期），troops 必须是非空对象、键为
 * 已知兵种、值为正整数；不合法返回 null（调用方答 INVALID_PARAMS）。
 */
export function readTroopPoolRequest(
  data: Record<string, unknown> | undefined,
  allowDeserter: boolean,
): { pool: TroopPoolKind; troops: Troops } | null {
  const pool = data?.pool;
  if (!isTroopPoolKind(pool) || (pool === 'deserter' && !allowDeserter)) {
    return null;
  }
  const raw = data?.troops;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return null;
  }
  const troops: Troops = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isTroopKind(key)) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return null;
    }
    troops[key] = value;
  }
  if (Object.keys(troops).length === 0) {
    return null;
  }
  return { pool, troops };
}

/** 请求数量超过池内现有的兵种（无则 null） */
function overAskedPoolKind(poolTroops: Record<TroopKind, number>, troops: Troops): TroopKind | null {
  for (const kind of TROOP_KINDS) {
    const count = troops[kind] ?? 0;
    if (count > (poolTroops[kind] ?? 0)) {
      return kind;
    }
  }
  return null;
}

/** 把指定数量入该城城内驻军（征兵完成同款 upsert） */
async function troopsEnterGarrison(client: pg.PoolClient, cityId: string, troops: Troops): Promise<void> {
  for (const kind of TROOP_KINDS) {
    const count = troops[kind] ?? 0;
    if (count > 0) {
      await client.query(
        `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)
         ON CONFLICT (city_id, troop) DO UPDATE SET count = city_army.count + EXCLUDED.count, updated_at = now()`,
        [cityId, kind, count],
      );
    }
  }
}

/** 治疗 / 招降 / 劝回：扣资源（招降另扣人口）、按最早一批扣池子、兵回城内驻军 */
export async function handleRestoreTroops(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  pool: TroopPoolKind,
  troops: Troops,
): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    const pools = await loadCityTroopPools(client, snap.cityId);
    const over = overAskedPoolKind(pools[pool].troops, troops);
    if (over !== null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    // 逃兵只有不在断粮状态时才能劝回（断粮中 CITY_STARVING）
    if (pool === 'deserter') {
      const rates = productionPerHour(
        snap.levels,
        territoryDisplayRates(snap.territory),
        snap.productionBonusPercent + snap.luoyangBonusPercent,
        snap.techs,
        snap.guardProductionPercent,
      );
      const armyUsePerHour = await loadArmyFoodUsePerHour(client, snap.cityId, snap.techs);
      const projection = projectStarvation(snap.resources.food, rates.food - armyUsePerHour, Date.now());
      if (projection.starving) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'CITY_STARVING');
        return;
      }
    }
    const percent = pool === 'wounded' ? HEAL_COST_PERCENT : pool === 'captive' ? CAPTIVE_RECRUIT_COST_PERCENT : DESERTER_RECALL_COST_PERCENT;
    const cost = restoreCost(troops, percent);
    const populationCost = pool === 'captive' ? restorePopulationCost(troops) : 0;
    const shortRes = RESOURCE_KEYS.find((key) => snap.resources[key] < cost[key]);
    if (shortRes !== undefined) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_RESOURCES', insufficientResourcesDetail(cost, snap));
      return;
    }
    if (populationCost > 0 && snap.population < populationCost) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_POPULATION', insufficientPopulationDetail(populationCost, snap));
      return;
    }
    const afterResources: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      afterResources[key] = snap.resources[key] - cost[key];
    }
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6${populationCost > 0 ? ', population = population - $7' : ''} WHERE id = $1`,
      populationCost > 0
        ? [snap.cityId, afterResources.gold, afterResources.wood, afterResources.food, afterResources.stone, afterResources.iron, populationCost]
        : [snap.cityId, afterResources.gold, afterResources.wood, afterResources.food, afterResources.stone, afterResources.iron],
    );
    await consumePoolTroops(client, snap.cityId, pool, troops);
    await troopsEnterGarrison(client, snap.cityId, troops);
    // 驻军变化后校正断粮计时：不再断粮时清掉哗变计时与预警标记（与遣散同口径）
    const armyUsePerHour = await loadArmyFoodUsePerHour(client, snap.cityId, snap.techs);
    const rates = productionPerHour(
      snap.levels,
      territoryDisplayRates(snap.territory),
      snap.productionBonusPercent + snap.luoyangBonusPercent,
      snap.techs,
      snap.guardProductionPercent,
    );
    const afterFood = afterResources.food;
    if (projectStarvation(afterFood, rates.food - armyUsePerHour, Date.now()).starveAtMs === null) {
      await client.query(
        `UPDATE cities SET mutiny_next_at = NULL, starve_warned_at = NULL
         WHERE id = $1 AND (mutiny_next_at IS NOT NULL OR starve_warned_at IS NOT NULL)`,
        [snap.cityId],
      );
    }
    await client.query('COMMIT');

    const cityState = await loadCityState(ctx.pool, accountId, snap.cityId);
    respondOk(ctx.registry, conn, op, seq, {
      restored: troops,
      cost,
      populationCost,
      ...(cityState ? { city: cityState } : {}),
    });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'troop_pools_changed', cityId: snap.cityId, pool } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 放弃治疗 / 释放俘虏：免费，按最早一批扣掉，不返还任何东西 */
export async function handleReleaseTroops(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  pool: TroopPoolKind,
  troops: Troops,
): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    const pools = await loadCityTroopPools(client, snap.cityId);
    const over = overAskedPoolKind(pools[pool].troops, troops);
    if (over !== null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    await consumePoolTroops(client, snap.cityId, pool, troops);
    await client.query('COMMIT');

    const cityState = await loadCityState(ctx.pool, accountId, snap.cityId);
    respondOk(ctx.registry, conn, op, seq, {
      released: troops,
      ...(cityState ? { city: cityState } : {}),
    });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'troop_pools_changed', cityId: snap.cityId, pool } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
