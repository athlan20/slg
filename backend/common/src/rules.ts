// 第一期建筑与城池经济规则的最小实现（范围见 docs/phase-1-launch-scope.md
// 「城池、建筑与经济」）。API（发起建造/拆除/取消的校验）与 Worker（到期完成）共用，
// 两侧不得各自再实现一套数值或校验。
// 所有数值均为占位决策，尚未经过数值评审；调整入口只在本文件与 production.ts。

import { BUILDING_KINDS, RESOURCE_KEYS, type BuildingKind, type KindActionCosts, type Resources } from './protocol';
import { getTimeScale, scaledRate } from './time-scale';

/** 建筑建成后的经济产出；非生产建筑为 null（军营的征兵、城墙的守城加成属后续玩法） */
export type ProducesKind = 'food' | 'wood' | 'stone' | 'iron' | 'gold';

export interface BuildingInfo {
  kind: BuildingKind;
  /** 中文名（对外文档与前端文案共用） */
  label: string;
  /** 单字缩写（界面格位用） */
  short: string;
  /** 建成后生产的资源；非生产建筑为 null（功能见 effects 一节的设计文档） */
  produces: ProducesKind | null;
  /** 建造成本（占位数值） */
  cost: Resources;
}

/**
 * 建筑清单（十种，每种同城限一座；v27 AISLG-77 新增书院 academy：科技研究所需，第 N 级科技要求书院 ≥ N 级）：产出与成本均为占位数值，未经数值评审。
 * house 民房→人口上限、government 官府→自动产金（兼 v16 野地占领上限，见
 * plunder.ts 的 territoryLimit），相应数值常量见本文件下方；
 * warehouse 仓库→按等级提供防掠夺保护（v16 规则落地 plunder.ts：保护量
 * 4000×等级、四资源固定均分各 1000×等级；玩家城掠夺消费方随玩家对抗阶段接入），
 * 不改变储量上限；barracks 军营 / wall 城墙的一期玩法（征兵、守城加成）
 * 随后续协议接入，当前仅可建造与升级。一期不提供建筑拆除。
 */
export const BUILDING_INFO: Record<BuildingKind, BuildingInfo> = {
  farm: {
    kind: 'farm',
    label: '农田',
    short: '田',
    produces: 'food',
    cost: { gold: 100, wood: 50, food: 0, stone: 0, iron: 0 },
  },
  lumber_mill: {
    kind: 'lumber_mill',
    label: '伐木场',
    short: '木',
    produces: 'wood',
    cost: { gold: 120, wood: 40, food: 0, stone: 0, iron: 0 },
  },
  quarry: {
    kind: 'quarry',
    label: '采石场',
    short: '石',
    produces: 'stone',
    cost: { gold: 150, wood: 60, food: 0, stone: 0, iron: 0 },
  },
  iron_mine: {
    kind: 'iron_mine',
    label: '铁矿',
    short: '铁',
    produces: 'iron',
    cost: { gold: 200, wood: 80, food: 0, stone: 60, iron: 0 },
  },
  house: {
    kind: 'house',
    label: '民房',
    short: '民',
    produces: null,
    cost: { gold: 80, wood: 60, food: 0, stone: 0, iron: 0 },
  },
  government: {
    kind: 'government',
    label: '官府',
    short: '府',
    produces: 'gold',
    cost: { gold: 200, wood: 100, food: 0, stone: 50, iron: 0 },
  },
  barracks: {
    kind: 'barracks',
    label: '军营',
    short: '营',
    produces: null,
    cost: { gold: 150, wood: 120, food: 0, stone: 30, iron: 0 },
  },
  warehouse: {
    kind: 'warehouse',
    label: '仓库',
    short: '仓',
    produces: null,
    cost: { gold: 120, wood: 100, food: 0, stone: 30, iron: 0 },
  },
  wall: {
    kind: 'wall',
    label: '城墙',
    short: '墙',
    produces: null,
    cost: { gold: 200, wood: 80, food: 0, stone: 50, iron: 0 },
  },
  academy: {
    kind: 'academy',
    label: '书院',
    short: '院',
    produces: null,
    cost: { gold: 180, wood: 100, food: 0, stone: 50, iron: 0 },
  },
  parade_ground: {
    kind: 'parade_ground',
    label: '校场',
    short: '校',
    produces: null,
    cost: { gold: 160, wood: 100, food: 0, stone: 40, iron: 0 },
  },
  beacon: {
    kind: 'beacon',
    label: '烽火台',
    short: '烽',
    produces: null,
    cost: { gold: 140, wood: 120, food: 0, stone: 60, iron: 0 },
  },
  post_station: {
    kind: 'post_station',
    label: '驿站',
    short: '驿',
    produces: null,
    cost: { gold: 150, wood: 110, food: 0, stone: 30, iron: 0 },
  },
  arrow_tower: {
    kind: 'arrow_tower',
    label: '箭塔',
    short: '箭',
    produces: null,
    cost: { gold: 220, wood: 100, food: 0, stone: 80, iron: 60 },
  },
  tavern: {
    kind: 'tavern',
    label: '酒馆',
    short: '酒',
    produces: null,
    cost: { gold: 260, wood: 120, food: 0, stone: 60, iron: 40 },
  },
};

