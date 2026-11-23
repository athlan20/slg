// 掠夺与仓库保护的数值镜像（v16，AISLG-4）：唯一事实来源是
// backend/common/src/plunder.ts 与 backend/common/src/troops.ts 的 carry，
// 对外文档为 docs/agent-api.md；仅用于界面预览（编队负重 / 仓库保护量 / 冷却时长），
// 权威判定与装填结算在服务端。经 protocol.ts 原名再导出，既有 import 路径不变。

import { TROOP_INFO, TROOP_KINDS } from './protocol';
import type { TroopKind } from './protocol';

/** 编队负重合计 = Σ(数量 × 单兵 carry)：镜像 backend/common/src/troops.ts 的 armyCarryCapacity；
 *  bonusPercent 为负重科技加成百分数（v27 AISLG-77，每级 +5%，合计后向下取整） */
export function armyCarryCapacity(counts: Partial<Record<TroopKind, number>>, bonusPercent = 0): number {
  let total = 0;
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(counts[kind] ?? 0);
    if (count > 0) {
      total += TROOP_INFO[kind].carry * count;
    }
  }
  return bonusPercent > 0 ? Math.floor((total * (100 + bonusPercent)) / 100) : total;
}

/**
 * 仓库防掠夺保护（v16，占位）：镜像 backend/common/src/plunder.ts。
 * 保护总量 = 4000 × 仓库等级，四资源固定均分（每资源 1000 × 等级）；
 * 仅用于建筑弹窗展示，权威结算在服务端（玩家城掠夺消费方随玩家对抗阶段接入）。
 */
export const WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL = 4000;

export const WAREHOUSE_PROTECTION_SPLIT = 4;

/** 单资源保护额 = 1000 × 仓库等级（粮/木/石/铁各自独立享有） */
export function warehouseProtectionPerResource(warehouseLevel: number): number {
  return Math.max(0, Math.floor(warehouseLevel)) * (WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL / WAREHOUSE_PROTECTION_SPLIT);
}

/** 掠夺冷却（小时）：镜像 backend/common/src/plunder.ts 的 PLUNDER_COOLDOWN_MS */
export const PLUNDER_COOLDOWN_HOURS = 24;

// ---- v118（AISLG-270）：野地掠夺按账号每日递减 ----
// 唯一事实来源是 backend/common/src/plunder.ts 的 PLUNDER_DAILY_FULL_LIMIT /
// PLUNDER_DAILY_HALF_LIMIT / plunderLootPercent；这里只镜像数值供界面提示，
// 权威计数与打折在服务端（GET_STATE 的 plunderDaily 给出实际次数与倍数）。

/** 当天第 1..200 次全额、201..400 次减半、401 起两成 */
export const PLUNDER_DAILY_FULL_LIMIT = 200;

export const PLUNDER_DAILY_HALF_LIMIT = 400;

/** GET_STATE 的账号级 plunderDaily（v118）：今日已成功野地掠夺次数 / 下一次的收益倍数 / 下次清零时刻 */
export interface PlunderDailyView {
  count: number;
  /** 下一次野地掠夺的收益倍数：100 / 50 / 20 */
  lootPercent: number;
  /** 次数清零时刻（ISO 8601） */
  resetAt: string;
}
