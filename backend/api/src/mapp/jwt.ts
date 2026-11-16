// Linux.do 微应用 ES256 JWT 验签与 WebSocket 握手校验（AISLG-261）。
// 自主基于 node:crypto 实现，严格校验 ES256、iss、aud、appId、channel、exp、时钟容差与端点 URL。

import { verify, type KeyObject } from 'node:crypto';
import type { JwksCache } from './jwks';
import { MappAuthError, type MappConfig, type MappIdentity } from './types';

function decodeBase64Url(raw: string): Buffer {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    throw new MappAuthError('Invalid base64url string');
  }
  const buf = Buffer.from(raw, 'base64url');
  if (buf.toString('base64url') !== raw) {
    throw new MappAuthError('Base64url roundtrip mismatch');
  }
  return buf;
}

function parseJsonBase64Url<T>(raw: string): T {
  const buf = decodeBase64Url(raw);
  const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  return JSON.parse(text) as T;
}

interface JwtHeader {
  alg?: string;
  typ?: string;
  kid?: string;
  jku?: unknown;
  jwk?: unknown;
  x5u?: unknown;
  crit?: unknown;
}

interface JwtPayload {
  iss?: string;
  aud?: string;
  sub?: string;
  trust_level?: number;
  app_id?: string;
  channel?: string;
  scopes?: string[];
  version?: string;
  iat?: number;
  nbf?: number;
  exp?: number;
  jti?: string;
  htm?: string;
  htu?: string;
  query_keys?: string[];
}

/** 拆解并提取 WebSocket 握手 URL 中的 mini_app_token，并返回剔除 token 后的纯净 HTTPS URL */
export function extractWebSocketToken(
  requestUrl: string,
  audienceOrigin: string,
): { token: string; cleanHttpsUrl: string } {
  if (!requestUrl || requestUrl.length > 163840 || requestUrl.includes('#')) {
    throw new MappAuthError('Invalid upgrade URL length or format');
  }

  // 拼接成绝对 URL 以便解析
  let fullUrlStr = requestUrl;
  if (requestUrl.startsWith('/')) {
    fullUrlStr = `${audienceOrigin}${requestUrl}`;
  } else if (fullUrlStr.startsWith('wss://')) {
    fullUrlStr = 'https://' + fullUrlStr.slice(6);
  } else if (fullUrlStr.startsWith('ws://')) {
    fullUrlStr = 'http://' + fullUrlStr.slice(5);
  }

  const parsed = new URL(fullUrlStr);
  const questionIdx = fullUrlStr.indexOf('?');
  if (questionIdx < 0) {
    throw new MappAuthError('WebSocket upgrade missing query string');
  }

  const queryString = fullUrlStr.slice(questionIdx + 1);
  const remainingParts: string[] = [];
  let token: string | undefined;

  for (const part of queryString.split('&')) {
    if (!part) continue;
    const eqIdx = part.indexOf('=');
    const rawKey = eqIdx < 0 ? part : part.slice(0, eqIdx);
    let key = '';
    try {
      key = decodeURIComponent(rawKey.replaceAll('+', ' '));
    } catch {
      remainingParts.push(part);
      continue;
    }

    if (key === 'mini_app_token') {
      if (token !== undefined || eqIdx < 0) {
        throw new MappAuthError('Duplicate or malformed mini_app_token parameter');
      }
      const rawVal = part.slice(eqIdx + 1);
      token = decodeURIComponent(rawVal.replaceAll('+', ' '));
      if (!token) {
        throw new MappAuthError('Empty mini_app_token value');
      }
    } else {
      remainingParts.push(part);
    }
  }

  if (!token) {
    throw new MappAuthError('mini_app_token not found');
  }

  // 重新构建剔除 mini_app_token 后的 URL，强制转换为 https:
  const baseWithoutQuery = fullUrlStr.slice(0, questionIdx).replace(/^(ws|wss):/i, 'https:');
  const cleanHttpsUrl =
    baseWithoutQuery + (remainingParts.length > 0 ? `?${remainingParts.join('&')}` : '');

  return { token, cleanHttpsUrl };
}