/** 兼容导出：农场成本（协议文档示例引用） */
export const FARM_COST: Resources = BUILDING_INFO.farm.cost;

/**
 * 注册时初始城池资源：五资源各 2000（v24，AISLG-48：800 → 2000，新号建完军营后
 * 能凑出约 23 个义兵、有机会打下 Lv1 野地；v21 AISLG-31 曾由 5000 降到 800，让开局
 * 即有资源决策；旧源码首城初始化 UserFunc.php:282 为 5000）。
 * 「开号之初」的唯一权威定义：注册与 RESET_ACCOUNT 都以本组常量复原。
 */
export const INITIAL_RESOURCES: Resources = { gold: 2000, wood: 2000, food: 2000, stone: 2000, iron: 2000 };

/**
 * 开号自带的建筑及等级（2026-09-27 决策：自动建 1 级官府，开局即产金 10/小时）。
 * 注册与 RESET_ACCOUNT 都按本表写入 city_buildings。
 */
export const INITIAL_BUILDINGS: Partial<Record<BuildingKind, number>> = { government: 1 };

/**
 * 开号初始人口（2026-09-27 决策：50）。v19 起无民房时上限即基线 50（POP_CAP_BASE），
 * 开号为「50/50 满编」状态，建民房后恢复增长（accruePopulation 的既定语义不变）。
 */
export const INITIAL_POPULATION = 50;

/** 同一城池允许的同时在建数量（第一期为 1）；建造与升级共用 */
export const MAX_ACTIVE_BUILDS = 1;

/**
 * 建造排队上限（不含在建）：占位决策。旧游戏升级走排程表 + 元宝加速
 * （仅作参考，加速体系第一期不做），容量数值
 * 未在其配置中查到，先取 2：即队列总长 = 1 在建 + 2 排队。调整入口在本文件。
 */
export const BUILD_QUEUE_CAPACITY = 2;

/**
 * 建筑等级上限（占位决策，未经数值评审）。
 * 本项目相对旧游戏的简化：每种建筑同城唯一（不可重复建造），成长走升级；
 * 旧游戏是格位制多实例，本项目不采用。
 */
export const MAX_BUILDING_LEVEL = 20;

/**
 * 升级倍数（v31，AISLG-85）：第 L → L+1 级的成本与耗时 = 基础值 × 倍数。1~10 级维持线性（倍数 = L，
 * 即升到 10 级为止的前期节奏不变）；10 级以后每级 ×1.3：L ≥ 10 时倍数 = 9 × 1.3^(L − 9)
 * （10→11 = 11.7、14→15 = 33.4、19→20 = 124.1）。Worker 排队激活的 SQL 用同一公式。
 */
export const UPGRADE_LINEAR_UNTIL = 9;
export const UPGRADE_GROWTH_AFTER = 1.3;

export function upgradeLevelFactor(currentLevel: number): number {
  const level = Math.max(1, Math.floor(currentLevel));
  return level <= UPGRADE_LINEAR_UNTIL ? level : UPGRADE_LINEAR_UNTIL * UPGRADE_GROWTH_AFTER ** (level - UPGRADE_LINEAR_UNTIL);
}

// ---- 城池经济（v8，2026-09-27 确认规则；建筑成本与每级产量仍为占位数值） ----

/**
 * 人口上限的无民房基线（v19，AISLG-22）：无民房时上限为 50 而非 0——开号人口 50
 * 显示「50/50 满编」而非自相矛盾的「50/0」，建民房后上限抬过 50 恢复增长。
 */
export const POP_CAP_BASE = 50;

