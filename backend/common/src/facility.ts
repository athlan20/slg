// 野地设施（AISLG-232，v97）：目前只有望楼 watchtower。本文件只放**数值与纯规则**，
// API（发起建造 / 升级）、Worker（到期完成）、视野计算（fog.ts / fog-db.ts）与协议文档共用同一份常量，
// 前后端与 slg-mcp 清单都从协议文档取值，不各写一份。
//
// 规则（需求 AISLG-232 第一节）：
// - 只能盖在自己已占领的野地上（kind='wilderness' 且归本账号的城池），每块地最多一座；
// - 每座城名下的野地最多 2 座（主城 2 座，每座分城各 2 座）；
// - 最高 3 级，新建即 1 级；升级到 2 / 3 级；
// - 视野半径（切比雪夫）1 级 6 / 2 级 8 / 3 级 10，**取代**野地原来的 3 格，不叠加；
// - 花费与耗时见 WATCHTOWER_LEVELS；耗时同建筑一样除以 time_scale、不低于 1 秒，但**不吃**「建筑」科技折扣；
// - 不占城池建造队列，望楼有自己的计时（wilderness_facilities.finish_at 由 Worker 到期完成）。

import type { Resources } from './protocol';
import { getTimeScale } from './time-scale';

/** 野地设施的类别（本单只有望楼；烽火台 / 军营等留待后续） */
export const FACILITY_KINDS = ['watchtower'] as const;
export type FacilityKind = (typeof FACILITY_KINDS)[number];

/** 是否已知设施类别 */
export function isFacilityKind(value: unknown): value is FacilityKind {
  return typeof value === 'string' && (FACILITY_KINDS as readonly string[]).includes(value);
}

/** 最高等级 */
export const FACILITY_MAX_LEVEL = 3;

/** 每座城名下的野地上最多能盖几座望楼 */
export const FACILITY_PER_CITY_LIMIT = 2;

/** 单级数值（费用为**这一级**的花费，不是累计） */
export interface FacilityLevelInfo {
  /** 该等级的视野半径（切比雪夫距离，格） */
  visionRadius: number;
  /** 从上一等级升到本等级的花费（1 级即新建花费） */
  cost: Pick<Resources, 'gold' | 'wood' | 'stone'>;
  /** 基准耗时（秒，未加速、不打科技折扣） */
  seconds: number;
}

/** 望楼各级数值（需求 AISLG-232 第一张表，一字不改） */
export const WATCHTOWER_LEVELS: Readonly<Record<number, FacilityLevelInfo>> = {
  1: { visionRadius: 6, cost: { gold: 300, wood: 200, stone: 100 }, seconds: 120 },
  2: { visionRadius: 8, cost: { gold: 600, wood: 400, stone: 200 }, seconds: 240 },
  3: { visionRadius: 10, cost: { gold: 900, wood: 600, stone: 300 }, seconds: 360 },
};

/** 望楼的视野半径（等级；未知等级按 0 处理，调用方用 max 兜底） */
export function watchtowerVisionRadius(level: number): number {
  return WATCHTOWER_LEVELS[Math.max(0, Math.floor(level))]?.visionRadius ?? 0;
}

/** 从 currentLevel 升到下一级（新建 = 0 → 1）的花费；已满级返回 null */
export function facilityUpgradeCost(kind: FacilityKind, currentLevel: number): Resources | null {
  const info = levelInfoOf(kind, currentLevel + 1);
  if (!info) {
    return null;
  }
  return { gold: info.cost.gold, wood: info.cost.wood, food: 0, stone: info.cost.stone, iron: 0 };
}

/** 从 currentLevel 升到下一级的耗时（秒）：基准 ÷ time_scale、向下取整、不低于 1；已满级返回 null */
export function facilityUpgradeSeconds(kind: FacilityKind, currentLevel: number, scale = getTimeScale()): number | null {
  const info = levelInfoOf(kind, currentLevel + 1);
  if (!info) {
    return null;
  }
  return Math.max(1, Math.floor(info.seconds / Math.max(1, scale)));
}

/** 目标等级的数据（越界返回 null） */
function levelInfoOf(kind: FacilityKind, level: number): FacilityLevelInfo | null {
  if (kind !== 'watchtower') {
    return null;
  }
  if (!Number.isInteger(level) || level < 1 || level > FACILITY_MAX_LEVEL) {
    return null;
  }
  return WATCHTOWER_LEVELS[level];
}

/** 满级的三级累计花费（文档与复核口径用） */
export function facilityTotalCost(kind: FacilityKind): Pick<Resources, 'gold' | 'wood' | 'stone'> {
  const total = { gold: 0, wood: 0, stone: 0 };
  for (let level = 1; level <= FACILITY_MAX_LEVEL; level += 1) {
    const info = levelInfoOf(kind, level);
    if (!info) {
      continue;
    }
    total.gold += info.cost.gold;
    total.wood += info.cost.wood;
    total.stone += info.cost.stone;
  }
  return total;
}

/** 地块的视野半径（共用函数，AISLG-232 技术细节）：野地原来 3 格，有望楼时取望楼半径，二者取大不叠加。
 *  「地形影响视野」的另一张单要往这里加规则——不要在别处另写一份。 */
export function facilityVisionRadiusOf(level: number | null | undefined): number {
  if (!level || level <= 0) {
    return 0;
  }
  return watchtowerVisionRadius(level);
}
