// GET_AGENT_INFO 与 AGENT_REPORT_PLAN（从 handlers.ts 拆出以控制单文件行数，v43）。
// v43：GET_AGENT_INFO 新增 agentTokens（v46 移除，Agent 令牌改由 GET_AGENT_TOKEN 专门协议下发——
// 本协议 Agent 连接也能调，不能带令牌）与 wechatBound；v44：googleBound；v45：githubBound / githubLogin。

import pg from 'pg';
import { Op, type AgentPlanView } from '../../common/src/protocol';
import { listEvents, toEventView } from '../../common/src/events';
import type { ConnInfo } from './connections';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { accountHasWechat } from './wx-accounts';
import { accountHasOauth, oauthDisplayName } from './oauth-accounts';

/** 账号是否已绑定微信；服务端没配微信时无从判断，按未绑定处理 */
async function isWechatBound(ctx: HandlerContext, accountId: string): Promise<boolean> {
  const appId = ctx.wx?.client?.appId;
  return appId ? accountHasWechat(ctx.pool, appId, accountId) : false;
}

/** 账号在某第三方 OAuth（Google / GitHub）是否已绑定；服务端没配该提供商时恒为未绑定。
 *  v47 起 GitHub 按站点分套：配了任意一套（default 或按 Host）即视为已启用 */
function githubEnabled(ctx: HandlerContext): boolean {
  return Boolean(ctx.github && (ctx.github.sites.defaultSite !== null || ctx.github.sites.byHost.size > 0));
}

async function isOauthBound(ctx: HandlerContext, provider: 'google' | 'github', accountId: string): Promise<boolean> {
  const enabled = provider === 'google' ? Boolean(ctx.google?.clientId) : githubEnabled(ctx);
  if (!enabled) {
    return false;
  }
  return accountHasOauth(ctx.pool, provider, accountId);
}

export async function handleGetAgentInfo(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const agentConns = ctx.registry.agentConnections(accountId);
  const [recentRows, plan, wechatBound, googleBound, githubLogin] = await Promise.all([
    listEvents(ctx.pool, accountId, { limit: 10, initiator: 'agent' }),
    loadAgentPlan(ctx.pool, accountId),
    isWechatBound(ctx, accountId),
    isOauthBound(ctx, 'google', accountId),
    githubEnabled(ctx) ? oauthDisplayName(ctx.pool, 'github', accountId) : Promise.resolve(null),
  ]);
  respondOk(ctx.registry, conn, op, seq, {
    agentOnline: agentConns.length > 0,
    connections: agentConns.map((c) => ({ role: 'agent', connectedAt: c.connectedAt.toISOString() })),
    plan,
    recentEvents: recentRows.map(toEventView),
    wechatBound,
    googleBound,
    githubBound: githubLogin !== null,
    githubLogin,
  });
}

/** 计划字段的长度上限（占位决策） */
const PLAN_NEXT_MAX = 200;
const PLAN_OVERALL_MAX = 500;

/** 读取可选的文本字段：缺省 = undefined（保持不变）；提供时 trim，超长或非字符串 = null（非法） */
function readOptionalPlanText(
  data: Record<string, unknown> | undefined,
  key: string,
  maxLength: number,
): string | undefined | null {
  if (!(key in (data ?? {}))) {
    return undefined;
  }
  const value = data?.[key];
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > maxLength ? null : trimmed;
}

/**
 * Agent 上报计划（v10，仅 Agent 连接；玩家连接返回 AGENT_FORBIDDEN）。两段文本都可只更新
 * 其一：缺省保持不变、空串清除；后写覆盖先写（多 Agent 连接时以最近上报为准）。
 * 计划是自报的展示信息：不写事件流（区别于游戏动作），仅推送给账号其他在线连接。
 */
export async function handleAgentReportPlan(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  if (conn.role !== 'agent') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const nextAction = readOptionalPlanText(data, 'nextAction', PLAN_NEXT_MAX);
  const overallPlan = readOptionalPlanText(data, 'overallPlan', PLAN_OVERALL_MAX);
  if (nextAction === null || overallPlan === null) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (nextAction === undefined && overallPlan === undefined) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const current = await loadAgentPlan(ctx.pool, accountId);
  const merged: AgentPlanView = {
    nextAction: nextAction !== undefined ? (nextAction.length > 0 ? nextAction : null) : current?.nextAction ?? null,
    overallPlan: overallPlan !== undefined ? (overallPlan.length > 0 ? overallPlan : null) : current?.overallPlan ?? null,
    updatedAt: new Date().toISOString(),
  };
  await ctx.pool.query(
    `INSERT INTO agent_plans (account_id, next_action, overall_plan, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (account_id)
     DO UPDATE SET next_action = $2, overall_plan = $3, updated_at = now()`,
    [accountId, merged.nextAction, merged.overallPlan],
  );
  respondOk(ctx.registry, conn, op, seq, { plan: merged });
  ctx.registry.broadcast(
    accountId,
    { op: Op.PUSH_AGENT_PLAN, push: true, data: { ...merged } },
    conn,
  );
}

/** 读取账号当前的 Agent 计划快照；从未上报返回 null */
export async function loadAgentPlan(pool: pg.Pool, accountId: string): Promise<AgentPlanView | null> {
  const res = await pool.query(
    `SELECT next_action, overall_plan, updated_at FROM agent_plans WHERE account_id = $1`,
    [accountId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { next_action: string | null; overall_plan: string | null; updated_at: Date };
  return {
    nextAction: row.next_action,
    overallPlan: row.overall_plan,
    updatedAt: row.updated_at.toISOString(),
  };
}
