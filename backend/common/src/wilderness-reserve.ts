// 野地储量（v61，AISLG-165）：每块野地有一份储量，驻军采集从中扣，采空即停；没人采时按恢复速度慢慢长回。
// 数值（占位，可微调，只改本文件）：储量基准 = 1500 + 3500 × 等级，按 (x, y, 等级) 的固定哈希在 ±20% 内取值；
// 金矿 ×0.4。采集上限 = 储量的 10%/h，恢复 = 储量的 2%/h，有没有人占领都恢复。
// 单位：储量与其上限为**基准单位**（与 world.ts 的占领加成、驻军采集同口径）；采集上限与恢复速率随 time_scale
// 放大（与产出同幅），因此采空 / 回满的真实时长按倍率缩短，储量上限本身不随缩放。
// 口径：占领加成不扣储量；连片 / 名城 / 农耕等加成只放大产出，不额外扣储量。
// 惰性结算：储量只在 (reserve, reserve_at) 落库；结算或读取时用闭式解推进到当前时刻，无需后台逐格扫描。
// 归属边界：归属方名下的野地与城池结算同区间推进；归属变化前的空档只按恢复计算（无人采集）。

import { getTimeScale } from './time-scale';
import { famousTerritoryMultiplier } from './famous-effects';
import { clusterBonusMultiplier, TERRAIN_INFO, territoryBonusRates, territoryClusterSizes, wildernessGatherRate, type TerritoryRow } from './world';
import type { TerrainKind } from './protocol';
import type { ProducedResource } from './production';

/** 储量基准 = 固定部分 + 每级增量（基准单位） */
export const RESERVE_FIXED_BASE = 1500;
export const RESERVE_PER_LEVEL = 3500;
/** 同一块地的储量在 基准 × (1 ± 该比例) 内随机（固定哈希，不随时间变化） */
export const RESERVE_VARIANCE = 0.2;
/** 金矿储量相对基准的系数（金币稀缺） */
export const RESERVE_GOLD_FACTOR = 0.4;
/** 采集上限（占储量的比例 / 小时）：每块地每小时最多采走这么多 */
export const GATHER_CAP_RATIO = 0.1;
/** 恢复速率（占储量的比例 / 小时）：净流量 = 恢复 − 采集，不低于 0、不超过上限 */
export const RECOVERY_RATIO = 0.02;

const MS_PER_HOUR = 3_600_000;

export type ReserveTier = 'ample' | 'normal' | 'depleted';

