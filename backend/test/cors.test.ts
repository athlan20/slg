// 跨域（CORS）注册的单元测试（api/src/cors.ts）：来源过滤策略与预检行为，
// 用 inject 在无数据库环境验证。生产背景：站点 slg.example.cn 与 API 网关
// slgws.example.cn 不同源，浏览器跨域读 HTTP 路由需要跨域头。

import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import { corsOriginFilter, parseCorsOrigins, PRODUCTION_SITE_ORIGIN, registerCors } from '../api/src/cors';

async function buildApp(): Promise<ReturnType<typeof fastify>> {
  const app = fastify();
  await registerCors(app);
  app.get('/health', async () => ({ ok: true }));
  return app;
}

test('parseCorsOrigins：未设置为默认白名单（生产站点）；* 与逗号清单可覆盖', () => {
  assert.deepEqual(parseCorsOrigins(undefined), [PRODUCTION_SITE_ORIGIN]);
  assert.deepEqual(parseCorsOrigins('  '), [PRODUCTION_SITE_ORIGIN]);
  assert.equal(parseCorsOrigins('*'), '*');
  assert.deepEqual(parseCorsOrigins('https://a.com, https://b.com'), ['https://a.com', 'https://b.com']);
});

test('corsOriginFilter：默认白名单放行生产站点与本地开发来源，拒绝陌生来源', async () => {
  const filter = corsOriginFilter(parseCorsOrigins(undefined));
  const allow = (origin: string | undefined): Promise<boolean> =>
    new Promise((resolve) => filter(origin, (_err, ok) => resolve(ok === true)));
  assert.equal(await allow(PRODUCTION_SITE_ORIGIN), true);
  assert.equal(await allow('http://localhost:8424'), true, 'rsbuild dev 端口');
  assert.equal(await allow('http://127.0.0.1:3000'), true);
  assert.equal(await allow('https://evil.example'), false);
  assert.equal(await allow(undefined), false, '无 Origin（同源 / 非浏览器）不加跨域头');
});

test('默认策略：生产站点跨域读 /health 带回显 Origin 头，陌生来源不带', async () => {
  const app = await buildApp();
  const ok = await app.inject({ method: 'GET', url: '/health', headers: { origin: PRODUCTION_SITE_ORIGIN } });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['access-control-allow-origin'], PRODUCTION_SITE_ORIGIN, '回显放行的来源');

  const denied = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
  assert.equal(denied.statusCode, 200, '拒绝跨域只体现为缺头，不影响访问本身');
  assert.equal(denied.headers['access-control-allow-origin'], undefined);

  const sameOrigin = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(sameOrigin.statusCode, 200);
  assert.equal(sameOrigin.headers['access-control-allow-origin'], undefined);
});

test('预检（OPTIONS）：白名单来源返回 204 与允许方法，陌生来源不带跨域头', async () => {
  const app = await buildApp();
  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/health',
    headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' },
  });
  assert.equal(preflight.statusCode, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5173');
  assert.ok((preflight.headers['access-control-allow-methods'] ?? '').includes('GET'));

  const denied = await app.inject({
    method: 'OPTIONS',
    url: '/health',
    headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
  });
  assert.equal(denied.headers['access-control-allow-origin'], undefined);
});

test('CORS_ORIGIN=* ：任意来源放行（宽策略）', async () => {
  const previous = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = '*';
  try {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://any.example' } });
    assert.equal(res.headers['access-control-allow-origin'], 'https://any.example');
  } finally {
    if (previous === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = previous;
    }
  }
});

test('CORS_ORIGIN 白名单：精确匹配清单成员', async () => {
  const previous = process.env.CORS_ORIGIN;
  process.env.CORS_ORIGIN = 'https://a.com,https://b.com';
  try {
    const app = await buildApp();
    const ok = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://a.com' } });
    assert.equal(ok.headers['access-control-allow-origin'], 'https://a.com');
    const denied = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://c.com' } });
    assert.equal(denied.headers['access-control-allow-origin'], undefined);
  } finally {
    if (previous === undefined) {
      delete process.env.CORS_ORIGIN;
    } else {
      process.env.CORS_ORIGIN = previous;
    }
  }
});
