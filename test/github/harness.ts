// GitHub 登录联调的公共设施：假 GitHub 服务（access_token + /user）+ 真实 API 进程（临时端口）。
// 复用微信联调的极简 WebSocket 客户端（../wechat/harness）。API 进程经 GITHUB_API_BASE 指向
// 假 GitHub（github.ts 读该环境变量），FRONTEND_URL 指向一个假端口（不需要真的起前端——
// 测试只断言 302 的 Location）。连 DATABASE_URL 指向的 PostgreSQL（见 test/README.md）。

import http from 'node:http';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { Client, type Harness as WechatHarness } from '../wechat/harness';

export { Client } from '../wechat/harness';
export type Harness = Omit<WechatHarness, 'scenes'> & {
  httpUrl: string;
  frontendUrl: string;
  /** 造一个对应 GitHub 用户 login 的授权码（同名 = 同一个 GitHub 用户） */
  newCode: (login: string) => string;
  /** 双站点套（v47）：key = 测试 Host（cn.test 国内 / cc.test 国际，后者禁密码登录） */
  sites: typeof SITES;
};

export const Op = {
  LOGIN: 1,
  GET_STATE: 10,
  GET_AGENT_INFO: 12,
  GET_AGENT_TOKEN: 64,
  GOOGLE_LOGIN: 60,
  GOOGLE_BIND: 61,
  GITHUB_AUTH_START: 62,
  OAUTH_REDEEM: 63,
} as const;

const backendDir = path.resolve(__dirname, '../../backend');
let codeRun = 0;
const CLIENT_ID = 'gh-test-client-id';
const CLIENT_SECRET = 'gh-test-secret';
const REDIRECT_URI = 'http://127.0.0.1:1/auth/github/callback'; // 不会被真的访问，只是回传给 GitHub 校验
// 双站点套（v47）：cn.test / cc.test 各一个「OAuth App」，假 GitHub 两个都认；
// cc.test 同时在 PASSWORD_LOGIN_DISABLED_HOSTS 里（国际站只有第三方登录）。
// apiBase 指向假 GitHub（在 startHarness 里才知道端口，故此处为构造函数）
const makeSites = (githubBase: string) => ({
  'cn.test': { clientId: 'gh-cn-site', clientSecret: 'gh-cn-secret', redirectUri: 'http://127.0.0.1:1/auth/github/callback', frontendUrl: 'http://127.0.0.1:18999', apiBase: githubBase },
  'cc.test': { clientId: 'gh-cc-site', clientSecret: 'gh-cc-secret', redirectUri: 'http://127.0.0.1:2/auth/github/callback', frontendUrl: 'http://127.0.0.1:18998', apiBase: githubBase },
});

export interface HarnessOptions {
  apiPort: number;
  frontendPort: number;
  /** false = 不配 GitHub 凭证（验证「没配置时功能整体关闭」） */
  githubEnabled?: boolean;
}

/** 启动假 GitHub 服务与 API 进程，等 /health 就绪；调用方负责 stop() */
export async function startHarness(options: HarnessOptions): Promise<Harness> {
  const frontendUrl = `http://127.0.0.1:${options.frontendPort}`;
  // 假 GitHub：login 名 → 固定数字 id；code 一次性；token 换回用户。
  // id 以当前时间戳为起点（每轮运行唯一）：库里留着上一轮的绑定，相同 id 会串到上一轮的账号
  let nextUserId = Math.floor(Date.now());  // 毫秒精度：快速连续重跑也不与上一轮的 id 撞车
  const users = new Map<string, { id: number; login: string }>();
  const codeToLogin = new Map<string, string>();
  const usedCodes = new Set<string>();
  const tokenToUser = new Map<string, { id: number; login: string }>();
  let codeSeq = 0;

  const fakeGithub = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const json = (body: unknown, status = 200) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/login/oauth/access_token' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        const form = new URLSearchParams(body);
        const known = [
          { id: CLIENT_ID, secret: CLIENT_SECRET },
          { id: 'gh-cn-site', secret: 'gh-cn-secret' },
          { id: 'gh-cc-site', secret: 'gh-cc-secret' },
        ];
        if (!known.some((k) => form.get('client_id') === k.id && form.get('client_secret') === k.secret)) {
          return json({ error: 'incorrect_client_secret' });
        }
        const code = form.get('code') ?? '';
        const login = codeToLogin.get(code);
        if (!login || usedCodes.has(code)) {
          return json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect' });
        }
        usedCodes.add(code); // code 一次性
        const token = `gho-fake-${code}`;
        tokenToUser.set(token, users.get(login)!);
        return json({ access_token: token, token_type: 'bearer' });
      });
      return;
    }
    if (url.pathname === '/user') {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const user = tokenToUser.get(token);
      if (!user) {
        return json({ message: 'Bad credentials' }, 401);
      }
      return json(user);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fakeGithub.listen(0, '127.0.0.1', resolve));
  const githubPort = (fakeGithub.address() as AddressInfo).port;

  const api: ChildProcess = spawn('npx', ['tsx', '--env-file=.env', 'api/src/index.ts'], {
    cwd: backendDir,
    env: {
      ...process.env,
      PORT: String(options.apiPort),
      HOST: '127.0.0.1',
      GITHUB_API_BASE: `http://127.0.0.1:${githubPort}`,
      GITHUB_CLIENT_ID: CLIENT_ID,
      GITHUB_CLIENT_SECRET: CLIENT_SECRET,
      GITHUB_REDIRECT_URI: REDIRECT_URI,
      FRONTEND_URL: frontendUrl,
      GITHUB_SITES: JSON.stringify(makeSites(`http://127.0.0.1:${githubPort}`)),
      PASSWORD_LOGIN_DISABLED_HOSTS: 'cc.test',
      // 本套只测 GitHub：显式关掉微信与 Google（--env-file=.env 可能带着本地凭证进来）
      WX_APPID: '',
      WX_APPSECRET: '',
      GOOGLE_CLIENT_ID: '',
      ...(options.githubEnabled === false
        ? { GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '' }
        : {}),
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
      fakeGithub.close();
      throw new Error('API 进程启动超时');
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  const opened: Client[] = [];
  const harness: Harness = {
    apiPort: options.apiPort,
    wsUrl: `ws://127.0.0.1:${options.apiPort}/ws`,
    httpUrl: `http://127.0.0.1:${options.apiPort}`,
    frontendUrl,
    newCode(login: string): string {
      if (!users.has(login)) {
        users.set(login, { id: nextUserId++, login });
      }
      const code = `code-${login}-${codeRun++}`;
      codeToLogin.set(code, login);
      return code;
    },
    async connect() {
      const client = await Client.connect(options.apiPort);
      opened.push(client);
      return client;
    },
    sites: makeSites(`http://127.0.0.1:${githubPort}`),
    stop() {
      opened.forEach((c) => c.close());
      api.kill('SIGTERM');
      fakeGithub.close();
    },
  };
  return harness;
}

