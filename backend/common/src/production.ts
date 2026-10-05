// 资源生产与人口增长（v8，docs/phase-1-launch-scope.md「城池、建筑与经济」2026-09-27 确认规则）。
// 五种产出：农田/伐木场/采石场/铁矿各产一种资源，官府自动产金；四种生产资源另有各 100/h
// 的基础产量（无建筑也产出，参照旧源码 UtilsExtend.php 产量公式）；生产不占用人口
// （范围文档：四种资源建筑的生产不受工作人口限制）。
// 结算采用懒结算：cities 行记录上次结算时间与微单位余数，读取城池或扣减资源前
// 在事务内推进到当前时刻；离线期间照常累积，无需后台进程参与。
// v14 军队耗粮：粮的净产量 = 产出 − 全军小时耗粮（城内驻军 1 倍，行军 / 野地驻军 ×2，
// 参照旧源码 refreshFoodArmyUse）；耗尽后粮食钳 0、不记负债；v34（AISLG-107）起断粮另有哗变（starvation.ts / worker starvation-tick.ts：每小时城内驻军每兵种减 10%）。
// 耗粮随编成变化，每次结算前现查现算（loadArmyFoodUsePerHour），不做事件驱动缓存。
// 储量上限只钳制产出增量：达到上限后停止对应生产（余数冻结）；已有超限存量不直接
// 扣减（确认规则，耗粮扣减不受此限）；仓库不改变储量上限（改为后续战斗玩法的防掠夺保护）。
// 人口同理懒结算：线性增长至民房提供的上限（征兵消耗属后续协议，当前只增长）。
// 科技 / 道具加成尚未设计：公式保留全局乘数位（当前恒为 1）；野地占领加成与驻军
// 采集已按 extra 参数接入（v12，来源 world.ts 的 territoryRates），接入时只改本文件。

import pg from 'pg';
import { BUILDING_INFO, populationGrowthPerHour, popCap } from './rules';
import { scaledRate } from './time-scale';
import { BUILDING_KINDS, type BuildingKind, type Resources, type StorageCaps, type TroopKind } from './protocol';
import { armyFoodUsePerHour } from './troops';
import { FAMOUS_PRODUCTION_BONUS_PERCENT } from './famous-city';
import { farmingPercent, storagePercent, type TechLevels } from './tech';
import { loadTechLevelsByCity } from './tech-db';
import { loadCityGuard } from './hero-db';
import { guardProductionPercent } from './hero';

/**
 * 每级建筑的小时产量。v7 起生产不再借用「工作人口」概念（人口是民房体系，只参与征兵）；
 * 数值为 v6 之前「工作人口 × 全局速率」的折算结果，保持量级不变。
 * v19（AISLG-20）官府产金 10 → 100/级：升级成本 = 建造价 × 等级 下每级回本 2×等级
 * 小时（Lv2 约 2 小时），金币可自循环；野外金矿（world.ts 的 gold_mine 地形）为第二金源。
 */
export const RATE_PER_LEVEL: Record<'gold' | 'food' | 'wood' | 'stone' | 'iron', number> = {
  food: 120,
  wood: 100,
  stone: 80,
  iron: 60,
  gold: 100,
};

/**
 * 四种生产资源的基础产量（每小时，2026-09-27 决策，参照旧源码 UtilsExtend.php 的
 * 产量公式「100 + 建筑产量」）：无对应建筑也持续产出。金币无基础产量（官府体系）。
 * 储量上限按建筑推导的基础小时产量计算，**不含**本基础值（与旧源码上限公式一致）。
 */
export const BASE_PRODUCTION_PER_HOUR: Record<'food' | 'wood' | 'stone' | 'iron', number> = {
  food: 100,
  wood: 100,
  stone: 100,
  iron: 100,
};

/** 储量上限：基础值 + 基础小时产量 × 100（确认规则；按资源各自计算，不含加成产量与基础产量） */
export const STORAGE_BASE = 10_000;
export const STORAGE_PER_BASE_RATE = 100;
/** 黄金储量上限固定 100 万（确认规则，不由建筑提高） */
export const GOLD_CAP = 1_000_000;

