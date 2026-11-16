// Linux.do 微应用 JWKS 获取与缓存单测（AISLG-261）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, type JsonWebKey } from 'node:crypto';
import { JwksCache, computeSpkiSha256, parseAndValidateJwk } from '../api/src/mapp/jwks';

const ecKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const ecJwk = ecKey.publicKey.export({ format: 'jwk' }) as JsonWebKey;
const ecKid = 'community-ec-key-id-1';

test('parseAndValidateJwk：正常解析合法的 EC P-256 公钥 JWK', () => {
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    use: 'sig',
    kid: ecKid,
    x: ecJwk.x,
    y: ecJwk.y,
  };
  const { keyObject, kid, sha256 } = parseAndValidateJwk(jwk);
  assert.equal(kid, ecKid);
  assert.equal(keyObject.asymmetricKeyType, 'ec');
  assert.equal(sha256, computeSpkiSha256(keyObject));
});

test('parseAndValidateJwk：包含私钥分量 d 时必须拒绝', () => {
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    alg: 'ES256',
    use: 'sig',
    kid: ecKid,
    x: ecJwk.x,
    y: ecJwk.y,
    d: 'some-private-component',
  };
  assert.throws(() => parseAndValidateJwk(jwk), /Invalid community JWK/);
});

test('parseAndValidateJwk：RSA 密钥或非 prime256v1 曲线必须拒绝', () => {
  const rsaKey = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const rsaJwk = rsaKey.publicKey.export({ format: 'jwk' }) as JsonWebKey;
  assert.throws(
    () => parseAndValidateJwk({ ...rsaJwk, use: 'sig', kid: 'rsa-key' }),
    /Invalid community JWK/,
  );

  const secp256k1Key = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const k1Jwk = secp256k1Key.publicKey.export({ format: 'jwk' }) as JsonWebKey;
  assert.throws(
    () => parseAndValidateJwk({ ...k1Jwk, use: 'sig', kid: 'k1-key' }),
    /Invalid community JWK/,
  );
});

test('JwksCache：正常拉取并在内存中按 kid 和 sha256 索引', async () => {
  const validJwks = {
    keys: [
      {
        kty: 'EC',
        crv: 'P-256',
        alg: 'ES256',
        use: 'sig',
        kid: ecKid,
        x: ecJwk.x,
        y: ecJwk.y,
      },
    ],
  };

  const mockFetch = async () =>
    new Response(JSON.stringify(validJwks), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const cache = new JwksCache({
    issuer: 'https://community.test',
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  try {
    await cache.refresh();
    const key = await cache.getKey(ecKid);
    assert.ok(key);
    assert.equal(key.asymmetricKeyType, 'ec');

    // 同样能通过 sha256 查到
    const sha = computeSpkiSha256(key);
    const keyBySha = await cache.getKey(sha);
    assert.ok(keyBySha);
  } finally {
    cache.stop();
  }
});

test('JwksCache：返回多把公钥或空 keys 时拒绝', async () => {
  const multiKeys = {
    keys: [
      { kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: '1', x: ecJwk.x, y: ecJwk.y },
      { kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: '2', x: ecJwk.x, y: ecJwk.y },
    ],
  };

  const mockFetch = async () =>
    new Response(JSON.stringify(multiKeys), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

  const cache = new JwksCache({
    issuer: 'https://community.test',
    fetchFn: mockFetch as unknown as typeof fetch,
  });

  try {
    await assert.rejects(() => cache.refresh(), /JWKS must contain exactly one public key/);
  } finally {
    cache.stop();
  }
});

test('JwksCache：网络失败时保留旧公钥并记录告警', async () => {
  let callCount = 0;
  const mockFetch = async () => {
    callCount += 1;
    if (callCount === 1) {
      return new Response(
        JSON.stringify({
          keys: [
            { kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: ecKid, x: ecJwk.x, y: ecJwk.y },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response('Internal Server Error', { status: 500 });
  };

  const cache = new JwksCache({
    issuer: 'https://community.test',
    fetchFn: mockFetch as unknown as typeof fetch,
    retryBackoffMs: 100,
  });

  try {
    // 第一次成功
    await cache.refresh();
    assert.ok(await cache.getKey(ecKid));

    // 第二次失败：旧公钥依然在
    await assert.rejects(() => cache.refresh(), /JWKS fetch failed/);
    assert.ok(await cache.getKey(ecKid));
  } finally {
    cache.stop();
  }
});

test('JwksCache：未知 kid 触发一次强刷', async () => {
  let fetchCount = 0;
  const newKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const newJwk = newKey.publicKey.export({ format: 'jwk' }) as JsonWebKey;
  const newKid = 'rotated-kid-2';

  const mockFetch = async () => {
    fetchCount += 1;
    return new Response(
      JSON.stringify({
        keys: [
          { kty: 'EC', crv: 'P-256', alg: 'ES256', use: 'sig', kid: newKid, x: newJwk.x, y: newJwk.y },
        ],
      }),
      { status: 200 },
    );
  };

  const cache = new JwksCache({
    issuer: 'https://community.test',
    fetchFn: mockFetch as unknown as typeof fetch,
    forceRefreshCooldownMs: 50,
  });

  try {
    // 缓存中还没有该 kid，getKey 会触发强刷并拉取成功
    const key = await cache.getKey(newKid);
    assert.ok(key);
    assert.equal(fetchCount, 1);

    // 再次查相同 key 不重复 fetch
    const key2 = await cache.getKey(newKid);
    assert.ok(key2);
    assert.equal(fetchCount, 1);
  } finally {
    cache.stop();
  }
});
