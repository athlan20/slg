// 行军时长的本地预估（AISLG-72）：出征 / 调兵表单展示「大概多久能到」用。
// 权威值以 MARCH / SCOUT 响应的 march.arriveAt 为准；此处镜像
// backend/common/src/world.ts marchTravelSeconds 的占位公式：
// max(1, ceil(Chebyshev 距离 × 每格基准秒 ÷ 编队最慢兵种速度 ÷ timeScale))。
// 验证环境用 MARCH_SECONDS_PER_TILE 环境变量覆盖每格秒数时，预估会有偏差。

import { TROOP_KINDS, type TechLevels, type TroopKind } from './protocol';

/** 科技加成百分数（镜像 backend/common/src/tech.ts：负重 / 行军每级 +5%）；techs 缺省按 0 级 */
export const TECH_PERCENT_PER_LEVEL = 5;
export function carryBonusPercent(techs: Partial<TechLevels> | undefined): number {
  return (techs?.carrying ?? 0) * TECH_PERCENT_PER_LEVEL;
}
export function marchBonusPercent(techs: Partial<TechLevels> | undefined): number {
  return (techs?.marching ?? 0) * TECH_PERCENT_PER_LEVEL;
}

/** 每格行军秒数（未加速基准）：镜像 world.ts 的 DEFAULT_MARCH_SECONDS_PER_TILE */
export const MARCH_SECONDS_PER_TILE = 15;

/** 行军速度系数：镜像 battle-engine.ts 的 TROOP_STATS.marchSpeed（斥候 ×2、轻骑兵 ×1.5、其余 ×1，占位） */
export const TROOP_MARCH_SPEED: Record<TroopKind, number> = {
  porter: 1,
  militia: 1,
  scout: 2,
  pikeman: 1,
  swordsman: 1,
  archer: 1,
  cavalry: 1.5,
  iron_cavalry: 1.2,
  supply_wagon: 0.7,
  ballista: 0.6,
  siege_ram: 0.6,
};

/** 行军时长预估（秒）：编队最慢兵种决定速度，空编队按基准速度 1；至少按 1 格计 */
export function marchTravelSeconds(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  troops: Partial<Record<TroopKind, number>>,
  timeScale: number,
  speedPercent = 0,
): number {
  const distance = Math.max(1, Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY)));
  let slowest: number | null = null;
  for (const kind of TROOP_KINDS) {
    if ((troops[kind] ?? 0) > 0) {
      const speed = TROOP_MARCH_SPEED[kind];
      slowest = slowest === null ? speed : Math.min(slowest, speed);
    }
  }
  // v27（AISLG-77）：行军科技每级 +5% 速度，总时长再 ÷ (1 + 百分数 / 100)
  const techFactor = 1 + Math.max(0, speedPercent) / 100;
  return Math.max(1, Math.ceil((distance * MARCH_SECONDS_PER_TILE) / Math.max(0.1, slowest ?? 1) / Math.max(1, timeScale) / techFactor));
}
