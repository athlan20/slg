// 断粮哗变（v34，AISLG-107）的共用规则：城池粮食为 0 且净产量为负时，每过 1 小时（随全局时间倍速缩放）
// 该城**城内驻军**每个兵种减少 10%（向上取整、至少 1 个；没有逃兵系统，减少的直接损失）；在外部队
// （行军中 / 驻守野地）不强制召回，但耗粮照常计入（所以出征多也会加速断粮）。粮食恢复为正或净产量转正即停。
// 预计断粮时间 starveAt 随 CityView 下发，距断粮不足 1 小时（缩放后）推送一次预警。
// 旧口径「断粮仅停止增长、部队不解散」（v14）由本规则取代；全部数值为占位，上线后按数据调整。
// API（视图的预计断粮时间）与 Worker（预警 / 哗变结算）共用，两侧不得各自再实现一套。

import { TROOP_KINDS, type TroopKind } from './protocol';
import { scaledMs } from './time-scale';

/** 每次哗变城内每个兵种的减员比例（百分数） */
export const MUTINY_LOSS_PERCENT = 10;
/** 哗变间隔与预警提前量（基准小时，随全局时间倍速缩放） */
export const MUTINY_INTERVAL_HOURS = 1;
export const STARVE_WARNING_LEAD_HOURS = 1;

export function mutinyIntervalMs(): number {
  return scaledMs(MUTINY_INTERVAL_HOURS * 3_600_000);
}

export function starveWarningLeadMs(): number {
  return scaledMs(STARVE_WARNING_LEAD_HOURS * 3_600_000);
}

export interface StarvationProjection {
  /** 已断粮（粮食为 0 且净产量为负）：哗变计时中 */
  starving: boolean;
  /** 预计断粮时刻（毫秒时间戳）：已断粮 = 现在；净产量非负（不会断粮）为 null */
  starveAtMs: number | null;
}

/**
 * 按当前粮食与净产量推算断粮：netPerHour = 粮毛产量 − 全军耗粮（均为已按全局倍速折算的每小时值，
 * 与 CityView 同口径）。净产量 ≥ 0 不会断粮；粮食为 0 且净产量 < 0 即已断粮。
 */
export function projectStarvation(food: number, netPerHour: number, nowMs: number): StarvationProjection {
  if (netPerHour >= 0) {
    return { starving: false, starveAtMs: null };
  }
  if (food <= 0) {
    return { starving: true, starveAtMs: nowMs };
  }
  return { starving: false, starveAtMs: nowMs + (food / -netPerHour) * 3_600_000 };
}

export interface MutinyResult {
  /** 各兵种本次减员（仅非零项） */
  losses: Partial<Record<TroopKind, number>>;
  /** 减员后的城内驻军（全零兵种已剔除） */
  remaining: Partial<Record<TroopKind, number>>;
  total: number;
}

/** 一次哗变：每个兵种减 ceil(数量 × 10%)（至少 1 个，不超过现有数量） */
export function applyMutiny(army: Partial<Record<TroopKind, number>>): MutinyResult {
  const losses: Partial<Record<TroopKind, number>> = {};
  const remaining: Partial<Record<TroopKind, number>> = {};
  let total = 0;
  for (const kind of TROOP_KINDS) {
    const count = Math.max(0, Math.floor(army[kind] ?? 0));
    if (count <= 0) {
      continue;
    }
    const loss = Math.min(count, Math.max(1, Math.ceil((count * MUTINY_LOSS_PERCENT) / 100)));
    losses[kind] = loss;
    total += loss;
    if (count - loss > 0) {
      remaining[kind] = count - loss;
    }
  }
  return { losses, remaining, total };
}
