// 城池部队池（伤兵 / 俘虏 / 逃兵，AISLG-212）的过期清理：伤兵与俘虏 72 小时、
// 逃兵 24 小时（入账时已按当时时间缩放折算成 wall-clock 写死）。读取侧
// （loadCityTroopPools / consumePoolTroops）也过滤过期行，这里周期删行兜底，
// 防止无人访问的城（弃号）池子行无限堆积。

import pg from 'pg';
import { cleanupExpiredTroopPools } from '../../common/src/troop-pools-db';

/** 清理最小间隔（毫秒，真实时间） */
export const TROOP_POOL_TICK_MS = 60_000;

let lastRunMs = 0;

/** 单 tick 入口：节流到 TROOP_POOL_TICK_MS；返回本次删除的行数 */
export async function processTroopPools(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < TROOP_POOL_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  return cleanupExpiredTroopPools(pool);
}
