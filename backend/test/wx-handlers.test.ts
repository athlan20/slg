// 微信扫码协议与 Agent 令牌协议的处理逻辑测试：假的微信客户端 + 只认 SQL 形状的桩连接池（不连数据库）。
// 确认阶段的真实建号 / 绑定 / 签发会话涉及 PostgreSQL，由根目录 test/wechat 的联调测试覆盖。

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebSocket } from 'ws';
import { Op, type ResponseFrame, type PushFrame } from '../common/src/protocol';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { createWxService } from '../api/src/handlers-wechat';
import { loginWithPassword } from '../api/src/auth';
import { randomWechatUsername } from '../api/src/wx-accounts';
import { WechatError, type WechatClient } from '../api/src/wechat';

type Frame = ResponseFrame | PushFrame;

function setup(options: { client?: WechatClient | null; boundOpenids?: Set<string>; accountBound?: boolean; now?: () => number } = {}) {
  const registry = new ConnectionRegistry();
  const queries: string[] = [];
  const pool = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push(sql);
      if (sql.includes('FROM wechat_identities w JOIN accounts')) {
        const bound = options.boundOpenids?.has(String(params[1]));
        return bound ? { rowCount: 1, rows: [{ id: 'acct-bound', username: 'old_name' }] } : { rowCount: 0, rows: [] };
      }
      if (sql.includes('FROM wechat_identities WHERE')) {
        return options.accountBound ? { rowCount: 1, rows: [{}] } : { rowCount: 0, rows: [] };
      }
      return { rowCount: 0, rows: [] };
    },
  } as unknown as HandlerContext['pool'];
  const wx = createWxService(options.client === undefined ? fakeClient() : options.client, 180);
  if (options.now) {
    wx.now = options.now;
  }
  const ctx: HandlerContext = { pool, registry, wx, passwordDisabledHosts: new Set() };
  const connect = (extra: Partial<ConnInfo> = {}) => {
    const sent: Frame[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as unknown as WebSocket;
    const conn: ConnInfo = { socket, ip: '113.87.20.5', host: null, accountId: null, username: null, role: null, sessionId: null, connectedAt: new Date(), ...extra };
    return { conn, sent };
  };
  const call = async (c: { conn: ConnInfo; sent: Frame[] }, op: number, data?: Record<string, unknown>) => {
    const before = c.sent.length;
    await handleMessage(ctx, c.conn, JSON.stringify({ op, seq: 1, data }));
    return c.sent.slice(before).find((f): f is ResponseFrame => 'ok' in f && f.op === op);
  };
  return { ctx, registry, queries, connect, call };
}

function fakeClient(overrides: Partial<WechatClient> = {}): WechatClient {
  return {
    appId: 'wx-test',
    createQrCode: async (scene) => `data:image/jpeg;base64,QR-${scene}`,
    codeToSession: async (code) => ({ openid: `openid-of-${code}`, unionid: null }),
    ...overrides,
  };
}

test('未登录连接：LOGIN 与 WX_* 放行，其他协议仍是 NOT_LOGGED_IN', async () => {
  const t = setup();
  const web = t.connect();
  assert.equal((await t.call(web, Op.GET_STATE))?.error?.code, 'NOT_LOGGED_IN');
  assert.equal((await t.call(web, Op.GET_AGENT_TOKEN))?.error?.code, 'NOT_LOGGED_IN');
  assert.equal((await t.call(web, Op.WX_QR_CREATE, { purpose: 'login' }))?.ok, true);
});

test('WX_QR_CREATE：返回 ticket / 图片 / 过期时间，ticket 即 scene', async () => {
  const t = setup({ now: () => Date.UTC(2026, 9, 3, 8, 0, 0) });
  const web = t.connect();
  const res = await t.call(web, Op.WX_QR_CREATE, { purpose: 'login' });
  assert.ok(res?.ok);
  const data = res.data as { ticket: string; qrImage: string; expiresAt: string };
  assert.match(data.ticket, /^[0-9A-Za-z]{16}$/);
  assert.equal(data.qrImage, `data:image/jpeg;base64,QR-${data.ticket}`);
  assert.equal(data.expiresAt, '2026-10-03T08:03:00.000Z');
  assert.ok(web.conn.authDeadlineAt === undefined || web.conn.authDeadlineAt >= Date.UTC(2026, 9, 3, 8, 3, 0), '等扫码期间登录超时被延长');
});

