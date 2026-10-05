// 微信接口封装（docs/wechat-qr-login.md「微信接口封装」）：只用到三个接口——
// stable_token（取 access_token，内存缓存、提前 5 分钟刷新）、getwxacodeunlimit（生成带 scene 的小游戏码）、
// jscode2session（用小游戏 wx.login 的 code 换 openid）。
// 业务层只依赖 WechatClient 接口，测试注入假实现；微信返回 errcode 一律只记日志（不含密钥），
// 对客户端统一翻译成 WX_CODE_INVALID / WX_UNAVAILABLE。

export interface WechatConfig {
  appId: string;
  appSecret: string;
  /** 码打开的小游戏版本：release（默认）/ trial / develop */
  envVersion: 'release' | 'trial' | 'develop';
  /** 微信接口根地址；仅联调测试时用 WX_API_BASE 指向假的微信服务，线上不配 */
  apiBase: string;
}

export interface WechatSession {
  openid: string;
  /** 小游戏没绑开放平台时为 null */
  unionid: string | null;
}

export interface WechatClient {
  readonly appId: string;
  /** 生成小游戏码；scene 即 ticket。返回可直接放进 <img src> 的 data URI */
  createQrCode(scene: string): Promise<string>;
  /** 用 wx.login 的 code 换 openid；session_key 用不到，不返回也不保存 */
  codeToSession(code: string): Promise<WechatSession>;
}

/** code 失效（过期或已被使用）与其余失败要给客户端不同的错误码 */
export class WechatError extends Error {
  constructor(
    readonly kind: 'code_invalid' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

/** access_token 提前这么久刷新（毫秒） */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
/** jscode2session 里表示「code 无效 / 已被使用」的 errcode */
const CODE_INVALID_ERRCODES = new Set([40029, 40163]);
/** access_token 失效的 errcode：清缓存后重试一次 */
const TOKEN_INVALID_ERRCODES = new Set([40001, 40014, 42001]);

/** 读取环境变量；没配 WX_APPID / WX_APPSECRET 时返回 null（扫码登录整体关闭） */
export function readWechatConfig(env: NodeJS.ProcessEnv = process.env): WechatConfig | null {
  const appId = env.WX_APPID?.trim();
  const appSecret = env.WX_APPSECRET?.trim();
  if (!appId || !appSecret) {
    return null;
  }
  const raw = env.WX_CODE_ENV?.trim();
  const envVersion = raw === 'trial' || raw === 'develop' ? raw : 'release';
  const apiBase = (env.WX_API_BASE?.trim() || 'https://api.weixin.qq.com').replace(/\/+$/, '');
  return { appId, appSecret, envVersion, apiBase };
}

type FetchFn = typeof fetch;

export function createWechatClient(config: WechatConfig, fetchFn: FetchFn = fetch): WechatClient {
  let cached: { token: string; refreshAt: number } | null = null;

  async function call(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetchFn(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      console.error('wechat request failed:', err instanceof Error ? err.message : err);
      throw new WechatError('unavailable', 'request failed');
    }
  }

  async function accessToken(): Promise<string> {
    if (cached && Date.now() < cached.refreshAt) {
      return cached.token;
    }
    const res = await call(`${config.apiBase}/cgi-bin/stable_token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid: config.appId, secret: config.appSecret }),
    });
    const body = (await res.json().catch(() => null)) as
      | { access_token?: string; expires_in?: number; errcode?: number; errmsg?: string }
      | null;
    if (!body?.access_token) {
      console.error('wechat stable_token failed: errcode=%s errmsg=%s', body?.errcode, body?.errmsg);
      throw new WechatError('unavailable', 'stable_token failed');
    }
    const ttlMs = Math.max(0, (body.expires_in ?? 7200) * 1000 - TOKEN_REFRESH_MARGIN_MS);
    cached = { token: body.access_token, refreshAt: Date.now() + ttlMs };
    return body.access_token;
  }

  async function requestQrCode(scene: string): Promise<string | { errcode: number; errmsg?: string }> {
    const token = await accessToken();
    const res = await call(`${config.apiBase}/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ scene, check_path: false, width: 280, env_version: config.envVersion }),
    });
    const contentType = res.headers.get('content-type') ?? '';
    // 成功时直接返回图片二进制；失败时是 JSON { errcode, errmsg }
    if (contentType.startsWith('image/')) {
      const bytes = Buffer.from(await res.arrayBuffer());
      return `data:${contentType.split(';')[0]};base64,${bytes.toString('base64')}`;
    }
    const body = (await res.json().catch(() => null)) as { errcode?: number; errmsg?: string } | null;
    return { errcode: body?.errcode ?? -1, errmsg: body?.errmsg };
  }

  return {
    appId: config.appId,
    async createQrCode(scene) {
      let result = await requestQrCode(scene);
      if (typeof result !== 'string' && TOKEN_INVALID_ERRCODES.has(result.errcode)) {
        cached = null;
        result = await requestQrCode(scene);
      }
      if (typeof result !== 'string') {
        console.error('wechat getwxacodeunlimit failed: errcode=%s errmsg=%s', result.errcode, result.errmsg);
        throw new WechatError('unavailable', 'getwxacodeunlimit failed');
      }
      return result;
    },
    async codeToSession(code) {
      const query = new URLSearchParams({
        appid: config.appId,
        secret: config.appSecret,
        js_code: code,
        grant_type: 'authorization_code',
      });
      const res = await call(`${config.apiBase}/sns/jscode2session?${query.toString()}`);
      const body = (await res.json().catch(() => null)) as
        | { openid?: string; unionid?: string; errcode?: number; errmsg?: string }
        | null;
      if (body?.openid) {
        return { openid: body.openid, unionid: body.unionid ?? null };
      }
      console.error('wechat jscode2session failed: errcode=%s errmsg=%s', body?.errcode, body?.errmsg);
      throw new WechatError(
        body?.errcode !== undefined && CODE_INVALID_ERRCODES.has(body.errcode) ? 'code_invalid' : 'unavailable',
        'jscode2session failed',
      );
    },
  };
}