/** 校验 JWT payload 中的 htu 与 query_keys 是否匹配实际请求的 URL */
function verifyEndpointUrl(
  htu: string,
  queryKeys: string[] | undefined,
  cleanHttpsUrl: string,
  audience: string,
): void {
  if (typeof htu !== 'string' || htu.length > 16384) {
    throw new MappAuthError('Invalid token htu');
  }

  const htuParsed = new URL(htu);
  const cleanParsed = new URL(cleanHttpsUrl);

  // audience 必须与 htu origin 一致
  if (htuParsed.origin !== audience || cleanParsed.origin !== audience) {
    throw new MappAuthError('Audience origin mismatch');
  }

  // 路径必须完全一致
  if (cleanParsed.pathname !== htuParsed.pathname) {
    throw new MappAuthError('Endpoint pathname mismatch');
  }

  // token 中的 htu 不能含 mini_app_token
  if (htuParsed.searchParams.has('mini_app_token')) {
    throw new MappAuthError('htu must not contain mini_app_token');
  }

  const allowedKeys = Array.isArray(queryKeys) ? queryKeys : [];
  const allowedSet = new Set<string>();
  for (const k of allowedKeys) {
    if (
      typeof k !== 'string' ||
      !/^[A-Za-z0-9_.-]{1,64}$/.test(k) ||
      k === 'mini_app_token' ||
      allowedSet.has(k) ||
      htuParsed.searchParams.has(k)
    ) {
      throw new MappAuthError('Invalid query_keys declaration in token');
    }
    allowedSet.add(k);
  }

  // 检查除 htu 固定 query 外的附加参数
  const htuSearch = htu.includes('?') ? htu.slice(htu.indexOf('?') + 1) : '';
  const cleanSearch = cleanHttpsUrl.includes('?') ? cleanHttpsUrl.slice(cleanHttpsUrl.indexOf('?') + 1) : '';

  let extraQuery = '';
  if (cleanSearch !== htuSearch) {
    if (htuSearch && !cleanSearch.startsWith(`${htuSearch}&`)) {
      throw new MappAuthError('Query does not match reviewed prefix');
    }
    extraQuery = htuSearch ? cleanSearch.slice(htuSearch.length + 1) : cleanSearch;
  }

  if (extraQuery) {
    const extraParams = new URLSearchParams(extraQuery);
    if (extraParams.toString() !== extraQuery) {
      throw new MappAuthError('Query encoding mismatch');
    }
    const seen = new Set<string>();
    for (const [key] of extraParams) {
      if (!allowedSet.has(key) || seen.has(key)) {
        throw new MappAuthError(`Disallowed dynamic query key: ${key}`);
      }
      seen.add(key);
    }
  }
}

