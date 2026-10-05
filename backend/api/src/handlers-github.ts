// GitHub 授权发起与一次性登录码兑换的协议处理（GITHUB_AUTH_START / OAUTH_REDEEM，AISLG-128）。
// 授权码模式不走 WS 双向确认：GITHUB_AUTH_START 只发授权地址，网页整页跳去 GitHub，
// 结果经 HTTP 回调（github-callback.ts）302 带回前端，页面再用 OAUTH_REDEEM 把
// 一次性码换成会话令牌、走原有 LOGIN {token}。

import { issueSessionToken } from './auth';
import type { ConnInfo } from './connections';
import { readString, respondError, respondOk } from './frames';
import { createGithubClient } from './github';
import type { HandlerContext } from './handlers';
import { accountHasOauth } from './oauth-accounts';
import { OneTimeCodeStore, OauthStateStore } from './oauth-store';
import { githubSiteFor, type GithubSites, type GithubSiteConfig } from './site-config';
import { RateLimiter } from './wx-tickets';

/** 授权发起限频：同一 IP 每分钟 20 次（会打 GitHub 接口的是回调侧，这里挡无脑刷 state） */
const START_LIMIT = 20;
const START_WINDOW_MS = 60_000;

/** 某站点的一套 GitHub 服务（配置 + 按它构造的客户端） */
export interface GithubSiteEntry {
  config: GithubSiteConfig;
  client: ReturnType<typeof createGithubClient>;
}

/** API 进程内的 GitHub 登录服务（v47 起按站点分套）：某站没配凭证时该站功能关闭 */
export interface GithubService {
  sites: GithubSites;
  entries: Map<string, GithubSiteEntry>;
  states: OauthStateStore;
  codes: OneTimeCodeStore;
  limiter: RateLimiter;
  now: () => number;
}

/** 某站点的服务套（Host 匹配不到用 default 套）；没配为 null */
export function githubEntryFor(service: GithubService, host: string | null): GithubSiteEntry | null {
  const config = githubSiteFor(host, service.sites);
  if (!config) {
    return null;
  }
  const key = config.clientId;
  let entry = service.entries.get(key);
  if (!entry) {
    entry = { config, client: createGithubClient(config) };
    service.entries.set(key, entry);
  }
  return entry;
}

export function createGithubService(sites: GithubSites): GithubService {
  return {
    sites,
    entries: new Map(),
    states: new OauthStateStore(),
    codes: new OneTimeCodeStore(),
    limiter: new RateLimiter(START_LIMIT, START_WINDOW_MS),
    now: () => Date.now(),
  };
}

/** 定时清理（index.ts 每 5 秒调一次）：过期 state / 登录码与限频记录 */
export function sweepGithubOauth(github: GithubService | undefined): void {
  if (!github) {
    return;
  }
  const now = github.now();
  github.states.sweep(now);
  github.codes.sweep(now);
  github.limiter.prune(now);
}

export async function handleGithubAuthStart(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const github = ctx.github;
  if (!github) {
    respondError(ctx.registry, conn, op, seq, 'GITHUB_UNAVAILABLE');
    return;
  }
  const entry = githubEntryFor(github, conn.host);
  if (!entry) {
    respondError(ctx.registry, conn, op, seq, 'GITHUB_UNAVAILABLE');
    return;
  }
  const purpose = readString(data, 'purpose');
  if (purpose !== 'login' && purpose !== 'bind') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  // bind 要已登录的玩家连接；login 用途在已登录连接上没有意义
  if (purpose === 'bind') {
    if (!conn.accountId) {
      respondError(ctx.registry, conn, op, seq, 'NOT_LOGGED_IN');
      return;
    }
    if (conn.role !== 'player') {
      respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
      return;
    }
  } else if (conn.accountId) {
    respondError(ctx.registry, conn, op, seq, 'ALREADY_LOGGED_IN');
    return;
  }
  const now = github.now();
  if (!github.limiter.allow(conn.ip ?? 'unknown', now)) {
    respondError(ctx.registry, conn, op, seq, 'RATE_LIMITED');
    return;
  }
  // 已绑定的账号再发起 bind 没有意义，直接告知（省一次 GitHub 往返）
  if (purpose === 'bind' && (await accountHasOauth(ctx.pool, 'github', conn.accountId as string))) {
    respondError(ctx.registry, conn, op, seq, 'GITHUB_ALREADY_BOUND');
    return;
  }
  const state = github.states.create(purpose, purpose === 'bind' ? conn.accountId : null, now, conn.host);
  respondOk(ctx.registry, conn, op, seq, { authUrl: entry.client.authorizeUrl(state.state) });
}

/** OAUTH_REDEEM：一次性登录码换会话令牌；码无效 / 过期 / 已用过返回 OAUTH_CODE_INVALID */
export async function handleOauthRedeem(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const code = readString(data, 'code');
  if (code === null || code.length < 1 || code.length > 128) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const github = ctx.github;
  if (!github || github.sites.defaultSite === null) {
    respondError(ctx.registry, conn, op, seq, 'GITHUB_UNAVAILABLE');
    return;
  }
  if (conn.accountId) {
    respondError(ctx.registry, conn, op, seq, 'ALREADY_LOGGED_IN');
    return;
  }
  const payload = github.codes.take(code, github.now());
  if (!payload) {
    respondError(ctx.registry, conn, op, seq, 'OAUTH_CODE_INVALID');
    return;
  }
  const session = await issueSessionToken(ctx.pool, payload.accountId);
  respondOk(ctx.registry, conn, op, seq, {
    sessionToken: session.token,
    username: payload.username,
    created: payload.created,
  });
}
