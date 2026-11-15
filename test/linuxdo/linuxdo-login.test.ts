// Linux.do 一键登录 + 绑定的端到端联调（AISLG-258）：真实 API 进程 + PostgreSQL，Linux.do 接口换成假服务
//（harness.ts，经 LINUXDO_API_BASE 注入），用 WebSocket 客户端扮演「网页」与「Agent」，用 fetch 扮演
// 「Linux.do 跳回来的浏览器」。覆盖登录建号 / 同号 / 改名、资格门槛、取消 / 过期 / 重放、绑定占用、
// Agent 令牌、未配置时整体关闭。GitHub 行为的回归见 test/github。
//
// 运行（必须设置 DATABASE_URL 指向可写的临时库，绝不能是开发库；API 进程会跑迁移）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:17258/slg npm run test:linuxdo
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Client, Op, startHarness, type Harness, type User } from './harness';
import { seedAccount } from '../account-seed';

const API_PORT = 18196;
const DB_URL = process.env.DATABASE_URL;

let harness: Harness;
let disabledHarness: Harness | undefined;

before(async () => {
  if (DB_URL) {
    harness = await startHarness(API_PORT, true);
  }
});

after(() => {
  harness?.stop();
  disabledHarness?.stop();
});

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过 Linux.do 登录联调' };
// 每次运行换一组 Linux.do 用户 id 与用户名：库里留着上一轮的绑定，同一个 id 会串到旧账号
const RUN_NUM = Date.now() % 1_000_000_000;
const idOf = (n: number): number => RUN_NUM * 10 + n;
const nameOf = (who: string): string => `${who}-${RUN_NUM}`;

const trusted = (id: number, username: string): User => ({ id, username, trust_level: 2, active: true, silenced: false });

/** 模拟 Linux.do 授权后跳回浏览器的回调；返回 302 的 Location（fetch 不跟随重定向） */
async function callback(params: Record<string, string>): Promise<{ location: string; cacheControl: string | null }> {
  const res = await fetch(`${harness.httpUrl}/auth/linuxdo/callback?${new URLSearchParams(params)}`, { redirect: 'manual' });
  return { location: res.headers.get('location') ?? '', cacheControl: res.headers.get('cache-control') };
}

/** 解析 302 回前端的查询参数（必须回到前端地址） */
function frontendParams(location: string): URLSearchParams {
  assert.ok(location.startsWith(harness.frontendUrl), `跳回地址应在前端：${location}`);
  return new URL(location).searchParams;
}

/** 发起授权：返回 state，并检查授权地址形态（code 流、只读 user 权限） */
async function startAuth(purpose: 'login' | 'bind', client: Client): Promise<string> {
  const res = await client.call(Op.OAUTH_AUTH_START, { provider: 'linuxdo', purpose });
  assert.ok(res.ok, JSON.stringify(res));
  const authUrl = new URL(String(res.data?.authUrl));
  assert.equal(authUrl.pathname, '/oauth2/authorize');
  assert.equal(authUrl.searchParams.get('response_type'), 'code');
  assert.equal(authUrl.searchParams.get('scope'), 'user');
  const state = authUrl.searchParams.get('state') as string;
  assert.match(state, /^[A-Za-z0-9_-]{20,}$/);
  return state;
}

/** 扮演完整登录：授权 → 回跳（code 对应某个 Linux.do 用户）→ OAUTH_REDEEM → LOGIN */
async function linuxdoLogin(user: User): Promise<{ web: Client; username: string; accountId: string; created: boolean }> {
  const web = await harness.connect();
  const state = await startAuth('login', web);
  const back = await callback({ code: harness.newCode(user), state });
  assert.equal(back.cacheControl, 'no-store', '回跳响应不允许被缓存');
  const code = frontendParams(back.location).get('code');
  assert.ok(code, `回跳应带一次性码：${back.location}`);
  const redeem = await web.call(Op.OAUTH_REDEEM, { code });
  assert.ok(redeem.ok, JSON.stringify(redeem));
  const login = await web.call(Op.LOGIN, { token: redeem.data?.sessionToken, asAgent: false });
  assert.ok(login.ok, JSON.stringify(login));
  return {
    web,
    username: login.data?.username as string,
    accountId: login.data?.accountId as string,
    created: redeem.data?.created as boolean,
  };
}

