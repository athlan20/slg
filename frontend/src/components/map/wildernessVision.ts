// 野地视野半径的前端镜像（AISLG-233「丘陵视野」）：唯一事实来源是 backend/common/src/fog.ts 的
// wildernessVisionRadius / builtFacilityVisionRadius，客户端只用来**显示**这块地现在看多远
// （服务端仍按同一份规则裁剪视野）。望楼等级 → 半径仍取 watchtowerTable（不在这里再写一份）。
// 一致性由 backend/test/hill-vision.test.ts 钉住（与 watchtowerTable / yieldTable 的做法相同）。

import { watchtowerVisionRadius } from './watchtowerTable';

/** 野地没有望楼时的基础视野半径（格，切比雪夫） */
export const WILDERNESS_VISION_BASE = 3;
/** 丘陵上的野地视野加成：站得高望得远，只对占领的野地生效（城池与行军不加成） */
export const HILL_VISION_BONUS = 2;
/** 视野半径上限：与主城持平，加成不再往上叠（3 级望楼 10 + 2 正好封顶） */
export const WILDERNESS_VISION_MAX = 12;

/** 地形是不是丘陵（后端地形枚举值 'hill'） */
export function isHill(terrain: string | null | undefined): boolean {
  return terrain === 'hill';
}

/**
 * 一块占领野地的视野半径：max(野地 3, 望楼 6 / 8 / 10)，丘陵上的野地再 +2（3 → 5、6 / 8 / 10 → 8 / 10 / 12），
 * 上限 12。与后端 wildernessVisionRadius 同口径。
 */
export function wildernessVisionRadius(level: number | null | undefined, terrain: string | null | undefined): number {
  const base = Math.max(WILDERNESS_VISION_BASE, watchtowerVisionRadius(level ?? 0));
  const radius = isHill(terrain) ? base + HILL_VISION_BONUS : base;
  return Math.min(WILDERNESS_VISION_MAX, radius);
}

/**
 * 望楼字段下发的视野半径（city.territory[].facility.visionRadius / GET_TILE 的 facility）：
 * 没建成（0 级）时为 0，建成后是加成后的有效半径（丘陵外 6 / 8 / 10，丘陵上 8 / 10 / 12）。
 * 与后端 builtFacilityVisionRadius 同口径。
 */
export function builtFacilityVisionRadius(level: number | null | undefined, terrain: string | null | undefined): number {
  return level && level > 0 ? wildernessVisionRadius(level, terrain) : 0;
}
