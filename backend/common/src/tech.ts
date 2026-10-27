// 科技研究的共用规则（v27，AISLG-77 六项；v72，AISLG-192 扩到十六项）。
// 每项最高 10 级，账号共享（全账号所有城都生效），同一时间只研究一项，需要书院（academy）。
// API（发起 / 取消 / 视图）、Worker（到期完成）与各效果的消费方（产量 / 储量 / 负重 /
// 行军 / 侦察 / 守城 / 征兵 / 建造 / 研究 / 耗粮 / 掠夺 / 城防回涨 / 世界地图战斗）共用
// 本文件，不各自再实现一套数值；全部数值为占位，上线后按数据调整。
//
// AISLG-192 新增的十项里，战斗类四项（战斗 / 防护 / 驾驭 / 抛射）只在世界地图战斗中
// 生效（竞技场、将星塔不传科技乘数）；与武将加成是两层乘法（武将 20% 封顶不变）。

import { RESOURCE_KEYS, type Resources } from './protocol';
import { buildTimeBasis } from './rules';

/** 十六项科技：农耕 / 负重 / 行军 / 储存 / 侦察 / 城防 + 练兵 / 战斗 / 防护 / 驾驭 /
 *  抛射 / 补给 / 建筑 / 研究 / 掠夺 / 维修 */
export const TECH_KINDS = [
  'farming',
  'carrying',
  'marching',
  'storage',
  'scouting',
  'defense',
  'drill',
  'combat',
  'protection',
  'riding',
  'archery',
  'supply',
  'construction',
  'research',
  'looting',
  'repair',
] as const;

export type TechKind = (typeof TECH_KINDS)[number];

export function isTechKind(value: unknown): value is TechKind {
  return typeof value === 'string' && (TECH_KINDS as readonly string[]).includes(value);
}

/** 科技等级上限（每项相同；第 N 级要求书院 ≥ N 级，书院上限也是 10） */
export const MAX_TECH_LEVEL = 10;

/** 科技归类（前端分「发展 / 军事」两栏展示；Agent 文档同口径） */
export type TechCategory = 'development' | 'military';

/** 各科技当前等级（0 = 未研究）；账号级 */
export type TechLevels = Record<TechKind, number>;

export function emptyTechLevels(): TechLevels {
  return {
    farming: 0,
    carrying: 0,
    marching: 0,
    storage: 0,
    scouting: 0,
    defense: 0,
    drill: 0,
    combat: 0,
    protection: 0,
    riding: 0,
    archery: 0,
    supply: 0,
    construction: 0,
    research: 0,
    looting: 0,
    repair: 0,
  };
}

export interface TechInfo {
  kind: TechKind;
  label: string;
  /** 归类：development 发展 / military 军事（只影响界面分栏与文档编排） */
  category: TechCategory;
  /** 每级效果（百分数，带符号）：正数为加成、负数为减少（时长 / 耗粮 / 受伤）；
   *  scouting 不是数值加成（按等级解锁侦察内容），为 0 */
  percentPerLevel: number;
  /** 一句话效果说明（界面与文档共用） */
  effect: string;
  /** 第 1 级研究成本（占位）；第 N 级 = 基础 × N，逐项线性放大（与建筑升级同模型） */
  baseCost: Resources;
}

