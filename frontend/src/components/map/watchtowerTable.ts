// 望楼数值的前端镜像（AISLG-232，v96）：唯一事实来源是 backend/common/src/facility.ts，
// 客户端只用来在建造前展示花费与耗时（服务端仍按同一份常量复核）。
// 一致性由 backend/test/facility.test.ts 钉住（与 yieldTable 的做法相同）。

/** 野地设施类别（本单只有望楼） */
export type FacilityKind = 'watchtower';

/** 单级数值：视野半径（切比雪夫，格）、升到该级的花费、基准耗时（秒，未加速） */
export interface WatchtowerLevel {
  visionRadius: number;
  cost: { gold: number; wood: number; stone: number };
  seconds: number;
}

/** 望楼各级数值（与需求表一字不改；2、3 级是升级到该级的花费） */
export const WATCHTOWER_LEVELS: Readonly<Record<number, WatchtowerLevel>> = {
  1: { visionRadius: 6, cost: { gold: 300, wood: 200, stone: 100 }, seconds: 120 },
  2: { visionRadius: 8, cost: { gold: 600, wood: 400, stone: 200 }, seconds: 240 },
  3: { visionRadius: 10, cost: { gold: 900, wood: 600, stone: 300 }, seconds: 360 },
};

/** 最高等级 */
export const WATCHTOWER_MAX_LEVEL = 3;

/** 每座城名下的野地上最多能盖几座 */
export const WATCHTOWER_PER_CITY_LIMIT = 2;

/** 从 currentLevel 升到下一级的数值；已满级返回 null */
export function watchtowerNextLevel(currentLevel: number): WatchtowerLevel | null {
  return WATCHTOWER_LEVELS[Math.floor(currentLevel) + 1] ?? null;
}

/** 某个等级的视野半径（未知等级按 0） */
export function watchtowerVisionRadius(level: number): number {
  return WATCHTOWER_LEVELS[Math.floor(level)]?.visionRadius ?? 0;
}

/** 按全局时间缩放折算的耗时（秒）：max(1, floor(基准 ÷ scale))，与后端 facilityUpgradeSeconds 同口径 */
export function watchtowerSeconds(level: WatchtowerLevel, timeScale: number): number {
  return Math.max(1, Math.floor(level.seconds / Math.max(1, timeScale)));
}
