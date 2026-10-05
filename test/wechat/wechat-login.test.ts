// 微信扫码登录 + Agent 令牌的端到端联调（docs/wechat-qr-login.md「测试」）：
// 真实的 API 进程 + PostgreSQL，微信接口换成假微信服务（harness.ts，经 WX_API_BASE 注入），
// 用 WebSocket 客户端分别扮演「网页」「微信小游戏」「Agent」跑通完整流程。
//
// 运行（需要 DATABASE_URL 指向可写的 PostgreSQL，建议用临时库，见 test/README.md）：
//   DATABASE_URL=postgresql://slg@127.0.0.1:18999/slg npm run test:wechat
// 没有 DATABASE_URL 时整体跳过。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Op, startHarness, type Client, type Harness } from './harness';
import { seedAccount } from '../account-seed';

const API_PORT = 18090;
const TICKET_TTL_SECONDS = 8;
const AUTH_TIMEOUT_MS = 1000;
const DB_URL = process.env.DATABASE_URL;

let harness: Harness;
const connect = (): Promise<Client> => harness.connect();

before(async () => {
  if (DB_URL) {
    harness = await startHarness({ apiPort: API_PORT, ticketTtlSeconds: TICKET_TTL_SECONDS, authTimeoutMs: AUTH_TIMEOUT_MS });
  }
});

after(() => harness?.stop());

const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过微信扫码联调' };
let codeSeq = 0;
// 每次运行加后缀：库里留着上次跑出的绑定，同名微信才不会串到上一轮的账号
const RUN_ID = Date.now().toString(36);
const newCode = (who: string): string => `wxuser-${who}${RUN_ID}-${++codeSeq}`;

/** 扮演一次完整的「网页生成码 → 小游戏扫码确认 → 网页拿到令牌并登录」；返回登录后的网页连接与相关信息 */
async function wechatLogin(who: string): Promise<{ web: Client; username: string; accountId: string; scanAccountName: unknown }> {
  const web = await connect();
  const created = await web.call(Op.WX_QR_CREATE, { purpose: 'login' });
  assert.ok(created.ok, JSON.stringify(created));
  const { ticket, qrImage } = created.data as { ticket: string; qrImage: string };
  assert.match(qrImage, /^data:image\/(png|jpeg);base64,/);
  assert.ok(harness.scenes.includes(ticket), '二维码的 scene 就是 ticket');

  const phone = await connect();
  const scanned = await phone.call(Op.WX_SCAN, { ticket, code: newCode(who) });
  assert.ok(scanned.ok, JSON.stringify(scanned));
  await web.waitPush((f) => f.op === Op.PUSH_WX_QR_STATUS && f.data?.status === 'scanned');
  const confirmed = await phone.call(Op.WX_CONFIRM, { ticket });
  assert.ok(confirmed.ok, JSON.stringify(confirmed));
  const push = await web.waitPush((f) => f.op === Op.PUSH_WX_QR_STATUS && f.data?.status === 'confirmed');
  const sessionToken = push.data?.sessionToken as string;
  assert.match(sessionToken, /^[A-Za-z0-9_-]{43}$/);

  const login = await web.call(Op.LOGIN, { token: sessionToken, asAgent: false });
  assert.ok(login.ok, JSON.stringify(login));
  phone.close();
  return { web, username: login.data?.username, accountId: login.data?.accountId, scanAccountName: scanned.data?.accountName };
}

test('首次扫码自动建号：随机用户名、带初始城池；同一个微信再扫登录同一账号', opts, async () => {
  const first = await wechatLogin('alice');
  assert.equal(first.scanAccountName, null, '没绑定过：确认页显示将创建新账号');
  assert.match(first.username, /^wx_[0-9a-z]{6}$/);
  const state = await first.web.call(Op.GET_STATE);
  assert.ok(state.ok);
  assert.equal(state.data?.city.name, '主城');
  assert.equal(state.data?.city.levels.government, 1);

  const second = await wechatLogin('alice');
  assert.equal(second.scanAccountName, first.username, '已绑定：确认页显示将登录哪个账号');
  assert.equal(second.accountId, first.accountId);

  const other = await wechatLogin('bob');
  assert.notEqual(other.accountId, first.accountId);
});