export const TECH_INFO: Record<TechKind, TechInfo> = {
  farming: {
    kind: 'farming',
    label: '农耕',
    category: 'development',
    percentPerLevel: 5,
    effect: '粮、木、石、铁产量每级 +5%',
    baseCost: { gold: 150, wood: 100, food: 100, stone: 0, iron: 0 },
  },
  carrying: {
    kind: 'carrying',
    label: '负重',
    category: 'development',
    percentPerLevel: 5,
    effect: '部队负重每级 +5%（掠夺与运输共用）',
    baseCost: { gold: 150, wood: 150, food: 0, stone: 0, iron: 50 },
  },
  marching: {
    kind: 'marching',
    label: '行军',
    category: 'military',
    percentPerLevel: 5,
    effect: '行军速度每级 +5%',
    baseCost: { gold: 150, wood: 0, food: 100, stone: 0, iron: 50 },
  },
  storage: {
    kind: 'storage',
    label: '储存',
    category: 'development',
    percentPerLevel: 5,
    effect: '粮、木、石、铁储量上限每级 +5%',
    baseCost: { gold: 150, wood: 100, food: 0, stone: 100, iron: 0 },
  },
  scouting: {
    kind: 'scouting',
    label: '侦察',
    category: 'military',
    percentPerLevel: 0,
    effect: '侦察报告更详细：Lv3 起看到兵种明细，Lv6 起看到精确数量',
    baseCost: { gold: 100, wood: 50, food: 50, stone: 0, iron: 0 },
  },
  defense: {
    kind: 'defense',
    label: '城防',
    category: 'military',
    percentPerLevel: 1,
    effect: '主城守城时城墙减伤每级额外 +1%（加在城墙加成上）',
    baseCost: { gold: 150, wood: 0, food: 0, stone: 150, iron: 100 },
  },
  // ---- v72（AISLG-192）新增十项 ----
  drill: {
    kind: 'drill',
    label: '练兵',
    category: 'military',
    percentPerLevel: -3,
    effect: '征兵时长每级 −3%（10 级 −30%）',
    baseCost: { gold: 150, wood: 0, food: 100, stone: 0, iron: 50 },
  },
  combat: {
    kind: 'combat',
    label: '战斗',
    category: 'military',
    percentPerLevel: 1.5,
    effect: '世界地图战斗中我方全军攻击每级 +1.5%（10 级 +15%）',
    baseCost: { gold: 200, wood: 50, food: 0, stone: 0, iron: 150 },
  },
  protection: {
    kind: 'protection',
    label: '防护',
    category: 'military',
    percentPerLevel: -1.5,
    effect: '世界地图战斗中我方全军受到伤害每级 −1.5%（10 级 −15%）',
    baseCost: { gold: 200, wood: 0, food: 0, stone: 100, iron: 100 },
  },
  riding: {
    kind: 'riding',
    label: '驾驭',
    category: 'military',
    percentPerLevel: 2,
    effect: '骑兵类兵种战斗速度每级 +2%（10 级 +20%）',
    baseCost: { gold: 200, wood: 0, food: 150, stone: 0, iron: 100 },
  },
  archery: {
    kind: 'archery',
    label: '抛射',
    category: 'military',
    percentPerLevel: 1,
    effect: '远程兵种（弓箭兵 / 床弩 / 诸葛连弩 / 先登死士）射程每级 +1%（10 级 +10%）',
    baseCost: { gold: 200, wood: 150, food: 0, stone: 0, iron: 50 },
  },
  supply: {
    kind: 'supply',
    label: '补给',
    category: 'development',
    percentPerLevel: -3,
    effect: '部队耗粮（城内、行军、驻守）每级 −3%（10 级 −30%）',
    baseCost: { gold: 150, wood: 50, food: 150, stone: 0, iron: 0 },
  },
  construction: {
    kind: 'construction',
    label: '建筑',
    category: 'development',
    percentPerLevel: -3,
    effect: '建造、升级时长每级 −3%（10 级 −30%）',
    baseCost: { gold: 150, wood: 100, food: 0, stone: 100, iron: 0 },
  },
  research: {
    kind: 'research',
    label: '研究',
    category: 'development',
    percentPerLevel: -3,
    effect: '科技研究时长每级 −3%（10 级 −30%）',
    baseCost: { gold: 200, wood: 100, food: 0, stone: 50, iron: 0 },
  },
  looting: {
    kind: 'looting',
    label: '掠夺',
    category: 'development',
    percentPerLevel: 4,
    effect: '掠夺野地时可抢的资源池每级 +4%（10 级 +40%）',
    baseCost: { gold: 150, wood: 0, food: 50, stone: 0, iron: 100 },
  },
  repair: {
    kind: 'repair',
    label: '维修',
    category: 'development',
    percentPerLevel: 5,
    effect: '分城城防值每小时回涨每级 +5%（基础 10 点/小时，10 级 15 点/小时）',
    baseCost: { gold: 150, wood: 0, food: 0, stone: 150, iron: 0 },
  },
};