/** 固定哈希（x, y, 等级）→ [0, 1)：同一块地永远得到同一个数 */
export function reserveHash(x: number, y: number, level: number): number {
  let h = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(y + 0x7f4a7c15, 0xc2b2ae35) ^ Math.imul(level + 0x27d4eb2f, 0x165667b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 单块野地的储量上限（基准单位）：基准 × 固定哈希 ±20%，金矿 ×0.4 */
export function reserveCapOf(x: number, y: number, terrain: TerrainKind, level: number): number {
  const lv = Math.max(1, level);
  const base = Math.round(RESERVE_FIXED_BASE + RESERVE_PER_LEVEL * lv);
  const jitter = 1 - RESERVE_VARIANCE + 2 * RESERVE_VARIANCE * reserveHash(x, y, lv);
  const goldFactor = terrain === 'gold_mine' ? RESERVE_GOLD_FACTOR : 1;
  return base * jitter * goldFactor;
}

/** 驻军采集的储量扣减潜力（基准 / 小时）：采集速率与采集上限取小；未驻军为 0 */
export function gatherDrainOf(terrain: TerrainKind, level: number, garrison: number, cap: number): number {
  return Math.min(wildernessGatherRate(terrain, level, garrison), cap * GATHER_CAP_RATIO);
}

/** 闭式推进的结果（hours 小时后） */
export interface ReserveStep {
  reserve: number;
  /** 区间内的采集产出（基准单位，未乘连片 / 时间缩放） */
  yielded: number;
  /** 储量在区间内触底的时刻（相对区间起点的小时数）；未触底为 null */
  depletedAfterHours: number | null;
}

/**
 * 单块地在 hours 小时内的储量推进（纯函数，闭式解）：
 * - 采集 ≤ 恢复：储量净增（封顶于上限），产出 = 采集；
 * - 采集 > 恢复 且储量 > 0：储量按（采集 − 恢复）下降，产出 = 采集，触底后进入下一段；
 * - 储量为 0 且采集 > 恢复：产出 = 恢复（留兵也只能按恢复速度小量采集），储量保持 0。
 */
export function advanceReserve(reserve: number, cap: number, drain: number, recovery: number, hours: number): ReserveStep {
  const start = Math.min(cap, Math.max(0, reserve));
  if (hours <= 0) {
    return { reserve: start, yielded: 0, depletedAfterHours: null };
  }
  if (drain <= recovery) {
    return { reserve: Math.min(cap, start + (recovery - drain) * hours), yielded: drain * hours, depletedAfterHours: null };
  }
  if (start <= 0) {
    return { reserve: 0, yielded: recovery * hours, depletedAfterHours: null };
  }
  const netOut = drain - recovery;
  const emptyIn = start / netOut;
  if (hours < emptyIn) {
    return { reserve: start - netOut * hours, yielded: drain * hours, depletedAfterHours: null };
  }
  return { reserve: 0, yielded: drain * emptyIn + recovery * (hours - emptyIn), depletedAfterHours: emptyIn };
}

/** 按当前状态预计再过多少小时采空（无此类事件为 null：储量已空、未驻军或恢复不低于采集） */
export function projectEmptyHours(reserve: number, drain: number, recovery: number): number | null {
  if (reserve <= 0 || drain <= recovery) {
    return null;
  }
  return reserve / (drain - recovery);
}

/** 按当前状态预计再过多少小时回满（无此类事件为 null：已满或采集不低于恢复） */
export function projectFullHours(reserve: number, cap: number, drain: number, recovery: number): number | null {
  if (reserve >= cap || drain >= recovery) {
    return null;
  }
  return (cap - reserve) / (recovery - drain);
}

/** 储量档位（对外只给档位给非归属且未侦察的账号）：>60% 充足 / 20%–60% 一般 / <20% 枯竭 */
export function reserveTierOf(reserve: number, cap: number): ReserveTier {
  const ratio = cap > 0 ? reserve / cap : 0;
  if (ratio > 0.6) {
    return 'ample';
  }
  if (ratio >= 0.2) {
    return 'normal';
  }
  return 'depleted';
}

/** 推进所需的地块输入（与 TerritoryRow 同形；reserve / reserve_at 为库中原值） */
export type TileReserveInput = Pick<TerritoryRow, 'x' | 'y' | 'terrain' | 'level' | 'garrison' | 'reserve' | 'reserve_at'>;

/** 单块地推进到 to 的结果 */
export interface TileReserveStep {
  reserve: number;
  cap: number;
  /** 当前驻军的采集潜力（owned 为 false 时为 0） */
  drain: number;
  recovery: number;
  yielded: number;
  /** 区间内采空的时刻（未采空为 null） */
  depletedAt: Date | null;
  /** 按当前驻军预计采空 / 回满的时刻（无此类事件为 null） */
  emptyAt: Date | null;
  fullAt: Date | null;
}

function addHours(at: Date, hours: number): Date {
  return new Date(at.getTime() + hours * MS_PER_HOUR);
}

function hoursBetween(from: Date, to: Date): number {
  return Math.max(0, to.getTime() - from.getTime()) / MS_PER_HOUR;
}

/**
 * 单块地从 from 推进到 to（纯函数）。库中无储量值视为满储量；库中时刻早于 from 的空档
 * 只按恢复推进（归属变化前无人采集）。owned 为 false 时（无主野地）不扣采集。
 */
export function advanceTile(tile: TileReserveInput, from: Date, to: Date, owned: boolean): TileReserveStep {
  // 储量上限保持基准；采集上限与恢复速率随 time_scale 放大，因此采空 / 回满的真实时长按倍率缩短
  const scale = getTimeScale();
  const cap = reserveCapOf(tile.x, tile.y, tile.terrain, tile.level);
  const drainBase = owned ? gatherDrainOf(tile.terrain, tile.level, tile.garrison, cap) : 0;
  const drain = drainBase * scale;
  const recovery = cap * RECOVERY_RATIO * scale;
  let reserve = tile.reserve ?? cap;
  let at = tile.reserve_at ?? from;
  if (at < from) {
    reserve = advanceReserve(reserve, cap, 0, recovery, hoursBetween(at, from)).reserve;
    at = from;
  }
  const step = advanceReserve(reserve, cap, drain, recovery, hoursBetween(at, to));
  const emptyHours = projectEmptyHours(step.reserve, drain, recovery);
  const fullHours = projectFullHours(step.reserve, cap, drain, recovery);
  return {
    reserve: step.reserve,
    cap,
    // 对外的速率为基准单位（与 bonusRate、gatherRate 同口径）；yielded 与预计时刻为真实口径
    drain: drainBase,
    recovery: recovery / scale,
    yielded: step.yielded,
    depletedAt: step.depletedAfterHours === null ? null : addHours(at, step.depletedAfterHours),
    emptyAt: emptyHours === null ? null : addHours(to, emptyHours),
    fullAt: fullHours === null ? null : addHours(to, fullHours),
  };
}

/** 当前瞬时采集速率（基准 / 小时，未乘连片）：储量未空取采集潜力，已空取恢复（与采集上限取小） */
export function effectiveGatherOf(reserve: number | null | undefined, cap: number, drain: number): number {
  const recovery = cap * RECOVERY_RATIO;
  const current = reserve ?? cap;
  return current > 0 ? drain : Math.min(drain, recovery);
}

/** 城池名下野地的结算结果（gather 为基准单位，已乘连片加成，未乘时间缩放与占领百分数加成） */
export interface TerritorySettle {
  gather: Partial<Record<ProducedResource, number>>;
  updates: Array<{ x: number; y: number; reserve: number; reserveAt: Date; emptyAt: Date | null }>;
  depletions: Array<{ x: number; y: number; terrain: TerrainKind; level: number; at: Date }>;
}

/**
 * 城池 [from, to] 区间内对名下全部野地推进储量并汇总采集产出（纯函数，不落库）。
 * 连片加成只放大产出，不额外扣储量（采集扣减按单块计算）。
 */
export function settleTerritoryReserves(tiles: TerritoryRow[], from: Date, to: Date): TerritorySettle {
  const sizes = territoryClusterSizes(tiles);
  const result: TerritorySettle = { gather: {}, updates: [], depletions: [] };
  for (const tile of tiles) {
    const step = advanceTile(tile, from, to, true);
    const resource = TERRAIN_INFO[tile.terrain].resource;
    const multiplier = clusterBonusMultiplier(sizes.get(`${tile.x},${tile.y}`) ?? 1) * famousTerritoryMultiplier(tile.famous_name, resource);
    result.gather[resource] = (result.gather[resource] ?? 0) + step.yielded * multiplier;
    result.updates.push({ x: tile.x, y: tile.y, reserve: step.reserve, reserveAt: to, emptyAt: step.emptyAt });
    if (step.depletedAt) {
      result.depletions.push({ x: tile.x, y: tile.y, terrain: tile.terrain, level: tile.level, at: step.depletedAt });
    }
  }
  return result;
}

/**
 * 城池的产量展示口径（基准单位，与 productionPerHour 的 extra 参数一致）：占领加成 + 按当前储量封顶的
 * 瞬时采集（连片加成已计入）。只读库中状态，不做时间推进；结算以 settleTerritoryReserves 为准。
 */
export function territoryDisplayRates(tiles: TerritoryRow[]): Partial<Record<ProducedResource, number>> {
  const rates = territoryBonusRates(tiles);
  const sizes = territoryClusterSizes(tiles);
  for (const tile of tiles) {
    const cap = reserveCapOf(tile.x, tile.y, tile.terrain, tile.level);
    const drain = gatherDrainOf(tile.terrain, tile.level, tile.garrison, cap);
    const resource = TERRAIN_INFO[tile.terrain].resource;
    const multiplier = clusterBonusMultiplier(sizes.get(`${tile.x},${tile.y}`) ?? 1) * famousTerritoryMultiplier(tile.famous_name, resource);
    rates[resource] = (rates[resource] ?? 0) + Math.round(effectiveGatherOf(tile.reserve, cap, drain) * multiplier);
  }
  return rates;
}

/** 把结算推进后的储量写回内存中的地块快照（结算与视图同口径；就地修改并返回原数组） */
export function applyReserveUpdates<T extends TileReserveInput>(tiles: T[], updates: TerritorySettle['updates']): T[] {
  const byPos = new Map(updates.map((update) => [`${update.x},${update.y}`, update]));
  for (const tile of tiles) {
    const update = byPos.get(`${tile.x},${tile.y}`);
    if (update) {
      tile.reserve = update.reserve;
      tile.reserve_at = update.reserveAt;
    }
  }
  return tiles;
}
