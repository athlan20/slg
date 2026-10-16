// 名城独有效果（v62，AISLG-166，数值为占位，可再调）：8 座名城各一项只有占领者享受的效果，
// 叠加在 famous-city.ts 的 +20% 产量之上。效果跟着城走（cities.famous_name 标记），
// 换主人即归新主人，放弃 / 被占后随标记撤下立即失效；同一玩家占多座名城各自只对各自生效。
// 城墙、箭塔、仓库、行军、野地产出各消费方只读本文件的查询函数，不各自写死数值。

import type { ProducedResource } from './production';
import type { FAMOUS_CITY_NAMES } from './famous-city';
import type { BuildingKind, TroopKind } from './protocol';

type FamousCityName = (typeof FAMOUS_CITY_NAMES)[number];

/** 名城主题建筑的等级上限（AISLG-167）：占有该名城时，对应主题建筑可升到此级，其余建筑仍为 MAX_BUILDING_LEVEL（20） */
export const FAMOUS_THEME_LEVEL_MAX = 25;

/**
 * 名城 → 主题建筑（AISLG-167，与 FAMOUS_EFFECTS 对齐）：洛阳城墙、长安箭塔、官渡农田、成都铁矿、建业伐木场、
 * 邺城官府（一期无金矿，官府是唯一产金建筑）、许昌驿站、襄阳仓库。跟着城走（cities.famous_name），与效果同口径。
 */
export const FAMOUS_THEME_BUILDING: Record<FamousCityName, BuildingKind> = {
  洛阳: 'wall',
  长安: 'arrow_tower',
  官渡: 'farm',
  成都: 'iron_mine',
  建业: 'lumber_mill',
  邺城: 'government',
  许昌: 'post_station',
  襄阳: 'warehouse',
};

/**
 * 名城 → 专属精锐兵（AISLG-168）：每座名城一种，只能在占领该名城的那座分城的军营征募（cities.famous_name 判定，
 * 跟着城走：失守后原主人不能再练，已练出的兵留在原主人手里）。NPC 名城守军仍用普通兵种。
 * 兵种的数值与军营门槛在 troops.ts 的 TROOP_INFO（famousCity 字段与本表对齐）。
 */
export const FAMOUS_ELITE_TROOP: Record<FamousCityName, TroopKind> = {
  洛阳: 'yulin_guard',
  建业: 'danyang_soldier',
  襄阳: 'baimao_soldier',
  许昌: 'huwei_guard',
  成都: 'zhuge_crossbow',
  邺城: 'xiandeng_warrior',
  官渡: 'hubao_cavalry',
  长安: 'xiliang_cavalry',
};

/** 专属兵种对应的名城（普通兵种为 null） */
export function famousCityOfEliteTroop(troop: TroopKind): FamousCityName | null {
  for (const name of Object.keys(FAMOUS_ELITE_TROOP) as FamousCityName[]) {
    if (FAMOUS_ELITE_TROOP[name] === troop) {
      return name;
    }
  }
  return null;
}

/** 名城标记对应的专属兵种；非名城（或名字不在表中）为 null */
export function eliteTroopOf(name: string | null | undefined): TroopKind | null {
  if (!name) {
    return null;
  }
  return Object.hasOwn(FAMOUS_ELITE_TROOP, name) ? FAMOUS_ELITE_TROOP[name as FamousCityName] : null;
}

/** 名城效果种类：城墙（守城战减伤）、箭塔（伤害）、野地产出、行军速度（自城调兵 / 运输）、仓库（防掠夺保护额） */
export type FamousEffectKind = 'wall' | 'tower' | 'territory' | 'march' | 'warehouse';

export interface FamousEffectDef {
  kind: FamousEffectKind;
  /** 数值：wall 为城墙减伤的额外百分点，其余为百分比 */
  percent: number;
  /** territory 专用：辖下野地中产出这些资源的地块才享受加成（采集与占领加成同口径） */
  resources?: ProducedResource[];
}

/** 名城 → 独有效果（v62）。洛阳守城、长安箭塔、官渡 / 成都 / 建业 / 邺城的辖下野地、许昌调兵、襄阳仓库 */
export const FAMOUS_EFFECTS: Record<FamousCityName, FamousEffectDef> = {
  洛阳: { kind: 'wall', percent: 5 },
  长安: { kind: 'tower', percent: 20 },
  官渡: { kind: 'territory', percent: 25, resources: ['food'] },
  成都: { kind: 'territory', percent: 25, resources: ['iron', 'stone'] },
  建业: { kind: 'territory', percent: 25, resources: ['wood'] },
  邺城: { kind: 'territory', percent: 25, resources: ['gold'] },
  许昌: { kind: 'march', percent: 20 },
  襄阳: { kind: 'warehouse', percent: 50 },
};

/** 协议视图（TileView.famous.effect / CityView.famousEffect）：种类、数值与野地资源（非野地为 null） */
export interface FamousEffectView {
  kind: FamousEffectKind;
  percent: number;
  resources: ProducedResource[] | null;
}

/** 名城标记对应的效果定义；非名城（或名字不在表中）为 null */
export function famousEffectOf(name: string | null | undefined): FamousEffectDef | null {
  if (!name) {
    return null;
  }
  return Object.hasOwn(FAMOUS_EFFECTS, name) ? FAMOUS_EFFECTS[name as FamousCityName] : null;
}

/** 名城的主题建筑（AISLG-167）；非名城（或名字不在表中）为 null */
export function famousThemeBuildingOf(name: string | null | undefined): BuildingKind | null {
  if (!name) {
    return null;
  }
  return Object.hasOwn(FAMOUS_THEME_BUILDING, name) ? FAMOUS_THEME_BUILDING[name as FamousCityName] : null;
}

/** 协议视图口径：与 famousEffectOf 同源，供 TileView / CityView 下发 */
export function famousEffectView(name: string | null | undefined): FamousEffectView | null {
  const def = famousEffectOf(name);
  return def ? { kind: def.kind, percent: def.percent, resources: def.resources ? [...def.resources] : null } : null;
}

/** 该名城是否为指定种类的效果；是则返回数值，否则 0 */
function percentOfKind(name: string | null | undefined, kind: FamousEffectKind): number {
  const def = famousEffectOf(name);
  return def && def.kind === kind ? def.percent : 0;
}

/** 城墙守城减伤的额外百分点（洛阳 +5），与城防科技同一入口（wallDefensePercent 的 extraPercent） */
export function famousWallExtraPercent(name: string | null | undefined): number {
  return percentOfKind(name, 'wall');
}

/** 箭塔伤害百分比（长安 +20%） */
export function famousTowerPercent(name: string | null | undefined): number {
  return percentOfKind(name, 'tower');
}

/** 仓库防掠夺保护额百分比（襄阳 +50%） */
export function famousWarehousePercent(name: string | null | undefined): number {
  return percentOfKind(name, 'warehouse');
}

/** 出发城为该名城时，调兵 / 运输的行军速度百分比（许昌 +20%） */
export function famousMarchPercent(name: string | null | undefined): number {
  return percentOfKind(name, 'march');
}

/**
 * 名城辖下野地对某资源的产出乘数（1 = 无加成）：该名城的效果是 territory 且包含该资源时为 1 + 百分比。
 * 占领加成（territoryBonusRates）与驻军采集（settleTerritoryReserves / territoryDisplayRates）共用。
 */
export function famousTerritoryMultiplier(name: string | null | undefined, resource: ProducedResource): number {
  const def = famousEffectOf(name);
  if (!def || def.kind !== 'territory' || !def.resources?.includes(resource)) {
    return 1;
  }
  return 1 + def.percent / 100;
}
