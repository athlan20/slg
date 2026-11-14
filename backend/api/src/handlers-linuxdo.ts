import type { ConnInfo } from './connections';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { handleGithubAuthStart } from './handlers-github';
import { createLinuxdoClient } from './linuxdo';
import { linuxdoSiteFor, type LinuxdoSites } from './linuxdo-sites';
import { accountHasOauth } from './oauth-accounts';
import { OauthStateStore, OneTimeCodeStore } from './oauth-store';
import { RateLimiter } from './wx-tickets';

export interface LinuxdoService {
  sites: LinuxdoSites;
  minTrustLevel: number | null;
  entries: Map<string, { config: NonNullable<LinuxdoSites['defaultSite']>; client: ReturnType<typeof createLinuxdoClient> }>;
  states: OauthStateStore;
  /** 回调成功后签发的一次性登录码；与 GitHub 的码共用 OAUTH_REDEEM 兑换（handleOauthRedeem 两处都查） */
  codes: OneTimeCodeStore;
  limiter: RateLimiter;
  now: () => number;
}

export function createLinuxdoService(sites: LinuxdoSites, minTrustLevel: number | null): LinuxdoService {
  return { sites, minTrustLevel, entries: new Map(), states: new OauthStateStore(), codes: new OneTimeCodeStore(), limiter: new RateLimiter(20, 60_000), now: () => Date.now() };
}

export function linuxdoEntryFor(service: LinuxdoService, host: string | null) {
  const config = linuxdoSiteFor(host, service.sites);
  if (!config || service.minTrustLevel === null) return null;
  // 同 clientId 的不同站点仍可能使用不同回调或前端，不能只按 clientId 缓存。
  const key = JSON.stringify(config);
  let entry = service.entries.get(key);
  if (!entry) {
    entry = { config, client: createLinuxdoClient(config, service.minTrustLevel) };
    service.entries.set(key, entry);
  }
  return entry;
}

export async function handleOauthAuthStart(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined, data: Record<string, unknown> | undefined): Promise<void> {
  const provider = readString(data, 'provider');
  if (provider === 'github') return handleGithubAuthStart(ctx, conn, op, seq, data);
  if (provider !== 'linuxdo') return respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
  const service = ctx.linuxdo;
  const entry = service && linuxdoEntryFor(service, conn.host);
  if (!service || !entry) return respondError(ctx.registry, conn, op, seq, 'LINUXDO_UNAVAILABLE');
  const purpose = readString(data, 'purpose');
  if (purpose !== 'login' && purpose !== 'bind') return respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
  if (purpose === 'bind') {
    if (!conn.accountId) return respondError(ctx.registry, conn, op, seq, 'NOT_LOGGED_IN');
    if (conn.role !== 'player') return respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
  } else if (conn.accountId) return respondError(ctx.registry, conn, op, seq, 'ALREADY_LOGGED_IN');
  const now = service.now();
  if (!service.limiter.allow(conn.ip ?? 'unknown', now)) return respondError(ctx.registry, conn, op, seq, 'RATE_LIMITED');
  if (purpose === 'bind' && await accountHasOauth(ctx.pool, 'linuxdo', conn.accountId as string)) return respondError(ctx.registry, conn, op, seq, 'LINUXDO_ALREADY_BOUND');
  const state = service.states.create(purpose, purpose === 'bind' ? conn.accountId : null, now, conn.host);
  respondOk(ctx.registry, conn, op, seq, { authUrl: entry.client.authorizeUrl(state.state) });
}
