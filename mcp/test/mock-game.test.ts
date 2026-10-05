// 端到端集成测试（AISLG-131）：起一个假的游戏 WebSocket 服务器（按协议帧应答），
// 用 MCP SDK 的 Client + StdioClientTransport 拉起真实的 slg-mcp 子进程，
// 验收口径逐条覆盖：登录携带 token/asAgent/docVersion、工具调用往返、推送经
// get_notifications 增量读取、断线自动重连、登录失败与 docNotice 的提示、
// SLG_TOKEN 缺失时的清晰报错。

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadManifest } from '../src/manifest.js';

const manifest = loadManifest();
const MCP_ROOT = join(import.meta.dirname, '..');
const TSX_CLI = join(MCP_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');

interface MockFrame {
  op?: number;
  seq?: number;
  data?: Record<string, unknown>;
}

type Scenario = 'ok' | 'ok-with-notice' | 'bad-token';

/** 假游戏服务器：LOGIN 按场景应答，其余 op 回显；可主动推推送、可断开模拟掉线 */
class MockGame {
  readonly server: WebSocketServer;
  port = 0;
  url = '';
  private readonly sockets: WebSocket[] = [];
  readonly logins: MockFrame[] = [];
  readonly requests: MockFrame[] = [];
  scenario: Scenario = 'ok';
  /** 这些 op 号按错误应答（测错误路径） */
  failOps = new Set<number>();

  private constructor() {
    this.server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    this.server.on('connection', (socket) => {
      this.sockets.push(socket);
      socket.on('message', (raw) => this.handle(socket, raw.toString()));
    });
  }

  /** ws 绑定是异步的：等 listening 后才能拿到端口 */
  static async start(): Promise<MockGame> {
    const game = new MockGame();
    await new Promise<void>((resolve) => game.server.once('listening', resolve));
    game.port = (game.server.address() as { port: number }).port;
    game.url = `ws://127.0.0.1:${game.port}/ws`;
    return game;
  }

  private handle(socket: WebSocket, raw: string): void {
    const frame = JSON.parse(raw) as { op: number; seq: number; data?: Record<string, unknown> };
    if (frame.op === 1) {
      this.logins.push(frame);
      const token = frame.data?.token;
      if (this.scenario === 'bad-token') {
        this.reply(socket, frame, false, { code: 'SESSION_INVALID', message: '会话令牌无效或已过期' });
        return;
      }
      this.reply(socket, frame, true, {
        accountId: 'acc-test',
        username: 'mock-player',
        role: 'agent',
        sessionToken: token,
        expiresAt: null,
        protocolVersion: manifest.version,
        docNotice: this.scenario === 'ok-with-notice' ? '接口文档已更新，请重新下载。' : null,
      });
      return;
    }
    this.requests.push(frame);
    if (this.failOps.has(frame.op)) {
      this.reply(socket, frame, false, { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' });
      return;
    }
    this.reply(socket, frame, true, { echoOp: frame.op, city: '主城' });
  }

  private reply(socket: WebSocket, frame: { op: number; seq: number }, ok: boolean, body: Record<string, unknown>): void {
    const payload = ok
      ? { op: frame.op, seq: frame.seq, ok: true, data: body }
      : { op: frame.op, seq: frame.seq, ok: false, error: body };
    socket.send(JSON.stringify(payload));
  }

  push(eventId: number, op: number, data: Record<string, unknown>): void {
    for (const socket of this.sockets) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ op, push: true, eventId, data }));
      }
    }
  }

  /** 断开当前全部连接（模拟掉线；服务端口保持，等 MCP 重连） */
  dropConnections(): void {
    for (const socket of this.sockets.splice(0)) {
      socket.close(4006, 'drop');
    }
  }

  async close(): Promise<void> {
    for (const socket of this.sockets.splice(0)) {
      socket.terminate();
    }
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

interface ClientOptions {
  token?: string;
  scenario?: Scenario;
  failOps?: number[];
}

/** 起 mock 服务器 + MCP 子进程，跑用例；无论成败都收尾，避免残留进程挂住测试 */
async function withMcp(options: ClientOptions, run: (game: MockGame, client: Client) => Promise<void>): Promise<void> {
  const game = await MockGame.start();
  game.scenario = options.scenario ?? 'ok';
  for (const op of options.failOps ?? []) {
    game.failOps.add(op);
  }
  let client: Client | null = null;
  try {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [TSX_CLI, join(MCP_ROOT, 'src', 'index.ts')],
      cwd: MCP_ROOT,
      env: {
        ...process.env,
        SLG_TOKEN: options.token ?? 'sk-good',
        SLG_SERVER: game.url,
        SLG_READY_TIMEOUT_MS: '5000',
        SLG_REQUEST_TIMEOUT_MS: '5000',
      } as Record<string, string>,
      stderr: 'ignore',
    });
    client = new Client({ name: 'slg-mcp-test', version: '0.0.1' });
    await client.connect(transport);
    await run(game, client);
  } finally {
    await client?.close().catch(() => undefined);
    await game.close();
  }
}

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((part) => part.text ?? '').join('\n');
}

