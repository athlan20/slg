// Google 一键登录的接口封装（AISLG-127）：只用到一个出站请求——拉 Google 的公钥（JWKS）
// 校验前端送来的 ID Token（JWT / RS256）。校验规则：
// - 签名用 JWKS 里 kid 对应的公钥验（RS256，其他算法一律拒绝）；
// - iss 必须是 accounts.google.com 或 https://accounts.google.com；
// - aud 必须等于本服务配置的 Client ID（防止发给别的应用的 token 被拿来自用）；
// - exp 允许约 60 秒时钟误差；
// - 用户标识用 sub（永不变），email 仅展示存档（可变）。
// 公钥按响应 Cache-Control 缓存，避免每次登录都打 Google。出站代理走 Node 24 的
// NODE_USE_ENV_PROXY=1 + HTTPS_PROXY（部署细节见 backend/README.md），代码不用额外处理。
// 业务层只依赖下面导出的函数与 GoogleError；测试注入假 JWKS 与自定义时钟。

import { createPublicKey, verify as cryptoVerify } from 'node:crypto';

/** Google 公钥（JWKS）地址；联调测试可用 GOOGLE_CERTS_URL 指向本地假服务 */
export const GOOGLE_CERTS_URL =
  process.env.GOOGLE_CERTS_URL?.trim() || 'https://www.googleapis.com/oauth2/v3/certs';

export interface GoogleConfig {
  clientId: string;
}

/** 读取环境变量；没配 GOOGLE_CLIENT_ID 时返回 null（Google 登录整体关闭） */
export function readGoogleConfig(env: NodeJS.ProcessEnv = process.env): GoogleConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim();
  return clientId ? { clientId } : null;
}

/** 验证通过后拿到的 Google 身份 */
export interface GoogleIdentity {
  /** Google 账号的唯一标识（永不变），绑定关系的键 */
  sub: string;
  /** 邮箱（可变，仅展示存档）；token 里没有为 null */
  email: string | null;
}

/** 凭证无效（伪造 / 过期 / 不是发给本应用的）与「连不上 Google」要给客户端不同的错误码 */
export class GoogleError extends Error {
  constructor(
    readonly kind: 'credential_invalid' | 'unavailable',
    message: string,
  ) {
    super(message);
  }
}

interface Jwk {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

export interface Jwks {
  keys: Jwk[];
}

type FetchJwks = () => Promise<{ jwks: Jwks; cacheMs: number }>;

/** JWKS 请求超时，与微信接口的口径一致 */
const REQUEST_TIMEOUT_MS = 8000;
/** 响应没给 Cache-Control 时的兜底缓存时长（Google 实际会给约 6 小时） */
const DEFAULT_CACHE_MS = 60 * 60 * 1000;
/** exp / nbf 允许的时钟误差（毫秒） */
const CLOCK_SKEW_MS = 60_000;
/** credential（JWT）长度上限：正常 ID Token 一两千字符，超过按参数错误由调用方拒绝 */
export const CREDENTIAL_MAX_LENGTH = 8192;

/** 拉取并缓存 Google 公钥；缓存时长按 Cache-Control: max-age，取不到用兜底值 */
export function createJwksFetcher(url: string = GOOGLE_CERTS_URL, fetchFn: typeof fetch = fetch): FetchJwks {
  let cached: { keys: Map<string, Jwk>; expiresAt: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.expiresAt) {
      return { jwks: { keys: [...cached.keys.values()] }, cacheMs: cached.expiresAt - Date.now() };
    }
    let res: Response;
    try {
      res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      console.error('google certs request failed:', err instanceof Error ? err.message : err);
      throw new GoogleError('unavailable', 'certs request failed');
    }
    if (!res.ok) {
      throw new GoogleError('unavailable', `certs http ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as Jwks | null;
    if (!body || !Array.isArray(body.keys)) {
      throw new GoogleError('unavailable', 'certs malformed');
    }
    const maxAge = /max-age\s*=\s*(\d+)/i.exec(res.headers.get('cache-control') ?? '');
    const cacheMs = maxAge ? Math.max(0, Number(maxAge[1]) * 1000) : DEFAULT_CACHE_MS;
    const keys = new Map<string, Jwk>();
    for (const key of body.keys) {
      if (key.kid && key.kty === 'RSA') {
        keys.set(key.kid, key);
      }
    }
    cached = { keys, expiresAt: Date.now() + cacheMs };
    return { jwks: body, cacheMs };
  };
}

function base64UrlDecode(segment: string): Buffer {
  return Buffer.from(segment, 'base64url');
}

function decodeJson(segment: string, what: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(base64UrlDecode(segment).toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new GoogleError('credential_invalid', `malformed ${what}`);
  }
}

export interface VerifyOptions {
  clientId: string;
  /** 拉公钥（默认真实 Google，测试注入假 JWKS） */
  fetchJwks?: FetchJwks;
  /** 校验用的当前时刻（毫秒；测试注入） */
  now?: () => number;
}

/**
 * 校验 Google ID Token（JWT）并返回身份；无效抛 GoogleError('credential_invalid')，
 * 连不上公钥服务抛 GoogleError('unavailable')。用 node:crypto 自实现（RS256），不引第三方库。
 */
export async function verifyGoogleIdToken(credential: string, options: VerifyOptions): Promise<GoogleIdentity> {
  const parts = credential.split('.');
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    throw new GoogleError('credential_invalid', 'not a jwt');
  }
  const [rawHeader, rawClaims, rawSignature] = parts;
  const header = decodeJson(rawHeader, 'header');
  const claims = decodeJson(rawClaims, 'claims');
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new GoogleError('credential_invalid', 'unexpected alg or kid');
  }

  const fetchJwks = options.fetchJwks ?? createJwksFetcher();
  let jwks: Jwks;
  try {
    jwks = (await fetchJwks()).jwks;
  } catch (err) {
    if (err instanceof GoogleError) {
      throw err;
    }
    throw new GoogleError('unavailable', 'certs fetch failed');
  }
  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk || !jwk.n || !jwk.e) {
    throw new GoogleError('credential_invalid', 'unknown kid');
  }

  const signed = Buffer.from(`${rawHeader}.${rawClaims}`, 'utf8');
  const signature = base64UrlDecode(rawSignature);
  let key;
  try {
    key = createPublicKey({ key: jwk as { kty: string; n: string; e: string }, format: 'jwk' });
  } catch {
    throw new GoogleError('credential_invalid', 'bad public key');
  }
  const signatureOk = cryptoVerify('RSA-SHA256', signed, key, signature);
  if (!signatureOk) {
    throw new GoogleError('credential_invalid', 'bad signature');
  }

  const now = (options.now ?? Date.now)();
  const iss = claims.iss;
  if (iss !== 'accounts.google.com' && iss !== 'https://accounts.google.com') {
    throw new GoogleError('credential_invalid', 'unexpected iss');
  }
  if (claims.aud !== options.clientId) {
    throw new GoogleError('credential_invalid', 'unexpected aud');
  }
  if (typeof claims.exp !== 'number' || now > claims.exp * 1000 + CLOCK_SKEW_MS) {
    throw new GoogleError('credential_invalid', 'expired');
  }
  if (typeof claims.nbf === 'number' && now + CLOCK_SKEW_MS < claims.nbf * 1000) {
    throw new GoogleError('credential_invalid', 'not yet valid');
  }
  if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
    throw new GoogleError('credential_invalid', 'missing sub');
  }
  return { sub: claims.sub, email: typeof claims.email === 'string' ? claims.email : null };
}
