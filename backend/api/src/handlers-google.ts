// Google 一键登录 / 绑定的协议处理（GOOGLE_LOGIN / GOOGLE_BIND，AISLG-127）。
// 与微信扫码一样，Google 这一段只负责换到一个会话令牌：网页经 GSI 拿到 ID Token 后
// 发 GOOGLE_LOGIN，成功收到 { sessionToken } 再走原有 LOGIN { token }，completeLogin
// 及后续流程不动。sub 只存在服务端，不发给网页。
// Google 这一侧没有 ticket 状态机：凭证由前端一次送到、当场校验，服务端无中间态。

import { issueSessionToken } from './auth';
import { extendAuthDeadline, type ConnInfo } from './connections';
import { readString, respondError, respondOk } from './frames';
import { CREDENTIAL_MAX_LENGTH, GoogleError, verifyGoogleIdToken, type GoogleConfig, type GoogleIdentity } from './google';
import type { HandlerContext } from './handlers';
import { accountHasOauth, bindOauth, findAccountByOauth, loginWithOauth } from './oauth-accounts';
import { RateLimiter } from './wx-tickets';

/** 登录尝试限频：同一 IP 每分钟 20 次（与生成微信码同口径；绑定走已登录连接不限频） */
const LOGIN_LIMIT = 20;
const LOGIN_WINDOW_MS = 60_000;
/** GOOGLE_LOGIN 成功后给「网页发 LOGIN {token}」留的登录超时余量 */
const AUTH_GRACE_MS = 15_000;

/** API 进程内的 Google 登录服务：clientId 为 null 表示没配置 GOOGLE_CLIENT_ID，Google 登录整体关闭 */
export interface GoogleService {
  clientId: string | null;
  verify: (credential: string) => Promise<GoogleIdentity>;
  loginLimiter: RateLimiter;
  now: () => number;
}

export function createGoogleService(config: GoogleConfig | null): GoogleService {
  return {
    clientId: config?.clientId ?? null,
    async verify(credential) {
      if (!config) {
        throw new GoogleError('unavailable', 'google not configured');
      }
      return verifyGoogleIdToken(credential, { clientId: config.clientId });
    },
    loginLimiter: new RateLimiter(LOGIN_LIMIT, LOGIN_WINDOW_MS),
    now: () => Date.now(),
  };
}

/** 读取并校验 credential 参数；返回 null 表示已回错 */
function readCredential(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): string | null {
  const credential = readString(data, 'credential');
  if (credential === null || credential.length < 1 || credential.length > CREDENTIAL_MAX_LENGTH) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return null;
  }
  return credential;
}

/** 校验凭证并翻译错误码；凭证无效 / 连不上 Google 时已回错并返回 null */
async function verifyCredential(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  credential: string,
): Promise<GoogleIdentity | null> {
  try {
    return await ctx.google!.verify(credential);
  } catch (err) {
    if (err instanceof GoogleError) {
      respondError(ctx.registry, conn, op, seq, err.kind === 'credential_invalid' ? 'GOOGLE_CREDENTIAL_INVALID' : 'GOOGLE_UNAVAILABLE');
      return null;
    }
    throw err;
  }
}

export async function handleGoogleLogin(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  if (conn.accountId) {
    respondError(ctx.registry, conn, op, seq, 'ALREADY_LOGGED_IN');
    return;
  }
  const google = ctx.google;
  if (!google?.clientId) {
    respondError(ctx.registry, conn, op, seq, 'GOOGLE_UNAVAILABLE');
    return;
  }
  const credential = readCredential(ctx, conn, op, seq, data);
  if (credential === null) {
    return;
  }
  if (!google.loginLimiter.allow(conn.ip ?? 'unknown', google.now())) {
    respondError(ctx.registry, conn, op, seq, 'RATE_LIMITED');
    return;
  }
  const identity = await verifyCredential(ctx, conn, op, seq, credential);
  if (identity === null) {
    return;
  }
  const account = await loginWithOauth(ctx.pool, { provider: 'google', subject: identity.sub, displayName: identity.email }, conn.ip);
  const session = await issueSessionToken(ctx.pool, account.id);
  // 网页随即用 LOGIN {token} 登录这条连接：把登录超时顺延一下，覆盖时序抖动
  extendAuthDeadline(conn, google.now() + AUTH_GRACE_MS);
  respondOk(ctx.registry, conn, op, seq, {
    sessionToken: session.token,
    created: account.created,
  });
}

export async function handleGoogleBind(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  // GOOGLE_BIND 不在 PRE_AUTH_OPS：未登录连接已被 NOT_LOGGED_IN 挡掉；Agent 连接拒绝
  if (conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const google = ctx.google;
  if (!google?.clientId) {
    respondError(ctx.registry, conn, op, seq, 'GOOGLE_UNAVAILABLE');
    return;
  }
  const credential = readCredential(ctx, conn, op, seq, data);
  if (credential === null) {
    return;
  }
  const accountId = conn.accountId as string;
  // 当前账号已绑过 Google：没有意义，直接告知，省一次凭证校验
  if (await accountHasOauth(ctx.pool, 'google', accountId)) {
    respondError(ctx.registry, conn, op, seq, 'GOOGLE_ALREADY_BOUND');
    return;
  }
  const identity = await verifyCredential(ctx, conn, op, seq, credential);
  if (identity === null) {
    return;
  }
  const oauthIdentity = { provider: 'google' as const, subject: identity.sub, displayName: identity.email };
  // 这个 Google 账号已绑了别的号：给出明确原因（区别于当前号已绑）
  if ((await findAccountByOauth(ctx.pool, 'google', identity.sub)) !== null) {
    respondError(ctx.registry, conn, op, seq, 'GOOGLE_ALREADY_BOUND');
    return;
  }
  const result = await bindOauth(ctx.pool, accountId, oauthIdentity);
  if (result === 'already_bound') {
    respondError(ctx.registry, conn, op, seq, 'GOOGLE_ALREADY_BOUND');
    return;
  }
  respondOk(ctx.registry, conn, op, seq, { bound: true });
}
