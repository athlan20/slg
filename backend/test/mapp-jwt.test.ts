// Linux.do 微应用 JWT 验签正反例单测（AISLG-261）。
// 本地生成 EC P-256 密钥对，测试签名正确性、各 claim 拦截、算法篡改、时序与容差。

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, type JsonWebKey, type KeyObject } from 'node:crypto';
import { JwksCache, computeSpkiSha256 } from '../api/src/mapp/jwks';
import { extractWebSocketToken, verifyMappToken } from '../api/src/mapp/jwt';
import type { MappConfig } from '../api/src/mapp/types';

// 生成测试用 EC P-256 密钥对
const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const altKeyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

const pubJwk = keyPair.publicKey.export({ format: 'jwk' }) as JsonWebKey;
const pubKid = computeSpkiSha256(keyPair.publicKey);

const baseConfig: MappConfig = {
  enabled: true,
  issuer: 'https://linux.do',
  appId: '019a2a58-0000-7000-8000-000000000001',
  channel: 'production',
  audience: 'https://slgws.example.com',
  origins: new Set(['https://linux.do']),
  identityProvider: 'linuxdo_mapp',
  minTrustLevel: 1,
};

function createMockJwksCache(keyObject: KeyObject = keyPair.publicKey, kid: string = pubKid): JwksCache {
  const cache = new JwksCache({ issuer: baseConfig.issuer });
  cache.setKey(kid, keyObject);
  return cache;
}

function buildToken(options?: {
  header?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  signingKey?: KeyObject;
  corruptSig?: boolean;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'ES256',
    typ: 'mini-app-access+jwt',
    kid: pubKid,
    ...options?.header,
  };

  const payload: Record<string, unknown> = {
    iss: baseConfig.issuer,
    aud: baseConfig.audience,
    sub: '10086',
    trust_level: 2,
    app_id: baseConfig.appId,
    channel: baseConfig.channel,
    scopes: ['network.websocket'],
    version: '1.0.0',
    iat: now,
    nbf: now,
    exp: now + 600,
    jti: 'test-jti-1234567890abcdef',
    htm: 'GET',
    htu: 'https://slgws.example.com/ws',
    query_keys: [],
    ...options?.payload,
  };
  if (options?.payload && 'trust_level' in options.payload && options.payload.trust_level === undefined) {
    delete payload.trust_level;
  }

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = Buffer.from(`${headerB64}.${payloadB64}`);

  const signingKey = options?.signingKey ?? keyPair.privateKey;
  let sig = sign('sha256', data, { key: signingKey, dsaEncoding: 'ieee-p1363' });

  if (options?.corruptSig) {
    sig = Buffer.from(sig);
    sig[0] ^= 0xff;
  }

  return `${headerB64}.${payloadB64}.${sig.toString('base64url')}`;
}

test('正例：合法的 ES256 令牌成功解析身份', async () => {
  const token = buildToken();
  const cache = createMockJwksCache();
  const identity = await verifyMappToken(token, baseConfig, cache, {
    cleanHttpsUrl: 'https://slgws.example.com/ws',
  });

  assert.equal(identity.iss, baseConfig.issuer);
  assert.equal(identity.sub, '10086');
  assert.equal(identity.trust_level, 2);
  assert.equal(identity.channel, 'production');
  assert.equal(identity.appId, baseConfig.appId);
});

test('反例：签名被篡改或不匹配被拒', async () => {
  const token = buildToken({ corruptSig: true });
  const cache = createMockJwksCache();
  await assert.rejects(
    () => verifyMappToken(token, baseConfig, cache),
    /Signature verification failed/,
  );
});

test('反例：由其他非信任私钥签发的令牌被拒', async () => {
  const token = buildToken({ signingKey: altKeyPair.privateKey });
  const cache = createMockJwksCache();
  await assert.rejects(
    () => verifyMappToken(token, baseConfig, cache),
    /Signature verification failed/,
  );
});

