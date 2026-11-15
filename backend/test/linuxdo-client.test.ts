import test from 'node:test';
import assert from 'node:assert/strict';
import { createLinuxdoClient, LinuxdoError, readLinuxdoMinTrustLevel, type LinuxdoConfig } from '../api/src/linuxdo';
import { linuxdoSiteFor, readLinuxdoSites } from '../api/src/linuxdo-sites';

const config: LinuxdoConfig = { clientId: 'id', clientSecret: 'secret', redirectUri: 'https://api.test/auth/linuxdo/callback', frontendUrl: 'https://front.test', apiBase: 'https://provider.test' };
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const good = { id: 123, username: 'alice', trust_level: 1, active: true, silenced: false };

test('Linux.do OAuth uses code flow, client_secret_post and bearer user request', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = createLinuxdoClient(config, 1, async (url, init) => {
    calls.push({ url: String(url), init });
    return String(url).endsWith('/oauth2/token') ? json({ access_token: 'private-token' }) : json(good);
  });
  const url = new URL(client.authorizeUrl('state'));
  assert.equal(url.pathname, '/oauth2/authorize');
  assert.equal(url.searchParams.get('scope'), 'user');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'state');
  assert.deepEqual(await client.exchangeCode('code'), { id: '123', login: 'alice' });
  const body = new URLSearchParams(String(calls[0].init?.body));
  assert.equal(body.get('client_secret'), 'secret');
  assert.equal(body.get('code'), 'code');
  assert.equal(body.get('redirect_uri'), config.redirectUri);
  assert.equal((calls[1].init?.headers as Record<string, string>).authorization, 'Bearer private-token');
  assert.ok(calls[1].init?.signal);
});

test('malformed or ineligible identities fail closed', async () => {
  for (const [user, expected] of [
    [{ ...good, trust_level: 0 }, 'not_eligible'], [{ ...good, active: false }, 'not_eligible'],
    [{ ...good, silenced: true }, 'not_eligible'], [{ ...good, id: 0 }, 'unavailable'],
    [{ ...good, id: Number.MAX_SAFE_INTEGER + 1 }, 'unavailable'], [{ ...good, username: '  ' }, 'unavailable'],
    [{ ...good, active: undefined }, 'unavailable'], [{ ...good, trust_level: -1 }, 'unavailable'],
  ] as const) {
    const client = createLinuxdoClient(config, 1, async (url) => String(url).endsWith('/oauth2/token') ? json({ access_token: 't' }) : json(user));
    await assert.rejects(client.exchangeCode('code'), (err: unknown) => err instanceof LinuxdoError && err.kind === expected);
  }
  const invalid = createLinuxdoClient(config, 1, async () => json({ error: 'invalid_grant' }, 400));
  await assert.rejects(invalid.exchangeCode('code'), (err: unknown) => err instanceof LinuxdoError && err.kind === 'code_invalid');
});

test('site configuration and threshold disable incomplete or malformed settings', () => {
  assert.equal(readLinuxdoMinTrustLevel({}), 1);
  assert.equal(readLinuxdoMinTrustLevel({ LINUXDO_MIN_TRUST_LEVEL: '2' }), 2);
  assert.equal(readLinuxdoMinTrustLevel({ LINUXDO_MIN_TRUST_LEVEL: '-1' }), null);
  assert.equal(linuxdoSiteFor('a.test', readLinuxdoSites({ LINUXDO_CLIENT_ID: 'id' })), null);
  const sites = readLinuxdoSites({ LINUXDO_SITES: JSON.stringify({ 'a.test': config }) });
  assert.equal(linuxdoSiteFor('A.TEST:443', sites)?.clientId, 'id');
  assert.equal(linuxdoSiteFor('b.test', sites), null);
});

test('信任等级门槛边界：等于门槛放行，低一级拒绝；门槛 0 时 TL0 也放行', async () => {
  const fetchAs = (user: Record<string, unknown>) => async (url: string | URL | Request) =>
    String(url).endsWith('/oauth2/token') ? json({ access_token: 't' }) : json(user);
  const ok = createLinuxdoClient(config, 2, fetchAs({ ...good, trust_level: 2 }));
  assert.deepEqual(await ok.exchangeCode('code'), { id: '123', login: 'alice' });
  const low = createLinuxdoClient(config, 2, fetchAs({ ...good, trust_level: 1 }));
  await assert.rejects(low.exchangeCode('code'), (err: unknown) => err instanceof LinuxdoError && err.kind === 'not_eligible');
  const zero = createLinuxdoClient(config, 0, fetchAs({ ...good, trust_level: 0 }));
  assert.deepEqual(await zero.exchangeCode('code'), { id: '123', login: 'alice' });
});

test('LINUXDO_MIN_TRUST_LEVEL 解析：空值与空白取默认 1；非数字、负数、小数返回 null（功能关闭）', () => {
  assert.equal(readLinuxdoMinTrustLevel({ LINUXDO_MIN_TRUST_LEVEL: '' }), 1);
  assert.equal(readLinuxdoMinTrustLevel({ LINUXDO_MIN_TRUST_LEVEL: '  3 ' }), 3);
  assert.equal(readLinuxdoMinTrustLevel({ LINUXDO_MIN_TRUST_LEVEL: '0' }), 0);
  for (const bad of ['abc', '-1', '1.5', '1e2', '99999999999999999999']) {
    assert.equal(readLinuxdoMinTrustLevel({ LINUXDO_MIN_TRUST_LEVEL: bad }), null, bad);
  }
});

test('active=false 与 silenced=true 即使信任等级达标也拒绝；缺字段按不可用处理', async () => {
  const fetchAs = (user: Record<string, unknown>) => async (url: string | URL | Request) =>
    String(url).endsWith('/oauth2/token') ? json({ access_token: 't' }) : json(user);
  const inactive = createLinuxdoClient(config, 0, fetchAs({ ...good, trust_level: 4, active: false }));
  await assert.rejects(inactive.exchangeCode('code'), (err: unknown) => err instanceof LinuxdoError && err.kind === 'not_eligible');
  const muted = createLinuxdoClient(config, 0, fetchAs({ ...good, trust_level: 4, silenced: true }));
  await assert.rejects(muted.exchangeCode('code'), (err: unknown) => err instanceof LinuxdoError && err.kind === 'not_eligible');
});