/** 第 level 级的研究成本 = 基础 × level */
export function techCost(kind: TechKind, level: number): Resources {
  const scale = Math.max(1, Math.floor(level));
  const base = TECH_INFO[kind].baseCost;
  const cost: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const key of RESOURCE_KEYS) {
    cost[key] = base[key] * scale;
  }
  return cost;
}

/** 研究基准秒数 = 建造基准 × 2（占位）；第 N 级时长 = 基准 × N，再按研究科技
 *  （每级 −3%）缩短，随全局时间缩放 ÷ scale（总时长取整，下限 1 秒） */
export const RESEARCH_BUILD_TIME_FACTOR = 2;

export function researchSeconds(level: number, researchLevel = 0): number {
  const { seconds, scale } = buildTimeBasis();
  const base = seconds * RESEARCH_BUILD_TIME_FACTOR * Math.max(1, Math.floor(level));
  const reduced = base * (1 - researchReductionPercent({ research: researchLevel }) / 100);
  return Math.max(1, Math.floor(reduced / scale));
}

// ---- 各科技的效果出口（消费方只调这些函数，不自行乘系数） ----

/** 科技当前累计效果（百分数，带符号）：等级 × 每级效果 */
export function techPercent(kind: TechKind, techs?: Partial<TechLevels>): number {
  return (techs?.[kind] ?? 0) * TECH_INFO[kind].percentPerLevel;
}

/** 时长 / 耗粮 / 受伤类科技：当前累计「减少」幅度（正数，0..30） */
function reductionPercent(kind: TechKind, techs?: Partial<TechLevels>): number {
  return Math.max(0, -techPercent(kind, techs));
}

/** 时长类缩放：按「减少百分之 N」压缩（秒数向下取整，下限见各调用方） */
export function reduceDuration(seconds: number, reducePercent: number): number {
  const percent = Math.min(100, Math.max(0, reducePercent));
  return seconds * (1 - percent / 100);
}

/** 农耕：四种基础资源产量加成百分数（金币不受影响） */
export function farmingPercent(techs?: Partial<TechLevels>): number {
  return techPercent('farming', techs);
}

/** 储存：四种基础资源储量上限加成百分数（金币上限固定，不受影响） */
export function storagePercent(techs?: Partial<TechLevels>): number {
  return techPercent('storage', techs);
}

/** 负重：编队负重加成百分数 */
export function carryingPercent(techs?: Partial<TechLevels>): number {
  return techPercent('carrying', techs);
}

/** 行军：速度加成百分数（行军时长 ÷ (1 + 百分数 / 100)） */
export function marchingPercent(techs?: Partial<TechLevels>): number {
  return techPercent('marching', techs);
}

/** 城防：城墙守城减伤额外百分点 */
export function defenseExtraPercent(techs?: Partial<TechLevels>): number {
  return techPercent('defense', techs);
}

/** 练兵：征兵时长减少百分数（正数） */
export function drillReductionPercent(techs?: Partial<TechLevels>): number {
  return reductionPercent('drill', techs);
}

/** 建筑：建造 / 升级时长减少百分数（正数） */
export function constructionReductionPercent(techs?: Partial<TechLevels>): number {
  return reductionPercent('construction', techs);
}

/** 研究：科技研究时长减少百分数（正数） */
export function researchReductionPercent(techs?: Partial<TechLevels>): number {
  return reductionPercent('research', techs);
}

/** 补给：部队耗粮减少百分数（正数） */
export function supplyReductionPercent(techs?: Partial<TechLevels>): number {
  return reductionPercent('supply', techs);
}

/** 掠夺：野地掠夺资源池加成百分数 */
export function lootingPercent(techs?: Partial<TechLevels>): number {
  return techPercent('looting', techs);
}