test('反例：alg 篡改为 none 或 HS256 被拒', async () => {
  const cache = createMockJwksCache();

  const tokenNone = buildToken({ header: { alg: 'none' } });
  await assert.rejects(
    () => verifyMappToken(tokenNone, baseConfig, cache),
    /Invalid JWT header/,
  );

  const tokenHs = buildToken({ header: { alg: 'HS256' } });
  await assert.rejects(
    () => verifyMappToken(tokenHs, baseConfig, cache),
    /Invalid JWT header/,
  );
});

test('反例：Header 包含非法扩展（jku/jwk/x5u/crit）被拒', async () => {
  const cache = createMockJwksCache();
  for (const field of ['jku', 'jwk', 'x5u', 'crit']) {
    const token = buildToken({ header: { [field]: 'invalid' } });
    await assert.rejects(
      () => verifyMappToken(token, baseConfig, cache),
      /Invalid JWT header/,
    );
  }
});

test('反例：令牌过期（exp <= now）被拒', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = buildToken({ payload: { iat: now - 200, nbf: now - 200, exp: now - 10 } });
  const cache = createMockJwksCache();
  await assert.rejects(
    () => verifyMappToken(token, baseConfig, cache),
    /Token expired or clock tolerance violated/,
  );
});

test('反例：nbf 超出时钟容差被拒', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = buildToken({ payload: { iat: now + 20, nbf: now + 20, exp: now + 600 } });
  const cache = createMockJwksCache();
  await assert.rejects(
    () => verifyMappToken(token, baseConfig, cache),
    /Token expired or clock tolerance violated/,
  );
});

test('时钟容差：5 秒以内的时间偏差允许通过', async () => {
  const now = Math.floor(Date.now() / 1000);
  // iat / nbf 在未来 3 秒（<= 5 秒容差）
  const token = buildToken({ payload: { iat: now + 3, nbf: now + 3, exp: now + 600 } });
  const cache = createMockJwksCache();
  const identity = await verifyMappToken(token, baseConfig, cache, { now });
  assert.equal(identity.sub, '10086');
});

test('反例：有效期超过 15 分钟（900 秒）被拒', async () => {
  const now = Math.floor(Date.now() / 1000);
  const token = buildToken({ payload: { iat: now, nbf: now, exp: now + 901 } });
  const cache = createMockJwksCache();
  await assert.rejects(
    () => verifyMappToken(token, baseConfig, cache),
    /Token lifetime must be > 0 and <= 900 seconds/,
  );
});

test('反例：aud / iss / appId 不匹配被拒', async () => {
  const cache = createMockJwksCache();

  const tokenAud = buildToken({ payload: { aud: 'https://other.example.com' } });
  await assert.rejects(
    () => verifyMappToken(tokenAud, baseConfig, cache),
    /Audience mismatch/,
  );

  const tokenIss = buildToken({ payload: { iss: 'https://other-issuer.com' } });
  await assert.rejects(
    () => verifyMappToken(tokenIss, baseConfig, cache),
    /Issuer mismatch/,
  );

  const tokenApp = buildToken({ payload: { app_id: 'other-app-id' } });
  await assert.rejects(
    () => verifyMappToken(tokenApp, baseConfig, cache),
    /AppId mismatch/,
  );
});

test('渠道隔离：sandbox 令牌打到 production 配置被拒，反之亦然', async () => {
  const cache = createMockJwksCache();

  // production 配置收到 sandbox 令牌
  const sandboxToken = buildToken({ payload: { channel: 'sandbox' } });
  await assert.rejects(
    () => verifyMappToken(sandboxToken, baseConfig, cache),
    /Channel mismatch/,
  );

  // sandbox 配置收到 production 令牌
  const sandboxConfig: MappConfig = { ...baseConfig, channel: 'sandbox' };
  const prodToken = buildToken({ payload: { channel: 'production' } });
  await assert.rejects(
    () => verifyMappToken(prodToken, sandboxConfig, cache),
    /Channel mismatch/,
  );
});

