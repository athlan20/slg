// 协议增量变更清单（v32，AISLG-91）：清单完整性、LOGIN docNotice 口径与 /agent-api/changes 路由。

import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import type { WebSocket } from 'ws';
import { Op, PROTOCOL_VERSION, type ResponseFrame } from '../common/src/protocol';
import { PROTOCOL_CHANGELOG, changesSince, docNoticeFor } from '../common/src/protocol-changelog';
import { registerAgentApiRoutes } from '../api/src/agent-api-routes';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';

test('变更清单覆盖 1..PROTOCOL_VERSION 且连续（每次 bump 必须补一条）', () => {
  assert.deepEqual(
    PROTOCOL_CHANGELOG.map((c) => c.version),
    Array.from({ length: PROTOCOL_VERSION }, (_, i) => i + 1),
  );
  for (const c of PROTOCOL_CHANGELOG) {
    assert.ok(c.summary.trim().length > 0, `v${c.version} 摘要为空`);
  }
});

test('changesSince 返回 since 之后（不含）的版本', () => {
  assert.equal(changesSince(0).length, PROTOCOL_VERSION);
  assert.deepEqual(
    changesSince(PROTOCOL_VERSION - 2).map((c) => c.version),
    [PROTOCOL_VERSION - 1, PROTOCOL_VERSION],
  );
  assert.deepEqual(changesSince(PROTOCOL_VERSION), []);
  assert.deepEqual(changesSince(PROTOCOL_VERSION + 5), []);
});

test('docNoticeFor：落后给具体提示，未带给通用提示，最新为 null', () => {
  const outdated = docNoticeFor(PROTOCOL_VERSION - 1);
  assert.ok(outdated?.includes(`v${PROTOCOL_VERSION - 1}`) && outdated.includes(`/agent-api/changes/${PROTOCOL_VERSION - 1}`));
  const generic = docNoticeFor(null);
  assert.ok(generic?.includes(`v${PROTOCOL_VERSION}`) && generic.includes('/agent-api/changes/'));
  assert.equal(docNoticeFor(PROTOCOL_VERSION), null);
  assert.equal(docNoticeFor(PROTOCOL_VERSION + 1), null);
});

test('GET /agent-api/changes/{since} 与 ?since= 返回增量；非法 since 为 400', async () => {
  const app = fastify();
  registerAgentApiRoutes(app);
  try {
    const since = PROTOCOL_VERSION - 1;
    for (const url of [`/agent-api/changes/${since}`, `/agent-api/changes?since=${since}`]) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 200, url);
      assert.match(res.headers['content-type'] ?? '', /application\/json/);
      assert.equal(res.headers['access-control-allow-origin'], '*');
      const body = res.json();
      assert.equal(body.version, PROTOCOL_VERSION);
      assert.equal(body.since, since);
      assert.deepEqual(body.changes, changesSince(since));
    }
    for (const url of ['/agent-api/changes/abc', '/agent-api/changes/-1', '/agent-api/changes', '/agent-api/changes?since=1.5']) {
      const res = await app.inject({ method: 'GET', url });
      assert.equal(res.statusCode, 400, url);
      assert.equal(res.json().error, 'INVALID_PARAMS');
    }
  } finally {
    await app.close();
  }
});

// ---- LOGIN 响应的版本字段：令牌登录 + 只认 SQL 形状的桩连接池（不连数据库） ----

async function tokenLogin(extra: Record<string, unknown>): Promise<ResponseFrame> {
  const sent: ResponseFrame[] = [];
  const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } as unknown as WebSocket;
  const registry = new ConnectionRegistry();
  const conn: ConnInfo = { socket, ip: null, host: null, accountId: null, username: null, role: null, sessionId: null, connectedAt: new Date() };
  registry.add(conn);
  const pool = {
    query: async (sql: string) => {
      if (sql.includes('FROM sessions s JOIN accounts')) {
        return { rowCount: 1, rows: [{ session_id: 's1', account_id: 'a1', username: 'u1' }] };
      }
      if (sql.includes('UPDATE sessions')) {
        return { rowCount: 1, rows: [{ expires_at: new Date('2026-11-01T00:00:00Z') }] };
      }
      return { rowCount: 1, rows: [{ id: 1 }] };
    },
  } as unknown as HandlerContext['pool'];
  await handleMessage({ pool, registry, passwordDisabledHosts: new Set() }, conn, JSON.stringify({ op: Op.LOGIN, seq: 1, data: { token: 't', ...extra } }));
  const frame = sent.find((f) => f.op === Op.LOGIN);
  assert.ok(frame?.ok, JSON.stringify(sent));
  return frame;
}

test('LOGIN 响应带 protocolVersion；docNotice 仅 Agent 连接、按 docVersion 决定', async () => {
  const agentOld = (await tokenLogin({ asAgent: true, docVersion: PROTOCOL_VERSION - 1 })).data as Record<string, unknown>;
  assert.equal(agentOld.protocolVersion, PROTOCOL_VERSION);
  assert.equal(agentOld.docNotice, docNoticeFor(PROTOCOL_VERSION - 1));

  const agentNone = (await tokenLogin({ asAgent: true })).data as Record<string, unknown>;
  assert.equal(agentNone.docNotice, docNoticeFor(null));

  const agentBad = (await tokenLogin({ asAgent: true, docVersion: 'x' })).data as Record<string, unknown>;
  assert.equal(agentBad.docNotice, docNoticeFor(null), '非法 docVersion 视为未提供，不拒绝登录');

  const agentLatest = (await tokenLogin({ asAgent: true, docVersion: PROTOCOL_VERSION })).data as Record<string, unknown>;
  assert.equal(agentLatest.docNotice, null);

  const player = (await tokenLogin({ asAgent: false, docVersion: 1 })).data as Record<string, unknown>;
  assert.equal(player.protocolVersion, PROTOCOL_VERSION);
  assert.equal(player.docNotice, null);
});