test('纯微信账号不能用密码登录（也不能首次设密码占号）', opts, async () => {
  const { username } = await wechatLogin('carol');
  const player = await connect();
  assert.equal((await player.call(Op.LOGIN, { username, password: 'try-to-take-over-1', asAgent: false })).error?.code, 'INVALID_CREDENTIALS');
  // v47：Agent 一律不能用账号密码登录（改用永久令牌）
  const agent = await connect();
  assert.equal((await agent.call(Op.LOGIN, { username, password: 'try-to-take-over-1', asAgent: true })).error?.code, 'AGENT_PASSWORD_FORBIDDEN');
});

test('等扫码期间未登录连接不会被 15 秒（此处 1 秒）登录超时断开', opts, async () => {
  // 对照：没生成码的未登录连接到点被断开
  const idle = await connect();
  assert.equal(await idle.waitClose(AUTH_TIMEOUT_MS + 3000), 4001);

  const web = await connect();
  const created = await web.call(Op.WX_QR_CREATE, { purpose: 'login' });
  await new Promise((r) => setTimeout(r, AUTH_TIMEOUT_MS + 1500));
  assert.equal(web.isOpen, true, '生成码后网页连接的登录超时被延长到 ticket 过期之后');
  // 扫码后小游戏连接同样要活到玩家点确认（ticket 8 秒有效，此处在第 5 秒左右确认）
  const phone = await connect();
  const { ticket } = created.data as { ticket: string };
  assert.ok((await phone.call(Op.WX_SCAN, { ticket, code: newCode('dave') })).ok);
  await new Promise((r) => setTimeout(r, AUTH_TIMEOUT_MS + 1500));
  assert.equal(phone.isOpen, true);
  assert.ok((await phone.call(Op.WX_CONFIRM, { ticket })).ok);
});

test('取消：网页收到 canceled，ticket 作废', opts, async () => {
  const web = await connect();
  const { ticket } = (await web.call(Op.WX_QR_CREATE, { purpose: 'login' })).data as { ticket: string };
  const phone = await connect();
  await phone.call(Op.WX_SCAN, { ticket, code: newCode('erin') });
  assert.ok((await phone.call(Op.WX_CANCEL, { ticket })).ok);
  await web.waitPush((f) => f.data?.status === 'canceled');
  assert.equal((await phone.call(Op.WX_CONFIRM, { ticket })).error?.code, 'WX_TICKET_INVALID');
});

test('小游戏连接在确认前断开：网页收到 canceled', opts, async () => {
  const web = await connect();
  const { ticket } = (await web.call(Op.WX_QR_CREATE, { purpose: 'login' })).data as { ticket: string };
  const phone = await connect();
  await phone.call(Op.WX_SCAN, { ticket, code: newCode('frank') });
  phone.close();
  await web.waitPush((f) => f.data?.status === 'canceled', 5000);
});

test('一次性与防冒用：重复扫、换连接确认、code 重用都被拒', opts, async () => {
  const web = await connect();
  const { ticket } = (await web.call(Op.WX_QR_CREATE, { purpose: 'login' })).data as { ticket: string };
  const phoneA = await connect();
  const phoneB = await connect();
  const code = newCode('gina');
  assert.ok((await phoneA.call(Op.WX_SCAN, { ticket, code })).ok);
  assert.equal((await phoneB.call(Op.WX_SCAN, { ticket, code: newCode('hank') })).error?.code, 'WX_TICKET_INVALID');
  assert.equal((await phoneB.call(Op.WX_CONFIRM, { ticket })).error?.code, 'WX_TICKET_INVALID');
  assert.ok((await phoneA.call(Op.WX_CONFIRM, { ticket })).ok);
  assert.equal((await phoneA.call(Op.WX_CONFIRM, { ticket })).error?.code, 'WX_TICKET_INVALID', '确认后 ticket 作废');

  // 同一个 wx.login code 不能换第二次 openid（微信 40163）
  const web2 = await connect();
  const second = (await web2.call(Op.WX_QR_CREATE, { purpose: 'login' })).data as { ticket: string };
  assert.equal((await phoneB.call(Op.WX_SCAN, { ticket: second.ticket, code })).error?.code, 'WX_CODE_INVALID');
});