export async function verifyMappToken(
  token: string,
  config: MappConfig,
  jwksCache: JwksCache,
  options?: {
    scope?: 'network.websocket' | 'network.request';
    cleanHttpsUrl?: string;
    now?: number;
  },
): Promise<MappIdentity> {
  if (typeof token !== 'string' || token.length > 131072) {
    throw new MappAuthError('Token too long or not a string');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new MappAuthError('JWT must contain 3 parts');
  }

  const [headerB64, payloadB64, sigB64] = parts;

  let header: JwtHeader;
  let payload: JwtPayload;
  try {
    header = parseJsonBase64Url<JwtHeader>(headerB64);
    payload = parseJsonBase64Url<JwtPayload>(payloadB64);
  } catch {
    throw new MappAuthError('Malformed JWT header or payload');
  }

  // Header 校验：固定 ES256，不得有未受限外部扩展
  if (
    !header ||
    header.alg !== 'ES256' ||
    header.typ !== 'mini-app-access+jwt' ||
    header.jku !== undefined ||
    header.jwk !== undefined ||
    header.x5u !== undefined ||
    header.crit !== undefined ||
    typeof header.kid !== 'string' ||
    !header.kid
  ) {
    throw new MappAuthError('Invalid JWT header');
  }

  // 公钥查找与验签
  const publicKey: KeyObject | null = await jwksCache.getKey(header.kid);
  if (!publicKey) {
    throw new MappAuthError(`Public key not found for kid: ${header.kid}`);
  }

  const sig = decodeBase64Url(sigB64);
  if (sig.length !== 64) {
    throw new MappAuthError('ES256 IEEE-P1363 signature must be exactly 64 bytes');
  }

  const dataToVerify = Buffer.from(`${headerB64}.${payloadB64}`);
  const valid = verify(
    'sha256',
    dataToVerify,
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    sig,
  );
  if (!valid) {
    throw new MappAuthError('Signature verification failed');
  }

  // Payload 校验
  const now = Math.floor(options?.now ?? Date.now() / 1000);
  const expectedScope = options?.scope ?? 'network.websocket';

  if (!payload) {
    throw new MappAuthError('Missing payload');
  }

  if (payload.iss !== config.issuer) {
    throw new MappAuthError(`Issuer mismatch: expected ${config.issuer}, got ${payload.iss}`);
  }

  if (payload.aud !== config.audience) {
    throw new MappAuthError(`Audience mismatch: expected ${config.audience}, got ${payload.aud}`);
  }

  if (payload.app_id !== config.appId) {
    throw new MappAuthError(`AppId mismatch: expected ${config.appId}, got ${payload.app_id}`);
  }

  const allowedChannels = config.allowedChannels ?? [config.channel];
  if (typeof payload.channel !== 'string' || !(allowedChannels as readonly string[]).includes(payload.channel)) {
    throw new MappAuthError(`Channel mismatch: expected ${allowedChannels.join('|')}, got ${payload.channel}`);
  }

  if (typeof payload.sub !== 'string' || !/^[1-9][0-9]{0,19}$/.test(payload.sub)) {
    throw new MappAuthError('Subject sub must be non-empty digits (1..20 chars)');
  }

  if (Object.hasOwn(payload, 'trust_level')) {
    if (
      typeof payload.trust_level !== 'number' ||
      !Number.isInteger(payload.trust_level) ||
      payload.trust_level < 0 ||
      payload.trust_level > 4
    ) {
      throw new MappAuthError('Invalid trust_level value');
    }
  }

  if (
    !Array.isArray(payload.scopes) ||
    payload.scopes.length !== 1 ||
    payload.scopes[0] !== expectedScope
  ) {
    throw new MappAuthError('Invalid scopes in token');
  }

  if (payload.htm !== 'GET') {
    throw new MappAuthError('htm must be GET');
  }

  // 时序校验
  const { iat, nbf, exp, jti } = payload;
  if (
    !Number.isSafeInteger(iat) ||
    !Number.isSafeInteger(nbf) ||
    !Number.isSafeInteger(exp) ||
    typeof jti !== 'string' ||
    !/^[A-Za-z0-9_-]{16,128}$/.test(jti)
  ) {
    throw new MappAuthError('Invalid time claims or jti');
  }

  if (exp! <= iat! || exp! - iat! > 900) {
    throw new MappAuthError('Token lifetime must be > 0 and <= 900 seconds');
  }

  // 5 秒时钟容差
  if (iat! > now + 5 || nbf! > now + 5 || nbf! > iat! || iat! - nbf! > 5 || exp! <= now) {
    throw new MappAuthError('Token expired or clock tolerance violated');
  }

  // 端点 URL 校验
  if (options?.cleanHttpsUrl) {
    if (typeof payload.htu !== 'string') {
      throw new MappAuthError('Missing htu in token payload');
    }
    verifyEndpointUrl(payload.htu, payload.query_keys, options.cleanHttpsUrl, config.audience);
  }

  return {
    iss: payload.iss,
    sub: payload.sub,
    trust_level: payload.trust_level,
    channel: payload.channel as 'production' | 'sandbox',
    appId: payload.app_id,
  };
}
