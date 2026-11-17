// GET_AGENT_INFO 的 accountCreatedAt（AISLG-266，协议 v115）：账号第一次创建的时间，
// 取账号表已有的列 accounts.created_at（timestamptz NOT NULL DEFAULT now()），不新增表 / 迁移。
// 覆盖验收口径：
// ① 下发值 = accounts.created_at 的 ISO 8601 字符串（与库里的值一致，不四舍五入、不带本地时区）；
// ② 玩家连接与 Agent 连接取到的值完全一致（字段只读，与连接身份无关）；
// ③ 只读：本字段只发一条 SELECT，不写任何表；
// ④ 账号行不存在时抛错（不编造时间），由 handleMessage 统一回 INTERNAL。
// 用桩连接池，不需要真实 PostgreSQL（无需 TEST_DATABASE_URL）。

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebSocket } from 'ws';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleGetAgentInfo, loadAccountCreatedAt } from '../api/src/handlers-agent-info';
import { Op, type GetAgentInfoResponseData, type ResponseFrame } from '../common/src/protocol';

/** 账号在库里的创建时刻（带毫秒，验证 toISOString 原样下发） */
const CREATED_AT = new Date('2026-09-20T11:22:33.456Z');
const ACCOUNT_ID = '11111111-2222-3333-4444-555555555555';

interface QueryCall {
  sql: string;
  params?: unknown[];
}

interface Stub {
  pool: HandlerContext['pool'];
  calls: QueryCall[];
}

/** 桩连接池：按表名分派固定结果，并记录所有 SQL（用来断言只读） */
function stubPool(createdAt: Date | null): Stub {
  const calls: QueryCall[] = [];
  const pool = {
    query: async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      if (sql.includes('FROM accounts')) {
        return { rowCount: createdAt ? 1 : 0, rows: createdAt ? [{ created_at: createdAt }] : [] };
      }
      // events / agent_plans / oauth_identities 一律当作空结果：本用例只关心 accountCreatedAt
      return { rowCount: 0, rows: [] };
    },
  } as unknown as HandlerContext['pool'];
  return { pool, calls };
}

/** 已登录的连接；role 取 player 或 agent（只有协议级区分，不影响 accountCreatedAt） */
function makeConn(role: 'player' | 'agent', sent: ResponseFrame[]): ConnInfo {
  const socket = {
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => sent.push(JSON.parse(raw) as ResponseFrame),
    close: () => undefined,
  } as unknown as WebSocket;
  return {
    socket,
    ip: '203.0.113.7',
    host: 'slg.example.cn',
    accountId: ACCOUNT_ID,
    username: 'player1',
    role,
    sessionId: null,
    connectedAt: new Date('2026-11-01T00:00:00.000Z'),
  };
}

/** 调一次 GET_AGENT_INFO，返回响应帧与 SQL 记录 */
async function getAgentInfo(
  role: 'player' | 'agent',
  createdAt: Date | null = CREATED_AT,
): Promise<{ frame: ResponseFrame | undefined; calls: QueryCall[] }> {
  const { pool, calls } = stubPool(createdAt);
  const sent: ResponseFrame[] = [];
  const registry = new ConnectionRegistry();
  const conn = makeConn(role, sent);
  registry.add(conn);
  const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
  await handleGetAgentInfo(ctx, conn, Op.GET_AGENT_INFO, 7);
  return { frame: sent.find((f) => f.op === Op.GET_AGENT_INFO), calls };
}

test('accountCreatedAt：下发 accounts.created_at 的 ISO 8601 字符串', async () => {
  const { frame } = await getAgentInfo('player');
  assert.equal(frame?.ok, true);
  const data = frame?.data as unknown as GetAgentInfoResponseData;
  assert.equal(data.accountCreatedAt, '2026-09-20T11:22:33.456Z');
  // 可以被客户端直接用 Date 解析（新手弹窗按它算新号窗口）
  assert.equal(Date.parse(data.accountCreatedAt), CREATED_AT.getTime());
});

test('accountCreatedAt：玩家连接与 Agent 连接取到的值一致', async () => {
  const player = await getAgentInfo('player');
  const agent = await getAgentInfo('agent');
  const playerData = player.frame?.data as unknown as GetAgentInfoResponseData;
  const agentData = agent.frame?.data as unknown as GetAgentInfoResponseData;
  assert.equal(agentData.accountCreatedAt, playerData.accountCreatedAt);
  assert.equal(agentData.accountCreatedAt, '2026-09-20T11:22:33.456Z');
});

test('accountCreatedAt 只读：单个 SELECT，参数为当前账号 id，不写任何表', async () => {
  const { calls } = await getAgentInfo('agent');
  const accountQueries = calls.filter((c) => c.sql.includes('FROM accounts'));
  assert.equal(accountQueries.length, 1, '账号创建时间只查一次');
  assert.match(accountQueries[0].sql, /SELECT\s+created_at\s+FROM\s+accounts/i);
  assert.deepEqual(accountQueries[0].params, [ACCOUNT_ID]);
  assert.deepEqual(
    calls.filter((c) => /^\s*(INSERT|UPDATE|DELETE)\b/i.test(c.sql)),
    [],
    'GET_AGENT_INFO 不写库',
  );
});

test('loadAccountCreatedAt：账号行不存在时抛错，不编造时间', async () => {
  await assert.rejects(getAgentInfo('player', null), /account not found/);
  const { pool } = stubPool(null);
  await assert.rejects(loadAccountCreatedAt(pool, ACCOUNT_ID), /account not found/);
});

test('loadAccountCreatedAt：返回值的时区与毫秒不被截断', async () => {
  const { pool } = stubPool(new Date('2026-01-02T03:04:05.006Z'));
  assert.equal(await loadAccountCreatedAt(pool, ACCOUNT_ID), '2026-01-02T03:04:05.006Z');
});