/** 科技 / 野地 / 道具的产量加成乘数；相关系统上线前恒为 1（占位） */
export const PRODUCTION_BONUS_MULTIPLIER = 1;

/** 野外部队（行军中 / 野地驻军）的耗粮倍数（占位决策，参照旧源码 refreshFoodArmyUse 的 2 倍） */
export const FIELD_TROOP_FOOD_MULTIPLIER = 2;

export type ProducedResource = 'gold' | 'food' | 'wood' | 'stone' | 'iron';

export const PRODUCED_KEYS = ['gold', 'food', 'wood', 'stone', 'iron'] as const;

/** 各建筑类型的当前等级（v5：单实例，0 = 未建）；产量、人口与仓储上限都由等级推导 */
export type BuildingLevels = Record<BuildingKind, number>;

export function emptyBuildingLevels(): BuildingLevels {
  const levels = {} as BuildingLevels;
  for (const kind of BUILDING_KINDS) {
    levels[kind] = 0;
  }
  return levels;
}

/** 城池的小时产量：基础产量（四资源各 100/h，无建筑也产出）+ Σ 各生产建筑（等级 × 每级速率 × 加成乘数）。
 *  v12 起 extra 为野地占领加成与驻军采集的合计（world.ts 的 territoryRates；科技 / 道具加成仍待设计），
 *  直接按资源叠加，不经过 PRODUCTION_BONUS_MULTIPLIER。
 *  v20 起整体受全局时间缩放 × scale（AISLG-38）：结算与 CityView 下发都经过本函数，
 *  时钟快 scale 倍 = 速率 × scale，经济关系（产出 / 耗粮 / 增长同幅）保持不变。
 *  v24（AISLG-56）：bonusPercent 为该城的独占产量加成（名城分城 +20%），作用于
 *  基础 + 建筑 + 野地加成的合计、先于时间缩放。
 *  v27（AISLG-77）：techs 的农耕科技给粮 / 木 / 石 / 铁每级 +5%，与 bonusPercent 加算
 *  （同一个百分数池，金币不受农耕影响）。 */
export function productionPerHour(
  levels: Partial<BuildingLevels>,
  extra?: Partial<Record<ProducedResource, number>>,
  bonusPercent = 0,
  techs?: Partial<TechLevels>,
  /** v36（AISLG-115）：城守产量加成（四资源非金，智力 × 0.1% 封顶 5%），与农耕同一百分数池 */
  guardPercent = 0,
): Record<ProducedResource, number> {
  const rates: Record<ProducedResource, number> = {
    gold: 0,
    food: BASE_PRODUCTION_PER_HOUR.food,
    wood: BASE_PRODUCTION_PER_HOUR.wood,
    stone: BASE_PRODUCTION_PER_HOUR.stone,
    iron: BASE_PRODUCTION_PER_HOUR.iron,
  };
  for (const kind of BUILDING_KINDS) {
    const level = levels[kind] ?? 0;
    const resource = BUILDING_INFO[kind].produces;
    if (level <= 0 || resource === null) {
      continue;
    }
    rates[resource] += Math.round(level * RATE_PER_LEVEL[resource] * PRODUCTION_BONUS_MULTIPLIER);
  }
  if (extra) {
    for (const key of PRODUCED_KEYS) {
      rates[key] += extra[key] ?? 0;
    }
  }
  const farming = farmingPercent(techs);
  for (const key of PRODUCED_KEYS) {
    const percent = bonusPercent + (key === 'gold' ? 0 : farming + guardPercent);
    const boosted = percent > 0 ? Math.round((rates[key] * (100 + percent)) / 100) : rates[key];
    rates[key] = scaledRate(boosted);
  }
  return rates;
}

/**
 * 建筑推导的基础小时产量（不含加成乘数与 100/h 基础产量）：储量上限按它计算
 * （确认规则「基础 10000 + 对应资源基础小时产量 × 100」，与旧源码的上限公式一致，
 * 基础产量不计入）。
 */
function baseRatesPerHour(levels: BuildingLevels): Record<ProducedResource, number> {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
  for (const kind of BUILDING_KINDS) {
    const resource = BUILDING_INFO[kind].produces;
    const level = levels[kind] ?? 0;
    if (resource !== null && level > 0) {
      rates[resource] += level * RATE_PER_LEVEL[resource];
    }
  }
  return rates;
}

