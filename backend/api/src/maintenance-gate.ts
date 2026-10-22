// 换季维护态的拦截（AISLG-134，docs/season-system.md §2.5）：维护中除 GET_SEASON 与登录相关协议外，
// 游戏类请求一律返回 MAINTENANCE。维护态以 settings.maintenance 为准，进程内缓存约 2 秒；
// Worker 置位 / 清除时经 pg_notify（maintenance_on / maintenance_off / season_started）通知本进程立即失效缓存。
// 读库失败时放行（fail-open）并记日志：换季流程自身在事务里清维护态，不能因为 API 读库抖动把整站锁死。

import type pg from 'pg';
import { getMaintenance } from '../../common/src/season-db';

/** 维护态缓存有效期（毫秒） */
export const MAINTENANCE_CACHE_MS = 2000;
/** 维护期间 MAINTENANCE 响应建议的重试等待（秒） */
export const MAINTENANCE_RETRY_AFTER_SEC = 30;

let cachedActive = false;
let cachedAt = 0;

/** 使缓存失效（收到维护态相关通知时调用；下次检查时重新读库） */
export function invalidateMaintenanceCache(): void {
  cachedAt = 0;
}

/** 当前是否处于维护态（带缓存） */
export async function maintenanceActive(pool: pg.Pool): Promise<boolean> {
  if (Date.now() - cachedAt < MAINTENANCE_CACHE_MS) {
    return cachedActive;
  }
  try {
    cachedActive = (await getMaintenance(pool)) !== null;
    cachedAt = Date.now();
  } catch (err) {
    console.error('maintenance check failed, allowing request:', err instanceof Error ? err.message : err);
    cachedAt = Date.now();
    cachedActive = false;
  }
  return cachedActive;
}

/** 测试用：直接设定缓存结果（不读库） */
export function setMaintenanceCacheForTest(active: boolean): void {
  cachedActive = active;
  cachedAt = Date.now();
}