/**
 * 人口上限 = 50 + 100 × 民房等级 × (民房等级 + 1)（v19，AISLG-22：基线 50）。
 * 一期无拆除，民房等级只增不减；征兵消耗人口（征兵协议后续上线）。
 */
export function popCap(houseLevel: number): number {
  const level = Math.max(0, houseLevel);
  return POP_CAP_BASE + 100 * level * (level + 1);
}

/**
 * 人口增速系数（v19，AISLG-19）：增速 = 10 × 民房等级 × (民房等级 + 1) /小时，
 * 与上限公式同构（无民房为 0，Lv1 起从零填满上限恒约 10 小时），升民房同时
 * 改善上限与增速。此前为固定 10/小时、与民房等级无关（v8 确认规则的 v19 修订）。
 * v20 起受全局时间缩放 × scale（AISLG-38），与产出 / 耗粮同幅。
 */
export const POPULATION_GROWTH_COEFFICIENT = 10;

/** 人口每小时增长 = 系数 × 民房等级 × (等级 + 1)；无民房为 0（v19，AISLG-19；v20 × scale） */
export function populationGrowthPerHour(houseLevel: number): number {
  const level = Math.max(0, houseLevel);
  return scaledRate(POPULATION_GROWTH_COEFFICIENT * level * (level + 1));
}

/**
 * 城墙守城防御加成：每级 +5（百分数数值，占位决策；v11 随 CityView.defenseBonus 对外
 * 下发）。消费方是守城战斗结算——战斗公式上线后按本项目数值评审接入，此处只定数值出口。
 */
export const WALL_DEFENSE_PER_LEVEL = 5;
/** 城墙 11~20 级每级改为 +2（v31，AISLG-85）：20 级 = 70%，加满城防科技（+10）= 80%，低于引擎封顶 90% */
export const WALL_DEFENSE_PER_LEVEL_HIGH = 2;
export const WALL_HIGH_FROM_LEVEL = 10;

/** 城墙本体的守城减伤百分数：前 10 级每级 +5，11~20 级每级 +2（不含城防科技） */
export function wallBasePercent(wallLevel: number): number {
  const level = Math.max(0, Math.floor(wallLevel));
  const low = Math.min(level, WALL_HIGH_FROM_LEVEL);
  return low * WALL_DEFENSE_PER_LEVEL + Math.max(0, level - WALL_HIGH_FROM_LEVEL) * WALL_DEFENSE_PER_LEVEL_HIGH;
}

/** 默认建造时长（秒，未加速基准），四种建筑相同；可用环境变量 BUILD_SECONDS 覆盖，便于验证 */
export const DEFAULT_BUILD_SECONDS = 60;

/**
 * 建造时长的计算基准：{ 每单位基准秒数, 缩放 }。显式 BUILD_SECONDS 覆盖时不缩放（scale=1）。
 * 缩放与 1 秒下限必须作用于**总时长**（基准 × 等级 ÷ scale），不能先把每级钳到整秒
 * 再乘等级——否则高倍速下升级时长偏差可达 20%（AISLG-38 复核修复，与 AISLG-39 征兵同模型）。
 * Worker 的排队激活 SQL 用同一基准，保证 API 与 Worker 口径一致。
 */
export function buildTimeBasis(): { seconds: number; scale: number } {
  const raw = Number(process.env.BUILD_SECONDS);
  if (Number.isFinite(raw) && raw >= 1) {
    return { seconds: Math.floor(raw), scale: 1 };
  }
  return { seconds: DEFAULT_BUILD_SECONDS, scale: getTimeScale() };
}

/** 新建时长（秒）= max(1, floor(基准 ÷ scale)) */
export function buildSeconds(): number {
  return upgradeSeconds(1);
}

/**
 * 升级时长（秒）：占位公式 = 建造时长 × 升级倍数（upgradeLevelFactor：1~10 级 Lv1→2 为 2 倍时长，
 * 以此类推线性；10 级以后每级 ×1.3，v31），全局缩放作用于总时长：max(1, floor(基准 × 倍数 ÷ scale))。
 */
export function upgradeSeconds(currentLevel: number): number {
  const { seconds, scale } = buildTimeBasis();
  return Math.max(1, Math.floor((seconds * upgradeLevelFactor(currentLevel)) / scale));
}