test('/auth/config 按配置下发 linuxdoEnabled；首次授权自动建号（ld_ 前缀、无密码、初始主城）；同一 Linux.do 再登是同一个号', opts, async () => {
  const config = (await (await fetch(`${harness.httpUrl}/auth/config`)).json()) as { linuxdoEnabled: boolean };
  assert.equal(config.linuxdoEnabled, true);

  const first = await linuxdoLogin(trusted(idOf(1), nameOf('alice')));
  assert.equal(first.created, true);
  assert.match(first.username, /^ld_[0-9a-z]{6}$/);
  const state = await first.web.call(Op.GET_STATE);
  assert.ok(state.ok);
  assert.equal(state.data?.city.name, '主城');

  const second = await linuxdoLogin(trusted(idOf(1), nameOf('alice')));
  assert.equal(second.created, false);
  assert.equal(second.accountId, first.accountId);

  const other = await linuxdoLogin(trusted(idOf(2), nameOf('bob')));
  assert.notEqual(other.accountId, first.accountId);
});

test('改了 Linux.do 用户名仍是同一个号，GET_AGENT_INFO 的 linuxdoLogin 展示新名字', opts, async () => {
  const first = await linuxdoLogin(trusted(idOf(3), nameOf('carol')));
  const renamed = nameOf('carol-new');
  const again = await linuxdoLogin(trusted(idOf(3), renamed));
  assert.equal(again.accountId, first.accountId);
  assert.equal(again.created, false);
  const info = await again.web.call(Op.GET_AGENT_INFO);
  assert.equal(info.data?.linuxdoBound, true);
  assert.equal(info.data?.linuxdoLogin, renamed);
});

test('资格门槛（LINUXDO_MIN_TRUST_LEVEL=2 时）：等级不足 / 禁言 / 未激活回 not_eligible，且不建号', opts, async () => {
  for (const [n, patch] of [[4, { trust_level: 1 }], [5, { silenced: true }], [6, { active: false }]] as const) {
    const user: User = { ...trusted(idOf(n), nameOf(`low${n}`)), ...patch };
    const back = await callback({ code: harness.newCode(user), state: await startAuth('login', await harness.connect()) });
    assert.equal(frontendParams(back.location).get('error'), 'not_eligible', JSON.stringify(patch));
    assert.equal(frontendParams(back.location).get('code'), null, '不得回跳登录码');
  }
  // 达标后同一个 Linux.do 账号才能进：说明前面没有留下半个新号
  const ok = await linuxdoLogin(trusted(idOf(4), nameOf('low4')));
  assert.equal(ok.created, true);
});

test('取消 → canceled 且 state 同时作废；state 重放 → expired；登录码一次性；篡改的码无效', opts, async () => {
  const web = await harness.connect();
  const canceledState = await startAuth('login', web);
  const canceled = await callback({ error: 'access_denied', state: canceledState });
  assert.equal(frontendParams(canceled.location).get('error'), 'canceled');
  const again = await callback({ error: 'access_denied', state: canceledState });
  assert.equal(frontendParams(again.location).get('error'), 'expired');

  const state = await startAuth('login', web);
  const first = await callback({ code: harness.newCode(trusted(idOf(7), nameOf('dave'))), state });
  const code = frontendParams(first.location).get('code') as string;
  const replay = await callback({ code: harness.newCode(trusted(idOf(7), nameOf('dave'))), state });
  assert.equal(frontendParams(replay.location).get('error'), 'expired');

  assert.ok((await web.call(Op.OAUTH_REDEEM, { code })).ok);
  assert.equal((await web.call(Op.OAUTH_REDEEM, { code })).error?.code, 'OAUTH_CODE_INVALID', '一次性码用过即失效');
  assert.equal((await web.call(Op.OAUTH_REDEEM, { code: 'tampered-code' })).error?.code, 'OAUTH_CODE_INVALID');
});

test('不存在的 state、Linux.do 不认的 code 都按 expired 回跳', opts, async () => {
  const unknownState = await callback({ code: 'whatever', state: 'no-such-state' });
  assert.equal(frontendParams(unknownState.location).get('error'), 'expired');
  const state = await startAuth('login', await harness.connect());
  const bad = await callback({ code: 'code-never-issued', state });
  assert.equal(frontendParams(bad.location).get('error'), 'expired');
});