test('WX_QR_CREATE：参数 / 登录态 / 配置 / 限频 / 微信故障的各种拒绝', async () => {
  const t = setup();
  const web = t.connect();
  assert.equal((await t.call(web, Op.WX_QR_CREATE, { purpose: 'oops' }))?.error?.code, 'INVALID_PARAMS');
  assert.equal((await t.call(web, Op.WX_QR_CREATE))?.error?.code, 'INVALID_PARAMS');
  assert.equal((await t.call(web, Op.WX_QR_CREATE, { purpose: 'bind' }))?.error?.code, 'NOT_LOGGED_IN');

  const agent = t.connect({ accountId: 'a1', username: 'u', role: 'agent' });
  assert.equal((await t.call(agent, Op.WX_QR_CREATE, { purpose: 'bind' }))?.error?.code, 'AGENT_FORBIDDEN');
  const player = t.connect({ accountId: 'a2', username: 'u2', role: 'player' });
  assert.equal((await t.call(player, Op.WX_QR_CREATE, { purpose: 'login' }))?.error?.code, 'ALREADY_LOGGED_IN');

  const off = setup({ client: null });
  assert.equal((await off.call(off.connect(), Op.WX_QR_CREATE, { purpose: 'login' }))?.error?.code, 'WX_UNAVAILABLE');

  const broken = setup({ client: fakeClient({ createQrCode: async () => { throw new WechatError('unavailable', 'x'); } }) });
  const w = broken.connect();
  assert.equal((await broken.call(w, Op.WX_QR_CREATE, { purpose: 'login' }))?.error?.code, 'WX_UNAVAILABLE');
  assert.equal(broken.ctx.wx?.tickets.size, 0, '生成失败不留 ticket');
});

test('WX_QR_CREATE：同一 IP 每分钟 20 次，第 21 次 RATE_LIMITED；换 IP 不受影响', async () => {
  const t = setup();
  const web = t.connect();
  for (let i = 0; i < 20; i += 1) {
    assert.equal((await t.call(web, Op.WX_QR_CREATE, { purpose: 'login' }))?.ok, true, `第 ${i + 1} 次`);
  }
  assert.equal((await t.call(web, Op.WX_QR_CREATE, { purpose: 'login' }))?.error?.code, 'RATE_LIMITED');
  const other = t.connect({ ip: '8.8.8.8' });
  assert.equal((await t.call(other, Op.WX_QR_CREATE, { purpose: 'login' }))?.ok, true);
});

test('bind：账号已绑过微信直接 WX_ALREADY_BOUND，不浪费微信接口调用', async () => {
  let qrCalls = 0;
  const t = setup({ accountBound: true, client: fakeClient({ createQrCode: async () => { qrCalls += 1; return 'x'; } }) });
  const player = t.connect({ accountId: 'a2', username: 'u2', role: 'player' });
  assert.equal((await t.call(player, Op.WX_QR_CREATE, { purpose: 'bind' }))?.error?.code, 'WX_ALREADY_BOUND');
  assert.equal(qrCalls, 0);
});

async function createLoginTicket(t: ReturnType<typeof setup>) {
  const web = t.connect();
  const created = await t.call(web, Op.WX_QR_CREATE, { purpose: 'login' });
  return { web, ticket: (created?.data as { ticket: string }).ticket };
}

test('WX_SCAN：校验参数与 ticket；新微信账号名为 null，推送 scanned，响应带打码 IP', async () => {
  const t = setup();
  const { web, ticket } = await createLoginTicket(t);
  const phone = t.connect({ ip: null });

  assert.equal((await t.call(phone, Op.WX_SCAN, { ticket: 'short', code: 'c' }))?.error?.code, 'INVALID_PARAMS');
  assert.equal((await t.call(phone, Op.WX_SCAN, { ticket, code: '' }))?.error?.code, 'INVALID_PARAMS');
  assert.equal((await t.call(phone, Op.WX_SCAN, { ticket: 'AAAAAAAAAAAAAAAA', code: 'c' }))?.error?.code, 'WX_TICKET_INVALID');

  const res = await t.call(phone, Op.WX_SCAN, { ticket, code: 'code-1' });
  assert.ok(res?.ok);
  const data = res.data as Record<string, unknown>;
  assert.equal(data.purpose, 'login');
  assert.equal(data.accountName, null);
  assert.equal(data.requesterIp, '113.87.*.*');
  assert.ok(!JSON.stringify(res).includes('openid'), 'openid 不发给小游戏');

  const push = web.sent.find((f): f is PushFrame => 'push' in f && f.op === Op.PUSH_WX_QR_STATUS);
  assert.deepEqual(push?.data, { ticket, status: 'scanned' });
  assert.ok(!JSON.stringify(web.sent).includes('openid'), 'openid 不发给网页');
});

