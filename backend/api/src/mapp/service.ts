// Linux.do 微应用整体服务与处理器（AISLG-261）。
// 包含握手鉴权调度、Origin 白名单校验、MAPP_LOGIN 换取会话令牌逻辑。

import type { ConnInfo } from '../connections';
import type { HandlerContext } from '../handlers';
import { respondError, respondOk } from '../frames';
import { issueSessionToken } from '../auth';
import { loginWithOauth, type OauthIdentityInput } from '../oauth-accounts';
import { readMappConfig } from './config';
import { JwksCache, type JwksOptions } from './jwks';
import { extractWebSocketToken, verifyMappToken } from './jwt';
import { MappAuthError, type MappConfig, type MappIdentity } from './types';

export class MappService {
  constructor(
    readonly config: MappConfig,
    readonly jwksCache: JwksCache,
  ) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  isOriginAllowed(origin: string | null | undefined): boolean {
    if (!origin || typeof origin !== 'string') return false;
    return this.config.origins.has(origin.trim().replace(/\/+$/, ''));
  }

  async verifyUpgrade(request: {
    url?: string;
    raw?: { url?: string };
    headers: Record<string, unknown>;
  }): Promise<MappIdentity> {
    const origin =
      typeof request.headers.origin === 'string'
        ? request.headers.origin
        : Array.isArray(request.headers.origin)
          ? request.headers.origin[0]
          : null;

    if (!this.isOriginAllowed(origin)) {
      throw new MappAuthError('Origin not in MAPP_ORIGINS');
    }

    const rawUrl = request.raw?.url ?? request.url ?? '';
    const { token, cleanHttpsUrl } = extractWebSocketToken(rawUrl, this.config.audience);
    return await verifyMappToken(token, this.config, this.jwksCache, {
      scope: 'network.websocket',
      cleanHttpsUrl,
    });
  }

  async handleMappLogin(
    ctx: HandlerContext,
    conn: ConnInfo,
    op: number,
    seq: number | undefined,
  ): Promise<void> {
    // 玩家专用：Agent 角色被拒
    if (conn.role === 'agent') {
      return respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    }

    // 已登录连接不能重复登录
    if (conn.accountId) {
      return respondError(ctx.registry, conn, op, seq, 'ALREADY_LOGGED_IN');
    }

    // 连接未携带平台令牌
    if (!conn.mappIdentity) {
      if (conn.mappTokenPresent) {
        return respondError(ctx.registry, conn, op, seq, 'MAPP_TOKEN_INVALID');
      }
      return respondError(ctx.registry, conn, op, seq, 'MAPP_UNAVAILABLE');
    }

    // 信任等级门槛校验（令牌缺 trust_level 视为 0）
    const userTrustLevel = conn.mappIdentity.trust_level ?? 0;
    if (userTrustLevel < this.config.minTrustLevel) {
      return respondError(ctx.registry, conn, op, seq, 'MAPP_TRUST_LEVEL_LOW');
    }

    // 建号或绑定已有账号：仅给 player 角色，同一 sub 始终对应同一账号
    const identity: OauthIdentityInput = {
      provider: this.config.identityProvider,
      subject: conn.mappIdentity.sub,
      displayName: null,
    };

    const account = await loginWithOauth(ctx.pool, identity, conn.ip);
    const session = await issueSessionToken(ctx.pool, account.id);

    respondOk(ctx.registry, conn, op, seq, {
      sessionToken: session.token,
      username: account.username,
      created: account.created,
    });
  }

  stop(): void {
    this.jwksCache.stop();
  }
}

export async function createMappService(
  env: NodeJS.ProcessEnv = process.env,
  jwksOptions?: Partial<JwksOptions>,
): Promise<MappService | null> {
  const config = readMappConfig(env);
  if (!config) {
    return null;
  }

  const jwksCache = new JwksCache({
    issuer: config.issuer,
    ...jwksOptions,
  });

  // 预热拉取一次 JWKS（失败时不中断服务启动，稍后握手或重试会再次拉取）
  await jwksCache.refresh().catch((err) => {
    console.warn('[mapp] Initial JWKS fetch failed, will retry later:', err);
  });

  return new MappService(config, jwksCache);
}
