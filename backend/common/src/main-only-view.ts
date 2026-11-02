// 城池视图里的「仅主城建筑」过滤（v87，AISLG-217）：酒馆 tavern 与书院 academy 只在主城建造，
// 分城的 CityView.levels / buildings / costs 都不下发这两项（主城照旧）。从 api/src/views.ts 抽出，
// 让视图组装与规则标记各自独立；判定标记的唯一出处仍是 rules.ts 的 BUILDING_INFO.mainOnly。

import { BUILDING_KINDS, type BuildingKind, type BuildingCounts, type KindActionCosts } from './protocol';
import { actionCosts, isMainCityOnlyBuilding } from './rules';
import type { BuildingLevels } from './production';

/** 按建筑类型展开数量（0/1）与等级两张映射；非主城跳过仅主城的建筑 */
export function cityBuildingRecords(
  levels: BuildingLevels,
  isMainCity: boolean,
): { buildings: Partial<BuildingCounts>; levels: Partial<BuildingCounts> } {
  const buildings: Partial<BuildingCounts> = {};
  const levelRecord: Partial<BuildingCounts> = {};
  for (const kind of BUILDING_KINDS) {
    if (!isMainCity && isMainCityOnlyBuilding(kind)) {
      continue;
    }
    const level = levels[kind] ?? 0;
    buildings[kind] = level > 0 ? 1 : 0;
    levelRecord[kind] = level;
  }
  return { buildings, levels: levelRecord };
}

/** 各建筑「下一步动作」成本；非主城的 costs 里同样去掉仅主城的建筑 */
export function cityActionCosts(
  levels: BuildingLevels,
  isMainCity: boolean,
  famousName: string | null | undefined,
  reducePercent: number,
): Record<BuildingKind, KindActionCosts> {
  const all = actionCosts(levels, famousName, reducePercent);
  if (!isMainCity) {
    for (const kind of BUILDING_KINDS) {
      if (isMainCityOnlyBuilding(kind)) {
        delete (all as Partial<Record<BuildingKind, KindActionCosts>>)[kind];
      }
    }
  }
  return all;
}