test('绑定：老密码账号发起 bind → bind=ok；linuxdoBound / linuxdoLogin 下发；已绑后再绑拒绝；别的号绑同一身份 → already_bound', opts, async () => {
  const username = `ld_pw_${RUN_NUM}`;
  await seedAccount(username, 'password-123');
  const web = await harness.connect();
  assert.ok((await web.call(Op.LOGIN, { username, password: 'password-123', asAgent: false })).ok);
  const before = await web.call(Op.GET_AGENT_INFO);
  assert.equal(before.data?.linuxdoBound, false);
  assert.equal(before.data?.linuxdoLogin, null);

  const state = await startAuth('bind', web);
  const bound = await callback({ code: harness.newCode(trusted(idOf(8), nameOf('erin'))), state });
  assert.equal(frontendParams(bound.location).get('bind'), 'ok');
  const after = await web.call(Op.GET_AGENT_INFO);
  assert.equal(after.data?.linuxdoBound, true);
  assert.equal(after.data?.linuxdoLogin, nameOf('erin'));

  assert.equal((await web.call(Op.OAUTH_AUTH_START, { provider: 'linuxdo', purpose: 'bind' })).error?.code, 'LINUXDO_ALREADY_BOUND');

  const web2 = await harness.connect();
  const username2 = `ld_pw2_${RUN_NUM}`;
  await seedAccount(username2, 'password-123');
  await web2.call(Op.LOGIN, { username: username2, password: 'password-123', asAgent: false });
  const second = await startAuth('bind', web2);
  const conflict = await callback({ code: harness.newCode(trusted(idOf(8), nameOf('erin'))), state: second });
  assert.equal(frontendParams(conflict.location).get('error'), 'already_bound');

  // 绑定后，用这个 Linux.do 登录进的就是那个老密码账号
  const viaLinuxdo = await linuxdoLogin(trusted(idOf(8), nameOf('erin')));
  assert.equal(viaLinuxdo.username, username);
  assert.equal(viaLinuxdo.created, false);
});

test('纯 Linux.do 账号能拿到永久 Agent 令牌，Agent 用令牌以 agent 身份登录', opts, async () => {
  const { web, username } = await linuxdoLogin(trusted(idOf(9), nameOf('frank')));
  const tokenRes = await web.call(Op.GET_AGENT_TOKEN);
  assert.ok(tokenRes.ok, JSON.stringify(tokenRes));
  const agent = await harness.connect();
  const login = await agent.call(Op.LOGIN, { token: tokenRes.data?.token, asAgent: true });
  assert.ok(login.ok, JSON.stringify(login));
  assert.equal(login.data?.role, 'agent');
  assert.equal(login.data?.username, username);
});

test('权限边界：bind 未登录拒（NOT_LOGGED_IN）；Agent 连接拒（AGENT_FORBIDDEN）；已登录再 login 用途拒（ALREADY_LOGGED_IN）', opts, async () => {
  const anon = await harness.connect();
  assert.equal((await anon.call(Op.OAUTH_AUTH_START, { provider: 'linuxdo', purpose: 'bind' })).error?.code, 'NOT_LOGGED_IN');

  const { web } = await linuxdoLogin(trusted(idOf(10), nameOf('grace')));
  assert.equal((await web.call(Op.OAUTH_AUTH_START, { provider: 'linuxdo', purpose: 'login' })).error?.code, 'ALREADY_LOGGED_IN');

  const tokenRes = await web.call(Op.GET_AGENT_TOKEN);
  const agent = await harness.connect();
  await agent.call(Op.LOGIN, { token: tokenRes.data?.token, asAgent: true });
  assert.equal((await agent.call(Op.OAUTH_AUTH_START, { provider: 'linuxdo', purpose: 'bind' })).error?.code, 'AGENT_FORBIDDEN');
});

test('没配置 Linux.do 时整体关闭：/auth/config 为 false，OAUTH_AUTH_START 返回 LINUXDO_UNAVAILABLE', opts, async () => {
  disabledHarness = await startHarness(API_PORT + 2, false);
  const config = (await (await fetch(`${disabledHarness.httpUrl}/auth/config`)).json()) as { linuxdoEnabled: boolean };
  assert.equal(config.linuxdoEnabled, false);
  const client = await disabledHarness.connect();
  assert.equal((await client.call(Op.OAUTH_AUTH_START, { provider: 'linuxdo', purpose: 'login' })).error?.code, 'LINUXDO_UNAVAILABLE');
});
