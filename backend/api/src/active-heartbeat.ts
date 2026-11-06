// 玩家 / Agent 活跃时刻的刷新（v66 AISLG-181；AISLG-236 起 Agent 同等算活跃）：accounts.last_active_at 是联盟
// 「盟主长期不活跃自动转让」的依据，人玩或 Agent 玩都算活跃。刷新点：登录（handlers-auth.ts，两种身份都刷）、
// 玩家全部断线（handlers-offline.ts）、Agent 断线（handlers.ts 的 handleConnectionClosed），以及这里的在线心跳——
// 此刻有连接在线的账号每小时刷一次（盟主只靠 Agent 挂着不断线也算活跃）。
// 注意：离线日报的起点 last_online_at 不在这里刷，它仍然只由玩家连接全部断开时写。

import { touchActive } from '../../common/src/alliance-db';
import type { HandlerContext } from './handlers';

/** 在线心跳周期（毫秒）；远小于「盟主 7 天不活跃」阈值，粒度够用 */
export const ACTIVE_HEARTBEAT_MS = 3600 * 1000;

/** 此刻有连接在线的账号 id（登录后的连接只有玩家与 Agent 两种身份，两者同等算活跃） */
export function onlineActiveAccountIds(ctx: Pick<HandlerContext, 'registry'>): string[] {
  return ctx.registry.onlineAccountIds();
}

/** 启动在线心跳；返回定时器供关闭时清理。刷新失败只记日志，下个周期再来 */
export function startActiveHeartbeat(ctx: Pick<HandlerContext, 'pool' | 'registry'>, intervalMs = ACTIVE_HEARTBEAT_MS): NodeJS.Timeout {
  const timer = setInterval(() => {
    touchActive(ctx.pool, onlineActiveAccountIds(ctx)).catch((err: Error) => {
      console.warn(`slg-api active heartbeat failed: ${err.message}`);
    });
  }, intervalMs);
  timer.unref();
  return timer;
}
