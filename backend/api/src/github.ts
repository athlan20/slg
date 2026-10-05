// GitHub OAuth 接口封装（AISLG-128）：OAuth App（不是 GitHub App）只需两个接口——
// access_token（授权码换访问令牌）与 /user（取用户 id / login）。不申请任何 scope，
// 只要公开资料；拿到 id 与 login 后访问令牌即丢弃，不保存。
// 业务层只依赖 GithubClient 接口，测试注入假实现；GitHub 返回错误只记日志（不含 Secret），
// 对客户端统一翻译成 GITHUB_UNAVAILABLE。出站代理与 Google 同一套
//（NODE_USE_ENV_PROXY=1 + HTTPS_PROXY，见 backend/README.md）。

export interface GithubConfig {
  clientId: string;
  clientSecret: string;
  /** GitHub OAuth App 上登记的回调地址（authorize 与 access_token 都要带） */
  redirectUri: string;
  /** 授权完成 / 取消后 302 跳回的前端地址（不带尾斜杠，如 https://slg.example.cn） */
  frontendUrl: string;
  /** GitHub 接口根地址；仅联调测试时用 GITHUB_API_BASE 指向假的 GitHub 服务，线上不配 */
  apiBase: string;
}

export interface GithubUser {
  /** GitHub 用户的数字 id（永不变），绑定关系的键 */
  id: string;
  /** GitHub 用户名（可改名），仅展示 */
  login: string;
}

export interface GithubClient {
  readonly clientId: string;
  /** 生成 GitHub 授权地址（不带 scope：只读公开资料） */
  authorizeUrl(state: string): string;
  /** 用授权码换访问令牌并取用户信息；code 无效 / 已用过抛 kind='code_invalid'，其余失败 'unavailable' */
  exchangeCode(code: string): Promise<GithubUser>;
}

/** code 换令牌失败（无效 / 已用过）与其余失败要给客户端不同的错误码 */
export class GithubError extends Error {
  constructor(
    readonly kind: 'code_invalid' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 8000;

/** 读取环境变量；GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET / GITHUB_REDIRECT_URI / FRONTEND_URL 任缺一个即未启用 */
export function readGithubConfig(env: NodeJS.ProcessEnv = process.env): GithubConfig | null {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  const clientSecret = env.GITHUB_CLIENT_SECRET?.trim();
  const redirectUri = env.GITHUB_REDIRECT_URI?.trim();
  const frontendUrl = (env.FRONTEND_URL?.trim() || '').replace(/\/+$/, '');
  if (!clientId || !clientSecret || !redirectUri || !frontendUrl) {
    return null;
  }
  const apiBase = (env.GITHUB_API_BASE?.trim() || 'https://github.com').replace(/\/+$/, '');
  return { clientId, clientSecret, redirectUri, frontendUrl, apiBase };
}

type FetchFn = typeof fetch;

export function createGithubClient(config: GithubConfig, fetchFn: FetchFn = fetch): GithubClient {
  async function call(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      console.error('github request failed:', err instanceof Error ? err.message : err);
      throw new GithubError('unavailable', 'request failed');
    }
  }

  return {
    clientId: config.clientId,
    authorizeUrl(state: string) {
      const query = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        state,
      });
      return `${config.apiBase}/login/oauth/authorize?${query.toString()}`;
    },
    async exchangeCode(code) {
      // 授权码换访问令牌；GitHub 失败时返回 200 + error 字段（JSON 体）
      const tokenUrl = `${config.apiBase}/login/oauth/access_token`;
      const body = new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        redirect_uri: config.redirectUri,
      });
      const tokenRes = await call(tokenUrl, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      const tokenJson = (await tokenRes.json().catch(() => null)) as
        | { access_token?: string; error?: string; error_description?: string }
        | null;
      if (!tokenJson?.access_token) {
        console.error('github access_token failed:', tokenJson?.error, tokenJson?.error_description);
        // bad_verification_code = code 无效 / 已用过；其余（incorrect_client_secret 等）按不可用处理
        if (tokenJson?.error === 'bad_verification_code') {
          throw new GithubError('code_invalid', 'code invalid or used');
        }
        throw new GithubError('unavailable', 'access_token failed');
      }
      // 访问令牌只在本次请求里用，取完公开资料即丢弃（不落库、不打日志）
      const userUrl = new URL('/user', `${config.apiBase === 'https://github.com' ? 'https://api.github.com' : config.apiBase}/`);
      const userRes = await call(userUrl.toString(), {
        headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${tokenJson.access_token}` },
      });
      if (!userRes.ok) {
        throw new GithubError('unavailable', `user http ${userRes.status}`);
      }
      const user = (await userRes.json().catch(() => null)) as { id?: number; login?: string } | null;
      if (!user || typeof user.id !== 'number' || typeof user.login !== 'string') {
        throw new GithubError('unavailable', 'user malformed');
      }
      return { id: String(user.id), login: user.login };
    },
  };
}
