// 微信小游戏端（wechat-minigame/js）对真实 API 的联调：用假的 wx（connectSocket 由 ws 实现、
// login 返回假 code）驱动小游戏的登录流程状态机，网页端由 WebSocket 客户端扮演。
// 验证小游戏实际发出的帧与服务端协议对得上，而不是各自照文档写。需要 DATABASE_URL，同 wechat-login.test.ts。

import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Op, startHarness, type Client, type Harness } from './harness';
import { seedAccount } from '../account-seed';

const backendRequire = createRequire(path.resolve(__dirname, '../../backend/package.json'));
const WS = backendRequire('ws') as typeof import('ws').WebSocket;
const requireMini = createRequire(path.resolve(__dirname, '../../wechat-minigame/package.json'));
const { createLoginFlow } = requireMini('./js/login-flow') as {
  createLoginFlow: (deps: { wx: unknown; ticket: string; onChange: () => void; url?: string }) => {
    state: { phase: string; purpose: string; accountName: string | null; requesterIp: string | null; error: { text: string; retryable: boolean } | null };
    start: () => Promise<void>;
    retry: () => Promise<void>;
    confirm: () => Promise<void>;
    cancel: () => Promise<void>;
    dispose: () => void;
  };
};

const API_PORT = 18093;
const DB_URL = process.env.DATABASE_URL;
const opts = { skip: DB_URL ? false : '未设置 DATABASE_URL，跳过小游戏联调' };
const RUN_ID = Date.now().toString(36);
let codeSeq = 0;
const nextCode = (who: string): string => `wxuser-${who}${RUN_ID}-${++codeSeq}`;

let harness: Harness;
before(async () => {
  if (DB_URL) {
    harness = await startHarness({ apiPort: API_PORT, ticketTtlSeconds: 30 });
  }
});
after(() => harness?.stop());

/** 假 wx：connectSocket 返回与小游戏 SocketTask 同形的对象；login 依次返回给定的 code */
function fakeWx(codes: string[]) {
  const sockets: Array<{ ws: InstanceType<typeof WS> }> = [];
  const wx = {
    connectSocket(options: { url: string; fail?: () => void }) {
      const ws = new WS(options.url);
      sockets.push({ ws });
      return {
        onOpen: (cb: () => void) => ws.on('open', cb),
        onError: (cb: () => void) => ws.on('error', cb),
        onClose: (cb: (e: { code: number }) => void) => ws.on('close', (code) => cb({ code })),
        onMessage: (cb: (m: { data: string }) => void) => ws.on('message', (raw) => cb({ data: String(raw) })),
        send: ({ data }: { data: string }) => ws.send(data),
        close: () => ws.close(),
      };
    },
    login({ success }: { success: (r: { code: string }) => void }) {
      success({ code: codes.shift() ?? nextCode('fallback') });
    },
  };
  return { wx, sockets };
}

async function waitPhase(flow: { state: { phase: string } }, phase: string, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (flow.state.phase !== phase) {
    assert.ok(Date.now() < deadline, `等待阶段 ${phase} 超时，当前 ${flow.state.phase}`);
    await new Promise((r) => setTimeout(r, 30));
  }
}

async function webTicket(purpose: 'login' | 'bind', web?: Client): Promise<{ web: Client; ticket: string }> {
  const client = web ?? (await harness.connect());
  const created = await client.call(Op.WX_QR_CREATE, { purpose });
  assert.ok(created.ok, JSON.stringify(created));
  return { web: client, ticket: created.data?.ticket };
}

test('小游戏：扫码 → 确认页数据 → 确认 → 网页拿到令牌并登录', opts, async () => {
  const { web, ticket } = await webTicket('login');
  const { wx } = fakeWx([nextCode('mg1')]);
  const flow = createLoginFlow({ wx, ticket, onChange: () => undefined, url: harness.wsUrl });
  await flow.start();
  assert.equal(flow.state.phase, 'scanned');
  assert.equal(flow.state.purpose, 'login');
  assert.equal(flow.state.accountName, null);
  assert.equal(flow.state.requesterIp, '127.0.*.*');
  await web.waitPush((f) => f.data?.status === 'scanned');

  await flow.confirm();
  assert.equal(flow.state.phase, 'success');
  const push = await web.waitPush((f) => f.data?.status === 'confirmed');
  const login = await web.call(Op.LOGIN, { token: push.data?.sessionToken, asAgent: false });
  assert.ok(login.ok);
  assert.match(login.data?.username, /^wx_/);
  flow.dispose();
});