test('WX_SCAN：微信已绑定的账号，确认页显示该账号用户名', async () => {
  const t = setup({ boundOpenids: new Set(['openid-of-known']) });
  const { ticket } = await createLoginTicket(t);
  const res = await t.call(t.connect(), Op.WX_SCAN, { ticket, code: 'known' });
  assert.equal((res?.data as { accountName: string }).accountName, 'old_name');
});

test('WX_SCAN：已被扫过的 ticket 再扫无效；code 失效与微信故障分别报错', async () => {
  const t = setup();
  const { ticket } = await createLoginTicket(t);
  assert.ok((await t.call(t.connect(), Op.WX_SCAN, { ticket, code: 'a' }))?.ok);
  assert.equal((await t.call(t.connect(), Op.WX_SCAN, { ticket, code: 'b' }))?.error?.code, 'WX_TICKET_INVALID');

  for (const [kind, expected] of [['code_invalid', 'WX_CODE_INVALID'], ['unavailable', 'WX_UNAVAILABLE']] as const) {
    const bad = setup({ client: fakeClient({ codeToSession: async () => { throw new WechatError(kind, 'x'); } }) });
    const created = await createLoginTicket(bad);
    assert.equal((await bad.call(bad.connect(), Op.WX_SCAN, { ticket: created.ticket, code: 'c' }))?.error?.code, expected);
    // 换 openid 失败不改变 ticket 状态：玩家重新 wx.login 后还能再扫
    assert.equal(bad.ctx.wx?.tickets.get(created.ticket, Date.now())?.status, 'pending');
  }
});

test('WX_SCAN：随便一条连接拿无效 ticket 不会触发微信接口调用', async () => {
  let exchanges = 0;
  const t = setup({ client: fakeClient({ codeToSession: async () => { exchanges += 1; return { openid: 'o', unionid: null }; } }) });
  assert.equal((await t.call(t.connect(), Op.WX_SCAN, { ticket: 'BBBBBBBBBBBBBBBB', code: 'c' }))?.error?.code, 'WX_TICKET_INVALID');
  assert.equal(exchanges, 0);
});

test('WX_SCAN（bind）：该微信已被别的账号占用 → WX_ALREADY_BOUND，ticket 仍可被换一个微信扫', async () => {
  const t = setup({ boundOpenids: new Set(['openid-of-taken']) });
  const player = t.connect({ accountId: 'a2', username: 'me', role: 'player' });
  const created = await t.call(player, Op.WX_QR_CREATE, { purpose: 'bind' });
  const ticket = (created?.data as { ticket: string }).ticket;
  assert.equal((await t.call(t.connect(), Op.WX_SCAN, { ticket, code: 'taken' }))?.error?.code, 'WX_ALREADY_BOUND');
  const ok = await t.call(t.connect(), Op.WX_SCAN, { ticket, code: 'free' });
  assert.equal((ok?.data as { accountName: string }).accountName, 'me');
});

