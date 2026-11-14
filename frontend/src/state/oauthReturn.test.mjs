import test from 'node:test';
import assert from 'node:assert/strict';

// 直接加载 TypeScript 源文件（Node 原生去除类型，需要 Node 22.6+ 的 --experimental-strip-types，见 package.json 的 test 脚本）。
const { parseAuthConfig } = await import('./authConfig.ts');

let instance = 0;
async function consume(url) {
  const calls = [];
  globalThis.window = { location: { href: url }, history: { replaceState: (...args) => calls.push(args) } };
  // 每次用新的查询串导入，得到独立的模块实例（takeOauthReturn 的「只消费一次」状态按实例保存）
  const { takeOauthReturn } = await import(`./oauthReturn.ts?instance=${instance++}`);
  const result = takeOauthReturn();
  assert.equal(takeOauthReturn(), null, 'a callback is consumed only once');
  delete globalThis.window;
  return { result, calls };
}

test('Linux.do callback consumes code and strips secrets without losing other parameters', async () => {
  const { result, calls } = await consume('https://example.org/play?foo=bar&oauth=linuxdo&code=secret&error=canceled#area');
  assert.deepEqual(result, { provider: 'linuxdo', kind: 'code', code: 'secret' });
  assert.deepEqual(calls, [[null, '', '/play?foo=bar#area']]);
});

test('Linux.do callback supports bind, cancellation, expiry, eligibility and conflict', async () => {
  for (const [query, expected] of [
    ['bind=ok', { provider: 'linuxdo', kind: 'bindOk' }],
    ...['canceled', 'expired', 'unavailable', 'already_bound', 'not_eligible', 'unknown'].map(reason =>
      [`error=${reason}`, { provider: 'linuxdo', kind: 'error', reason }]),
    ['error=unexpected', { provider: 'linuxdo', kind: 'error', reason: 'unknown' }],
  ]) {
    const { result, calls } = await consume(`https://example.org/?oauth=linuxdo&${query}`);
    assert.deepEqual(result, expected);
    assert.deepEqual(calls, [[null, '', '/']]);
  }
});

test('GitHub callback keeps existing behavior and unrelated providers are untouched', async () => {
  assert.deepEqual((await consume('https://example.org/?oauth=github&code=abc')).result, { provider: 'github', kind: 'code', code: 'abc' });
  assert.deepEqual((await consume('https://example.org/?oauth=github&bind=ok')).result, { provider: 'github', kind: 'bindOk' });
  assert.deepEqual((await consume('https://example.org/?oauth=github&error=expired')).result, { provider: 'github', kind: 'error', reason: 'expired' });
  assert.deepEqual(await consume('https://example.org/?oauth=other&code=abc'), { result: null, calls: [] });
});

test('Linux.do is shown only when explicitly enabled; old config remains compatible', () => {
  for (const input of [null, {}, { linuxdoEnabled: false }, { linuxdoEnabled: 'true' }]) {
    assert.equal(parseAuthConfig(input).linuxdoEnabled, false);
  }
  assert.equal(parseAuthConfig({ linuxdoEnabled: true }).linuxdoEnabled, true);
  assert.deepEqual(parseAuthConfig({ githubEnabled: true, passwordLogin: false, googleClientId: 'abc' }), {
    googleClientId: 'abc', wechatEnabled: false, githubEnabled: true, linuxdoEnabled: false, passwordLogin: false,
  });
});