test('小游戏：取消 → 网页收到 canceled', opts, async () => {
  const { web, ticket } = await webTicket('login');
  const { wx } = fakeWx([nextCode('mg2')]);
  const flow = createLoginFlow({ wx, ticket, onChange: () => undefined, url: harness.wsUrl });
  await flow.start();
  await flow.cancel();
  assert.equal(flow.state.phase, 'canceled');
  await web.waitPush((f) => f.data?.status === 'canceled');
  flow.dispose();
});

test('小游戏：无效 ticket 提示回网页刷新（不可重试）；code 已用过可重试，重试会重新 wx.login', opts, async () => {
  const bad = fakeWx([nextCode('mg3')]);
  const invalid = createLoginFlow({ wx: bad.wx, ticket: 'ZZZZZZZZZZZZZZZZ', onChange: () => undefined, url: harness.wsUrl });
  await invalid.start();
  assert.equal(invalid.state.phase, 'failed');
  assert.equal(invalid.state.error?.retryable, false);
  assert.match(invalid.state.error?.text ?? '', /刷新二维码/);

  const { ticket } = await webTicket('login');
  const used = nextCode('mg4');
  // 第一次 wx.login 给一个已被换过 openid 的旧 code：服务端回 WX_CODE_INVALID，重试时给新 code
  const probe = await harness.connect();
  const other = await webTicket('login');
  await probe.call(Op.WX_SCAN, { ticket: other.ticket, code: used });
  const { wx } = fakeWx([used, nextCode('mg4b')]);
  const flow = createLoginFlow({ wx, ticket, onChange: () => undefined, url: harness.wsUrl });
  await flow.start();
  assert.equal(flow.state.phase, 'failed');
  assert.equal(flow.state.error?.retryable, true);
  await flow.retry();
  assert.equal(flow.state.phase, 'scanned', '重新 wx.login 后重试成功');
  flow.dispose();
});

test('小游戏：确认页上连接中断 → 失败且不可重试（ticket 绑在旧连接上）', opts, async () => {
  const { ticket } = await webTicket('login');
  const { wx, sockets } = fakeWx([nextCode('mg5')]);
  const flow = createLoginFlow({ wx, ticket, onChange: () => undefined, url: harness.wsUrl });
  await flow.start();
  assert.equal(flow.state.phase, 'scanned');
  sockets[0].ws.terminate();
  await waitPhase(flow, 'failed');
  assert.equal(flow.state.error?.retryable, false);
});

test('小游戏：bind 用途显示将绑定的账号，确认后网页状态变已绑定', opts, async () => {
  const web = await harness.connect();
  const username = `mgbind_${Date.now()}`;
  await seedAccount(username, 'password-123'); // v48 起密码通道不再自动注册，先直插预建
  assert.ok((await web.call(Op.LOGIN, { username, password: 'password-123', asAgent: false })).ok);
  const { ticket } = await webTicket('bind', web);
  const { wx } = fakeWx([nextCode('mg6')]);
  const flow = createLoginFlow({ wx, ticket, onChange: () => undefined, url: harness.wsUrl });
  await flow.start();
  assert.equal(flow.state.purpose, 'bind');
  assert.equal(flow.state.accountName, username);
  await flow.confirm();
  assert.equal(flow.state.phase, 'success');
  const push = await web.waitPush((f) => f.data?.status === 'confirmed');
  assert.equal(push.data?.bound, true);
  assert.equal((await web.call(Op.GET_AGENT_INFO)).data?.wechatBound, true);
  flow.dispose();
});

test('小游戏：同一微信已绑定其他账号时，bind 扫码直接提示不可用', opts, async () => {
  const who = nextCode('mg7').split('-')[1];
  const first = await harness.connect();
  const firstUsername = `mgfirst_${Date.now()}`;
  await seedAccount(firstUsername, 'password-123');
  await first.call(Op.LOGIN, { username: firstUsername, password: 'password-123', asAgent: false });
  const t1 = await webTicket('bind', first);
  const flow1 = createLoginFlow({ wx: fakeWx([`wxuser-${who}-a`]).wx, ticket: t1.ticket, onChange: () => undefined, url: harness.wsUrl });
  await flow1.start();
  await flow1.confirm();
  assert.equal(flow1.state.phase, 'success');

  const second = await harness.connect();
  const secondUsername = `mgsecond_${Date.now()}`;
  await seedAccount(secondUsername, 'password-123');
  await second.call(Op.LOGIN, { username: secondUsername, password: 'password-123', asAgent: false });
  const t2 = await webTicket('bind', second);
  const flow2 = createLoginFlow({ wx: fakeWx([`wxuser-${who}-b`]).wx, ticket: t2.ticket, onChange: () => undefined, url: harness.wsUrl });
  await flow2.start();
  assert.equal(flow2.state.phase, 'failed');
  assert.match(flow2.state.error?.text ?? '', /已经绑定/);
});
