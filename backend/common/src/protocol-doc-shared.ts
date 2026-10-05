// 协议文档各协议示例共用的常量：示例 id、时间戳与派生数值。
// 数值直接引用 rules.ts / production.ts 的常量与计算，保证文档示例与服务端真实返回一致。
// 受全局时间缩放影响的数值一律经 atBaseTimeScale 按未加速基准（scale=1）计算，与文档声明一致。

import {
  DEFAULT_BUILD_SECONDS,
  FARM_COST,
  INITIAL_BUILDINGS,
  INITIAL_POPULATION,
  INITIAL_RESOURCES,
  actionCosts,
  applyCost,
  popCap,
  populationGrowthPerHour,
} from './rules';
import { emptyBuildingLevels, productionPerHour, storageCaps } from './production';
import { atBaseTimeScale } from './time-scale';
import type { ArmyCounts, CityView } from './protocol';
import { EMPTY_ARMY } from './protocol-doc-army-consts';

export const CITY_ID = 'c8a1f1de-3b2a-4c5d-8e9f-0a1b2c3d4e5f';
export const ACCOUNT_ID = '0d3d8e2a-6f2b-4f4e-9d8f-1a2b3c4d5e6f';
export const BUILD_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
export const STARTED_AT = '2026-09-25T08:00:00.000Z';
/** 示例会话令牌（43 字符随机串形态；真实令牌由服务端签发） */
export const TOKEN = 'session-example-token-for-doc-0000000000000';
/** 示例会话过期时间：签发时间 + 30 天 */
export const TOKEN_EXPIRES_AT = '2026-10-25T08:00:00.000Z';
/** 示例到期时间 = 开始时间 + 默认建造时长（保持与 rules.ts 同步） */
export const DUE_AT = new Date(Date.parse(STARTED_AT) + DEFAULT_BUILD_SECONDS * 1000).toISOString();
/** 十四种建筑（v27 起含书院，v30 起含校场 / 烽火台 / 驿站 / 箭塔）全为 0 的 buildings / levels 示例 */
export const EMPTY_BUILDINGS = {
  farm: 0,
  lumber_mill: 0,
  quarry: 0,
  iron_mine: 0,
  house: 0,
  government: 0,
  barracks: 0,
  warehouse: 0,
  wall: 0,
  academy: 0,
  parade_ground: 0,
  beacon: 0,
  post_station: 0,
  arrow_tower: 0,
  tavern: 0,
} as const;
export const EMPTY_LEVELS = EMPTY_BUILDINGS;
/** 扣减建造成本后的资源示例 */
export const AFTER_COST = applyCost(INITIAL_RESOURCES, FARM_COST);

/** 开号之初的等级视图：自带建筑（1 级官府）叠加在空城之上 */
export const INITIAL_LEVELS = { ...emptyBuildingLevels(), ...INITIAL_BUILDINGS };
/** 开号之初的 buildings 视图（0/1，官府为 1） */
export const INITIAL_BUILDINGS_VIEW = { ...EMPTY_BUILDINGS, government: 1 };
/** 开号之初的产量示例（自带 1 级官府 → 金 100/小时，v19） */
export const INITIAL_PRODUCTION = atBaseTimeScale(() => productionPerHour(INITIAL_LEVELS));
/** 开号之初的动作成本示例（官府给升级成本，其余给建造成本） */
export const INITIAL_COSTS = actionCosts(INITIAL_LEVELS);
/** 一座农田建成后的动作成本示例（在开号基础上叠加农田） */
export const FARM_BUILT_COSTS = actionCosts({ ...INITIAL_LEVELS, farm: 1 });
/** 农田与伐木场均建成后的动作成本示例 */
export const FARM_LUMBER_COSTS = actionCosts({ ...INITIAL_LEVELS, farm: 1, lumber_mill: 1 });
/** 一座农田建成后的产量示例（引用 production.ts 的真实计算，与文档保持同步） */
export const FARM_PRODUCTION = atBaseTimeScale(() => productionPerHour({ ...INITIAL_LEVELS, farm: 1 }));

