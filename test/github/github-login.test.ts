// GitHub 一键登录 + 绑定的端到端联调（AISLG-128）：真实 API 进程 + PostgreSQL，
// GitHub 接口换成假服务（harness.ts，经 GITHUB_API_BASE 注入），用 WebSocket 客户端扮演
// 「网页」与「Agent」、用 fetch 扮演「GitHub 跳回来的浏览器」跑通完整流程。
//
// 运行（需要 DATABASE_URL 指向可写的 PostgreSQL，建议用临时库，见 test/README.md）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:18999/slg npm run test:github
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client, Op, startHarness, type Harness } from './harness';
import { seedAccount } from '../account-seed';

/** 带 Host 头的 GET（undici 的 fetch 会无视自定义 Host，只能走原生 http） */
function getJson(url: string, host: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    http.get(url, { headers: { Host: host } }, (res) => {
      let body = '';
      res.on('data', (chunk) => (body += chunk));
      res.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
}

const API_PORT = 18096;
const FRONTEND_PORT = 18097;
const DB_URL = process.env.DATABASE_URL;

let harness: Harness;
let disabledHarness: Harness;

before(async () => {
  if (DB_URL) {
    harness = await startHarness({ apiPort: API_PORT, frontendPort: FRONTEND_PORT });
  }
});

after(() => {
  harness?.stop();
  disabledHarness?.stop();
});

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过 GitHub 登录联调' };
// 每次运行加后缀：库里留着上次跑出的绑定，同一个 GitHub 用户才不会串到上一轮的账号
const RUN_ID = Date.now().toString(36);
const userOf = (who: string): string => `${who}-${RUN_ID}`;

/** 模拟 GitHub 授权后跳回浏览器的回调；返回 302 的 Location（fetch 不跟随重定向） */
async function callback(params: Record<string, string>): Promise<{ status: number; location: string | null; cacheControl: string | null }> {
  const search = new URLSearchParams(params);
  const res = await fetch(`${harness.httpUrl}/auth/github/callback?${search}`, { redirect: 'manual' });
  return {
    status: res.status,
    location: res.headers.get('location'),
    cacheControl: res.headers.get('cache-control'),
  };
}

/** 解析 302 回前端的查询参数 */
function frontendParams(location: string): URLSearchParams {
  assert.ok(location, '缺少 Location');
  const knownFrontends = [harness.frontendUrl, ...Object.values(harness.sites).map((s) => s.frontendUrl)];
  assert.ok(knownFrontends.some((f) => location.startsWith(f)), `跳回地址应在前端：${location}`);
  return new URL(location).searchParams;
}

/** 从 GITHUB_AUTH_START 的响应拿 state */
async function startAuth(purpose: 'login' | 'bind', client = harness.connect()): Promise<{ state: string; authUrl: string }> {
  const conn = await client;
  const res = await conn.call(Op.GITHUB_AUTH_START, { purpose });
  assert.ok(res.ok, JSON.stringify(res));
  const authUrl = res.data?.authUrl as string;
  const state = new URL(authUrl).searchParams.get('state') as string;
  assert.match(state, /^[A-Za-z0-9_-]{20,}$/);
  return { state, authUrl };
}

/** 扮演完整登录：发起授权 → GitHub 回跳（code 对应某个 GitHub 用户）→ 拿一次性码兑换并登录 */
async function githubLogin(who: string): Promise<{ web: Client; username: string; accountId: string; created: boolean }> {
  const web = await harness.connect();
  const { state, authUrl } = await startAuth('login', web);
  const authorizeUrl = new URL(authUrl);
  assert.equal(authorizeUrl.pathname, '/login/oauth/authorize', '授权地址形态');
  assert.equal(authorizeUrl.searchParams.get('scope'), null, '不带 scope：只读公开资料');
  const back = await callback({ code: harness.newCode(userOf(who)), state });
  const params = frontendParams(back.location as string);
  const code = params.get('code');
  assert.ok(code, '回跳应带一次性码');
  assert.equal(back.cacheControl, 'no-store', '回跳响应不允许被缓存');
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

test('首次 GitHub 授权自动建号（随机用户名 gh_、初始城池）；同一 GitHub 再登是同一个号', opts, async () => {
  const first = await githubLogin('alice');
  assert.equal(first.created, true);
  assert.match(first.username, /^gh_[0-9a-z]{6}$/);
  const state = await first.web.call(Op.GET_STATE);
  assert.ok(state.ok);
  assert.equal(state.data?.city.name, '主城');
  assert.equal(state.data?.city.levels.government, 1);

  const second = await githubLogin('alice');
  assert.equal(second.created, false);
  assert.equal(second.accountId, first.accountId);

  const other = await githubLogin('bob');
  assert.notEqual(other.accountId, first.accountId);
});

test('纯 GitHub 账号不能用密码登录', opts, async () => {
  const { username } = await githubLogin('carol');
  const player = await harness.connect();
  assert.equal((await player.call(Op.LOGIN, { username, password: 'try-to-take-over-1', asAgent: false })).error?.code, 'INVALID_CREDENTIALS');
  // v47：Agent 一律不能用账号密码登录（改用永久令牌）
  const agent = await harness.connect();
  assert.equal((await agent.call(Op.LOGIN, { username, password: 'try-to-take-over-1', asAgent: true })).error?.code, 'AGENT_PASSWORD_FORBIDDEN');
});

test('state 一次性：同一 state 二次回跳 error=expired；登录码一次性：重放 OAUTH_CODE_INVALID', opts, async () => {
  const web = await harness.connect();
  const { state } = await startAuth('login', web);
  const first = await callback({ code: harness.newCode(userOf('dave')), state });
  const code = frontendParams(first.location as string).get('code') as string;

  // 同一 state 再回跳（重放 / 篡改）：expired
  const replay = await callback({ code: harness.newCode(userOf('dave')), state });
  assert.equal(frontendParams(replay.location as string).get('error'), 'expired');

  // 一次性码只能兑换一次：第二次 OAUTH_CODE_INVALID（刷新页面重放地址栏旧码的场景）
  assert.ok((await web.call(Op.OAUTH_REDEEM, { code })).ok);
  assert.equal((await web.call(Op.OAUTH_REDEEM, { code })).error?.code, 'OAUTH_CODE_INVALID');
  // 篡改的码同样无效
  assert.equal((await web.call(Op.OAUTH_REDEEM, { code: 'tampered-code' })).error?.code, 'OAUTH_CODE_INVALID');
});

test('不存在的 state / 无效 code（GitHub 报 bad_verification_code）都按 expired 回跳', opts, async () => {
  const unknownState = await callback({ code: 'whatever', state: 'no-such-state' });
  assert.equal(frontendParams(unknownState.location as string).get('error'), 'expired');

  const web = await harness.connect();
  const { state } = await startAuth('login', web);
  const bad = await callback({ code: 'code-never-issued', state });
  assert.equal(frontendParams(bad.location as string).get('error'), 'expired');
});

test('玩家在 GitHub 点取消：error=canceled 回跳，state 同时作废', opts, async () => {
  const { state } = await startAuth('login');
  const canceled = await callback({ error: 'access_denied', state });
  assert.equal(frontendParams(canceled.location as string).get('error'), 'canceled');
  // 取消后 state 已被消耗：再用按 expired
  const again = await callback({ error: 'access_denied', state });
  assert.equal(frontendParams(again.location as string).get('error'), 'expired');
});

test('绑定 GitHub：老账号发起 bind 授权 → bind=ok；githubBound / githubLogin 下发；冲突场景 already_bound', opts, async () => {
  const username = `pw_${Date.now()}`;
  await seedAccount(username, 'password-123'); // v48 起密码通道不再自动注册，先直插预建
  const web = await harness.connect();
  assert.ok((await web.call(Op.LOGIN, { username, password: 'password-123', asAgent: false })).ok);
  const before = await web.call(Op.GET_AGENT_INFO);
  assert.equal(before.data?.githubBound, false);
  assert.equal(before.data?.githubLogin, null);

  const { state } = await startAuth('bind', web);
  const back = await callback({ code: harness.newCode(userOf('erin')), state });
  const params = frontendParams(back.location as string);
  assert.equal(params.get('bind'), 'ok');

  const after = await web.call(Op.GET_AGENT_INFO);
  assert.equal(after.data?.githubBound, true);
  assert.equal(after.data?.githubLogin, userOf('erin'));

  // 该账号已绑定：再发起 bind 直接拒（GITHUB_ALREADY_BOUND）
  assert.equal((await web.call(Op.GITHUB_AUTH_START, { purpose: 'bind' })).error?.code, 'GITHUB_ALREADY_BOUND');

  // 另一个账号绑同一个 GitHub：发起时该账号没绑（通过），回跳时被占用 → already_bound
  const web2 = await harness.connect();
  const username2 = `pw2_${Date.now()}`;
  await seedAccount(username2, 'password-123');
  await web2.call(Op.LOGIN, { username: username2, password: 'password-123', asAgent: false });
  const second = await startAuth('bind', web2);
  const conflict = await callback({ code: harness.newCode(userOf('erin')), state: second.state });
  assert.equal(frontendParams(conflict.location as string).get('error'), 'already_bound');

  // 绑定后，用这个 GitHub 登录进的就是该密码账号
  const viaGithub = await githubLogin('erin');
  assert.equal(viaGithub.username, username);
  assert.equal(viaGithub.created, false);
});

test('权限边界：bind 登录前拒 / Agent 连接拒；login 用途已登录连接拒；OAUTH_REDEEM 已登录拒', opts, async () => {
  const anon = await harness.connect();
  assert.equal((await anon.call(Op.GITHUB_AUTH_START, { purpose: 'bind' })).error?.code, 'NOT_LOGGED_IN');

  const { web } = await githubLogin('frank');
  assert.equal((await web.call(Op.GITHUB_AUTH_START, { purpose: 'login' })).error?.code, 'ALREADY_LOGGED_IN');
  assert.equal((await web.call(Op.OAUTH_REDEEM, { code: 'whatever' })).error?.code, 'ALREADY_LOGGED_IN');

  const tokenRes = await web.call(Op.GET_AGENT_TOKEN);
  assert.ok(tokenRes.ok);
  const agent = await harness.connect();
  await agent.call(Op.LOGIN, { token: tokenRes.data?.token, asAgent: true });
  assert.equal((await agent.call(Op.GITHUB_AUTH_START, { purpose: 'bind' })).error?.code, 'AGENT_FORBIDDEN');
});

test('纯 GitHub 账号能查看永久 Agent 令牌，Agent 用令牌以 agent 身份登录', opts, async () => {
  const { web, username } = await githubLogin('kate');
  const tokenRes = await web.call(Op.GET_AGENT_TOKEN);
  assert.ok(tokenRes.ok, JSON.stringify(tokenRes));
  const agent = await harness.connect();
  const login = await agent.call(Op.LOGIN, { token: tokenRes.data?.token, asAgent: true });
  assert.ok(login.ok, JSON.stringify(login));
  assert.equal(login.data?.role, 'agent');
  assert.equal(login.data?.username, username);
});

test('没配置 GitHub 时整体关闭：GITHUB_AUTH_START / OAUTH_REDEEM 返回 GITHUB_UNAVAILABLE，/auth/config 为 false', opts, async () => {
  const config = await (await fetch(`${harness.httpUrl}/auth/config`)).json();
  assert.equal(config.githubEnabled, true);

  disabledHarness = await startHarness({ apiPort: API_PORT + 2, frontendPort: FRONTEND_PORT + 2, githubEnabled: false });
  const disabledConfig = await (await fetch(`${disabledHarness.httpUrl}/auth/config`)).json();
  assert.equal(disabledConfig.githubEnabled, false);
  const client = await disabledHarness.connect();
  assert.equal((await client.call(Op.GITHUB_AUTH_START, { purpose: 'login' })).error?.code, 'GITHUB_UNAVAILABLE');
  assert.equal((await client.call(Op.OAUTH_REDEEM, { code: 'x' })).error?.code, 'GITHUB_UNAVAILABLE');
});

test('双站点（v47）：国际站 Host 拒密码登录，GitHub 授权与回跳按站点选套', opts, async () => {
  // 国际站（PASSWORD_LOGIN_DISABLED_HOSTS 列出的 Host）：绕过界面直发密码登录也被拒
  const intl = await Client.connectWithHost(harness.apiPort, 'cc.test');
  const denied = await intl.call(Op.LOGIN, { username: `intl_${Date.now()}`, password: 'password-123', asAgent: false });
  assert.equal(denied.error?.code, 'PASSWORD_LOGIN_CLOSED');
  // Agent 密码登录的拦截在国际站拦截之前（Agent 拒绝是全站规则）
  const deniedAgent = await intl.call(Op.LOGIN, { username: `intl2_${Date.now()}`, password: 'password-123', asAgent: true });
  assert.equal(deniedAgent.error?.code, 'AGENT_PASSWORD_FORBIDDEN');

  // /auth/config 按请求 Host 下发：国际站无密码表单；两站 GitHub 都可用
  const intlConfig = await getJson(`${harness.httpUrl}/auth/config`, 'cc.test');
  assert.equal(intlConfig.passwordLogin, false);
  assert.equal(intlConfig.githubEnabled, true);
  const cnConfig = await getJson(`${harness.httpUrl}/auth/config`, 'cn.test');
  assert.equal(cnConfig.passwordLogin, true);

  // GITHUB_AUTH_START 按连接 Host 选套：clientId 不同
  const intlStart = await intl.call(Op.GITHUB_AUTH_START, { purpose: 'login' });
  assert.ok(intlStart.ok, JSON.stringify(intlStart));
  assert.ok(String(intlStart.data?.authUrl).includes('client_id=gh-cc-site'), '国际站用 cc 套的 OAuth App');
  const cn = await Client.connectWithHost(harness.apiPort, 'cn.test');
  const cnStart = await cn.call(Op.GITHUB_AUTH_START, { purpose: 'login' });
  assert.ok(String(cnStart.data?.authUrl).includes('client_id=gh-cn-site'), '国内站用 cn 套的 OAuth App');

  // 国内站密码登录照常（同一进程、另一个 Host；v48 起要有已有账号）
  const cnUsername = `cn_${Date.now()}`;
  await seedAccount(cnUsername, 'password-123');
  const cnLogin = await cn.call(Op.LOGIN, { username: cnUsername, password: 'password-123', asAgent: false });
  assert.ok(cnLogin.ok, JSON.stringify(cnLogin));

  // 回跳按 state 里的站点跳回对应前端：国际站的授权回到 cc 套的 frontendUrl
  const intlState = new URL(String(intlStart.data?.authUrl)).searchParams.get('state') as string;
  const back = await callback({ code: harness.newCode(`site-${RUN_ID}`), state: intlState });
  assert.ok(String(back.location).startsWith(harness.sites['cc.test'].frontendUrl), `回国际站前端：${back.location}`);
  const code = frontendParams(back.location as string).get('code') as string;
  assert.ok((await intl.call(Op.OAUTH_REDEEM, { code })).ok, '国际站回跳的一次性码可兑换');
});