/** 升级成本（占位公式 = 建造成本 × 升级倍数 upgradeLevelFactor，逐项取整；1~10 级线性不变，10 级以后每级 ×1.3） */
export function upgradeCost(kind: BuildingKind, currentLevel: number): Resources {
  const factor = upgradeLevelFactor(currentLevel);
  const base = BUILDING_INFO[kind].cost;
  const cost: Resources = { ...base };
  for (const key of RESOURCE_KEYS) {
    cost[key] = Math.round(base[key] * factor);
  }
  return cost;
}

/**
 * 每种建筑「下一步动作」的成本（v6，随 GET_STATE 下发供客户端在发起前展示）：
 * 未建 → build 为建造成本；已建未满级 → upgrade 为升级成本；满级 → 均为 null。
 * v25（AISLG-71）另附各动作时长（秒，已按当前 timeScale 折算），null 语义与对应成本字段一致。
 * 只按等级推导，不反映队列状态（队满/在队等阻断由客户端按钮层处理）。
 */
export function actionCosts(levels: Record<BuildingKind, number>): Record<BuildingKind, KindActionCosts> {
  const result = {} as Record<BuildingKind, KindActionCosts>;
  for (const kind of BUILDING_KINDS) {
    const level = levels[kind] ?? 0;
    result[kind] = {
      build: level === 0 ? { ...BUILDING_INFO[kind].cost } : null,
      upgrade: level > 0 && level < MAX_BUILDING_LEVEL ? upgradeCost(kind, level) : null,
      buildSeconds: level === 0 ? buildSeconds() : null,
      upgradeSeconds: level > 0 && level < MAX_BUILDING_LEVEL ? upgradeSeconds(level) : null,
    };
  }
  return result;
}

export type BuildDeniedCode =
  | 'INSUFFICIENT_RESOURCES'
  | 'QUEUE_FULL'
  /** 该类型建筑已建成，或已在建造/升级队列中（单实例规则） */
  | 'BUILDING_EXISTS'
  /** 该类型尚未建造，不能升级 */
  | 'BUILDING_NOT_BUILT'
  /** 已达等级上限（MAX_BUILDING_LEVEL） */
  | 'BUILDING_LEVEL_MAX';

export type StartBuildVerdict =
  | { ok: true; cost: Resources; /** 建造目标等级恒为 1 */ level: 1; /** start=立即开工；queued=进入排队 */ mode: 'start' | 'queued' }
  | { ok: false; code: BuildDeniedCode; cost?: Resources };

/**
 * 发起建造前的统一校验（单实例、资源、开工/入队与容量判定都在这里）：
 * 已建成或队列中已有该类型 → BUILDING_EXISTS；资源不足 → INSUFFICIENT_RESOURCES；
 * 无在建 → 立即开工；在建中且排队未满 → 入队；排队已满 → QUEUE_FULL。
 * kindBusy = 该类型已建成（等级 > 0）或在队列中。
 */
export function startBuild(
  kind: BuildingKind,
  resources: Resources,
  kindBusy: boolean,
  activeBuilds: number,
  queuedBuilds: number,
): StartBuildVerdict {
  if (kindBusy) {
    return { ok: false, code: 'BUILDING_EXISTS' };
  }
  const cost = BUILDING_INFO[kind].cost;
  const verdict = judgeQueue(resources, cost, activeBuilds, queuedBuilds);
  return verdict.ok ? { ...verdict, level: 1 as const } : verdict;
}

/**
 * 发起升级前的统一校验：该类型已在队列中（含首次建造进行中、等级仍为 0）→
 * BUILDING_EXISTS（单实例规则：在队冲突比「未建成」更具体，先判，与文档一致）；
 * 未建造且不在队列 → BUILDING_NOT_BUILT；已达上限 → BUILDING_LEVEL_MAX；
 * 其余与建造相同（资源 / 开工 / 入队 / 容量）。升级目标等级 = currentLevel + 1。
 *
 * v22（AISLG-43）连续升级：可选 toLevel（currentLevel+2 .. MAX_BUILDING_LEVEL）把
 * 中间每一级合成**一条**队列条目——整链按各级公式价一次性预扣（快照全额）、
 * 占用 1 个队列位、Worker 逐级推进 due_at；level 字段 = 第一个目标等级。
 * toLevel ≤ 当前 +1 视同单级升级（调用方也可以不传）。
 */