/**
 * 储量上限视图（v8 确认规则；v22 AISLG-41 随全局缩放）：粮/木/石/铁各自 =
 * （10000 + 建筑产量 × 100）× timeScale，金币 = 100 万 × timeScale。产出与上限
 * 同幅缩放，五种资源的「填满时长」恒为未加速基准（四资源 100 小时、金 2500 小时），
 * 不再随 timeScale 漂移。仓库不改变储量上限（防掠夺保护随战斗玩法接入）。
 * v27（AISLG-77）：储存科技给四资源上限每级 +5%（金币上限固定不变）。
 */
export function storageCaps(levels: BuildingLevels, techs?: Partial<TechLevels>): StorageCaps {
  const base = baseRatesPerHour(levels);
  const techPercent = storagePercent(techs);
  const capped = (key: 'food' | 'wood' | 'stone' | 'iron'): number =>
    scaledRate(Math.floor(((STORAGE_BASE + base[key] * STORAGE_PER_BASE_RATE) * (100 + techPercent)) / 100));
  return {
    gold: scaledRate(GOLD_CAP),
    food: capped('food'),
    wood: capped('wood'),
    stone: capped('stone'),
    iron: capped('iron'),
  };
}

/** cities 表保存的产量余数（1 余数单位 = 1/1_000_000 资源单位，取值 0..999_999） */
export interface ProductionRemainders {
  gold: number;
  food: number;
  wood: number;
  stone: number;
  iron: number;
}

const MS_PER_HOUR = 3_600_000;
/** 余数刻度：微单位。刻度越细，单次结算的截断损失越小（每次 < 1 微单位，不随频率放大） */
const REM_SCALE = 1_000_000;

/**
 * 一步懒结算（纯函数）：按小时产量把 elapsedMs 折算为整数产出与新的微单位余数。
 * 增量（微单位）= floor(rate × 1e6 × elapsedMs / MS_PER_HOUR)，整单位进账、余数留存；
 * 每次结算的截断误差小于 1 微单位，结算频率不影响最终产出（误差不随次数累积放大）。
 * caps 用于储量钳制（v8 确认规则：达到上限后停止对应生产，增量截断到剩余空间、
 * 余数冻结；已有超限存量不扣减），五种资源（含金币）都计入。
 * foodUsePerHour（v14）为全军小时耗粮：粮按净产量（产出 − 耗粮）结算，净耗把粮食
 * 扣到 0 为止（不记负债、部队不解散）；耗粮属于扣减，不受储量上限钳制。缺省 0 时
 * 行为与 v13 完全一致。
 */
export function accrueProduction(
  rates: Record<ProducedResource, number>,
  rems: ProductionRemainders,
  elapsedMs: number,
  caps: Record<ProducedResource, number>,
  current: Resources,
  foodUsePerHour = 0,
): { gains: Record<ProducedResource, number>; rems: ProductionRemainders } {
  const gains: Record<ProducedResource, number> = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
  const next: ProductionRemainders = { ...rems };
  if (elapsedMs > 0) {
    for (const key of PRODUCED_KEYS) {
      if (key === 'food' && foodUsePerHour > 0) {
        const micro = rems.food + Math.floor(((rates.food - foodUsePerHour) * REM_SCALE * elapsedMs) / MS_PER_HOUR);
        const rawGain = Math.floor(micro / REM_SCALE);
        const after = current.food + rawGain;
        if (rawGain > 0 && after > caps.food) {
          // 净增越过储量上限：只进账剩余空间，余数冻结在原值（与产量钳制同规则）
          gains.food = Math.max(0, caps.food - current.food);
        } else if (after < 0) {
          // 净耗超过存量：粮食钳 0，缺口不记负债（断粮仅停止增长），余数归零
          gains.food = current.food > 0 ? -current.food : 0;
          next.food = 0;
        } else {
          gains.food = rawGain;
          next.food = micro - rawGain * REM_SCALE;
        }
        continue;
      }
      const micro = rems[key] + Math.floor((rates[key] * REM_SCALE * elapsedMs) / MS_PER_HOUR);
      const rawGain = Math.floor(micro / REM_SCALE);
      if (current[key] + rawGain > caps[key]) {
        // 已达储量上限：只进账剩余空间（可能为 0），余数冻结在原值（不放大也不清零）
        gains[key] = Math.max(0, caps[key] - current[key]);
      } else {
        gains[key] = rawGain;
        next[key] = micro % REM_SCALE;
      }
    }
  }
  return { gains, rems: next };
}