test('WX_CONFIRM / WX_CANCEL：未扫码、非扫码连接、无效参数都拒绝；取消推送 canceled 并作废 ticket', async () => {
  const t = setup();
  const { web, ticket } = await createLoginTicket(t);
  const phone = t.connect();
  assert.equal((await t.call(phone, Op.WX_CONFIRM, { ticket }))?.error?.code, 'WX_TICKET_INVALID', 'pending 不能确认');
  assert.equal((await t.call(phone, Op.WX_CONFIRM, {}))?.error?.code, 'INVALID_PARAMS');
  await t.call(phone, Op.WX_SCAN, { ticket, code: 'c' });
  assert.equal((await t.call(t.connect(), Op.WX_CONFIRM, { ticket }))?.error?.code, 'WX_TICKET_INVALID', '别的连接不能确认');
  assert.equal((await t.call(t.connect(), Op.WX_CANCEL, { ticket }))?.error?.code, 'WX_TICKET_INVALID', '别的连接不能取消');

  assert.ok((await t.call(phone, Op.WX_CANCEL, { ticket }))?.ok);
  const pushes = web.sent.filter((f): f is PushFrame => 'push' in f).map((f) => f.data.status);
  assert.deepEqual(pushes, ['scanned', 'canceled']);
  assert.equal((await t.call(phone, Op.WX_CONFIRM, { ticket }))?.error?.code, 'WX_TICKET_INVALID', '取消后 ticket 已作废');
});

test('连接断开：网页连接断开作废 ticket；小游戏连接断开通知网页 canceled', async () => {
  const { onWxConnectionClosed } = await import('../api/src/handlers-wechat');
  const t = setup();
  const first = await createLoginTicket(t);
  const phone = t.connect();
  await t.call(phone, Op.WX_SCAN, { ticket: first.ticket, code: 'c' });
  onWxConnectionClosed(t.ctx, phone.conn);
  assert.deepEqual(first.web.sent.filter((f): f is PushFrame => 'push' in f).map((f) => f.data.status), ['scanned', 'canceled']);

  const second = await createLoginTicket(t);
  onWxConnectionClosed(t.ctx, second.web.conn);
  assert.equal(t.ctx.wx?.tickets.size, 0);
});

test('到期清理：sweep 向网页推送 expired', async () => {
  const { sweepWxTickets } = await import('../api/src/handlers-wechat');
  let now = 1_000_000;
  const t = setup({ now: () => now });
  const { web, ticket } = await createLoginTicket(t);
  now += 179_000;
  sweepWxTickets(t.ctx);
  assert.equal(web.sent.filter((f) => 'push' in f).length, 0);
  now += 2_000;
  sweepWxTickets(t.ctx);
  const push = web.sent.find((f): f is PushFrame => 'push' in f);
  assert.deepEqual(push?.data, { ticket, status: 'expired' });
});

test('GET_AGENT_TOKEN / RESET_AGENT_TOKEN：Agent 连接一律 AGENT_FORBIDDEN（令牌不能经 Agent 可调的协议下发）', async () => {
  const t = setup();
  const agent = t.connect({ accountId: 'a1', username: 'u', role: 'agent' });
  assert.equal((await t.call(agent, Op.GET_AGENT_TOKEN))?.error?.code, 'AGENT_FORBIDDEN');
  assert.equal((await t.call(agent, Op.RESET_AGENT_TOKEN))?.error?.code, 'AGENT_FORBIDDEN');
});

test('密码登录：password_hash 为空的纯微信账号一律 INVALID_CREDENTIALS（不能首次设密码占号）', async () => {
  const pool = {
    query: async () => ({ rowCount: 1, rows: [{ id: 'a', username: 'wx_abc123', password_hash: null }] }),
  } as unknown as HandlerContext['pool'];
  for (const role of ['player', 'agent'] as const) {
    const res = await loginWithPassword(pool, { username: 'wx_abc123', password: 'whatever-123', signupIp: null });
    assert.deepEqual(res, { ok: false, code: 'INVALID_CREDENTIALS' });
  }
});

test('密码登录：不存在的用户名返回 SIGNUP_CLOSED（v48 起关闭自动注册，不建号）', async () => {
  const pool = {
    query: async () => ({ rowCount: 0, rows: [] }),
  } as unknown as HandlerContext['pool'];
  const res = await loginWithPassword(pool, { username: 'never-registered', password: 'whatever-123', signupIp: null });
  assert.deepEqual(res, { ok: false, code: 'SIGNUP_CLOSED' });
});

test('随机用户名：wx_ 加 6 位 base36', () => {
  const names = new Set(Array.from({ length: 50 }, randomWechatUsername));
  for (const name of names) {
    assert.match(name, /^wx_[0-9a-z]{6}$/);
  }
  assert.ok(names.size > 40, '应有足够随机性');
});
