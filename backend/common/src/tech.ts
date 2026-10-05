// 科技研究的共用规则（v27，AISLG-77）：6 项精简科技（旧游戏 TechnicFunc 24 项里挑选），
// 每项最高 10 级，账号共享（全账号所有城都生效），同一时间只研究一项，需要书院（academy）。
// API（发起 / 取消 / 视图）、Worker（到期完成）与各效果的消费方（产量 / 储量 / 负重 /
// 行军 / 侦察 / 守城）共用本文件，不各自再实现一套数值；全部数值为占位，上线后按数据调整。

import { RESOURCE_KEYS, type Resources } from './protocol';
import { buildTimeBasis } from './rules';

/** 六项科技：农耕 / 负重 / 行军 / 储存 / 侦察 / 城防 */
export const TECH_KINDS = ['farming', 'carrying', 'marching', 'storage', 'scouting', 'defense'] as const;

export type TechKind = (typeof TECH_KINDS)[number];

export function isTechKind(value: unknown): value is TechKind {
  return typeof value === 'string' && (TECH_KINDS as readonly string[]).includes(value);
}

/** 科技等级上限（每项相同；第 N 级要求书院 ≥ N 级，书院上限也是 10） */
export const MAX_TECH_LEVEL = 10;

/** 各科技当前等级（0 = 未研究）；账号级 */
export type TechLevels = Record<TechKind, number>;

export function emptyTechLevels(): TechLevels {
  return { farming: 0, carrying: 0, marching: 0, storage: 0, scouting: 0, defense: 0 };
}

export interface TechInfo {
  kind: TechKind;
  label: string;
  /** 每级效果（百分数）：farming / carrying / marching / storage 为 +5%，defense 为 +1%；
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
    percentPerLevel: 5,
    effect: '粮、木、石、铁产量每级 +5%',
    baseCost: { gold: 150, wood: 100, food: 100, stone: 0, iron: 0 },
  },
  carrying: {
    kind: 'carrying',
    label: '负重',
    percentPerLevel: 5,
    effect: '部队负重每级 +5%（掠夺与运输共用）',
    baseCost: { gold: 150, wood: 150, food: 0, stone: 0, iron: 50 },
  },
  marching: {
    kind: 'marching',
    label: '行军',
    percentPerLevel: 5,
    effect: '行军速度每级 +5%',
    baseCost: { gold: 150, wood: 0, food: 100, stone: 0, iron: 50 },
  },
  storage: {
    kind: 'storage',
    label: '储存',
    percentPerLevel: 5,
    effect: '粮、木、石、铁储量上限每级 +5%',
    baseCost: { gold: 150, wood: 100, food: 0, stone: 100, iron: 0 },
  },
  scouting: {
    kind: 'scouting',
    label: '侦察',
    percentPerLevel: 0,
    effect: '侦察报告更详细：Lv3 起看到兵种明细，Lv6 起看到精确数量',
    baseCost: { gold: 100, wood: 50, food: 50, stone: 0, iron: 0 },
  },
  defense: {
    kind: 'defense',
    label: '城防',
    percentPerLevel: 1,
    effect: '主城守城时城墙减伤每级额外 +1%（加在城墙加成上）',
    baseCost: { gold: 150, wood: 0, food: 0, stone: 150, iron: 100 },
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

/** 研究基准秒数 = 建造基准 × 2（占位）；第 N 级时长 = 基准 × N，随全局时间缩放 ÷ scale（总时长取整，下限 1 秒） */
export const RESEARCH_BUILD_TIME_FACTOR = 2;

export function researchSeconds(level: number): number {
  const { seconds, scale } = buildTimeBasis();
  return Math.max(1, Math.floor((seconds * RESEARCH_BUILD_TIME_FACTOR * Math.max(1, Math.floor(level))) / scale));
}

// ---- 各科技的效果出口（消费方只调这些函数，不自行乘系数） ----

/** 农耕：四种基础资源产量加成百分数（金币不受影响） */
export function farmingPercent(techs?: Partial<TechLevels>): number {
  return (techs?.farming ?? 0) * TECH_INFO.farming.percentPerLevel;
}

/** 储存：四种基础资源储量上限加成百分数（金币上限固定，不受影响） */
export function storagePercent(techs?: Partial<TechLevels>): number {
  return (techs?.storage ?? 0) * TECH_INFO.storage.percentPerLevel;
}

/** 负重：编队负重加成百分数 */
export function carryingPercent(techs?: Partial<TechLevels>): number {
  return (techs?.carrying ?? 0) * TECH_INFO.carrying.percentPerLevel;
}

/** 行军：速度加成百分数（行军时长 ÷ (1 + 百分数 / 100)） */
export function marchingPercent(techs?: Partial<TechLevels>): number {
  return (techs?.marching ?? 0) * TECH_INFO.marching.percentPerLevel;
}

/** 城防：城墙守城减伤额外百分点 */
export function defenseExtraPercent(techs?: Partial<TechLevels>): number {
  return (techs?.defense ?? 0) * TECH_INFO.defense.percentPerLevel;
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
  return { ok: true, kind, level, cost, seconds: researchSeconds(level) };
}
