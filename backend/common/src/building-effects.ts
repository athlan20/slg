// 二期新建筑的效果出口（v30，AISLG-80~83）：校场 / 烽火台 / 驿站 / 箭塔。
// 消费方只调这些函数，不自行乘系数；全部数值为占位，上线后按数据调整。
// - 校场（parade_ground，AISLG-80）：每城同时在外部队数上限 = 校场等级（未建按 1）；
// - 烽火台（beacon，AISLG-81）：来袭预警提前量每级 +10%，敌情按等级分 3 档详细度；
// - 驿站（post_station，AISLG-83）：从本城出发、目的地是自己另一座城的调兵 / 运输，行军速度每级 +10%；
// - 箭塔（arrow_tower，AISLG-82）：守城战里守方城墙位上不会被消灭的远程单位，伤害与射程随等级提升。

import type { ArmyCounts, TroopKind } from './protocol';
import { TROOP_KINDS } from './protocol';

// ---- 校场 ----

/** 没建校场时的在外部队上限（保证新号能出征） */
export const PARADE_BASE_LIMIT = 1;

/** 在外部队上限 = max(1, 校场等级) */
export function deployLimit(paradeLevel: number): number {
  return Math.max(PARADE_BASE_LIMIT, Math.floor(paradeLevel));
}

/** 能否再派出一支部队（count = 当前在外部队数；超限只拦新出征，已在外的不受影响） */
export function canDeployMore(count: number, paradeLevel: number): boolean {
  return count < deployLimit(paradeLevel);
}

// ---- 烽火台 ----

/** 每级预警提前量加成（百分数；10 级翻倍） */
export const BEACON_LEAD_PERCENT_PER_LEVEL = 10;
/** 敌情详细度分界：3 级起给兵种构成（各兵种大概范围），6 级起给精确兵种与数量 */
export const BEACON_KINDS_LEVEL = 3;
export const BEACON_EXACT_LEVEL = 6;

/** 预警提前量倍数 = 1 + 0.1 × 烽火台等级 */
export function beaconLeadMultiplier(level: number): number {
  return 1 + (Math.max(0, Math.floor(level)) * BEACON_LEAD_PERCENT_PER_LEVEL) / 100;
}

/** 预警敌情详细度：range 只给兵力大概范围 / kinds 各兵种大概范围 / exact 精确兵种与数量 */
export type BeaconIntel = 'range' | 'kinds' | 'exact';

export function beaconIntelOf(level: number): BeaconIntel {
  return level >= BEACON_EXACT_LEVEL ? 'exact' : level >= BEACON_KINDS_LEVEL ? 'kinds' : 'range';
}

/** 区间（编成数量 ±20% 取整，与既有预警兵力范围同口径） */
export function estimateRange(count: number): { min: number; max: number } {
  const n = Math.max(0, Math.floor(count));
  return { min: Math.floor(n * 0.8), max: Math.ceil(n * 1.2) };
}

/** 预警里的敌情：总范围恒有；kinds 档给各兵种范围，exact 档给精确编成 */
export interface WarningIntel {
  intel: BeaconIntel;
  armyMin: number;
  armyMax: number;
  armyKinds?: Partial<Record<TroopKind, { min: number; max: number }>>;
  army?: Partial<Record<TroopKind, number>>;
}

export function warningIntel(army: Partial<Record<TroopKind, number>>, beaconLevel: number): WarningIntel {
  const intel = beaconIntelOf(beaconLevel);
  let total = 0;
  const kinds: Partial<Record<TroopKind, { min: number; max: number }>> = {};
  const exact: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = Math.max(0, Math.floor(army[kind] ?? 0));
    if (count > 0) {
      total += count;
      kinds[kind] = estimateRange(count);
      exact[kind] = count;
    }
  }
  const range = estimateRange(total);
  return {
    intel,
    armyMin: range.min,
    armyMax: range.max,
    ...(intel === 'kinds' ? { armyKinds: kinds } : {}),
    ...(intel === 'exact' ? { army: exact } : {}),
  };
}

// ---- 驿站 ----

/** 每级行军速度加成（百分数；10 级翻倍） */
export const STATION_PERCENT_PER_LEVEL = 10;

/** 驿站行军速度加成百分数（仅自己城池之间的调兵 / 运输使用） */
export function stationPercent(level: number): number {
  return Math.max(0, Math.floor(level)) * STATION_PERCENT_PER_LEVEL;
}

// ---- 箭塔 ----

/** 箭塔每回合固定伤害 = 每级基础 × 等级（不走判定链、不吃防御；占位，校准见 docs/battle-calibration.md） */
export const TOWER_DAMAGE_PER_LEVEL = 150;
/** 射程 = 基础 + 每级加成（一维战场坐标；战场长度 120，攻方到城墙位的距离 ≤ 射程才被射击） */
export const TOWER_RANGE_BASE = 45;
export const TOWER_RANGE_PER_LEVEL = 5;

export interface TowerStats {
  /** 每回合对射程内最近敌方兵堆造成的固定伤害 */
  damage: number;
  range: number;
}

/** 箭塔数值；未建（0 级）为 null */
export function towerStats(level: number): TowerStats | null {
  const lv = Math.max(0, Math.floor(level));
  if (lv === 0) {
    return null;
  }
  return { damage: TOWER_DAMAGE_PER_LEVEL * lv, range: TOWER_RANGE_BASE + TOWER_RANGE_PER_LEVEL * lv };
}

export type { ArmyCounts };