test('ticket 到期：网页收到 expired，之后扫码 / 确认无效', opts, async () => {
  const web = await connect();
  const { ticket } = (await web.call(Op.WX_QR_CREATE, { purpose: 'login' })).data as { ticket: string };
  await web.waitPush((f) => f.data?.status === 'expired', (TICKET_TTL_SECONDS + 8) * 1000);
  const phone = await connect();
  assert.equal((await phone.call(Op.WX_SCAN, { ticket, code: newCode('ivy') })).error?.code, 'WX_TICKET_INVALID');
});

test('绑定微信：老账号登录后 bind 扫码；已绑定再绑 / 微信已被占用都返回 WX_ALREADY_BOUND', opts, async () => {
  const username = `pw_${Date.now()}`;
  await seedAccount(username, 'password-123'); // v48 起密码通道不再自动注册，先直插预建
  const web = await connect();
  const reg = await web.call(Op.LOGIN, { username, password: 'password-123', asAgent: false });
  assert.ok(reg.ok, JSON.stringify(reg));
  assert.equal((await web.call(Op.GET_AGENT_INFO)).data?.wechatBound, false);

  const created = await web.call(Op.WX_QR_CREATE, { purpose: 'bind' });
  assert.ok(created.ok, JSON.stringify(created));
  const { ticket } = created.data as { ticket: string };
  const phone = await connect();
  const scanned = await phone.call(Op.WX_SCAN, { ticket, code: newCode('jack') });
  assert.equal(scanned.data?.purpose, 'bind');
  assert.equal(scanned.data?.accountName, username);
  assert.ok((await phone.call(Op.WX_CONFIRM, { ticket })).ok);
  const push = await web.waitPush((f) => f.data?.status === 'confirmed');
  assert.equal(push.data?.bound, true);
  assert.equal(push.data?.sessionToken, undefined);
  assert.equal((await web.call(Op.GET_AGENT_INFO)).data?.wechatBound, true);

  // 该账号已绑定：再要 bind 码直接拒
  assert.equal((await web.call(Op.WX_QR_CREATE, { purpose: 'bind' })).error?.code, 'WX_ALREADY_BOUND');

  // 另一个账号想绑同一个微信：扫码阶段就拒
  const web2 = await connect();
  const username2 = `pw2_${Date.now()}`;
  await seedAccount(username2, 'password-123');
  await web2.call(Op.LOGIN, { username: username2, password: 'password-123', asAgent: false });
  const t2 = (await web2.call(Op.WX_QR_CREATE, { purpose: 'bind' })).data as { ticket: string };
  assert.equal((await phone.call(Op.WX_SCAN, { ticket: t2.ticket, code: newCode('jack') })).error?.code, 'WX_ALREADY_BOUND');

  // 绑定后，用这个微信扫码登录进的就是该密码账号
  const viaWechat = await wechatLogin('jack');
  assert.equal(viaWechat.username, username);
});

