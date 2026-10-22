// 赛季预告阶段（AISLG-134，docs/season-system.md §4）：T-3d / T-1d / T-1h / T-10m。
// 纯函数，Worker（发预告）与运维脚本（状态展示、set-end 重新布防）共用，不读写数据库。
// 阶段按距结束的剩余时间判定：剩余 ≤ 阈值即“已到达”。已到达且未发过的阶段里只发最近（最靠近结束）的一个，
// 其余未发的已到达阶段一并标记为已发（部署 / 重启晚于阈值时不连发多条）。

/** 预告阶段（阈值从大到小排列：数组末尾即最靠近结束的阶段） */
export const SEASON_NOTICE_STAGES = [
  { stage: 'T-3d', remainingSec: 3 * 24 * 3600, strongRemind: false },
  { stage: 'T-1d', remainingSec: 24 * 3600, strongRemind: false },
  { stage: 'T-1h', remainingSec: 3600, strongRemind: true },
  { stage: 'T-10m', remainingSec: 600, strongRemind: true },
] as const;

export type SeasonNoticeStage = (typeof SEASON_NOTICE_STAGES)[number]['stage'];

/** 距结束的剩余毫秒（≤ 0 表示已到结束，此时不再发预告） */
export function remainingMs(endAtMs: number, nowMs: number): number {
  return endAtMs - nowMs;
}

/** 已到达（剩余 ≤ 阈值且尚未结束）的阶段，按阈值从大到小 */
export function crossedStages(endAtMs: number, nowMs: number): SeasonNoticeStage[] {
  const left = remainingMs(endAtMs, nowMs);
  if (left <= 0) {
    return [];
  }
  return SEASON_NOTICE_STAGES.filter((item) => left <= item.remainingSec * 1000).map((item) => item.stage);
}

/**
 * 本次的预告计划：send 为要发的那一个阶段（已到达且未发过的里最近的一个，没有则 null）；
 * markNotified 为这次一并标记为已发的全部阶段（包括 send 本身与更早的未发阶段，防止晚部署连发）。
 */
export function planNotice(
  endAtMs: number,
  nowMs: number,
  notified: readonly string[],
): { send: SeasonNoticeStage | null; markNotified: SeasonNoticeStage[] } {
  const pending = crossedStages(endAtMs, nowMs).filter((stage) => !notified.includes(stage));
  if (pending.length === 0) {
    return { send: null, markNotified: [] };
  }
  return { send: pending[pending.length - 1], markNotified: pending };
}

/**
 * 改结束时间后重新布防（运维 set-end）：只保留仍已到达的阶段，已不再到达的（结束时间被推后）移出，
 * 之后到点会重新发。
 */
export function rearmNotified(endAtMs: number, nowMs: number, notified: readonly string[]): SeasonNoticeStage[] {
  const crossed = crossedStages(endAtMs, nowMs);
  return notified.filter((stage): stage is SeasonNoticeStage => crossed.includes(stage as SeasonNoticeStage));
}