async function waitFor(predicate: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.fail('等待条件超时');
}

interface NotificationPage {
  notifications: Array<{ id: number; eventId: number | null; name: string; data: Record<string, unknown> }>;
  nextSinceId: number;
}

/** 轮询 get_notifications 直到满足条件（推送与工具调用走不同通道，到达有先后） */
async function waitForNotifications(
  client: Client,
  check: (page: NotificationPage) => boolean,
  timeoutMs = 5_000,
): Promise<NotificationPage> {
  const deadline = Date.now() + timeoutMs;
  let last: NotificationPage | null = null;
  while (Date.now() < deadline) {
    last = JSON.parse(textOf(await client.callTool({ name: 'get_notifications' }))) as NotificationPage;
    if (check(last)) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.fail(`通知轮询超时：last=${JSON.stringify(last?.notifications.map((entry) => entry.name))}`);
}

test('登录与工具往返：LOGIN 带 token/asAgent/docVersion，工具调用透传协议', async () => {
  await withMcp({}, async (game, client) => {
    await waitFor(() => game.logins.length >= 1);
    const login = game.logins[0] as { data?: Record<string, unknown> };
    assert.equal(login.data?.token, 'sk-good');
    assert.equal(login.data?.asAgent, true);
    assert.equal(login.data?.docVersion, manifest.version, 'LOGIN 应带清单版本号（docVersion）');

    const result = await client.callTool({ name: 'BUILD', arguments: { kind: 'farm' } });
    assert.equal((result as { isError?: boolean }).isError ?? false, false);
    assert.ok(textOf(result).includes('echoOp'), '工具结果应包含游戏服务器应答');
    assert.equal(game.requests.at(-1)?.op, 21, 'BUILD 帧序号应为 21');
    assert.equal(game.requests.at(-1)?.data?.kind, 'farm');
  });
});

test('工具清单：含游戏操作与 get_notifications，不含登录流程与仅玩家 op', async () => {
  await withMcp({}, async (_game, client) => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name);
    assert.ok(names.includes('BUILD') && names.includes('MARCH') && names.includes('get_notifications'));
    for (const banned of ['LOGIN', 'LOGOUT', 'WX_QR_CREATE', 'GOOGLE_LOGIN', 'GET_AGENT_TOKEN', 'RESET_AGENT_TOKEN']) {
      assert.ok(!names.includes(banned), `${banned} 不应出现`);
    }
    const build = tools.find((tool) => tool.name === 'BUILD');
    const schema = build?.inputSchema as { properties?: Record<string, { enum?: string[] }> };
    assert.ok(schema?.properties?.kind?.enum?.includes('farm'), 'BUILD.kind 应是枚举');
  });
});