/**
 * 人口增长的一步懒结算（纯函数）：线性增长，达上限后停止（余数冻结）。
 * 人口只在征兵时消耗（后续协议）；一期无拆除，民房等级只增不减。
 */
export function accruePopulation(
  current: number,
  rem: number,
  growthPerHour: number,
  cap: number,
  elapsedMs: number,
): { current: number; rem: number } {
  if (elapsedMs <= 0 || current >= cap) {
    return { current, rem };
  }
  const micro = rem + Math.floor((growthPerHour * REM_SCALE * elapsedMs) / MS_PER_HOUR);
  const grown = Math.floor(micro / REM_SCALE);
  if (current + grown > cap) {
    return { current: cap, rem };
  }
  return { current: current + grown, rem: micro % REM_SCALE };
}

// ---- 与数据库的衔接（API 的城池读取 / 建造事务内调用） ----

/** 结算所需的 cities 行子集；调用方负责在事务内对行加 FOR UPDATE 锁 */
export interface CityProductionRow {
  id: string;
  gold: number;
  wood: number;
  food: number;
  stone: number;
  iron: number;
  settled_at: Date;
  gold_rem: number;
  food_rem: number;
  wood_rem: number;
  stone_rem: number;
  iron_rem: number;
  population: number;
  population_rem: number;
}

/** 结算后的城池资源与人口快照 */
export interface SettledCity {
  resources: Resources;
  rems: ProductionRemainders;
  population: number;
  populationRem: number;
}

/** 城池的独占产量加成（百分数）：名城分城（cities.famous_name 非空）+20%，其余 0 */
export async function loadProductionBonusPercent(q: pg.Pool | pg.PoolClient, cityId: string): Promise<number> {
  const res = await q.query(`SELECT famous_name FROM cities WHERE id = $1`, [cityId]);
  return res.rows[0]?.famous_name ? FAMOUS_PRODUCTION_BONUS_PERCENT : 0;
}

/** 各类型当前等级（v5：权威来源为 city_buildings，由 Worker 在完成时 upsert） */
export async function loadBuildingLevels(q: pg.Pool | pg.PoolClient, cityId: string): Promise<BuildingLevels> {
  const res = await q.query(
    `SELECT kind, level FROM city_buildings WHERE city_id = $1`,
    [cityId],
  );
  const levels = emptyBuildingLevels();
  for (const row of res.rows as Array<{ kind: BuildingKind; level: number }>) {
    if ((BUILDING_KINDS as readonly string[]).includes(row.kind)) {
      levels[row.kind] = row.level;
    }
  }
  return levels;
}

/**
 * 全军小时耗粮（v14，读取时现查现算，不做事件驱动缓存）：城内驻军 1 倍 +
 * 行军中（含返程）与野地驻军 ×FIELD_TROOP_FOOD_MULTIPLIER（旧源码 refreshFoodArmyUse
 * 同规则；新架构在每次结算前重算，编成变化自然生效）。未知兵种按 0 计。
 * 须在城池行已锁定的同一事务内调用，与结算取同一时刻的编成。
 */
