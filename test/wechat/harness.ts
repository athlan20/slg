// 微信扫码联调的公共设施：假微信服务 + 真实 API 进程（临时端口）+ 极简 WebSocket 客户端。
// node 联调测试（wechat-login.test.ts）与浏览器 E2E（e2e/wechat-login.spec.ts）共用；
// ws / tsx 取自 backend 的依赖，API 进程连 DATABASE_URL 指向的 PostgreSQL（建议用临时库，见 test/README.md）。

import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';

const backendDir = path.resolve(__dirname, '../../backend');
const requireFromBackend = createRequire(path.join(backendDir, 'package.json'));
const WebSocket = requireFromBackend('ws') as typeof import('ws').WebSocket;

export const Op = {
  LOGIN: 1,
  LOGOUT: 2,
  GET_STATE: 10,
  GET_AGENT_INFO: 12,
  WX_QR_CREATE: 54,
  WX_SCAN: 55,
  WX_CONFIRM: 56,
  WX_CANCEL: 57,
  GET_AGENT_TOKEN: 64,
  RESET_AGENT_TOKEN: 65,
  PUSH_WX_QR_STATUS: 2018,
} as const;

export interface Frame {
  op: number;
  seq?: number;
  ok?: boolean;
  push?: boolean;
  data?: Record<string, any>;
  error?: { code: string; message: string };
}

/** 极简 WS 客户端：请求按 seq 关联响应，推送存入队列等待 */
export class Client {
  readonly pushes: Frame[] = [];
  closeCode: number | null = null;
  private seq = 0;
  private waiting = new Map<number, (frame: Frame) => void>();
  private pushWaiters: Array<() => void> = [];

  private constructor(private readonly socket: InstanceType<typeof WebSocket>) {
    socket.on('message', (raw) => {
      const frame = JSON.parse(String(raw)) as Frame;
      if (frame.push) {
        this.pushes.push(frame);
        this.pushWaiters.splice(0).forEach((fn) => fn());
      } else if (frame.seq !== undefined) {
        this.waiting.get(frame.seq)?.(frame);
        this.waiting.delete(frame.seq);
      }
    });
    socket.on('close', (code) => {
      this.closeCode = code;
      this.pushWaiters.splice(0).forEach((fn) => fn());
    });
  }

  static connect(port: number): Promise<Client> {
    return Client.connectWithHost(port, undefined);
  }

  /** 带自定义 Host 头连接（双站点测试：连哪个域名就算哪个站，v47） */
  static connectWithHost(port: number, host: string | undefined): Promise<Client> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, host ? { headers: { Host: host } } : {});
      socket.once('open', () => resolve(new Client(socket)));
      socket.once('error', reject);
    });
  }

  get isOpen(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  call(op: number, data?: Record<string, unknown>): Promise<Frame> {
    const seq = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`op ${op} 响应超时`)), 10_000);
      this.waiting.set(seq, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
      this.socket.send(JSON.stringify({ op, seq, data }));
    });
  }

  /** 等到满足条件的推送（已到的也算）；超时抛错 */
  async waitPush(match: (frame: Frame) => boolean, timeoutMs = 15_000): Promise<Frame> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = this.pushes.find(match);
      if (found) {
        return found;
      }
      const left = deadline - Date.now();
      if (left <= 0 || this.closeCode !== null) {
        throw new Error('等待推送超时或连接已关闭');
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, left);
        this.pushWaiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  async waitClose(timeoutMs = 5000): Promise<number | null> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    return this.closeCode;
  }

  close(): void {
    this.socket.close();
  }
}


export interface Harness {
  apiPort: number;
  wsUrl: string;
  /** 假微信收到的二维码 scene（= ticket），按生成顺序 */
  scenes: string[];
  connect: () => Promise<Client>;
  stop: () => void;
}

export interface HarnessOptions {
  apiPort: number;
  ticketTtlSeconds: number;
  authTimeoutMs?: number;
}

/** 启动假微信服务与 API 进程，等 /health 就绪；调用方负责 stop() */
export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const scenes: string[] = [];
  const usedCodes = new Set<string>();
  const opened: Client[] = [];
  const fakeWechat = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const json = (body: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/cgi-bin/stable_token') {
      return json({ access_token: 'fake-token', expires_in: 7200 });
    }
    if (url.pathname === '/wxa/getwxacodeunlimit') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        scenes.push((JSON.parse(body) as { scene: string }).scene);
        // 1×1 的合法 PNG：浏览器里 <img> 能正常解码显示
        res.writeHead(200, { 'content-type': 'image/png' });
        res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
      });
      return;
    }
    if (url.pathname === '/sns/jscode2session') {
      const code = url.searchParams.get('js_code') ?? '';
      if (usedCodes.has(code)) {
        return json({ errcode: 40163, errmsg: 'code been used' });
      }
      usedCodes.add(code);
      // code 形如 "wxuser-<名字>-<序号>"：同名 = 同一个微信用户（同一个 openid）
      return json({ openid: `openid-${code.split('-')[1]}`, session_key: 'never-used' });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fakeWechat.listen(0, '127.0.0.1', resolve));
  const fakePort = (fakeWechat.address() as AddressInfo).port;

  const api: ChildProcess = spawn('npx', ['tsx', '--env-file=.env', 'api/src/index.ts'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(options.apiPort),
      HOST: '127.0.0.1',
      WX_APPID: 'wx-fake-app',
      WX_APPSECRET: 'fake-secret',
      WX_API_BASE: `http://127.0.0.1:${fakePort}`,
      WX_TICKET_TTL_SECONDS: String(options.ticketTtlSeconds),
      ...(options.authTimeoutMs ? { AUTH_TIMEOUT_MS: String(options.authTimeoutMs) } : {}),
      LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${options.apiPort}/health`)).ok) {
        break;
      }
    } catch {
      // 还没起来
    }
    assert.ok(Date.now() < deadline, 'API 进程启动超时');
    await new Promise((r) => setTimeout(r, 300));
  }

  return {
    apiPort: options.apiPort,
    wsUrl: `ws://127.0.0.1:${options.apiPort}/ws`,
    scenes,
    async connect() {
      const client = await Client.connect(options.apiPort);
      opened.push(client);
      return client;
    },
    stop() {
      opened.forEach((c) => c.close());
      api.kill('SIGTERM');
      fakeWechat.close();
    },
  };
}
