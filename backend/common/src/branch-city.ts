// 城池等级与分城规则（v24，AISLG-58；数值为占位，上线后按数据调整）：
// - 城池等级 = 该城官府等级（不另造升级系统）；
// - 占领 NPC 城变分城：主城官府 ≥ 3 级；分城数 < 分城上限 = floor(主城官府等级 ÷ 3)；
//   目标 NPC 城等级 ≤ 出发城官府等级（参考旧游戏：只能拿下不高于自己级别的城）。
// API（出征发起初核）与 Worker（到达复核）共用，两侧不得各自另算。

/** 占领 NPC 城所需的主城官府最低等级 */
export const BRANCH_MIN_GOVERNMENT = 3;
/** 主城官府每多少级换 1 个分城名额 */
export const BRANCH_GOVERNMENT_PER_SLOT = 3;

/** 分城上限 = floor(主城官府等级 ÷ 3)；名城也计入分城数量（AISLG-56） */
export function branchCityLimit(mainGovernmentLevel: number): number {
  return Math.floor(Math.max(0, Math.floor(mainGovernmentLevel)) / BRANCH_GOVERNMENT_PER_SLOT);
}

/** 城池等级 = 该城官府等级（未建官府按 0；旧列 cities.level 恒为 1，不再作为展示口径） */
export function cityLevelOf(governmentLevel: number): number {
  return Math.max(0, Math.floor(governmentLevel));
}

export type OccupyCityDenial = 'GOVERNMENT_TOO_LOW' | 'BRANCH_LIMIT' | 'TARGET_LEVEL_TOO_HIGH';

/**
 * 占领 NPC 城的资格判定（出征发起与到达复核共用）。顺序即提示优先级：
 * 主城官府不够 3 级 → 分城已满 → 目标等级高于出发城官府等级。
 * branchCount 为账号现有分城数（不含主城）。
 */
export function checkOccupyNpcCity(args: {
  mainGovernment: number;
  fromGovernment: number;
  branchCount: number;
  targetLevel: number;
}): OccupyCityDenial | null {
  if (args.mainGovernment < BRANCH_MIN_GOVERNMENT) {
    return 'GOVERNMENT_TOO_LOW';
  }
  if (args.branchCount >= branchCityLimit(args.mainGovernment)) {
    return 'BRANCH_LIMIT';
  }
  if (args.targetLevel > args.fromGovernment) {
    return 'TARGET_LEVEL_TOO_HIGH';
  }
  return null;
}
