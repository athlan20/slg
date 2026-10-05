// 一期兵种与征兵规则（v11，docs/phase-1-launch-scope.md「征兵、行军与战斗」）。
// API（发起征兵/取消的校验）与 Worker（到期完成）共用，两侧不得各自再实现一套数值。
// 所有数值均为占位决策（未经数值评审）；战斗属性（攻防/速度/射程）随战斗玩法设计。
// 单兵小时耗粮 foodUse（v14）参照旧源码量级（UtilsExtend.php cfg_soldier.food_use：
// 基础 2–6、骑兵 9–18）：城内部队按 1 倍计入净产量结算，行军/野地驻军按 2 倍
// （refreshFoodArmyUse 同规则），消费方见 production.ts 的 loadArmyFoodUsePerHour。

import { RESOURCE_KEYS, TROOP_KINDS, type Resources, type TroopKind } from './protocol';
import { scaledSeconds } from './time-scale';

export interface TroopInfo {
  /** 兵种 */
  troop: TroopKind;
  /** 中文名（对外文档与前端文案共用） */
  label: string;
  /** 单兵征募成本（占位数值） */
  cost: Resources;
  /** 单兵占用人口（占位：全部为 1） */
  population: number;
  /** 单兵征募时长（秒，占位数值；可用环境变量 RECRUIT_UNIT_SECONDS 覆盖便于验证） */
  unitSeconds: number;
  /** 解锁所需军营等级（占位决策，未建军营视为 0 级） */
  barracksLevel: number;
  /** 单兵小时耗粮（占位数值，未经数值评审；计入资源懒结算的净产量，断粮仅停止增长） */
  foodUse: number;
  /** 单兵负重（v16，占位数值）：掠夺时可携带的资源总量按编队 Σ(数量 × 单兵负重) 封顶 */
  carry: number;
}

/** 一期七兵种清单（旧游戏 1–7 号；数值均为占位） */
export const TROOP_INFO: Record<TroopKind, TroopInfo> = {
  porter: {
    troop: 'porter',
    label: '民夫',
    cost: { gold: 50, wood: 30, food: 30, stone: 0, iron: 0 },
    population: 1,
    unitSeconds: 8,
    barracksLevel: 1,
    foodUse: 2,
    carry: 500,
  },
  militia: {
    troop: 'militia',
    label: '义兵',
    cost: { gold: 80, wood: 20, food: 50, stone: 0, iron: 0 },
    population: 1,
    unitSeconds: 10,
    barracksLevel: 1,
    foodUse: 3,
    carry: 60,
  },
  scout: {
    troop: 'scout',
    label: '斥候',
    cost: { gold: 100, wood: 50, food: 80, stone: 0, iron: 0 },
    population: 1,
    unitSeconds: 15,
    barracksLevel: 2,
    foodUse: 4,
    carry: 80,
  },
  pikeman: {
    troop: 'pikeman',
    label: '长枪兵',
    cost: { gold: 150, wood: 80, food: 100, stone: 0, iron: 50 },
    population: 1,
    unitSeconds: 20,
    barracksLevel: 3,
    foodUse: 5,
    carry: 60,
  },
  swordsman: {
    troop: 'swordsman',
    label: '刀盾兵',
    cost: { gold: 180, wood: 60, food: 120, stone: 0, iron: 80 },
    population: 1,
    unitSeconds: 25,
    barracksLevel: 4,
    foodUse: 6,
    carry: 80,
  },
  archer: {
    troop: 'archer',
    label: '弓箭兵',
    cost: { gold: 200, wood: 120, food: 100, stone: 0, iron: 60 },
    population: 1,
    unitSeconds: 30,
    barracksLevel: 5,
    foodUse: 6,
    carry: 50,
  },
  cavalry: {
    troop: 'cavalry',
    label: '轻骑兵',
    cost: { gold: 300, wood: 80, food: 150, stone: 0, iron: 100 },
    population: 1,
    unitSeconds: 40,
    barracksLevel: 6,
    foodUse: 12,
    carry: 100,
  },
  // ---- 二期四兵种（v32；旧游戏 8 / 9 / 10 / 11 号，数值为占位，校准见 docs/battle-calibration.md） ----
  iron_cavalry: {
    troop: 'iron_cavalry',
    label: '铁骑兵',
    cost: { gold: 600, wood: 100, food: 200, stone: 0, iron: 300 },
    population: 3,
    unitSeconds: 60,
    barracksLevel: 11,
    foodUse: 30,
    carry: 100,
  },
  supply_wagon: {
    troop: 'supply_wagon',
    label: '辎重车',
    cost: { gold: 200, wood: 300, food: 60, stone: 0, iron: 40 },
    population: 6,
    unitSeconds: 30,
    barracksLevel: 3,
    foodUse: 10,
    carry: 5000,
  },
  ballista: {
    troop: 'ballista',
    label: '床弩',
    cost: { gold: 350, wood: 300, food: 80, stone: 0, iron: 120 },
    population: 3,
    unitSeconds: 45,
    barracksLevel: 7,
    foodUse: 8,
    carry: 0,
  },
  siege_ram: {
    troop: 'siege_ram',
    label: '冲车',
    cost: { gold: 400, wood: 400, food: 80, stone: 100, iron: 100 },
    population: 5,
    unitSeconds: 60,
    barracksLevel: 8,
    foodUse: 10,
    carry: 0,
  },
};

