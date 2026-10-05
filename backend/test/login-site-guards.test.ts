// LOGIN 密码登录的三道拦截：
// ① Agent 用账号密码登录一律被拒（AGENT_PASSWORD_FORBIDDEN，哪个站都一样）；
// ② 国际站（PASSWORD_LOGIN_DISABLED_HOSTS 列出的 Host）整站不收密码登录（PASSWORD_LOGIN_CLOSED），
//    绕过界面直发也一样；
// ①② 在参数校验之后、碰数据库之前拦下：拦截生效时断言连接池零查询。
// ③ 用户名不存在 → SIGNUP_CLOSED（v48 起关闭密码通道自动注册）：这道要查一次库才知道。

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebSocket } from 'ws';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { Op, type ResponseFrame } from '../common/src/protocol';

/** 记录被调用过的 SQL；拦截生效时应当为空数组 */
function stubPool(calls: string[]): HandlerContext['pool'] {
  return {
    query: async (sql: string) => {
      calls.push(sql);
      return { rowCount: 0, rows: [] };
    },
  } as unknown as HandlerContext['pool'];
}

function login(
  host: string | null,
  disabledHosts: string[],
  data: Record<string, unknown>,
): Promise<{ frame: ResponseFrame | undefined; calls: string[] }> {
  const sent: ResponseFrame[] = [];
  const socket = {
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => sent.push(JSON.parse(raw) as ResponseFrame),
    close: () => undefined,
  } as unknown as WebSocket;
  const registry = new ConnectionRegistry();
  const conn: ConnInfo = {
    socket,
    ip: '203.0.113.7',
    host,
    accountId: null,
    username: null,
    role: null,
    sessionId: null,
    connectedAt: new Date(),
  };
  registry.add(conn);
  const calls: string[] = [];
  const ctx: HandlerContext = {
    pool: stubPool(calls),
    registry,
    passwordDisabledHosts: new Set(disabledHosts),
  };
  return handleMessage(ctx, conn, JSON.stringify({ op: Op.LOGIN, seq: 1, data })).then(() => ({
    frame: sent.find((f) => f.op === Op.LOGIN),
    calls,
  }));
}

test('Agent 用账号密码登录被拒：AGENT_PASSWORD_FORBIDDEN，且不碰数据库', async () => {
  const { frame, calls } = await login('slg.example.cn', [], {
    username: 'player1',
    password: 'pass-123456',
    asAgent: true,
  });
  assert.equal(frame?.ok, false);
  assert.equal(frame?.error?.code, 'AGENT_PASSWORD_FORBIDDEN');
  assert.deepEqual(calls, []);
});

test('国际站（关闭密码登录的 Host）发密码登录被拒：PASSWORD_LOGIN_CLOSED，且不碰数据库', async () => {
  const { frame, calls } = await login('slg.yuntianyou.cc', ['slg.yuntianyou.cc'], {
    username: 'player1',
    password: 'pass-123456',
    asAgent: false,
  });
  assert.equal(frame?.ok, false);
  assert.equal(frame?.error?.code, 'PASSWORD_LOGIN_CLOSED');
  assert.deepEqual(calls, []);
});

test('密码登录不存在的用户名被拒：SIGNUP_CLOSED（v48 起不再自动注册）', async () => {
  // 桩连接池所有查询都返回 0 行——第一条就是「按用户名查账号」，查无此人是本用例的前提
  const { frame, calls } = await login('slg.example.cn', [], {
    username: 'never-registered',
    password: 'pass-123456',
    asAgent: false,
  });
  assert.equal(frame?.ok, false);
  assert.equal(frame?.error?.code, 'SIGNUP_CLOSED');
  assert.equal(calls.length, 1, '只查了一次账号，没有后续建号写入');
});

test('Host 带端口 / 大小写也能命中禁用站点（与握手 Host 归一化同规则）', async () => {
  const { frame } = await login('SLG.YunTianYou.CC:443', ['slg.yuntianyou.cc'], {
    username: 'player1',
    password: 'pass-123456',
    asAgent: false,
  });
  assert.equal(frame?.error?.code, 'PASSWORD_LOGIN_CLOSED');
});

test('Agent 密码登录优先于站点判断：国际站上 Agent 拿到的仍是 AGENT_PASSWORD_FORBIDDEN', async () => {
  const { frame } = await login('slg.yuntianyou.cc', ['slg.yuntianyou.cc'], {
    username: 'player1',
    password: 'pass-123456',
    asAgent: true,
  });
  assert.equal(frame?.error?.code, 'AGENT_PASSWORD_FORBIDDEN');
});

test('国内站玩家密码登录不受影响：进入正常登录流程（有数据库查询）', async () => {
  const { frame, calls } = await login('slg.example.cn', ['slg.yuntianyou.cc'], {
    username: 'player1',
    password: 'pass-123456',
    asAgent: false,
  });
  // 桩连接池对「查用户名」返回 0 行 → player 身份走注册路径；这里只断言拦截没误伤
  assert.ok(calls.length > 0, '应当进入登录 / 注册流程');
  assert.notEqual(frame?.error?.code, 'PASSWORD_LOGIN_CLOSED');
  assert.notEqual(frame?.error?.code, 'AGENT_PASSWORD_FORBIDDEN');
});

test('参数不合法仍然先报 INVALID_PARAMS（拦截在参数校验之后）', async () => {
  const { frame, calls } = await login('slg.yuntianyou.cc', ['slg.yuntianyou.cc'], {
    username: 'player1',
    password: 'short',
    asAgent: false,
  });
  assert.equal(frame?.error?.code, 'INVALID_PARAMS');
  assert.deepEqual(calls, []);
});
