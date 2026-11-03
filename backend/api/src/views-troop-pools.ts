// GET_TROOP_POOLS（op 147，v88，AISLG-218）的只读视图组装：账号全部城的伤兵 / 俘虏 / 逃兵三池
// 与各城断粮时刻。从 handlers-troop-pools.ts 拆出以控制单文件行数。
//
// 只读：不开事务、不加锁、不落库——生产结算只在内存里推进（accrueProduction 纯函数），
// 与 GET_STATE（loadCityState 会先把生产结算落库）的差别仅在结算时刻的毫秒与取整误差内。
// 断粮口径与 CityView.starveAt 一致（views.ts toCityView）：粮食按「粮毛产量 − 全军耗粮」推进，
// 再交给 common/src/starvation.ts 的 projectStarvation 推算，不另造一套公式。

import type pg from 'pg';
import { type AccountTroopPoolsCityView, type TroopPoolKind } from '../../common/src/protocol';
import { emptyPoolRecord, loadAccountTroopPools } from '../../common/src/troop-pools-db';
import {
  accrueProduction,
  loadArmyFoodUsePerHour,
  loadBuildingLevels,
  loadProductionBonusPercent,
  productionPerHour,
  storageCaps,
} from '../../common/src/production';
import { loadCityGuard } from '../../common/src/hero-db';
import { guardProductionPercent } from '../../common/src/hero';
import { loadTechLevels } from '../../common/src/tech-db';
import { projectStarvation } from '../../common/src/starvation';
import { loadTerritory } from '../../common/src/world-db';
import { territoryDisplayRates } from '../../common/src/wilderness-reserve';

/** 城池行里断粮推算需要的列（与 CityProductionRow 同源，只读取需要的部分） */
interface CityRow {
  id: string;
  name: string;
  gold: number;
  wood: number;
  food: number;
  stone: number;
  iron: number;
  food_rem: number;
  settled_at: Date;
}

/**
 * 单城断粮开始时刻（ISO 8601；不会断粮为 null）——与 CityView.starveAt 同口径：
 * 粮食按净产量推进到现在（只在内存里，不落库），再由 projectStarvation 推算。
 * 逐城复用 views.ts 用到的同一批函数（产量 / 耗粮 / 城守 / 科技 / 野地采集），不重写规则。
 */
async function starveAtOf(
  client: pg.PoolClient,
  city: CityRow,
  accountTechs: Awaited<ReturnType<typeof loadTechLevels>>,
  nowMs: number,
): Promise<string | null> {
  const levels = await loadBuildingLevels(client, city.id);
  const territory = await loadTerritory(client, city.id);
  const guard = await loadCityGuard(client, city.id);
  const bonusPercent = await loadProductionBonusPercent(client, city.id);
  const rates = productionPerHour(
    levels,
    territoryDisplayRates(territory),
    bonusPercent,
    accountTechs,
    guard ? guardProductionPercent(guard.wit) : 0,
  );
  const armyUsePerHour = await loadArmyFoodUsePerHour(client, city.id, accountTechs);
  // 粮食在内存里推进到 now（与 settleCityProduction 同一个纯函数；余数只关心粮，其余留 0）
  const { gains } = accrueProduction(
    rates,
    { gold: 0, food: city.food_rem, wood: 0, stone: 0, iron: 0 },
    Math.max(0, nowMs - city.settled_at.getTime()),
    storageCaps(levels, accountTechs),
    { gold: city.gold, food: city.food, wood: city.wood, stone: city.stone, iron: city.iron },
    armyUsePerHour,
  );
  const projection = projectStarvation(city.food + gains.food, rates.food - armyUsePerHour, nowMs);
  return projection.starveAtMs === null ? null : new Date(projection.starveAtMs).toISOString();
}

/**
 * 账号全部城的伤兵营视图（GET_TROOP_POOLS 的响应 data.cities）：主城在前、其余按创建时间；
 * 三个池子结构与 CityView 的 wounded / captives / deserters 完全相同，三池全空的城也返回。
 * 池子只用一次查询（loadAccountTroopPools）；断粮推算按城逐城读取产量相关数据（只读、无锁）。
 */
export async function loadAccountTroopPoolsView(
  client: pg.PoolClient,
  accountId: string,
): Promise<AccountTroopPoolsCityView[]> {
  const cityRes = await client.query(
    `SELECT id, name, gold, wood, food, stone, iron, food_rem, settled_at, now() AS db_now
     FROM cities WHERE account_id = $1
     ORDER BY created_at, id`,
    [accountId],
  );
  const rows = cityRes.rows as Array<CityRow & { db_now: Date }>;
  if (rows.length === 0) {
    return [];
  }
  const nowMs = rows[0].db_now.getTime();
  const poolsByCity = await loadAccountTroopPools(client, accountId);
  const techs = await loadTechLevels(client, accountId);
  const out: AccountTroopPoolsCityView[] = [];
  // 主城 = 创建时间最早（与 lockCitySnapshot / views.ts 的主城口径一致，rows 已按创建时间排序）
  for (const [index, row] of rows.entries()) {
    const record = poolsByCity.get(row.id) ?? emptyPoolRecord();
    const pools: Record<TroopPoolKind, AccountTroopPoolsCityView['wounded']> = record;
    out.push({
      cityId: row.id,
      name: row.name,
      isMain: index === 0,
      starveAt: await starveAtOf(client, row, techs, nowMs),
      wounded: pools.wounded,
      captives: pools.captive,
      deserters: pools.deserter,
    });
  }
  // 主城恒在第一位；其余保持创建时间顺序（上面的循环已经是这个顺序）
  return out;
}
