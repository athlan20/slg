// 玩家活跃时刻的刷新（v66，AISLG-181）：accounts.last_active_at 是联盟「盟主长期不活跃自动转让」的依据。
// 刷新点：玩家登录（handlers-auth.ts）、玩家全部断线（handlers-offline.ts）、以及这里的在线心跳——
// 此刻有玩家连接在线的账号每小时刷一次（盟主一直挂着不断线也算活跃）。Agent 连接不算。

import { touchActive } from '../../common/src/alliance-db';
import type { HandlerContext } from './handlers';

/** 在线心跳周期（毫秒）；远小于「盟主 7 天不活跃」阈值，粒度够用 */
export const ACTIVE_HEARTBEAT_MS = 3600 * 1000;

/** 此刻有玩家连接在线的账号 id */
export function onlinePlayerAccountIds(ctx: Pick<HandlerContext, 'registry'>): string[] {
  return ctx.registry
    .onlineAccountIds()
    .filter((id) => ctx.registry.connectionsOf(id).some((c) => c.role === 'player'));
}

/** 启动在线心跳；返回定时器供关闭时清理。刷新失败只记日志，下个周期再来 */
export function startActiveHeartbeat(ctx: Pick<HandlerContext, 'pool' | 'registry'>, intervalMs = ACTIVE_HEARTBEAT_MS): NodeJS.Timeout {
  const timer = setInterval(() => {
    touchActive(ctx.pool, onlinePlayerAccountIds(ctx)).catch((err: Error) => {
      console.warn(`slg-api active heartbeat failed: ${err.message}`);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
