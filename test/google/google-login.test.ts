// Google 一键登录 + 绑定的端到端联调（AISLG-127）：真实 API 进程 + PostgreSQL，
// Google 公钥换成假 JWKS 服务（harness.ts，经 GOOGLE_CERTS_URL 注入），用同一把
// 私钥签 ID Token，WebSocket 客户端扮演「网页」与「Agent」跑通完整流程。
//
// 运行（需要 DATABASE_URL 指向可写的 PostgreSQL，建议用临时库，见 test/README.md）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:18999/slg npm run test:google
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Op, startHarness, type Harness } from './harness';
import { seedAccount } from '../account-seed';

const API_PORT = 18095;
const DB_URL = process.env.DATABASE_URL;

let harness: Harness;
let disabledHarness: Harness;

before(async () => {
  if (DB_URL) {
    harness = await startHarness({ apiPort: API_PORT });
  }
});

after(() => {
  harness?.stop();
  disabledHarness?.stop();
});

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过 Google 登录联调' };
// 每次运行加后缀：库里留着上次跑出的绑定，同一个 sub 才不会串到上一轮的账号
const RUN_ID = Date.now().toString(36);
const subOf = (who: string): string => `sub-${who}-${RUN_ID}`;

/** 扮演一次「GSI 回调拿到 credential → GOOGLE_LOGIN 换令牌 → LOGIN」；返回登录后的连接与信息 */
async function googleLogin(who: string, tokenOptions: Parameters<Harness['makeToken']>[0] = {}) {
  const web = await harness.connect();
  const exchanged = await web.call(Op.GOOGLE_LOGIN, {
    credential: harness.makeToken({ sub: subOf(who), ...tokenOptions }),
  });
  assert.ok(exchanged.ok, JSON.stringify(exchanged));
  const { sessionToken, created } = exchanged.data as { sessionToken: string; created: boolean };
  assert.match(sessionToken, /^[A-Za-z0-9_-]{43}$/);
  const login = await web.call(Op.LOGIN, { token: sessionToken, asAgent: false });
  assert.ok(login.ok, JSON.stringify(login));
  return { web, created, username: login.data?.username as string, accountId: login.data?.accountId as string };
}

test('首次 Google 登录自动建号：随机用户名、带初始城池；同一 Google 再登是同一个号', opts, async () => {
  const first = await googleLogin('alice');
  assert.equal(first.created, true);
  assert.match(first.username, /^g_[0-9a-z]{6}$/);
  const state = await first.web.call(Op.GET_STATE);
  assert.ok(state.ok);
  assert.equal(state.data?.city.name, '主城');
  assert.equal(state.data?.city.levels.government, 1);
  assert.ok(first.web.call(Op.GET_STATE)); // 纯 Google 账号没有密码，但令牌登录正常

  const second = await googleLogin('alice');
  assert.equal(second.created, false, '已绑定的 Google 账号直接登录，不再建号');
  assert.equal(second.accountId, first.accountId);

  const other = await googleLogin('bob');
  assert.notEqual(other.accountId, first.accountId);
});

test('纯 Google 账号不能用密码登录（也不能首次设密码占号）', opts, async () => {
  const { username } = await googleLogin('carol');
  const player = await harness.connect();
  assert.equal((await player.call(Op.LOGIN, { username, password: 'try-to-take-over-1', asAgent: false })).error?.code, 'INVALID_CREDENTIALS');
  // v47：Agent 一律不能用账号密码登录（改用永久令牌）
  const agent = await harness.connect();
  assert.equal((await agent.call(Op.LOGIN, { username, password: 'try-to-take-over-1', asAgent: true })).error?.code, 'AGENT_PASSWORD_FORBIDDEN');
});

test('伪造 / aud 错 / 过期的凭证一律 GOOGLE_CREDENTIAL_INVALID', opts, async () => {
  for (const tokenOptions of [
    { wrongKey: true },
    { aud: 'other-app.apps.googleusercontent.com' },
    { iss: 'https://evil.example.com' },
    { expInSeconds: -120 },
  ]) {
    const client = await harness.connect();
    const res = await client.call(Op.GOOGLE_LOGIN, {
      credential: harness.makeToken({ sub: subOf('dave'), ...tokenOptions }),
    });
    assert.equal(res.error?.code, 'GOOGLE_CREDENTIAL_INVALID', JSON.stringify(tokenOptions));
  }
  // 参数缺失与超长同样被拒
  const client = await harness.connect();
  assert.equal((await client.call(Op.GOOGLE_LOGIN, {})).error?.code, 'INVALID_PARAMS');
  assert.equal((await client.call(Op.GOOGLE_LOGIN, { credential: 'x'.repeat(9000) })).error?.code, 'INVALID_PARAMS');
});

