// 取消建造条目的返还规则（v7 排队返还；v71 AISLG-190 在建也返还、连升只退未完成级）。
// 从 api/src/handlers-city.ts 抽出到 common：API 的 CANCEL_BUILD、上线迁移（v87 AISLG-217）与换主城
// （v82 AISLG-205，v87 起一并取消酒馆 / 书院在建）都用同一份规则，不各写一套。

import { RESOURCE_KEYS, type BuildingKind, type Resources } from './protocol';
import { upgradeChainCost } from './rules';

/** 取消返还所需的 builds 行字段（成本快照 + 连升终点） */
export interface RefundableBuildRow {
  kind: string;
  level: number;
  to_level?: number | null;
  cost?: Record<string, unknown> | null;
}

/** builds.cost 成本快照 → Resources（旧数据无快照时按零返还） */
export function refundOf(row: { cost?: Record<string, unknown> | null }): Resources {
  const refund: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  const cost = row.cost ?? {};
  for (const key of RESOURCE_KEYS) {
    const value = cost[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      refund[key] = Math.floor(value);
    }
  }
  return refund;
}

/**
 * 取消返还额（AISLG-190）：单级 / 建造 = 成本快照全额；连升（to_level）只返还未完成的级——
 * row.level 为当前推进中的级，它起到 to_level 的各级成本才退（已完成的级保留等级、不退）。
 * 排队中的连升 row.level = 起始级，结果即整链快照，与快照一致。
 */
export function cancelRefundOf(row: RefundableBuildRow): Resources {
  if (row.to_level === null || row.to_level === undefined) {
    return refundOf(row);
  }
  return upgradeChainCost(row.kind as BuildingKind, row.level - 1, row.to_level);
}
