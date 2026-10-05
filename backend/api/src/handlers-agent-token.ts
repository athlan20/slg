// 永久 Agent 令牌（v46，AISLG-129）：每账号一个、建号自动生成、永不过期、原文可反复显示。
// 玩家把「复制给 AI」提示词发给自己的 Agent，提示词第四行就是这个令牌，Agent 用
// LOGIN {token, asAgent: true} 登录。泄露时 RESET_AGENT_TOKEN 换新，旧令牌立刻失效、
// 用它在线的 Agent 连接被断开。
// 仅玩家本人的网页连接可查看 / 重置（Agent 连接返回 AGENT_FORBIDDEN）；令牌不进
// GET_AGENT_INFO（那条协议 Agent 也能调）。v43 的多令牌（签发 / 吊销 / 上限 3 个 / 30 天）
// 已随本需求移除。

import type { ConnInfo } from './connections';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { ensureAgentToken, replaceAgentToken, type AgentTokenRow } from './agent-token';

/** 响应载荷：令牌原文 + 元信息（前端展示「重置于 / 最近使用」） */
function tokenPayload(row: AgentTokenRow): Record<string, unknown> {
  return {
    token: row.token,
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt ? row.lastUsedAt.toISOString() : null,
  };
}

/** GET_AGENT_TOKEN：返回令牌原文；老账号没有时惰性补生成 */
export async function handleGetAgentToken(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  if (conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const row = await ensureAgentToken(ctx.pool, conn.accountId as string);
  respondOk(ctx.registry, conn, op, seq, tokenPayload(row));
}

/** RESET_AGENT_TOKEN：换一个新的随机令牌；旧令牌立即失效，用它在线的连接被断开（close 4003） */
export async function handleResetAgentToken(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  if (conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const accountId = conn.accountId as string;
  const { fresh, oldId } = await replaceAgentToken(ctx.pool, accountId);
  // 断开旧令牌登录的连接（发起重置的是玩家网页连接，sessionId 对不上，不会被误断）
  if (oldId) {
    for (const other of ctx.registry.connectionsOf(accountId)) {
      if (other.sessionId === oldId) {
        other.socket.close(4003, 'agent token reset');
      }
    }
  }
  respondOk(ctx.registry, conn, op, seq, tokenPayload(fresh));
}
