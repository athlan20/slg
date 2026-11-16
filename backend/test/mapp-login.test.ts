// Linux.do 微应用 MAPP_LOGIN 协议处理器单测（AISLG-261）。
// 覆盖：成功建号/复用已有号、信任等级不足拦截、Agent 角色被拒、已登录被拒、未开启服务与身份缺失兜底。

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebSocket } from 'ws';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { MappService } from '../api/src/mapp/service';
import { JwksCache } from '../api/src/mapp/jwks';
import type { MappConfig } from '../api/src/mapp/types';

function createMockPool() {
  const accounts = new Map<string, { id: string; username: string }>();
  const identities = new Map<string, { accountId: string; provider: string; subject: string }>();
  let nextId = 1;

  const queryFn = async (sql: string, params: unknown[] = []) => {
    // 查已有绑定
    if (sql.includes('FROM oauth_identities o JOIN accounts a')) {
      const [provider, subject] = params as [string, string];
      const ident = identities.get(`${provider}:${subject}`);
      if (!ident) {
        return { rowCount: 0, rows: [] };
      }
      const acc = accounts.get(ident.accountId);
      return { rowCount: 1, rows: [{ id: acc!.id, username: acc!.username }] };
    }

    // 建号
    if (sql.includes('INSERT INTO accounts')) {
      const username = params[0] as string;
      const id = `acc-uuid-${nextId++}`;
      accounts.set(id, { id, username });
      return { rowCount: 1, rows: [{ id, username }] };
    }

    // 初始城池
    if (sql.includes('INSERT INTO cities')) {
      return { rowCount: 1, rows: [{ id: `city-${nextId++}` }] };
    }

    // 写绑定关系
    if (sql.includes('INSERT INTO oauth_identities')) {
      const [accountId, provider, subject] = params as [string, string, string];
      identities.set(`${provider}:${subject}`, { accountId, provider, subject });
      return { rowCount: 1, rows: [] };
    }

    // 签发会话令牌
    if (sql.includes('INSERT INTO sessions')) {
      return { rowCount: 1, rows: [{ id: 'sess-1', token: 'mock-session-token-xyz' }] };
    }

    return { rowCount: 0, rows: [] };
  };

  const client = {
    query: queryFn,
    release: () => undefined,
  };

  const pool = {
    query: queryFn,
    connect: async () => client,
  };

  return { pool, accounts, identities };
}

function createTestContext(
  pool: HandlerContext['pool'],
  mappConfigOverrides?: Partial<MappConfig>,
  disableMapp = false,
): { ctx: HandlerContext; mappService: MappService | null } {
  const registry = new ConnectionRegistry();
  if (disableMapp) {
    return {
      ctx: { pool, registry, passwordDisabledHosts: new Set() },
      mappService: null,
    };
  }

  const config: MappConfig = {
    enabled: true,
    issuer: 'https://linux.do',
    appId: '019a2a58-0000-7000-8000-000000000001',
    channel: 'production',
    audience: 'https://slgws.example.com',
    origins: new Set(['https://linux.do']),
    identityProvider: 'linuxdo_mapp',
    minTrustLevel: 1,
    ...mappConfigOverrides,
  };

  const cache = new JwksCache({ issuer: config.issuer });
  const mappService = new MappService(config, cache);
  const ctx: HandlerContext = {
    pool,
    registry,
    passwordDisabledHosts: new Set(),
    mapp: mappService,
  };

  return { ctx, mappService };
}

async function sendMappLogin(
  ctx: HandlerContext,
  conn: ConnInfo,
  seq = 1,
): Promise<{ frame: ResponseFrame; sent: ResponseFrame[] }> {
  const sent: ResponseFrame[] = [];
  (conn.socket as unknown as { send: (raw: string) => void }).send = (raw: string) => {
    sent.push(JSON.parse(raw) as ResponseFrame);
  };
  await handleMessage(ctx, conn, JSON.stringify({ op: Op.MAPP_LOGIN, seq, data: {} }));
  const frame = sent.find((f) => f.op === Op.MAPP_LOGIN);
  assert.ok(frame, '未收到 MAPP_LOGIN 响应帧');
  return { frame, sent };
}

function makeConn(overrides?: Partial<ConnInfo>): ConnInfo {
  const socket = {
    readyState: 1,
    OPEN: 1,
    send: () => undefined,
    close: () => undefined,
  } as unknown as WebSocket;

  return {
    socket,
    ip: '127.0.0.1',
    host: null,
    accountId: null,
    username: null,
    role: null,
    sessionId: null,
    connectedAt: new Date(),
    ...overrides,
  };
}

test('MAPP_LOGIN：Agent 角色连接调用一律返回 AGENT_FORBIDDEN', async () => {
  const { pool } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool']);
  const conn = makeConn({
    role: 'agent',
    mappIdentity: { iss: 'https://linux.do', sub: '123', channel: 'production', appId: 'app1' },
  });

  const { frame } = await sendMappLogin(ctx, conn);
  assert.equal(frame.ok, false);
  assert.equal(frame.error?.code, 'AGENT_FORBIDDEN');
});