/** 开号之初的人口现状示例（v8 规则 + 2026-09-27 开局决策：人口 50；v19 起无民房上限即基线 50——
 *  开号 50/50 满编、增速 0，建民房后恢复增长） */
export const INITIAL_POPULATION_VIEW = {
  current: INITIAL_POPULATION,
  cap: popCap(0),
  growthPerHour: atBaseTimeScale(() => populationGrowthPerHour(0)),
};
/** 开号之初的储量上限示例（v8：四资源 = 基础值，金币固定 100 万；官府不影响储量上限） */
export const INITIAL_STORAGE = atBaseTimeScale(() => storageCaps(INITIAL_LEVELS));
/** 农田与伐木场均建成后（各 Lv1）的储量上限示例：粮 22000 / 木 11000 */
export const FARM_LUMBER_STORAGE = atBaseTimeScale(() => storageCaps({ ...INITIAL_LEVELS, farm: 1, lumber_mill: 1 }));

/** BuildView 示例（GET_STATE / BUILD / 推送共用同一结构） */
export const BUILD_VIEW = {
  id: BUILD_ID,
  cityId: CITY_ID,
  kind: 'farm',
  status: 'building',
  level: 1,
  toLevel: null,
  initiator: 'agent',
  startedAt: STARTED_AT,
  dueAt: DUE_AT,
  completedAt: null,
} as const;

/** 排队中的 BuildView 示例：dueAt 为 null，开工（队首激活）时由服务端重算 */
export const QUEUED_BUILD_VIEW = {
  id: '8d0f7790-8536-51ef-a5ef-f18bd2a01b8f',
  cityId: CITY_ID,
  kind: 'lumber_mill',
  status: 'queued',
  level: 1,
  toLevel: null,
  initiator: 'player',
  startedAt: '2026-09-25T08:00:30.000Z',
  dueAt: null,
  completedAt: null,
} as const;

/** 已取消的排队条目示例（CANCEL_BUILD 响应与 build_cancelled 推送共用） */
export const CANCELLED_BUILD_VIEW = {
  ...QUEUED_BUILD_VIEW,
  status: 'cancelled',
} as const;

/**
 * 完整 CityView 示例：以开号初始状态为底、按需覆盖差异字段。返回值受 CityView 类型约束——
 * 协议新增字段而示例未补时直接编译失败，避免各示例手写对象逐渐缺字段（此前多处示例缺
 * timeScale / truceUntil / armyFoodUsePerHour / marches 等）。timeScale 示例取 1（未加速基准）。
 */
export function exampleCity(overrides: Partial<CityView> = {}): CityView {
  return {
    id: CITY_ID,
    name: '主城',
    level: 1,
    resources: { ...INITIAL_RESOURCES },
    buildings: { ...INITIAL_BUILDINGS_VIEW },
    levels: { ...INITIAL_LEVELS },
    costs: INITIAL_COSTS,
    farms: 0,
    production: { ...INITIAL_PRODUCTION },
    population: INITIAL_POPULATION_VIEW,
    storage: INITIAL_STORAGE,
    army: { ...EMPTY_ARMY } as ArmyCounts,
    armyFoodUsePerHour: 0,
    timeScale: 1,
    truceUntil: null,
    newbieUntil: null,
    shieldUntil: null,
    shieldNextAt: null,
    durability: null,
    famousName: null,
    productionBonusPercent: 0,
    starveAt: null,
    mutinyNextAt: null,
    guard: null,
    deploy: { count: 0, limit: 1 },
    tower: null,
    techs: { farming: 0, carrying: 0, marching: 0, storage: 0, scouting: 0, defense: 0 },
    recruitQueue: [],
    defenseBonus: 0,
    marches: [],
    territory: [],
    queue: [],
    building: null,
    ...overrides,
  };
}
