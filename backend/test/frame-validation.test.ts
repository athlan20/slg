// 帧规整层（handleMessage 的协议帧校验）的单元测试（不依赖数据库）。
// 只覆盖登录检查之前的纯帧校验路径；进入具体 handler 的流程由 scripts/smoke.ts 端到端覆盖。

import test from 'node:test';
import assert from 'node:assert/strict';
import type { WebSocket } from 'ws';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import type { ResponseFrame } from '../common/src/protocol';

/** 一条未登录连接 + 其发出的全部响应帧 */
function makeConn(): { conn: ConnInfo; sent: ResponseFrame[] } {
  const sent: ResponseFrame[] = [];
  const socket = {
    readyState: 1,
    OPEN: 1,
    send: (raw: string) => sent.push(JSON.parse(raw)),
  } as unknown as WebSocket;
  const registry = new ConnectionRegistry();
  const conn: ConnInfo = {
    socket,
    ip: '203.0.113.10',
    host: null,
    accountId: null,
    username: null,
    role: null,
    sessionId: null,
    connectedAt: new Date(),
  };
  registry.add(conn);
  return { conn, sent };
}

function ctxOf(): HandlerContext {
  return { pool: undefined as unknown as HandlerContext['pool'], registry: new ConnectionRegistry(), passwordDisabledHosts: new Set() };
}

test('非 JSON 文本帧返回 INVALID_MESSAGE：op=0 且无 seq（解析不出任何字段）', async () => {
  const { conn, sent } = makeConn();
  await handleMessage(ctxOf(), conn, '这不是JSON');
  assert.equal(sent.length, 1);
  const frame = sent[0];
  assert.equal(frame.op, 0);
  assert.equal(frame.ok, false);
  assert.equal(frame.error?.code, 'INVALID_MESSAGE');
  assert.equal('seq' in frame, false);
});

test('非法帧回带 seq（v17）：能解析出数字 seq 时原样回带，op 恒为 0', async () => {
  const cases: Array<{ raw: string; seq?: number }> = [
    { raw: '{"seq":5}', seq: 5 },
    { raw: '{"op":"21","seq":5}', seq: 5 },
    { raw: '{"op":null,"seq":42}', seq: 42 },
    { raw: '{"op":"21","seq":"x"}' },
    { raw: '"hello"' },
    { raw: '123' },
  ];
  for (const { raw, seq } of cases) {
    const { conn, sent } = makeConn();
    await handleMessage(ctxOf(), conn, raw);
    assert.equal(sent.length, 1, raw);
    const frame = sent[0];
    assert.equal(frame.op, 0, raw);
    assert.equal(frame.ok, false);
    assert.equal(frame.error?.code, 'INVALID_MESSAGE', raw);
    if (seq === undefined) {
      assert.equal('seq' in frame, false, `${raw} 不应带 seq`);
    } else {
      assert.equal(frame.seq, seq, raw);
    }
  }
});

test('非整数 op（如 21.5）按非法帧拒绝为 INVALID_MESSAGE，不再原样回显（v17）', async () => {
  const { conn, sent } = makeConn();
  await handleMessage(ctxOf(), conn, '{"op":21.5,"seq":1}');
  assert.equal(sent.length, 1);
  const frame = sent[0];
  assert.equal(frame.op, 0);
  assert.equal(frame.seq, 1);
  assert.equal(frame.error?.code, 'INVALID_MESSAGE');
});

test('合法帧的 op / seq 回带不受影响：未登录发业务协议返回 NOT_LOGGED_IN', async () => {
  const a = makeConn();
  await handleMessage(ctxOf(), a.conn, '{"op":999,"seq":7}');
  assert.equal(a.sent.length, 1);
  assert.equal(a.sent[0].op, 999);
  assert.equal(a.sent[0].seq, 7);
  assert.equal(a.sent[0].error?.code, 'NOT_LOGGED_IN');

  const b = makeConn();
  await handleMessage(ctxOf(), b.conn, '{"op":999}');
  assert.equal('seq' in b.sent[0], false);
});