test('MAPP_LOGIN：已登录连接重复调用返回 ALREADY_LOGGED_IN', async () => {
  const { pool } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool']);
  const conn = makeConn({
    accountId: 'existing-account-id',
    mappIdentity: { iss: 'https://linux.do', sub: '123', channel: 'production', appId: 'app1' },
  });

  const { frame } = await sendMappLogin(ctx, conn);
  assert.equal(frame.ok, false);
  assert.equal(frame.error?.code, 'ALREADY_LOGGED_IN');
});

test('MAPP_LOGIN：服务端未启用微应用返回 MAPP_UNAVAILABLE', async () => {
  const { pool } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool'], undefined, true);
  const conn = makeConn({
    mappIdentity: { iss: 'https://linux.do', sub: '123', channel: 'production', appId: 'app1' },
  });

  const { frame } = await sendMappLogin(ctx, conn);
  assert.equal(frame.ok, false);
  assert.equal(frame.error?.code, 'MAPP_UNAVAILABLE');
});

test('MAPP_LOGIN：普通连接（无平台令牌握手）返回 MAPP_UNAVAILABLE', async () => {
  const { pool } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool']);
  const conn = makeConn({
    mappIdentity: null,
    mappTokenPresent: false,
  });

  const { frame } = await sendMappLogin(ctx, conn);
  assert.equal(frame.ok, false);
  assert.equal(frame.error?.code, 'MAPP_UNAVAILABLE');
});

test('MAPP_LOGIN：携带了 token 参数但缺少身份信息返回 MAPP_TOKEN_INVALID', async () => {
  const { pool } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool']);
  const conn = makeConn({
    mappIdentity: null,
    mappTokenPresent: true,
  });

  const { frame } = await sendMappLogin(ctx, conn);
  assert.equal(frame.ok, false);
  assert.equal(frame.error?.code, 'MAPP_TOKEN_INVALID');
});

test('MAPP_LOGIN：论坛信任等级低于门槛返回 MAPP_TRUST_LEVEL_LOW', async () => {
  const { pool } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool'], { minTrustLevel: 2 });

  // 等级为 1 < 2 被拒
  const connLow = makeConn({
    mappIdentity: {
      iss: 'https://linux.do',
      sub: '123',
      trust_level: 1,
      channel: 'production',
      appId: 'app1',
    },
  });
  const { frame: frameLow } = await sendMappLogin(ctx, connLow);
  assert.equal(frameLow.ok, false);
  assert.equal(frameLow.error?.code, 'MAPP_TRUST_LEVEL_LOW');

  // 令牌缺少 trust_level 视为 0 < 2 被拒
  const connMissing = makeConn({
    mappIdentity: {
      iss: 'https://linux.do',
      sub: '123',
      channel: 'production',
      appId: 'app1',
    },
  });
  const { frame: frameMissing } = await sendMappLogin(ctx, connMissing);
  assert.equal(frameMissing.ok, false);
  assert.equal(frameMissing.error?.code, 'MAPP_TRUST_LEVEL_LOW');
});

test('MAPP_LOGIN：合法的微应用登录：首次建号，再次返回已有号', async () => {
  const { pool, identities } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool'], {
    minTrustLevel: 1,
    identityProvider: 'linuxdo_mapp',
  });

  const identity = {
    iss: 'https://linux.do',
    sub: '998877',
    trust_level: 2,
    channel: 'production' as const,
    appId: 'app1',
  };

  // 1. 首次登录：自动建号
  const conn1 = makeConn({ mappIdentity: identity });
  const { frame: res1 } = await sendMappLogin(ctx, conn1, 10);
  assert.equal(res1.ok, true);
  const data1 = res1.data as { sessionToken: string; username: string; created: boolean };
  assert.equal(data1.created, true);
  assert.match(data1.username, /^ld_[a-z0-9]{6}$/);
  assert.match(data1.sessionToken, /^[A-Za-z0-9_-]{43}$/);

  // 检查身份绑定表是否记录正确
  const bound = identities.get('linuxdo_mapp:998877');
  assert.ok(bound);
  assert.equal(bound.provider, 'linuxdo_mapp');
  assert.equal(bound.subject, '998877');

  // 2. 相同 sub 再次登录：复用同一账号，created 为 false
  const conn2 = makeConn({ mappIdentity: identity });
  const { frame: res2 } = await sendMappLogin(ctx, conn2, 11);
  assert.equal(res2.ok, true);
  const data2 = res2.data as { sessionToken: string; username: string; created: boolean };
  assert.equal(data2.created, false);
  assert.equal(data2.username, data1.username);
});

test('MAPP_LOGIN：MAPP_IDENTITY_PROVIDER 可配置为 linuxdo', async () => {
  const { pool, identities } = createMockPool();
  const { ctx } = createTestContext(pool as unknown as HandlerContext['pool'], {
    identityProvider: 'linuxdo',
  });

  const identity = {
    iss: 'https://linux.do',
    sub: '5566',
    trust_level: 3,
    channel: 'production' as const,
    appId: 'app1',
  };

  const conn = makeConn({ mappIdentity: identity });
  const { frame } = await sendMappLogin(ctx, conn);
  assert.equal(frame.ok, true);
  assert.equal((frame.data as { created: boolean }).created, true);

  // 绑定的 provider 为 linuxdo
  const bound = identities.get('linuxdo:5566');
  assert.ok(bound);
  assert.equal(bound.provider, 'linuxdo');
});
