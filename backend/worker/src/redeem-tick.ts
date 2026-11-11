// 兑换尝试记录的定期清理（AISLG-253，v109）：redeem_attempts 只用来统计「每账号每小时失败次数」，
// 保留 7 天足够（进度窗口是 1 小时）。每小时最多跑一次（这个表不需要秒级清理，也给 Worker 的 tick 减负）；
// 幂等，重复执行只删更早的行。

import type pg from 'pg';
import { purgeRedeemAttempts } from '../../common/src/redeem-db';

/** 最小执行间隔（毫秒）：Worker tick 是 1 秒，这里自己节流到 1 小时 */
export const REDEEM_ATTEMPT_PURGE_INTERVAL_MS = 60 * 60 * 1000;

let lastRun = 0;

/** 清理超过保留期（7 天）的兑换尝试，返回删除条数（未到间隔直接返回 0） */
export async function processRedeemAttempts(pool: pg.Pool, now: number = Date.now()): Promise<number> {
  if (now - lastRun < REDEEM_ATTEMPT_PURGE_INTERVAL_MS) {
    return 0;
  }
  lastRun = now;
  const purged = await purgeRedeemAttempts(pool, new Date(now));
  if (purged > 0) {
    console.log(`purged ${purged} redeem attempt(s)`);
  }
  return purged;
}

/** 测试用：重置节流计时，让下一次调用立即执行 */
export function resetRedeemTickThrottle(): void {
  lastRun = 0;
}