/** 维修：分城城防值每小时回涨加成百分数 */
export function repairPercent(techs?: Partial<TechLevels>): number {
  return techPercent('repair', techs);
}

/** 世界地图战斗的科技乘数（战斗 / 防护 / 驾驭 / 抛射）；竞技场、将星塔与 NPC 一方不传 */
export interface TechCombatBonus {
  /** 全军攻击 +%（每级 1.5%） */
  atkPercent: number;
  /** 全军受到伤害 −%（每级 1.5%） */
  defPercent: number;
  /** 骑兵类战斗速度 +%（每级 2%） */
  cavalrySpeedPercent: number;
  /** 远程兵种射程 +%（每级 1%） */
  rangedRangePercent: number;
}

/** 把科技等级换算成战斗引擎的乘数；全 0 时返回 null（引擎走原路径，数值不变） */
export function combatTechBonus(techs?: Partial<TechLevels>): TechCombatBonus | null {
  const bonus: TechCombatBonus = {
    atkPercent: Math.max(0, techPercent('combat', techs)),
    defPercent: Math.max(0, -techPercent('protection', techs)),
    cavalrySpeedPercent: Math.max(0, techPercent('riding', techs)),
    rangedRangePercent: Math.max(0, techPercent('archery', techs)),
  };
  return bonus.atkPercent > 0 || bonus.defPercent > 0 || bonus.cavalrySpeedPercent > 0 || bonus.rangedRangePercent > 0
    ? bonus
    : null;
}

/** 侦察报告详细度：rough 只给总兵力约数；kinds 给兵种明细（数量为近似）；exact 给精确数量 */
export type ScoutDetail = 'rough' | 'kinds' | 'exact';

export const SCOUT_KINDS_LEVEL = 3;
export const SCOUT_EXACT_LEVEL = 6;

export function scoutDetailOf(techs?: Partial<TechLevels>): ScoutDetail {
  const level = techs?.scouting ?? 0;
  return level >= SCOUT_EXACT_LEVEL ? 'exact' : level >= SCOUT_KINDS_LEVEL ? 'kinds' : 'rough';
}

// ---- 研究发起校验 ----

export type ResearchDeniedCode =
  | 'INSUFFICIENT_RESOURCES'
  /** 已有进行中的研究（账号同一时间只研究一项） */
  | 'RESEARCH_IN_PROGRESS'
  /** 该科技已满级 */
  | 'TECH_LEVEL_MAX'
  /** 本城书院等级低于目标等级（未建书院按 0 级） */
  | 'ACADEMY_TOO_LOW';

export type StartResearchVerdict =
  | { ok: true; kind: TechKind; level: number; cost: Resources; seconds: number }
  | { ok: false; code: ResearchDeniedCode; cost?: Resources; academyRequired?: number };

/**
 * 发起研究的统一校验（顺序即错误码优先级）：满级 → 已有进行中研究 → 书院等级 → 资源。
 * 研究的目标等级 = 当前等级 + 1；第 N 级要求发起城的书院 ≥ N 级。
 * 研究时长按该账号当前的研究科技等级缩短（每级 −3%）。
 */
export function startResearch(
  kind: TechKind,
  levels: TechLevels,
  academyLevel: number,
  resources: Resources,
  researching: boolean,
): StartResearchVerdict {
  const current = levels[kind];
  if (current >= MAX_TECH_LEVEL) {
    return { ok: false, code: 'TECH_LEVEL_MAX' };
  }
  if (researching) {
    return { ok: false, code: 'RESEARCH_IN_PROGRESS' };
  }
  const level = current + 1;
  if (academyLevel < level) {
    return { ok: false, code: 'ACADEMY_TOO_LOW', academyRequired: level };
  }
  const cost = techCost(kind, level);
  if (RESOURCE_KEYS.some((key) => resources[key] < cost[key])) {
    return { ok: false, code: 'INSUFFICIENT_RESOURCES', cost };
  }
  return { ok: true, kind, level, cost, seconds: researchSeconds(level, levels.research) };
}