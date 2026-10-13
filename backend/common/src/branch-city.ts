// 城池等级与分城规则（v24，AISLG-58；数值为占位，上线后按数据调整）：
// - 城池等级 = 该城官府等级（不另造升级系统）；
// - 占领 NPC 城变分城：主城官府 ≥ 3 级；分城数 < 分城上限 = floor(主城官府等级 ÷ 2)（v57 由 ÷3 放宽）；
//   目标 NPC 城等级 ≤ 出发城官府等级（参考旧游戏：只能拿下不高于自己级别的城）；
//   本账号刚放弃的分城在冷却内不能再占回（v57，AISLG-153；冷却天数见 discardCooldownDays）。
// API（出征发起初核）与 Worker（到达复核）共用，两侧不得各自另算。

/** 占领 NPC 城所需的主城官府最低等级 */
export const BRANCH_MIN_GOVERNMENT = 3;
/** 主城官府每多少级换 1 个分城名额 */
export const BRANCH_GOVERNMENT_PER_SLOT = 2;

/** 分城上限 = floor(主城官府等级 ÷ 2)；名城也计入分城数量（AISLG-56，v57 由 ÷3 放宽为 ÷2） */
export function branchCityLimit(mainGovernmentLevel: number): number {
  return Math.floor(Math.max(0, Math.floor(mainGovernmentLevel)) / BRANCH_GOVERNMENT_PER_SLOT);
}

/** 城池等级 = 该城官府等级（未建官府按 0；旧列 cities.level 恒为 1，不再作为展示口径） */
export function cityLevelOf(governmentLevel: number): number {
  return Math.max(0, Math.floor(governmentLevel));
}

/** 放弃分城后的冷却天数 = 放弃时的官府等级（参考旧游戏 discardCity；未建官府按 1 天）。调用方再按时间缩放换算 */
export function discardCooldownDays(governmentLevel: number): number {
  return Math.max(1, Math.floor(Math.max(0, governmentLevel)));
}

export type OccupyCityDenial = 'GOVERNMENT_TOO_LOW' | 'BRANCH_LIMIT' | 'DISCARD_COOLDOWN' | 'TARGET_LEVEL_TOO_HIGH';

/**
 * 占领 NPC 城的资格判定（出征发起与到达复核共用）。顺序即提示优先级：
 * 主城官府不够 3 级 → 分城已满 → 放弃冷却中 → 目标等级高于出发城官府等级。
 * branchCount 为账号现有分城数（不含主城）；discardCooldown 为本账号在该地块的放弃冷却是否未结束。
 */
export function checkOccupyNpcCity(args: {
  mainGovernment: number;
  fromGovernment: number;
  branchCount: number;
  targetLevel: number;
  discardCooldown?: boolean;
}): OccupyCityDenial | null {
  if (args.mainGovernment < BRANCH_MIN_GOVERNMENT) {
    return 'GOVERNMENT_TOO_LOW';
  }
  if (args.branchCount >= branchCityLimit(args.mainGovernment)) {
    return 'BRANCH_LIMIT';
  }
  if (args.discardCooldown) {
    return 'DISCARD_COOLDOWN';
  }
  if (args.targetLevel > args.fromGovernment) {
    return 'TARGET_LEVEL_TOO_HIGH';
  }
  return null;
}
