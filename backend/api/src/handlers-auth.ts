// 登录 / 登出协议的处理逻辑（从 handlers.ts 拆出以控制单文件行数）：
// - 密码登录（v48 起仅已有账号，新用户名返回 SIGNUP_CLOSED）与会话令牌登录（免密自动登录，令牌滑动续期）；
// - 登录成功即绑定连接、写 Agent 上下线事件并推送，随后关闭流程；
// - 登出吊销本连接所用的会话令牌并关闭连接。

import { EventType, Op, type InitiatorRole } from '../../common/src/protocol';
import { sanitizeAgentModelInput } from '../../common/src/agent-models';
import { findAgentTokenByToken, touchAgentToken } from './agent-token';
import { issueSessionToken, loginWithPassword, resolveSessionToken, revokeSession } from './auth';
import type { ConnInfo, ConnectionRegistry } from './connections';
import { isPasswordLoginDisabled } from './site-config';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { insertEvent } from '../../common/src/events';
import { docNoticeFor } from '../../common/src/protocol-changelog';
import { PROTOCOL_VERSION } from '../../common/src/protocol-version';

export async function handleLogin(
  ctx: HandlerContext,
  conn: ConnInfo,
  data: Record<string, unknown> | undefined,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const docVersion = readDocVersion(data);
  // v50（AISLG-133）：Agent 可自报驱动模型；玩家登录忽略该字段（密码分支 asAgent 恒为 false）
  const agentModel = data?.asAgent === true ? sanitizeAgentModelInput(data?.agentModel) : null;
  // 令牌登录：与密码互斥（同时提供按参数错误处理），账号由会话解析
  const token = readString(data, 'token');
  if (token !== null) {
    if (
      token.length < 1 ||
      readString(data, 'password') !== null ||
      typeof data?.asAgent !== 'boolean'
    ) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    const session = await resolveSessionToken(ctx.pool, token);
    if (!session) {
      // v46（AISLG-129）：不是会话令牌，再按账号的永久 Agent 令牌查（sk_ 开头；先查 sessions
      // 保持 30 天滑动令牌的原语义，查不到才落到 agent_tokens）
      const agentToken = await findAgentTokenByToken(ctx.pool, token);
      if (!agentToken) {
        respondError(ctx.registry, conn, op, seq, 'SESSION_INVALID');
        return;
      }
      void touchAgentToken(ctx.pool, agentToken.id);
      // 永久令牌不续期也不过期：expiresAt 为 null；sessionId 是 agent_tokens 行 id——
      // LOGOUT 对它 DELETE sessions 是 0 行（只断连接不吊销），RESET_AGENT_TOKEN 按它断开旧连接
      await completeLogin(ctx, conn, op, seq, {
        account: { id: agentToken.accountId, username: agentToken.username },
        sessionId: agentToken.id,
        sessionToken: token,
        expiresAt: null,
        role: data.asAgent ? 'agent' : 'player',
        docVersion,
        agentModel,
      });
      return;
    }
    await completeLogin(ctx, conn, op, seq, {
      account: session.account,
      sessionId: session.sessionId,
      sessionToken: token,
      expiresAt: session.expiresAt,
      role: data.asAgent ? 'agent' : 'player',
      docVersion,
      agentModel,
    });
    return;
  }

  const username = readString(data, 'username');
  const password = readString(data, 'password');
  if (
    username === null || username.length < 1 || username.length > 32 ||
    password === null || password.length < 6 || password.length > 64 ||
    typeof data?.asAgent !== 'boolean'
  ) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  // v47（AISLG-130）密码登录两道拦截，都在校验参数之后、碰数据库之前：
  // ① Agent 一律不能用账号密码登录（哪个站都一样），提示改用永久令牌；
  // ② 站点关了密码登录（国际站）就不收，绕过界面直发也照样被拒。
  if (data.asAgent) {
    respondError(ctx.registry, conn, op, seq, 'AGENT_PASSWORD_FORBIDDEN');
    return;
  }
  if (isPasswordLoginDisabled(conn.host, ctx.passwordDisabledHosts)) {
    respondError(ctx.registry, conn, op, seq, 'PASSWORD_LOGIN_CLOSED');
    return;
  }
  const result = await loginWithPassword(ctx.pool, {
    username,
    password,
    signupIp: conn.ip,
  });
  if (!result.ok || !result.account) {
    respondError(ctx.registry, conn, op, seq, result.code ?? 'INVALID_CREDENTIALS');
    return;
  }
  const session = await issueSessionToken(ctx.pool, result.account.id);
  await completeLogin(ctx, conn, op, seq, {
    account: result.account,
    sessionId: session.sessionId,
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    role: 'player',
    docVersion,
    agentModel: null,
  });
}

