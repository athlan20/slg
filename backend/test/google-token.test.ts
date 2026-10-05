// Google ID Token 校验（api/src/google.ts）的单元测试（AISLG-127）：
// 本地生成 RSA 密钥对自签 JWT、注入假 JWKS 与自定义时钟，覆盖签名错 / aud 错 /
// iss 错 / 过期 / 算法不对 / 未知 kid / 时钟误差容忍 / 公钥服务连不上，以及 JWKS 缓存。

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import {
  GoogleError,
  createJwksFetcher,
  readGoogleConfig,
  verifyGoogleIdToken,
  type Jwks,
} from '../api/src/google';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

/** 测试密钥对：公钥以 JWK 形态进假 JWKS，私钥用来签 token */
function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
  return { privateKey, jwk };
}

const KID = 'test-kid-1';
const keys = makeKeys();

const fakeJwks: Jwks = { keys: [{ kid: KID, ...keys.jwk, alg: 'RS256', use: 'sig' }] };
const fetchJwks = async () => ({ jwks: fakeJwks, cacheMs: 60_000 });

interface TokenOptions {
  sub?: string;
  email?: string | null;
  aud?: string;
  iss?: string;
  /** 相对 now 的过期秒数 */
  expInSeconds?: number;
  nbfInSeconds?: number;
  alg?: string;
  kid?: string;
  /** 用另一把私钥签名（模拟伪造） */
  wrongKey?: boolean;
}

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/** 按测试参数签一个 ID Token */
function makeToken(options: TokenOptions = {}, nowMs = Date.now()): string {
  const nowSec = Math.floor(nowMs / 1000);
  const header = { alg: options.alg ?? 'RS256', kid: options.kid ?? KID, typ: 'JWT' };
  const claims = {
    iss: options.iss ?? 'https://accounts.google.com',
    aud: options.aud ?? CLIENT_ID,
    sub: options.sub ?? 'google-sub-1234567890',
    email: options.email === null ? undefined : (options.email ?? 'player@example.com'),
    exp: Math.floor(nowSec + (options.expInSeconds ?? 3600)),
    nbf: options.nbfInSeconds === undefined ? undefined : Math.floor(nowSec + options.nbfInSeconds),
    iat: nowSec,
  };
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = options.wrongKey ? makeKeys().privateKey : keys.privateKey;
  const signature = cryptoSign('RSA-SHA256', Buffer.from(signed), key);
  return `${signed}.${b64url(signature)}`;
}

/** 断言校验以指定的 GoogleError kind 失败 */
async function assertRejects(credential: string, kind: 'credential_invalid' | 'unavailable', now?: () => number): Promise<void> {
  await assert.rejects(
    () => verifyGoogleIdToken(credential, { clientId: CLIENT_ID, fetchJwks, now }),
    (err: unknown) => {
      assert.ok(err instanceof GoogleError);
      assert.equal(err.kind, kind);
      return true;
    },
  );
}

test('readGoogleConfig：没配 GOOGLE_CLIENT_ID 返回 null，配了返回 trim 后的值', () => {
  assert.equal(readGoogleConfig({}), null);
  assert.equal(readGoogleConfig({ GOOGLE_CLIENT_ID: '  ' }), null);
  assert.deepEqual(readGoogleConfig({ GOOGLE_CLIENT_ID: ' abc.apps.googleusercontent.com ' }), {
    clientId: 'abc.apps.googleusercontent.com',
  });
});

test('合法 ID Token 验证通过，返回 sub 与 email', async () => {
  const identity = await verifyGoogleIdToken(makeToken(), { clientId: CLIENT_ID, fetchJwks });
  assert.deepEqual(identity, { sub: 'google-sub-1234567890', email: 'player@example.com' });
});

test('token 里没有 email 时返回 null', async () => {
  const identity = await verifyGoogleIdToken(makeToken({ email: null }), { clientId: CLIENT_ID, fetchJwks });
  assert.equal(identity.email, null);
});

test('iss 两种合法取值都接受', async () => {
  for (const iss of ['accounts.google.com', 'https://accounts.google.com']) {
    const identity = await verifyGoogleIdToken(makeToken({ iss }), { clientId: CLIENT_ID, fetchJwks });
    assert.equal(identity.sub, 'google-sub-1234567890');
  }
});

test('伪造签名（别的私钥签的）被拒', () => assertRejects(makeToken({ wrongKey: true }), 'credential_invalid'));

test('aud 不是本应用的 Client ID 被拒（发给别的应用的 token 不能自用）', () =>
  assertRejects(makeToken({ aud: 'other-app.apps.googleusercontent.com' }), 'credential_invalid'));

test('iss 不是 Google 被拒', () => assertRejects(makeToken({ iss: 'https://evil.example.com' }), 'credential_invalid'));

test('过期 token 被拒', () => assertRejects(makeToken({ expInSeconds: -120 }), 'credential_invalid'));

test('允许约 60 秒时钟误差：过期 30 秒仍通过，过期 90 秒被拒', async () => {
  const now = () => Date.now();
  const almost = await verifyGoogleIdToken(makeToken({ expInSeconds: -30 }, now()), {
    clientId: CLIENT_ID,
    fetchJwks,
    now,
  });
  assert.equal(almost.sub, 'google-sub-1234567890');
  await assertRejects(makeToken({ expInSeconds: -90 }, now()), 'credential_invalid', now);
});

test('nbf 尚未生效被拒（同样留 60 秒误差）', () =>
  assertRejects(makeToken({ nbfInSeconds: 120 }), 'credential_invalid'));

test('sub 缺失被拒', () => assertRejects(makeToken({ sub: '' }), 'credential_invalid'));

test('算法不是 RS256 被拒（如 alg=none）', () => assertRejects(makeToken({ alg: 'none' }), 'credential_invalid'));

test('kid 不在公钥集里被拒', () => assertRejects(makeToken({ kid: 'unknown-kid' }), 'credential_invalid'));

test('不是三段式 JWT / 段损坏被拒', async () => {
  await assertRejects('not-a-jwt', 'credential_invalid');
  await assertRejects('a.b', 'credential_invalid');
  await assertRejects(`${b64url('not json')}.${b64url('{}')}.${b64url('sig')}`, 'credential_invalid');
});

test('公钥服务连不上 → unavailable，与凭证无效区分', async () => {
  const failingFetch = async (): Promise<{ jwks: Jwks; cacheMs: number }> => {
    throw new Error('network down');
  };
  await assert.rejects(
    () => verifyGoogleIdToken(makeToken(), { clientId: CLIENT_ID, fetchJwks: failingFetch }),
    (err: unknown) => {
      assert.ok(err instanceof GoogleError);
      assert.equal(err.kind, 'unavailable');
      return true;
    },
  );
});

test('createJwksFetcher：按 Cache-Control max-age 缓存，窗口内不重复请求', async () => {
  let calls = 0;
  const body = JSON.stringify(fakeJwks);
  const fetchFn = async (): Promise<Response> => {
    calls += 1;
    return new Response(body, { headers: { 'content-type': 'application/json', 'cache-control': 'max-age=60' } });
  };
  const fetcher = createJwksFetcher('https://fake.example/certs', fetchFn as unknown as typeof fetch);
  const first = await fetcher();
  const second = await fetcher();
  assert.equal(calls, 1, '第二次走缓存');
  assert.equal(first.jwks.keys.length, 1);
  assert.equal(second.jwks.keys.length, 1);
  assert.ok(second.cacheMs > 0);
});
