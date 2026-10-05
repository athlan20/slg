// 双站点配置（v47，AISLG-130）：国内站 slg.example.cn（密码 + 第三方登录）与国际站
// slg.yuntianyou.cc（只有 Google / GitHub）共用同一套服务与数据库。站点按连接访问的
// 域名（握手 Host 头）区分——连哪个域名就算哪个站，与浏览器 Origin 无关。
// 反向代理 / CDN 场景须把原始 Host 传给 API，或在开启 TRUST_PROXY 时传 X-Forwarded-Host。

import type { GithubConfig } from './github';

/** Host 归一化：小写、去掉端口（对比与作为 GITHUB_SITES 的键都用这个形态） */
export function normalizeHost(raw: string | undefined | null): string | null {
  if (!raw) {
    return null;
  }
  const host = raw.trim().toLowerCase();
  if (!host) {
    return null;
  }
  // [IPv6]:port 与 hostname:port 两种形态
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end > 0 ? host.slice(1, end) : host;
  }
  const colon = host.indexOf(':');
  return colon > 0 ? host.slice(0, colon) : host;
}

/**
 * 从请求头取站点 Host：TRUST_PROXY 开启时优先 X-Forwarded-Host（只在自家代理可信时用，
 * 与 request.ip 的信任条件一致），否则用 Host 头（直连部署不可伪造）。
 */
export function hostFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  trustProxy: boolean,
): string | null {
  const pick = (name: string): string | undefined => {
    const value = headers[name];
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  };
  const forwarded = trustProxy ? pick('x-forwarded-host') : undefined;
  return normalizeHost(forwarded ?? pick('host'));
}

/** 密码登录关闭的站点（PASSWORD_LOGIN_DISABLED_HOSTS，逗号分隔 Host）；空返回空集 */
export function readPasswordDisabledHosts(env: NodeJS.ProcessEnv = process.env): ReadonlySet<string> {
  const raw = env.PASSWORD_LOGIN_DISABLED_HOSTS ?? '';
  return new Set(
    raw
      .split(',')
      .map((item) => normalizeHost(item))
      .filter((item): item is string => item !== null),
  );
}

/** 该站点是否关闭了密码登录。比较前再归一化一次（连接侧经 hostFromHeaders 已归一化，
 *  这里兜底：任何调用方传入带端口 / 大小写不一的 Host 都不会漏判）。 */
export function isPasswordLoginDisabled(host: string | null, disabled: ReadonlySet<string>): boolean {
  const normalized = normalizeHost(host);
  return normalized !== null && disabled.has(normalized);
}

/** GITHUB_SITES 的单个站点套（GitHub OAuth App 一站一个：回调地址只能填一个） */
export interface GithubSiteConfig extends GithubConfig {
  /** 该套配置使用的 GitHub 接口根地址（默认 https://github.com；测试注入） */
  apiBase: string;
}

interface RawSiteConfig {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  frontendUrl?: string;
  apiBase?: string;
}

function parseSite(raw: RawSiteConfig | undefined): GithubSiteConfig | null {
  if (!raw) {
    return null;
  }
  const clientId = raw.clientId?.trim();
  const clientSecret = raw.clientSecret?.trim();
  const redirectUri = raw.redirectUri?.trim();
  const frontendUrl = (raw.frontendUrl?.trim() || '').replace(/\/+$/, '');
  if (!clientId || !clientSecret || !redirectUri || !frontendUrl) {
    return null;
  }
  return {
    clientId,
    clientSecret,
    redirectUri,
    frontendUrl,
    apiBase: (raw.apiBase?.trim() || 'https://github.com').replace(/\/+$/, ''),
  };
}

export interface GithubSites {
  /** 按 Host 指定的站点套；「default」键或旧的四变量作为兜底（任何 Host 都可用） */
  byHost: Map<string, GithubSiteConfig>;
  defaultSite: GithubSiteConfig | null;
}

/**
 * 读 GitHub 按站点配置：GITHUB_SITES 为 JSON（键 = Host，如
 * {"slg.example.cn":{...},"slg.yuntianyou.cc":{...}}）；旧的 GITHUB_CLIENT_ID 等四变量
 * 作为 default 套（匹配不到 Host 时使用），既有部署不用改配置。
 */
export function readGithubSites(env: NodeJS.ProcessEnv = process.env): GithubSites {
  const byHost = new Map<string, GithubSiteConfig>();
  const raw = env.GITHUB_SITES?.trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, RawSiteConfig>;
      for (const [key, value] of Object.entries(parsed)) {
        const host = key === 'default' ? 'default' : normalizeHost(key);
        const site = parseSite(value);
        if (host && site) {
          byHost.set(host, site);
        }
      }
    } catch (err) {
      console.error('GITHUB_SITES 解析失败（应为 JSON，键为 Host）:', err instanceof Error ? err.message : err);
    }
  }
  // 旧四变量 = default 套；GITHUB_SITES 里的 "default" 键优先
  const legacy = parseSite({
    clientId: env.GITHUB_CLIENT_ID,
    clientSecret: env.GITHUB_CLIENT_SECRET,
    redirectUri: env.GITHUB_REDIRECT_URI,
    frontendUrl: env.FRONTEND_URL,
    apiBase: env.GITHUB_API_BASE,
  });
  const defaultSite = byHost.get('default') ?? legacy;
  if (defaultSite) {
    byHost.set('default', defaultSite);
  }
  return { byHost, defaultSite };
}

/** 某站点的 GitHub 配置：先按 Host 精确匹配，匹配不到用 default 套 */
export function githubSiteFor(host: string | null, sites: GithubSites): GithubSiteConfig | null {
  if (host && sites.byHost.has(host)) {
    return sites.byHost.get(host) ?? null;
  }
  return sites.defaultSite;
}