/** v32：可选 docVersion（Agent 手上文档的协议版本）；非正整数视为未提供，不因此拒绝登录 */
function readDocVersion(data: Record<string, unknown> | undefined): number | null {
  const value = data?.docVersion;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

export interface LoginSuccess {
  account: { id: string; username: string };
  sessionId: string;
  sessionToken: string;
  /** 永久 Agent 令牌登录为 null（不续期不过期；v46） */
  expiresAt: Date | null;
  role: InitiatorRole;
  docVersion: number | null;
  /** v50（AISLG-133）：Agent 本次自报的模型名（清洗后）；null = 未声明（保留上次声明） */
  agentModel: string | null;
}

/** 两种登录方式的共同收尾：绑定连接、Agent 上线事件与推送、带令牌的成功响应 */
async function completeLogin(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  success: LoginSuccess,
): Promise<void> {
  const wasAgentOnline = success.role === 'agent' && ctx.registry.agentConnections(success.account.id).length > 0;
  ctx.registry.bind(conn, success.account.id);
  conn.username = success.account.username;
  conn.role = success.role;
  conn.sessionId = success.sessionId;
  if (success.role === 'agent') {
    await recordAgentPresence(ctx, success.account.id, EventType.AGENT_CONNECTED);
    recordAgentModelLogin(ctx.pool, success.account.id, success.agentModel);
    const isAgentOnline = ctx.registry.agentConnections(success.account.id).length > 0;
    if (isAgentOnline !== wasAgentOnline) {
      pushAgentStatus(ctx, success.account.id, isAgentOnline);
    }
  }
  respondOk(ctx.registry, conn, op, seq, {
    accountId: success.account.id,
    username: success.account.username,
    role: success.role,
    sessionToken: success.sessionToken,
    expiresAt: success.expiresAt ? success.expiresAt.toISOString() : null,
    protocolVersion: PROTOCOL_VERSION,
    docNotice: success.role === 'agent' ? docNoticeFor(success.docVersion) : null,
  });
}

export async function handleLogout(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  // 吊销会话后关闭连接；同令牌的其他连接在下次登录时收到 SESSION_INVALID
  if (conn.sessionId) {
    await revokeSession(ctx.pool, conn.sessionId);
  }
  respondOk(ctx.registry, conn, op, seq, {});
  conn.socket.close(1000, 'logout');
}


/** Agent 连接上线 / 离线时写事件并推给账号在线连接 */
export async function recordAgentPresence(ctx: HandlerContext, accountId: string, type: EventType): Promise<void> {
  await insertEvent(ctx.pool, { accountId, type, initiator: 'agent' });
}

/**
 * v50（AISLG-133）：Agent 登录成功后落库自报模型与上线时刻。agent_model 以最近一次
 * 声明为准（本次没带就只刷 agent_last_seen_at，不覆盖已有声明）。与 touchAgentToken
 * 同口径：非关键路径，失败只忽略不阻塞登录。
 */
function recordAgentModelLogin(pool: HandlerContext['pool'], accountId: string, agentModel: string | null): void {
  const query =
    agentModel !== null
      ? `UPDATE accounts SET agent_last_seen_at = now(), agent_model = $2 WHERE id = $1`
      : `UPDATE accounts SET agent_last_seen_at = now() WHERE id = $1`;
  void pool.query(query, agentModel !== null ? [accountId, agentModel] : [accountId]).catch(() => undefined);
}

/**
 * Agent 在线状态推送（v21 AISLG-37 改为翻转才推）：仅 online 状态翻转（0↔1 个
 * Agent 连接）时推送一次，多开场景不再重复；帧内带 connectionCount = 该账号当前
 * 在线连接数（含玩家与 Agent 连接），随推送下发此刻快照（非翻转的连接数变化不推送，
 * 精确值以重新登录 / GET_AGENT_INFO 为准）。
 */
export function pushAgentStatus(ctx: HandlerContext, accountId: string, online: boolean): void {
  ctx.registry.broadcast(accountId, {
    op: Op.PUSH_AGENT_STATUS,
    push: true,
    data: { online, connectionCount: ctx.registry.connectionsOf(accountId).length, at: new Date().toISOString() },
  });
}

