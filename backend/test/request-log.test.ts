// 请求日志脱敏（AISLG-173）：GitHub 回调查询串里的 code / state 在日志里替换为 [redacted]，
// 其他路由的日志不受影响。用真实 fastify 实例 + 内存日志流核对输出。

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { redactRequestUrl, requestLogSerializer } from '../api/src/request-log';

test('redactRequestUrl：回调地址的 code / state 被替换，其他参数保留', () => {
  assert.equal(
    redactRequestUrl('/auth/github/callback?code=AUTHCODE123&state=STATE456'),
    '/auth/github/callback?code=[redacted]&state=[redacted]',
  );
  assert.equal(
    redactRequestUrl('/auth/github/callback/?error=access_denied&state=STATE456'),
    '/auth/github/callback/?error=access_denied&state=[redacted]',
  );
  // 编码过的参数名同样识别
  assert.equal(redactRequestUrl('/auth/github/callback?%63ode=AUTHCODE123'), '/auth/github/callback?%63ode=[redacted]');
});

test('redactRequestUrl：其他路由与无查询串的地址原样保留', () => {
  assert.equal(redactRequestUrl('/health?code=keep&state=keep'), '/health?code=keep&state=keep');
  assert.equal(redactRequestUrl('/ws'), '/ws');
  assert.equal(redactRequestUrl('/auth/github/callback'), '/auth/github/callback');
});

test('请求日志：回调请求的 url 脱敏，其他路由的日志不变', async () => {
  const lines: string[] = [];
  const app = Fastify({
    logger: {
      level: 'info',
      stream: { write: (line: string) => void lines.push(line) },
      serializers: { req: requestLogSerializer },
    },
  });
  app.get('/auth/github/callback', async () => 'ok');
  app.get('/health', async () => ({ ok: true }));

  await app.inject({ method: 'GET', url: '/auth/github/callback?code=AUTHCODE123&state=STATE456' });
  await app.inject({ method: 'GET', url: '/health?code=keep' });
  await app.close();

  const all = lines.join('\n');
  assert.ok(!all.includes('AUTHCODE123'), '日志不得含授权码');
  assert.ok(!all.includes('STATE456'), '日志不得含 state');
  assert.ok(all.includes('/auth/github/callback?code=[redacted]&state=[redacted]'));
  assert.ok(all.includes('/health?code=keep'), '其他路由的查询串保持原样');
});
