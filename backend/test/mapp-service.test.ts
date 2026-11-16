// Linux.do 微应用 WebSocket 握手升级拦截单测（AISLG-261）。
// 测试 MAPP_ENABLED 开关控制、Origin 白名单与令牌合法性校验。

import test from 'node:test';
import assert from 'node:assert/strict';
import fastify from 'fastify';
import websocketPlugin from '@fastify/websocket';
import WebSocket from 'ws';
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';
import { MappService } from '../api/src/mapp/service';
import { JwksCache, computeSpkiSha256 } from '../api/src/mapp/jwks';
import type { MappConfig } from '../api/src/mapp/types';
import type { ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';

const keyPair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const pubKid = computeSpkiSha256(keyPair.publicKey);

const testConfig: MappConfig = {
  enabled: true,
  issuer: 'https://linux.do',
  appId: '019a2a58-0000-7000-8000-000000000001',
  channel: 'production',
  audience: 'https://slgws.example.com',
  origins: new Set(['https://linux.do']),
  identityProvider: 'linuxdo_mapp',
  minTrustLevel: 1,
};

function buildValidToken(audience: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'ES256', typ: 'mini-app-access+jwt', kid: pubKid };
  const payload = {
    iss: 'https://linux.do',
    aud: audience,
    sub: '10086',
    trust_level: 2,
    app_id: '019a2a58-0000-7000-8000-000000000001',
    channel: 'production',
    scopes: ['network.websocket'],
    version: '1.0.0',
    iat: now,
    nbf: now,
    exp: now + 600,
    jti: 'test-jti-1234567890abcdef',
    htm: 'GET',
    htu: `${audience}/ws`,
    query_keys: [],
  };

  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = Buffer.from(`${headerB64}.${payloadB64}`);
  const sig = sign('sha256', data, { key: keyPair.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${headerB64}.${payloadB64}.${sig.toString('base64url')}`;
}

async function createTestServer(mappService: MappService | null): Promise<{
  app: ReturnType<typeof fastify>;
  port: number;
  lastConn: ConnInfo | null;
}> {
  const app = fastify();
  await app.register(websocketPlugin);

  let lastConn: ConnInfo | null = null;
  const ctx: Partial<HandlerContext> = {
    mapp: mappService ?? undefined,
  };

  app.get(
    '/ws',
    {
      websocket: true,
      preValidation: async (request, reply) => {
        const rawUrl = request.raw.url ?? request.url ?? '';
        const search = rawUrl.includes('?') ? rawUrl.slice(rawUrl.indexOf('?') + 1) : '';
        const hasMappToken = /(?:^|[&?])mini_app_token(?:=|$)/.test(search);
        if (!hasMappToken) {
          return;
        }
        (request.raw as unknown as Record<string, unknown>).mappTokenPresent = true;
        if (!ctx.mapp?.enabled) {
          reply.code(401).send('Unauthorized');
          return;
        }
        try {
          const identity = await ctx.mapp.verifyUpgrade(request);
          (request.raw as unknown as Record<string, unknown>).mappIdentity = identity;
        } catch {
          reply.code(401).send('Unauthorized');
          return;
        }
      },
    },
    (socket: WebSocket, request) => {
      const rawReq = request.raw as unknown as Record<string, unknown>;
      const conn: ConnInfo = {
        socket,
        ip: request.ip || null,
        host: null,
        origin: typeof request.headers.origin === 'string' ? request.headers.origin : null,
        accountId: null,
        username: null,
        role: null,
        sessionId: null,
        connectedAt: new Date(),
        mappIdentity: (rawReq.mappIdentity as ConnInfo['mappIdentity']) ?? null,
        mappTokenPresent: (rawReq.mappTokenPresent as boolean) ?? false,
      };
      lastConn = conn;
    },
  );

  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { app, port, lastConn };
}

test('MAPP_ENABLED 关闭时：带 mini_app_token 被 401 拒绝，不带该参数正常建连', async () => {
  const { app, port } = await createTestServer(null);

  try {
    // 1. 不带 token：正常建立 WebSocket 连接
    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => ws1.on('open', resolve));
    assert.equal(ws1.readyState, WebSocket.OPEN);
    ws1.close();

    // 2. 带 token：升级被 401 拒绝
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?mini_app_token=some_token`);
    let statusCode: number | undefined;
    await new Promise((resolve) => {
      ws2.on('unexpected-response', (_req, res) => {
        statusCode = res.statusCode;
        resolve(null);
      });
      ws2.on('error', () => resolve(null));
    });
    assert.equal(statusCode, 401);
  } finally {
    await app.close();
  }
});

test('MAPP_ENABLED 开启时：Origin 检查与令牌有效性', async () => {
  const cache = new JwksCache({ issuer: testConfig.issuer });
  cache.setKey(pubKid, keyPair.publicKey);
  const mappService = new MappService(testConfig, cache);

  const { app, port } = await createTestServer(mappService);
  const token = buildValidToken('https://slgws.example.com');

  try {
    // 1. Origin 不在白名单中：被 401 拒绝
    const wsDisallowed = new WebSocket(
      `ws://127.0.0.1:${port}/ws?mini_app_token=${token}`,
      { headers: { Origin: 'https://evil.com' } },
    );
    let statusCodeDisallowed: number | undefined;
    await new Promise((resolve) => {
      wsDisallowed.on('unexpected-response', (_req, res) => {
        statusCodeDisallowed = res.statusCode;
        resolve(null);
      });
      wsDisallowed.on('error', () => resolve(null));
    });
    assert.equal(statusCodeDisallowed, 401);

    // 2. 伪造或损坏的令牌：被 401 拒绝
    const wsCorrupted = new WebSocket(
      `ws://127.0.0.1:${port}/ws?mini_app_token=corrupted.jwt.token`,
      { headers: { Origin: 'https://linux.do' } },
    );
    let statusCodeCorrupted: number | undefined;
    await new Promise((resolve) => {
      wsCorrupted.on('unexpected-response', (_req, res) => {
        statusCodeCorrupted = res.statusCode;
        resolve(null);
      });
      wsCorrupted.on('error', () => resolve(null));
    });
    assert.equal(statusCodeCorrupted, 401);

    // 3. 合法 Origin 与有效令牌：建连成功并挂载 mappIdentity
    const wsOk = new WebSocket(
      `ws://127.0.0.1:${port}/ws?mini_app_token=${token}`,
      { headers: { Origin: 'https://linux.do' } },
    );
    await new Promise((resolve) => wsOk.on('open', resolve));
    assert.equal(wsOk.readyState, WebSocket.OPEN);
    wsOk.close();

    // 4. 不带 token：正常建立普通连接（非 mapp 连接）
    const wsPlain = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((resolve) => wsPlain.on('open', resolve));
    assert.equal(wsPlain.readyState, WebSocket.OPEN);
    wsPlain.close();
  } finally {
    mappService.stop();
    await app.close();
  }
});
