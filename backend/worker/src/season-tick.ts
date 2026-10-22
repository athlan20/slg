// 换季的 Worker 步骤（AISLG-134，docs/season-system.md §2.5 / §4）：每个 tick 调用一次。
// - 当前赛季到点（end_at ≤ now）→ 执行换季；失败后 30 秒再试，连续 5 次失败停止自动重试并打大号错误日志；
// - 未到点 → 发送已到达的预告阶段（每阶段只发一次，见 season-notice.ts）；
// - 维护态残留（上次换季中途进程退出、且本季并未到点）→ 清掉，避免游戏永久停服。
import type pg from 'pg';
import { getCurrentSeason, getMaintenance, notifySeasonEvent, setMaintenance } from '../../common/src/season-db';
import { isSeasonResetting } from './season-busy';
import { runSeasonReset, type SeasonResetOptions } from './season-reset';
import { sendDueNotice } from './season-notice';

/** 换季失败后的重试间隔（毫秒） */
export const SEASON_RESET_RETRY_MS = 30_000;
/** 连续失败达到此次数后停止自动重试（需人工处理后重启 Worker） */
export const SEASON_RESET_MAX_FAILURES = 5;

let consecutiveFailures = 0;
let nextAttemptAt = 0;
let halted = false;
/** 测试注入（生产为空）：换季的故障注入钩子 */
let resetOptions: SeasonResetOptions = {};

/** 本 tick 的结果：reset 表示本 tick 完成了换季（调用方应结束本 tick，其余步骤下个 tick 再做） */
export type SeasonTickOutcome = 'idle' | 'reset';

/** 测试用：清空进程内的失败计数与停止标记，并设定换季的故障注入钩子（undefined 为恢复默认） */
export function resetSeasonTickStateForTest(options: SeasonResetOptions = {}): void {
  consecutiveFailures = 0;
  nextAttemptAt = 0;
  halted = false;
  resetOptions = options;
}

/** 当前是否因连续失败而停止自动重试 */
export function seasonResetHalted(): boolean {
  return halted;
}

export async function processSeasonTick(pool: pg.Pool, nowMs: number = Date.now()): Promise<SeasonTickOutcome> {
  if (isSeasonResetting()) {
    return 'idle';
  }
  const season = await getCurrentSeason(pool);
  if (!season) {
    return 'idle';
  }
  if (season.endAt.getTime() <= nowMs) {
    if (halted || nowMs < nextAttemptAt) {
      return 'idle';
    }
    try {
      const outcome = await runSeasonReset(pool, resetOptions);
      consecutiveFailures = 0;
      nextAttemptAt = 0;
      if (outcome.status === 'reset') {
        console.log(`season reset done: season ${outcome.oldSeasonId} ended, season ${outcome.newSeason.id} started (seed ${outcome.newSeason.seed})`);
        return 'reset';
      }
      console.log(`season reset skipped: ${outcome.reason}`);
      return 'idle';
    } catch (err) {
      consecutiveFailures += 1;
      console.error(`season reset failed (${consecutiveFailures}/${SEASON_RESET_MAX_FAILURES}):`, err instanceof Error ? err.stack ?? err.message : err);
      if (consecutiveFailures >= SEASON_RESET_MAX_FAILURES) {
        halted = true;
        console.error(
          '!!!!!!!! SEASON RESET HALTED: 连续失败已达上限，停止自动重试。旧世界保持原样，需人工排查后重启 Worker !!!!!!!!',
        );
      } else {
        nextAttemptAt = Date.now() + SEASON_RESET_RETRY_MS;
      }
      return 'idle';
    }
  }
  await clearStaleMaintenance(pool);
  await sendDueNotice(pool, season, nowMs);
  return 'idle';
}

/** 维护态只可能由换季置位；本季并未到点却残留维护态，说明上次换季中途退出，清掉恢复服务 */
async function clearStaleMaintenance(pool: pg.Pool): Promise<void> {
  const state = await getMaintenance(pool);
  if (state === null || state.reason !== 'season_reset') {
    return;
  }
  console.warn('season: stale maintenance state found while season is not due, clearing');
  await setMaintenance(pool, null);
  await notifySeasonEvent(pool, { reason: 'maintenance_off' });
}
