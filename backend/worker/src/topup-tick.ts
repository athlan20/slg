// 充值订单的定时作废（AISLG-251，v108）：把超过 24 小时仍未支付的 pending 订单置 expired。
// 每分钟最多跑一次（订单作废不需要秒级精度，也给 Worker 的 tick 减负）；幂等，
// 重复执行只影响仍为 pending 且已超时的行。

import type pg from 'pg';
import { expireStaleTopupOrders } from '../../common/src/topup-db';

/** 最小执行间隔（毫秒）：Worker tick 是 1 秒，这里自己节流到 1 分钟 */
export const TOPUP_EXPIRE_INTERVAL_MS = 60 * 1000;

let lastRun = 0;

/** 作废超时未支付的订单，返回处理条数（未到间隔直接返回 0） */
export async function processTopupOrders(pool: pg.Pool, now: number = Date.now()): Promise<number> {
  if (now - lastRun < TOPUP_EXPIRE_INTERVAL_MS) {
    return 0;
  }
  lastRun = now;
  const expired = await expireStaleTopupOrders(pool, new Date(now));
  if (expired > 0) {
    console.log(`expired ${expired} topup order(s)`);
  }
  return expired;
}

/** 测试用：重置节流计时，让下一次调用立即执行 */
export function resetTopupTickThrottle(): void {
  lastRun = 0;
}