test('推送经 get_notifications 增量读取（eventId 透传、游标翻页）', async () => {
  await withMcp({}, async (game, client) => {
    await waitFor(() => game.logins.length >= 1);
    game.push(42, 2001, { online: true });
    game.push(43, 2010, { x: 3, y: 4 });

    // 推送走 WebSocket、工具调用走 stdio，两条通道并行：轮询直到推送真正到达缓冲
    // （AI 的实际用法也是周期性读 get_notifications）
    const first = await waitForNotifications(client, (page) =>
      page.notifications.filter((entry) => entry.eventId !== null).length >= 2,
    );
    // 首条是「已连接」合成事件 + 两条推送
    assert.ok(first.notifications.length >= 3, `应含连接事件与推送：${first.notifications.length}`);
    const pushed = first.notifications.filter((entry) => entry.eventId !== null);
    assert.deepEqual(pushed.map((entry) => entry.eventId), [42, 43]);
    assert.equal(pushed[0]?.name, 'PUSH_AGENT_STATUS', '推送应带协议名（op 2001）');
    assert.equal(pushed[1]?.name, 'PUSH_NPC_ATTACK_WARNING', '推送应带协议名（op 2010）');

    // 增量：带上游标后不重复
    const second = JSON.parse(
      textOf(await client.callTool({ name: 'get_notifications', arguments: { sinceId: first.nextSinceId } })),
    ) as { notifications: unknown[]; nextSinceId: number };
    assert.equal(second.notifications.length, 0);
    assert.equal(second.nextSinceId, first.nextSinceId);
  });
});

test('断线自动重连：掉线后重新登录，工具恢复可用', async () => {
  await withMcp({}, async (game, client) => {
    await waitFor(() => game.logins.length >= 1);
    await client.callTool({ name: 'GET_STATE', arguments: {} });
    game.dropConnections();
    // 重连退避从 1s 起步，留足窗口
    await waitFor(() => game.logins.length >= 2, 15_000);
    const again = await client.callTool({ name: 'GET_STATE', arguments: {} });
    assert.ok(textOf(again).includes('echoOp'), '重连后工具应恢复');
    // 掉线与重连都应写入通知缓冲，AI 能感知（合成事件在子进程内生成，轮询读到）
    const notes = await waitForNotifications(client, (page) => {
      const states = page.notifications.filter((entry) => entry.name === 'connection').map((entry) => entry.data.state);
      return states.includes('disconnected') && states.includes('reconnected');
    });
    const states = notes.notifications.filter((entry) => entry.name === 'connection').map((entry) => entry.data.state);
    assert.ok(states.includes('disconnected') && states.includes('reconnected'), `连接事件缺失：${states.join(',')}`);
  });
});

test('游戏侧错误转 isError 并附错误码解释', async () => {
  await withMcp({ failOps: [21] }, async (_game, client) => {
    const result = await client.callTool({ name: 'BUILD', arguments: { kind: 'farm' } });
    assert.equal((result as { isError?: boolean }).isError, true);
    assert.ok(textOf(result).includes('INVALID_PARAMS'));
  });
});

test('登录失败（令牌无效）：工具返回登录错误，不崩进程', async () => {
  await withMcp({ token: 'sk-bad', scenario: 'bad-token' }, async (_game, client) => {
    const result = await client.callTool({ name: 'GET_STATE', arguments: {} });
    assert.equal((result as { isError?: boolean }).isError, true);
    assert.ok(textOf(result).includes('SESSION_INVALID'), '应提示令牌问题');
  });
});

test('docNotice：文档落后时工具结果前置更新提示', async () => {
  await withMcp({ scenario: 'ok-with-notice' }, async (game, client) => {
    await waitFor(() => game.logins.length >= 1);
    const result = await client.callTool({ name: 'GET_STATE', arguments: {} });
    assert.ok(textOf(result).includes('协议文档更新提示'), '应前置 docNotice 提示');
  });
});

test('agent-api 资源可读（整份协议文档）', async () => {
  await withMcp({}, async (_game, client) => {
    const res = await client.readResource({ uri: 'slg://agent-api.md' });
    const text = (res.contents[0] as { text?: string }).text ?? '';
    assert.ok(text.length > 10_000, '资源应是协议文档正文');
  });
});

test('SLG_TOKEN 缺失：非零退出并在 stderr 给出清晰指引', () => {
  const run = spawnSync(process.execPath, [TSX_CLI, join(MCP_ROOT, 'src', 'index.ts')], {
    cwd: MCP_ROOT,
    env: { ...process.env, SLG_TOKEN: '' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.notEqual(run.status, 0, '应非零退出');
  assert.ok((run.stderr ?? '').includes('SLG_TOKEN'), `stderr 应提示 SLG_TOKEN：${run.stderr}`);
});