/** 单次征募数量上限（占位决策） */
export const RECRUIT_COUNT_MAX = 100;
/** 同一城池同时征募中的数量（占位决策；征兵队列独立于建造队列） */
export const MAX_ACTIVE_RECRUITS = 1;
/** 征兵排队上限（不含征募中，占位决策） */
export const RECRUIT_QUEUE_CAPACITY = 2;

/**
 * 单兵征募**基准**时长（秒，未缩放）：环境变量 RECRUIT_UNIT_SECONDS 覆盖全部兵种
 * （验证用，API 与 Worker 必须一致）。v22（AISLG-39）起本函数返回未缩放基准——
 * 全局缩放与 1 秒下限改在批次总时长上应用（recruitBatchSeconds），与建造/升级同模型。
 */
export function recruitUnitSeconds(troop: TroopKind): number {
  const raw = Number(process.env.RECRUIT_UNIT_SECONDS);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw);
  }
  return TROOP_INFO[troop].unitSeconds;
}

/**
 * 批次征募总时长（秒）= max(1, 基准单兵时长 × 数量 ÷ time_scale)——**下限作用于
 * 批次总时长**而非单兵（v22，AISLG-39 方案 A：修复 v20 起单兵被逐个钳 1 秒、批量
 * 征兵比文档公式慢数倍的问题；显式环境变量覆盖优先且不再缩放，与建造路径一致）。
 */
export function recruitBatchSeconds(troop: TroopKind, count: number): number {
  const n = Math.max(1, Math.floor(count));
  const raw = Number(process.env.RECRUIT_UNIT_SECONDS);
  if (Number.isFinite(raw) && raw >= 1) {
    return Math.floor(raw) * n;
  }
  return scaledSeconds(TROOP_INFO[troop].unitSeconds * n);
}

/** 一支部队的小时耗粮合计 = Σ(单兵 foodUse × 数量)；未知兵种按 0 计 */
export function armyFoodUsePerHour(counts: Partial<Record<TroopKind, number>>): number {
  let total = 0;
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(counts[kind] ?? 0);
    if (count > 0) {
      total += TROOP_INFO[kind].foodUse * count;
    }
  }
  return total;
}

/** 一支部队的负重合计 = Σ(单兵 carry × 数量)；未知兵种按 0 计（v16 掠夺装填上限）。
 *  v27（AISLG-77）：bonusPercent 为负重科技加成百分数，合计后向下取整 */
export function armyCarryCapacity(counts: Partial<Record<TroopKind, number>>, bonusPercent = 0): number {
  let total = 0;
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(counts[kind] ?? 0);
    if (count > 0) {
      total += TROOP_INFO[kind].carry * count;
    }
  }
  return bonusPercent > 0 ? Math.floor((total * (100 + bonusPercent)) / 100) : total;
}

export type RecruitDeniedCode =
  | 'TROOP_NOT_AVAILABLE'
  | 'INSUFFICIENT_RESOURCES'
  | 'INSUFFICIENT_POPULATION'
  | 'RECRUIT_QUEUE_FULL';

export type StartRecruitVerdict =
  | {
      ok: true;
      /** 批次总成本 = 单兵成本 × 数量 */
      cost: Resources;
      /** 批次占用人口 = 单兵人口 × 数量 */
      population: number;
      /** 单兵时长快照（秒） */
      unitSeconds: number;
      /** start=立即征募；queued=进入排队 */
      mode: 'start' | 'queued';
    }
  | { ok: false; code: RecruitDeniedCode; cost?: Resources; population?: number };

/**
 * 发起征兵前的统一校验：军营等级未达兵种门槛 → TROOP_NOT_AVAILABLE；任一资源不足 →
 * INSUFFICIENT_RESOURCES；人口不足 → INSUFFICIENT_POPULATION（人口在征募时立即扣除，
 * 排队取消全额返还）；无征募中 → 立即开始；有征募中且排队未满 → 入队；排队已满 →
 * RECRUIT_QUEUE_FULL。
 */
export function startRecruit(
  troop: TroopKind,
  count: number,
  resources: Resources,
  population: number,
  barracksLevel: number,
  activeRecruits: number,
  queuedRecruits: number,
): StartRecruitVerdict {
  if (barracksLevel < TROOP_INFO[troop].barracksLevel) {
    return { ok: false, code: 'TROOP_NOT_AVAILABLE' };
  }
  const info = TROOP_INFO[troop];
  const cost: Resources = { ...info.cost };
  for (const key of RESOURCE_KEYS) {
    cost[key] = info.cost[key] * count;
  }
  if (RESOURCE_KEYS.some((key) => resources[key] < cost[key])) {
    // v22（AISLG-43）：失败附整单成本 / 人口，供协议层推导缺口与 retryAfterSeconds
    return { ok: false, code: 'INSUFFICIENT_RESOURCES', cost };
  }
  const populationCost = info.population * count;
  if (population < populationCost) {
    return { ok: false, code: 'INSUFFICIENT_POPULATION', population: populationCost };
  }
  if (activeRecruits < MAX_ACTIVE_RECRUITS) {
    return { ok: true, cost, population: populationCost, unitSeconds: recruitUnitSeconds(troop), mode: 'start' };
  }
  if (queuedRecruits < RECRUIT_QUEUE_CAPACITY) {
    return { ok: true, cost, population: populationCost, unitSeconds: recruitUnitSeconds(troop), mode: 'queued' };
  }
  return { ok: false, code: 'RECRUIT_QUEUE_FULL' };
}

// 引用 TROOP_KINDS 仅为保证清单与类型同步（避免未用告警的显式标记）
void TROOP_KINDS;
