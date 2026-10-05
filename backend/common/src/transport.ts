// 自有城池间运输（v26，AISLG-79）的共用规则：货物解析 / 合计与负重校验。
// API（发起时扣资源）与 Worker（到达入账 / 撤回与失效返还）共用，不各自再实现一套。

import { RESOURCE_KEYS, type Resources, type TroopKind } from './protocol';
import { armyCarryCapacity } from './troops';

export function emptyCargo(): Resources {
  return { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
}

/** 货物总量（五项之和） */
export function cargoTotal(cargo: Partial<Resources>): number {
  return RESOURCE_KEYS.reduce((sum, key) => sum + Math.floor(cargo[key] ?? 0), 0);
}

/** 解析请求里的 cargo：须为对象，五项缺省 0、非负整数，未知键 / 非法值 / 总量为 0 返回 null */
export function parseCargo(raw: unknown): Resources | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const cargo = emptyCargo();
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(RESOURCE_KEYS as readonly string[]).includes(key)) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      return null;
    }
    cargo[key as keyof Resources] = value;
  }
  return cargoTotal(cargo) > 0 ? cargo : null;
}

/** 库中 jsonb 货物 → 完整货物；空 / 非对象返回 null */
export function readCargo(raw: unknown): Resources | null {
  if (raw === null || typeof raw !== 'object') {
    return null;
  }
  const src = raw as Record<string, unknown>;
  const cargo = emptyCargo();
  for (const key of RESOURCE_KEYS) {
    const value = src[key];
    cargo[key] = typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  }
  return cargoTotal(cargo) > 0 ? cargo : null;
}

/** 货物是否超出编队负重 */
export function cargoOverCapacity(
  cargo: Resources,
  troops: Partial<Record<TroopKind, number>>,
  carryBonusPercent = 0,
): boolean {
  return cargoTotal(cargo) > armyCarryCapacity(troops, carryBonusPercent);
}
