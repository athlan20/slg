// Agent API 文档路由的注入测试：不启动监听、不需要数据库，
// 验证 /agent-api.md 与 /agent-api.json 的状态码、内容类型与「响应体 = 生成产物」。

import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import { PROTOCOL_VERSION } from '../common/src/protocol';
import { renderAgentApiManifest, renderAgentApiMarkdown } from '../common/src/protocol-doc-render';
import { registerAgentApiRoutes } from '../api/src/agent-api-routes';

test('GET /agent-api.md 返回与生成产物一致的 Markdown', async () => {
  const app = fastify();
  registerAgentApiRoutes(app);
  try {
    const res = await app.inject({ method: 'GET', url: '/agent-api.md' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /text\/markdown/);
    assert.equal(res.body, renderAgentApiMarkdown());
    assert.ok(res.body.startsWith('# SLG Agent API 参考'));
  } finally {
    await app.close();
  }
});

test('GET /agent-api.json 返回与生成产物一致的 JSON，含协议版本', async () => {
  const app = fastify();
  registerAgentApiRoutes(app);
  try {
    const res = await app.inject({ method: 'GET', url: '/agent-api.json' });
    assert.equal(res.statusCode, 200);
    assert.match(res.headers['content-type'] ?? '', /application\/json/);
    assert.equal(res.body, renderAgentApiManifest());
    const manifest = JSON.parse(res.body);
    assert.equal(manifest.version, PROTOCOL_VERSION);
    assert.ok(Array.isArray(manifest.ops) && manifest.ops.length > 0);
  } finally {
    await app.close();
  }
});