test('绑定 Google：老账号登录后 GOOGLE_BIND；重复绑 / Google 被占用都返回 GOOGLE_ALREADY_BOUND', opts, async () => {
  const username = `pw_${Date.now()}`;
  await seedAccount(username, 'password-123'); // v48 起密码通道不再自动注册，先直插预建
  const web = await harness.connect();
  const reg = await web.call(Op.LOGIN, { username, password: 'password-123', asAgent: false });
  assert.ok(reg.ok, JSON.stringify(reg));
  assert.equal((await web.call(Op.GET_AGENT_INFO)).data?.googleBound, false);

  const bound = await web.call(Op.GOOGLE_BIND, { credential: harness.makeToken({ sub: subOf('erin') }) });
  assert.ok(bound.ok, JSON.stringify(bound));
  assert.equal(bound.data?.bound, true);
  assert.equal((await web.call(Op.GET_AGENT_INFO)).data?.googleBound, true);

  // 该账号已绑定：再绑（换一个 Google）直接拒
  assert.equal(
    (await web.call(Op.GOOGLE_BIND, { credential: harness.makeToken({ sub: subOf('frank') }) })).error?.code,
    'GOOGLE_ALREADY_BOUND',
  );

  // 另一个账号想绑同一个 Google：被占用
  const web2 = await harness.connect();
  const username2 = `pw2_${Date.now()}`;
  await seedAccount(username2, 'password-123');
  await web2.call(Op.LOGIN, { username: username2, password: 'password-123', asAgent: false });
  assert.equal(
    (await web2.call(Op.GOOGLE_BIND, { credential: harness.makeToken({ sub: subOf('erin') }) })).error?.code,
    'GOOGLE_ALREADY_BOUND',
  );

  // 绑定后，用这个 Google 登录进的就是该密码账号
  const viaGoogle = await googleLogin('erin');
  assert.equal(viaGoogle.username, username);
  assert.equal(viaGoogle.created, false);
});

test('GOOGLE_BIND 的权限边界：登录前拒、Agent 连接拒；GOOGLE_LOGIN 已登录连接拒', opts, async () => {
  const anon = await harness.connect();
  assert.equal(
    (await anon.call(Op.GOOGLE_BIND, { credential: harness.makeToken({ sub: subOf('gina') }) })).error?.code,
    'NOT_LOGGED_IN',
  );
  const { web } = await googleLogin('henry');
  // 已登录的玩家连接不能发 GOOGLE_LOGIN（那条连接已经登录了）
  assert.equal(
    (await web.call(Op.GOOGLE_LOGIN, { credential: harness.makeToken({ sub: subOf('ivy') }) })).error?.code,
    'ALREADY_LOGGED_IN',
  );
  // Agent 连接不能绑定
  const tokenRes = await web.call(Op.GET_AGENT_TOKEN);
  assert.ok(tokenRes.ok);
  const agent = await harness.connect();
  await agent.call(Op.LOGIN, { token: tokenRes.data?.token, asAgent: true });
  assert.equal(
    (await agent.call(Op.GOOGLE_BIND, { credential: harness.makeToken({ sub: subOf('jack') }) })).error?.code,
    'AGENT_FORBIDDEN',
  );
});

test('纯 Google 账号能查看永久 Agent 令牌，Agent 用令牌以 agent 身份登录', opts, async () => {
  const { web, username } = await googleLogin('kate');
  const tokenRes = await web.call(Op.GET_AGENT_TOKEN);
  assert.ok(tokenRes.ok, JSON.stringify(tokenRes));
  const agent = await harness.connect();
  const login = await agent.call(Op.LOGIN, { token: tokenRes.data?.token, asAgent: true });
  assert.ok(login.ok, JSON.stringify(login));
  assert.equal(login.data?.role, 'agent');
  assert.equal(login.data?.username, username);
});

test('/auth/config：配置了返回 clientId 与微信开关；没配置 Google 时 GOOGLE_LOGIN 返回 GOOGLE_UNAVAILABLE', opts, async () => {
  const config = await (await fetch(`${harness.httpUrl}/auth/config`)).json();
  assert.equal(config.googleClientId, 'google-test-client-id');
  assert.equal(config.wechatEnabled, false, '没配微信凭证时前端应隐藏微信分页');

  disabledHarness = await startHarness({ apiPort: API_PORT + 1, googleEnabled: false });
  const disabledConfig = await (await fetch(`${disabledHarness.httpUrl}/auth/config`)).json();
  assert.equal(disabledConfig.googleClientId, null);
  const client = await disabledHarness.connect();
  assert.equal(
    (await client.call(Op.GOOGLE_LOGIN, { credential: harness.makeToken({ sub: subOf('lee') }) })).error?.code,
    'GOOGLE_UNAVAILABLE',
  );
});

test('登录尝试按 IP 限频：打满额度后 RATE_LIMITED', opts, async () => {
  // 用 aud 错的凭证刷限频额度：限频在凭证校验之前（照样计数），但不会真建号。
  // 此前用例已占掉部分额度，窗口 20 次/分钟，35 次内必然触发。
  let limited = false;
  for (let i = 0; i < 35; i += 1) {
    const client = await harness.connect();
    const res = await client.call(Op.GOOGLE_LOGIN, {
      credential: harness.makeToken({ sub: `sub-flood-${RUN_ID}-${i}`, aud: 'other-app' }),
    });
    client.close();
    if (res.error?.code === 'RATE_LIMITED') {
      limited = true;
      break;
    }
    assert.equal(res.error?.code, 'GOOGLE_CREDENTIAL_INVALID', '触发限频前应因凭证无效被拒');
  }
  assert.ok(limited, '35 次内应触发限频（窗口 20 次/分钟）');
});
