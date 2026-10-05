// Google 登录联调的公共设施：假 JWKS 服务（本地生成的 RSA 公钥）+ 真实 API 进程（临时端口）
// + 用同一把私钥签 ID Token 的工具。复用微信联调的极简 WebSocket 客户端（../wechat/harness）。
// API 进程经 GOOGLE_CERTS_URL 指向假 JWKS（google.ts 读该环境变量），连 DATABASE_URL
// 指向的 PostgreSQL（建议用临时库，见 test/README.md）。

import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Client, type Harness as WechatHarness } from '../wechat/harness';

export { Client } from '../wechat/harness';
export type Harness = Omit<WechatHarness, 'scenes'> & { httpUrl: string; makeToken: typeof makeToken };

export const Op = {
  LOGIN: 1,
  GET_STATE: 10,
  GET_AGENT_INFO: 12,
  GET_AGENT_TOKEN: 64,
  GOOGLE_LOGIN: 60,
  GOOGLE_BIND: 61,
} as const;

const backendDir = path.resolve(__dirname, '../../backend');

/** 测试密钥对：公钥进假 JWKS，私钥留给 makeToken 签名 */
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as { kty: string; n: string; e: string };
const KID = 'google-test-kid';
const jwksBody = JSON.stringify({ keys: [{ kid: KID, ...jwk, alg: 'RS256', use: 'sig' }] });

const b64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

export interface TokenOptions {
  sub?: string;
  email?: string;
  aud?: string;
  iss?: string;
  /** 相对当前时间的过期秒数 */
  expInSeconds?: number;
  /** 用另一把私钥签名（模拟伪造） */
  wrongKey?: boolean;
}

/** 按测试参数签一个 Google ID Token（与假 JWKS 里的公钥配对） */
export function makeToken(options: TokenOptions = {}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', kid: KID, typ: 'JWT' };
  const claims = {
    iss: options.iss ?? 'https://accounts.google.com',
    aud: options.aud ?? 'google-test-client-id',
    sub: options.sub ?? 'google-sub-anonymous',
    email: options.email ?? 'player@example.com',
    exp: nowSec + (options.expInSeconds ?? 3600),
    iat: nowSec,
  };
  const signed = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = options.wrongKey ? generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey : privateKey;
  return `${signed}.${b64url(cryptoSign('RSA-SHA256', Buffer.from(signed), key))}`;
}

export interface HarnessOptions {
  apiPort: number;
  /** false = 不配 GOOGLE_CLIENT_ID（验证「没配置时功能整体关闭」） */
  googleEnabled?: boolean;
}

/** 启动假 JWKS 服务与 API 进程，等 /health 就绪；调用方负责 stop() */
export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const certs = http.createServer((req, res) => {
    if (req.url === '/certs') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' });
      res.end(jwksBody);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => certs.listen(0, '127.0.0.1', resolve));
  const certsPort = (certs.address() as AddressInfo).port;

  const api: ChildProcess = spawn('npx', ['tsx', '--env-file=.env', 'api/src/index.ts'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(options.apiPort),
      HOST: '127.0.0.1',
      GOOGLE_CERTS_URL: `http://127.0.0.1:${certsPort}/certs`,
      ...(options.googleEnabled === false ? { GOOGLE_CLIENT_ID: '' } : { GOOGLE_CLIENT_ID: 'google-test-client-id' }),
      // 本套只测 Google：显式关掉微信（进程会 --env-file=.env，可能带着本地微信凭证进来）
      WX_APPID: '',
      WX_APPSECRET: '',
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
    if (Date.now() >= deadline) {
      api.kill('SIGKILL');
      certs.close();
      throw new Error('API 进程启动超时');
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const opened: Client[] = [];
  const harness: Harness = {
    apiPort: options.apiPort,
    wsUrl: `ws://127.0.0.1:${options.apiPort}/ws`,
    httpUrl: `http://127.0.0.1:${options.apiPort}`,
    makeToken,
    async connect() {
      const client = await Client.connect(options.apiPort);
      opened.push(client);
      return client;
    },
    stop() {
      opened.forEach((c) => c.close());
      api.kill('SIGTERM');
      certs.close();
    },
  };
  return harness;
}