export function startUpgrade(
  kind: BuildingKind,
  currentLevel: number,
  resources: Resources,
  kindInQueue: boolean,
  activeBuilds: number,
  queuedBuilds: number,
  toLevel?: number,
): { ok: true; cost: Resources; level: number; toLevel: number | null; mode: 'start' | 'queued' } | { ok: false; code: BuildDeniedCode; cost?: Resources } {
  if (kindInQueue) {
    return { ok: false, code: 'BUILDING_EXISTS' };
  }
  if (currentLevel <= 0) {
    return { ok: false, code: 'BUILDING_NOT_BUILT' };
  }
  if (currentLevel >= MAX_BUILDING_LEVEL) {
    return { ok: false, code: 'BUILDING_LEVEL_MAX' };
  }
  // 连续升级目标：超过等级上限整单拒绝（文档口径 BUILDING_LEVEL_MAX）；低于当前 +1 折回单级
  if (toLevel !== undefined && toLevel > MAX_BUILDING_LEVEL) {
    return { ok: false, code: 'BUILDING_LEVEL_MAX' };
  }
  const chainTarget = Math.max(toLevel ?? currentLevel + 1, currentLevel + 1);
  const chained = chainTarget > currentLevel + 1;
  const cost = upgradeChainCost(kind, currentLevel, chainTarget);
  const verdict = judgeQueue(resources, cost, activeBuilds, queuedBuilds);
  if (!verdict.ok) {
    return verdict;
  }
  return {
    ok: true,
    cost: verdict.cost,
    level: currentLevel + 1,
    toLevel: chained ? chainTarget : null,
    mode: verdict.mode,
  };
}

/** 连续升级的整链成本 = Σ upgradeCost(kind, l-1)（l = currentLevel+1 .. chainTarget，公式确定性可预扣） */
export function upgradeChainCost(kind: BuildingKind, currentLevel: number, chainTarget: number): Resources {
  const cost: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (let l = currentLevel + 1; l <= chainTarget; l += 1) {
    const step = upgradeCost(kind, l - 1);
    for (const key of RESOURCE_KEYS) {
      cost[key] += step[key];
    }
  }
  return cost;
}

/** 开工/入队/容量判定的内部结果；建造与升级在外层补齐各自的目标等级。
 *  v22（AISLG-43）：INSUFFICIENT_RESOURCES 失败附带整单成本，供协议层推导缺口与 retryAfterSeconds */
type QueueVerdict =
  | { ok: true; cost: Resources; mode: 'start' | 'queued' }
  | { ok: false; code: BuildDeniedCode; cost?: Resources };

function judgeQueue(
  resources: Resources,
  cost: Resources,
  activeBuilds: number,
  queuedBuilds: number,
): QueueVerdict {
  if (RESOURCE_KEYS.some((key) => resources[key] < cost[key])) {
    return { ok: false, code: 'INSUFFICIENT_RESOURCES', cost: { ...cost } };
  }
  if (activeBuilds < MAX_ACTIVE_BUILDS) {
    return { ok: true, cost: { ...cost }, mode: 'start' };
  }
  if (queuedBuilds < BUILD_QUEUE_CAPACITY) {
    return { ok: true, cost: { ...cost }, mode: 'queued' };
  }
  return { ok: false, code: 'QUEUE_FULL' };
}

/** 扣减建造成本（纯函数，不修改入参） */
export function applyCost(resources: Resources, cost: Resources): Resources {
  const next = { ...resources };
  for (const key of RESOURCE_KEYS) {
    next[key] = resources[key] - cost[key];
  }
  return next;
}

// ---- 集市兑换（v22，AISLG-42 满级后的资源消耗口） ----

/**
 * 兑换汇率：N 单位四基础资源（粮/木/石/铁）→ 1 金币（v22 占位决策，金币不可逆向兑换）。
 * 定位是「过满资源的可持续出口」而非套利通道：四资源换金的产出比官府产金低一个量级，
 * 不构成最优策略，只为满仓资源保底变现（同时缓解储量顶满后的产出作废）。
 */
export const EXCHANGE_INPUT_PER_GOLD = 4;

/** 兑换所得金币 = floor(amount ÷ 汇率)；不足 1 金返回 0（协议层按 INVALID_PARAMS 拒绝） */
export function exchangeGoldFor(amount: number): number {
  return Math.floor(Math.max(0, amount) / EXCHANGE_INPUT_PER_GOLD);
}

/** 到期完成的状态推进（纯函数）：Worker 依据它的结果写库；对建筑类型不敏感 */
export function completeBuild(build: { status: string; level: number }): {
  status: 'completed';
  level: number;
} {
  return { status: 'completed', level: build.level };
}