export async function loadArmyFoodUsePerHour(client: pg.PoolClient, cityId: string): Promise<number> {
  const city = await client.query(`SELECT troop, count FROM city_army WHERE city_id = $1`, [cityId]);
  const garrison = await client.query(
    `SELECT ta.troop AS troop, ta.count AS count
     FROM tile_army ta JOIN world_tiles wt ON wt.x = ta.x AND wt.y = ta.y
     WHERE wt.owner_city_id = $1`,
    [cityId],
  );
  const marching = await client.query(
    `SELECT troops FROM marches WHERE from_city_id = $1 AND status = 'marching'`,
    [cityId],
  );
  const cityCounts: Partial<Record<TroopKind, number>> = {};
  for (const row of city.rows as Array<{ troop: TroopKind; count: number }>) {
    cityCounts[row.troop] = row.count;
  }
  const fieldCounts: Partial<Record<TroopKind, number>> = {};
  const addField = (troop: string, count: number): void => {
    const value = Math.floor(count);
    if (value > 0) {
      fieldCounts[troop as TroopKind] = (fieldCounts[troop as TroopKind] ?? 0) + value;
    }
  };
  for (const row of garrison.rows as Array<{ troop: TroopKind; count: number }>) {
    addField(row.troop, row.count);
  }
  for (const row of marching.rows as Array<{ troops: Partial<Record<TroopKind, number>> | null }>) {
    for (const [troop, count] of Object.entries(row.troops ?? {})) {
      addField(troop, count ?? 0);
    }
  }
  return scaledRate(armyFoodUsePerHour(cityCounts) + FIELD_TROOP_FOOD_MULTIPLIER * armyFoodUsePerHour(fieldCounts));
}

/**
 * 把城池生产与人口推进到 now 并落库；返回结算后的资源、余数与人口。
 * 必须在调用方事务内、city 行已锁定的前提下使用；now 通常取数据库时钟（与 settled_at 同源），
 * Worker 完工切分时传建筑的到期时刻（due_at，同样由数据库时钟写入）。
 * v12 起 extra 为野地加成产量（占领变化时调用方先按旧 extra 结算到变化时刻再翻转归属，
 * 与建筑完工的产量切分同构）。
 */
export async function settleCityProduction(
  client: pg.PoolClient,
  city: CityProductionRow,
  levels: BuildingLevels,
  now: Date,
  extra?: Partial<Record<ProducedResource, number>>,
  foodUsePerHour = 0,
): Promise<SettledCity> {
  // v27：账号科技（农耕 / 储存）影响速率与上限；Worker 完成研究时先用旧等级结算再翻转等级
  // v36（AISLG-115）：城守产量加成（四资源非金）——结算与视图同口径（loadCityGuard 单点）
  const techs = await loadTechLevelsByCity(client, city.id);
  const guard = await loadCityGuard(client, city.id);
  const rates = productionPerHour(
    levels, extra, await loadProductionBonusPercent(client, city.id), techs,
    guard ? guardProductionPercent(guard.wit) : 0,
  );
  const caps = storageCaps(levels, techs);
  const rems: ProductionRemainders = {
    gold: city.gold_rem,
    food: city.food_rem,
    wood: city.wood_rem,
    stone: city.stone_rem,
    iron: city.iron_rem,
  };
  const current: Resources = {
    gold: city.gold,
    wood: city.wood,
    food: city.food,
    stone: city.stone,
    iron: city.iron,
  };
  const { gains, rems: nextRems } = accrueProduction(
    rates,
    rems,
    now.getTime() - city.settled_at.getTime(),
    caps,
    current,
    foodUsePerHour,
  );
  const resources: Resources = {
    gold: city.gold + gains.gold,
    wood: city.wood + gains.wood,
    food: city.food + gains.food,
    stone: city.stone + gains.stone,
    iron: city.iron + gains.iron,
  };
  const population = accruePopulation(
    city.population,
    city.population_rem,
    populationGrowthPerHour(levels.house),
    popCap(levels.house),
    now.getTime() - city.settled_at.getTime(),
  );
  await client.query(
    `UPDATE cities
     SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6,
         gold_rem = $7, food_rem = $8, wood_rem = $9, stone_rem = $10, iron_rem = $11,
         population = $12, population_rem = $13, settled_at = $14
     WHERE id = $1`,
    [
      city.id,
      resources.gold,
      resources.wood,
      resources.food,
      resources.stone,
      resources.iron,
      nextRems.gold,
      nextRems.food,
      nextRems.wood,
      nextRems.stone,
      nextRems.iron,
      population.current,
      population.rem,
      now,
    ],
  );
  return {
    resources,
    rems: nextRems,
    population: population.current,
    populationRem: population.rem,
  };
}