test('MAPP_CHANNEL 配置多个渠道时两种令牌都接受，未列出的渠道仍被拒', async () => {
  const cache = createMockJwksCache();
  const both: MappConfig = { ...baseConfig, channel: 'production', allowedChannels: ['production', 'sandbox'] };
  assert.equal((await verifyMappToken(buildToken({ payload: { channel: 'sandbox' } }), both, cache)).channel, 'sandbox');
  assert.equal((await verifyMappToken(buildToken({ payload: { channel: 'production' } }), both, cache)).channel, 'production');
  await assert.rejects(() => verifyMappToken(buildToken({ payload: { channel: 'staging' } }), both, cache), /Channel mismatch/);
});

test('用户信任等级：缺省视为 undefined，非法格式被拒', async () => {
  const cache = createMockJwksCache();

  // 缺 trust_level 字段正常解析，返回值保留 undefined
  const tokenNoTl = buildToken({ payload: { trust_level: undefined } });
  const res = await verifyMappToken(tokenNoTl, baseConfig, cache);
  assert.equal(res.trust_level, undefined);

  // 非法 trust_level（如负数、浮点、大于 4）被拒
  const tokenNeg = buildToken({ payload: { trust_level: -1 } });
  await assert.rejects(() => verifyMappToken(tokenNeg, baseConfig, cache), /Invalid trust_level/);

  const tokenHigh = buildToken({ payload: { trust_level: 5 } });
  await assert.rejects(() => verifyMappToken(tokenHigh, baseConfig, cache), /Invalid trust_level/);
});

test('端点 URL 与 query 校验：路径与 query_keys 匹配', async () => {
  const cache = createMockJwksCache();

  // 路径匹配成功
  const token1 = buildToken({ payload: { htu: 'https://slgws.example.com/ws', query_keys: [] } });
  const ok = await verifyMappToken(token1, baseConfig, cache, {
    cleanHttpsUrl: 'https://slgws.example.com/ws',
  });
  assert.ok(ok);

  // 路径不匹配被拒
  await assert.rejects(
    () =>
      verifyMappToken(token1, baseConfig, cache, {
        cleanHttpsUrl: 'https://slgws.example.com/ws/other',
      }),
    /Endpoint pathname mismatch/,
  );

  // 未声明的动态 query 参数被拒
  await assert.rejects(
    () =>
      verifyMappToken(token1, baseConfig, cache, {
        cleanHttpsUrl: 'https://slgws.example.com/ws?unauthorized_key=1',
      }),
    /Disallowed dynamic query key/,
  );

  // 允许声明的动态 query 参数
  const tokenWithKeys = buildToken({
    payload: { htu: 'https://slgws.example.com/ws', query_keys: ['room'] },
  });
  const okWithKey = await verifyMappToken(tokenWithKeys, baseConfig, cache, {
    cleanHttpsUrl: 'https://slgws.example.com/ws?room=lobby',
  });
  assert.ok(okWithKey);
});

test('extractWebSocketToken：提取 query token 并剔除 token 生成 cleanHttpsUrl', () => {
  const raw = '/ws?mini_app_token=MY_TOKEN';
  const res = extractWebSocketToken(raw, 'https://slgws.example.com');
  assert.equal(res.token, 'MY_TOKEN');
  assert.equal(res.cleanHttpsUrl, 'https://slgws.example.com/ws');

  // 保留其他 query 参数
  const rawWithOther = '/ws?foo=bar&mini_app_token=TOKEN_2&baz=qux';
  const res2 = extractWebSocketToken(rawWithOther, 'https://slgws.example.com');
  assert.equal(res2.token, 'TOKEN_2');
  assert.equal(res2.cleanHttpsUrl, 'https://slgws.example.com/ws?foo=bar&baz=qux');

  // 缺失 mini_app_token 报错
  assert.throws(() => extractWebSocketToken('/ws?foo=bar', 'https://slgws.example.com'));

  // 重复 mini_app_token 报错
  assert.throws(() => extractWebSocketToken('/ws?mini_app_token=A&mini_app_token=B', 'https://slgws.example.com'));
});