test('永久 Agent 令牌：查看（自动补生成）→ Agent 登录 → 重置换新并断开旧连接', opts, async () => {
  // 老账号（v46 之前注册）没有令牌：第一次 GET_AGENT_TOKEN 自动补生成，且之后保持同一枚
  const username = `pw_${Date.now()}`;
  await seedAccount(username, 'password-123'); // v48 起密码通道不再自动注册，先直插预建
  const web = await connect();
  assert.ok((await web.call(Op.LOGIN, { username, password: 'password-123', asAgent: false })).ok);
  const first = await web.call(Op.GET_AGENT_TOKEN);
  assert.ok(first.ok, JSON.stringify(first));
  const token = first.data?.token as string;
  assert.match(token, /^sk_[A-Za-z0-9_-]{43}$/);
  assert.equal(first.data?.lastUsedAt, null, '还没用过');
  const again = await web.call(Op.GET_AGENT_TOKEN);
  assert.equal(again.data?.token, token, '每号一枚，重复查看是同一个');
  assert.equal((await web.call(Op.GET_AGENT_INFO)).data?.agentTokens, undefined, '令牌不进 GET_AGENT_INFO');

  // Agent 用令牌登录；登录后 lastUsedAt 有值
  const agent = await connect();
  const login = await agent.call(Op.LOGIN, { token, asAgent: true });
  assert.ok(login.ok, JSON.stringify(login));
  assert.equal(login.data?.role, 'agent');
  assert.equal(login.data?.username, username);
  assert.equal(login.data?.expiresAt, null, '永久令牌不过期');
  const used = await web.call(Op.GET_AGENT_TOKEN);
  assert.notEqual(used.data?.lastUsedAt, null);

  // Agent 连接不能查看、也不能重置令牌
  assert.equal((await agent.call(Op.GET_AGENT_TOKEN)).error?.code, 'AGENT_FORBIDDEN');
  assert.equal((await agent.call(Op.RESET_AGENT_TOKEN)).error?.code, 'AGENT_FORBIDDEN');

  // 重置：旧令牌立即失效，用旧令牌在线的 Agent 被断开（close 4003），新令牌可登录
  const reset = await web.call(Op.RESET_AGENT_TOKEN);
  assert.ok(reset.ok, JSON.stringify(reset));
  const fresh = reset.data?.token as string;
  assert.match(fresh, /^sk_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(fresh, token);
  assert.equal(await agent.waitClose(), 4003, '重置断开旧令牌的在线连接');
  const retry = await connect();
  assert.equal((await retry.call(Op.LOGIN, { token, asAgent: true })).error?.code, 'SESSION_INVALID');
  const relogin = await retry.call(Op.LOGIN, { token: fresh, asAgent: true });
  assert.ok(relogin.ok, JSON.stringify(relogin));
  // 浏览器 LOGOUT 用永久令牌登录的连接：只断开、不吊销（令牌仍可登录）
  const browser = await connect();
  assert.ok((await browser.call(Op.LOGIN, { token: fresh, asAgent: false })).ok);
  assert.ok((await browser.call(Op.LOGOUT)).ok);
  assert.equal(await browser.waitClose(), 1000);
  const afterLogout = await connect();
  assert.ok((await afterLogout.call(Op.LOGIN, { token: fresh, asAgent: true })).ok, 'LOGOUT 不吊销永久令牌');
});

test('新账号建号即有令牌：扫码建号后直接可查可用', opts, async () => {
  const { web } = await wechatLogin('tokened');
  const res = await web.call(Op.GET_AGENT_TOKEN);
  assert.ok(res.ok, JSON.stringify(res));
  assert.match(res.data?.token as string, /^sk_[A-Za-z0-9_-]{43}$/);
  const agent = await connect();
  assert.ok((await agent.call(Op.LOGIN, { token: res.data?.token, asAgent: true })).ok);
});

test('登录前的其他协议仍被拒；换码会作废旧码', opts, async () => {
  const web = await connect();
  assert.equal((await web.call(Op.GET_STATE)).error?.code, 'NOT_LOGGED_IN');
  assert.equal((await web.call(Op.GET_AGENT_TOKEN)).error?.code, 'NOT_LOGGED_IN');
  const first = (await web.call(Op.WX_QR_CREATE, { purpose: 'login' })).data as { ticket: string };
  const second = (await web.call(Op.WX_QR_CREATE, { purpose: 'login' })).data as { ticket: string };
  const phone = await connect();
  assert.equal((await phone.call(Op.WX_SCAN, { ticket: first.ticket, code: newCode('lee') })).error?.code, 'WX_TICKET_INVALID');
  assert.ok((await phone.call(Op.WX_SCAN, { ticket: second.ticket, code: newCode('lee') })).ok);
});
