// 赛季通知的 API 侧处理（AISLG-134，docs/season-system.md §2.5 / §4）：Worker 经 pg_notify 发来的
// season_* / maintenance_* 通知，在这里转成 PUSH_SEASON 推给在线连接，并刷新维护态与倍速缓存。
// season_started 之后断开全部已登录连接（关闭码 1012）：客户端收到 PUSH_SEASON 后自行重连、重新登录，
// 账号此时已在新赛季里（惰性加入在登录路径上完成）。
import type pg from 'pg';
import { Op } from '../../common/src/protocol';
import type { SeasonPushData } from '../../common/src/protocol-season';
import { refreshTimeScale } from '../../common/src/time-scale';
import type { ConnectionRegistry } from './connections';
import { invalidateMaintenanceCache } from './maintenance-gate';

/** 赛季通知 reason → PUSH_SEASON 的 phase */
const SEASON_PHASE_BY_REASON: Readonly<Record<string, SeasonPushData['phase']>> = {
  season_warning: 'warning',
  season_resetting: 'resetting',
  season_started: 'started',
};

/** season_started 后断开连接的关闭码（1012 Service Restart） */
const SEASON_RESTART_CLOSE_CODE = 1012;

/**
 * 处理一条 pg_notify 载荷（reason 为赛季 / 维护态相关时返回 true，已处理；否则返回 false，交由其他分支）。
 * 维护态通知只让维护态缓存失效；season_* 推送 PUSH_SEASON 给全部在线连接（含 Agent）。
 */
export function handleSeasonNotice(
  payload: Record<string, unknown>,
  registry: ConnectionRegistry,
  pool: pg.Pool,
): boolean {
  const reason = typeof payload.reason === 'string' ? payload.reason : '';
  if (reason === 'maintenance_on' || reason === 'maintenance_off') {
    invalidateMaintenanceCache();
    return true;
  }
  const phase = SEASON_PHASE_BY_REASON[reason];
  if (phase === undefined) {
    return false;
  }
  const data = (payload.data ?? {}) as Record<string, unknown>;
  registry.broadcastAll({ op: Op.PUSH_SEASON, push: true, data: { ...data, phase } });
  if (reason === 'season_started') {
    // 新赛季：维护态与倍速缓存立即失效；旧连接全部断开（推送已排队在前，close 随后发出）
    invalidateMaintenanceCache();
    void refreshTimeScale(pool).catch(() => undefined);
    closeAllAccountConnections(registry, SEASON_RESTART_CLOSE_CODE, 'season_started');
  }
  return true;
}

/** 断开全部已登录连接（未登录连接不在注册表里，靠认证超时自行关闭） */
function closeAllAccountConnections(registry: ConnectionRegistry, code: number, reason: string): void {
  for (const accountId of registry.onlineAccountIds()) {
    for (const conn of registry.connectionsOf(accountId)) {
      try {
        conn.socket.close(code, reason);
      } catch {
        // 连接已断开时忽略
      }
    }
  }
}
