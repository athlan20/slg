// 充值的联调设施（AISLG-251，v108）：真实 API 进程（临时端口）+ 假支付渠道 + 极简 WebSocket 客户端。
// 假渠道由 PAYMENT_PROVIDER=fake 打开（common/src/payments/fake.ts）：建结账会话不发网络请求，
// 验签算法与 Creem 完全一致（头 creem-signature = HMAC-SHA256(原始请求体) 的十六进制串），
// 所以这里签的回调走的是真实路由、真实解析、真实入账。
// DATABASE_URL 必须显式给出（**不要**退回 backend/.env 的共用库；建议用临时集群，见 test/README.md）。

import assert from 'node:assert/strict';
import path from 'node:path';
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';

const backendDir = path.resolve(__dirname, '../../backend');
const requireFromBackend = createRequire(path.join(backendDir, 'package.json'));
const pg = requireFromBackend('pg') as typeof import('pg');

export { Client } from '../wechat/harness';

export const Op = {
  LOGIN: 1,
  GET_STATE: 10,
  GET_ITEMS: 148,
  BUY_ITEM: 149,
  CREATE_TOPUP: 155,
  GET_AGENT_TOKEN: 64,
  PUSH_ACCOUNT_STATE: 2020,
} as const;

/** 联调用的 Webhook Secret（假值，只在测试进程里用） */
export const WEBHOOK_SECRET = 'test-webhook-secret-251';

export interface Harness {
  apiPort: number;
  connect: () => ReturnType<typeof import('../wechat/harness').Client.connect>;
  stop: () => void;
}

export interface HarnessOptions {
  apiPort: number;
  /** false = 不配支付渠道（验证 CREATE_TOPUP 回 TOPUP_UNAVAILABLE、回调回 503） */
  paymentsEnabled?: boolean;
}

/** 对原始请求体算签名（与 Creem / FakeProvider 同一算法） */
export function signWebhook(rawBody: string, secret: string = WEBHOOK_SECRET): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** 向 API 发一条回调；返回 HTTP 状态与响应体 */
export async function postWebhook(
  apiPort: number,
  body: string,
  options: { signature?: string | null } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const signature = options.signature === undefined ? signWebhook(body) : options.signature;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (signature !== null) {
    headers['creem-signature'] = signature;
  }
  const res = await fetch(`http://127.0.0.1:${apiPort}/pay/creem/webhook`, { method: 'POST', headers, body });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** 直连数据库读订单（验证 status / clawback_short 等落库结果） */
export async function loadOrderRow(
  databaseUrl: string,
  orderId: string,
): Promise<{ status: string; ingot_amount: number; clawback_short: number } | null> {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const res = await pool.query(
      `SELECT status, ingot_amount, clawback_short FROM topup_orders WHERE id = $1`,
      [orderId],
    );
    return res.rowCount ? (res.rows[0] as { status: string; ingot_amount: number; clawback_short: number }) : null;
  } finally {
    await pool.end();
  }
}

/** 启动真实 API 进程（假支付渠道）并等 /health 就绪；调用方负责 stop() */
export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, '需要 DATABASE_URL（指向临时库）');
  const paymentsEnabled = options.paymentsEnabled ?? true;
  const api: ChildProcess = spawn('npx', ['tsx', '--env-file=.env', 'api/src/index.ts'], {
    cwd: backendDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      PORT: String(options.apiPort),
      HOST: '127.0.0.1',
      LOG_LEVEL: 'warn',
      ...(paymentsEnabled
        ? {
            PAYMENT_PROVIDER: 'fake',
            CREEM_WEBHOOK_SECRET: WEBHOOK_SECRET,
            CREEM_API_KEY: 'fake-api-key',
            CREEM_PRODUCT_TOPUP_1000: 'topup_199',
            PUBLIC_SITE_URL: 'https://slg.example.test',
          }
        : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${options.apiPort}/health`)).ok) {
        break;
      }
    } catch {
      // 还没起来
    }
    assert.ok(Date.now() < deadline, 'API 进程启动超时');
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  const { Client } = await import('../wechat/harness');
  const opened: Array<{ close: () => void }> = [];
  return {
    apiPort: options.apiPort,
    async connect() {
      const client = await Client.connect(options.apiPort);
      opened.push(client);
      return client;
    },
    stop() {
      opened.forEach((client) => client.close());
      api.kill('SIGTERM');
    },
  };
}