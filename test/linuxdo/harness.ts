// Linux.do 联调：真实 API + 隔离 PostgreSQL，外部 OAuth 换成可控的假服务。
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { Client } from '../wechat/harness';

export { Client };
export const Op = { LOGIN: 1, GET_STATE: 10, GET_AGENT_INFO: 12, OAUTH_AUTH_START: 157, OAUTH_REDEEM: 63, GET_AGENT_TOKEN: 64 } as const;
export type User = { id: number; username: string; trust_level: number; active: boolean; silenced: boolean };

export async function startHarness(apiPort: number, enabled = true) {
  const codes = new Map<string, User>();
  const tokens = new Map<string, User>();
  let sequence = 0;
  const fake = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://fake');
    const json = (value: unknown, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/oauth2/token' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        const form = new URLSearchParams(body);
        if (form.get('client_id') !== 'ld-test' || form.get('client_secret') !== 'ld-secret' ||
            form.get('grant_type') !== 'authorization_code' || form.get('redirect_uri') !== 'http://127.0.0.1:1/auth/linuxdo/callback') return json({ error: 'invalid_client' }, 401);
        const code = form.get('code') ?? '';
        const user = codes.get(code);
        if (!user) return json({ error: 'invalid_grant' }, 400);
        codes.delete(code);
        const token = `token-${code}`;
        tokens.set(token, user);
        return json({ access_token: token, token_type: 'bearer' });
      });
      return;
    }
    if (url.pathname === '/api/user') {
      const token = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
      const user = tokens.get(token);
      if (!user) return json({ error: 'invalid_token' }, 401);
      tokens.delete(token);
      return json(user);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const fakePort = (fake.address() as AddressInfo).port;
  const frontendUrl = `http://127.0.0.1:${apiPort + 1}`;
  const api = spawn('npx', ['tsx', '--env-file=.env', 'api/src/index.ts'], {
    cwd: path.resolve(__dirname, '../../backend'),
    env: { ...process.env, PORT: String(apiPort), HOST: '127.0.0.1', FRONTEND_URL: frontendUrl,
      LINUXDO_CLIENT_ID: enabled ? 'ld-test' : '', LINUXDO_CLIENT_SECRET: enabled ? 'ld-secret' : '',
      LINUXDO_REDIRECT_URI: 'http://127.0.0.1:1/auth/linuxdo/callback', LINUXDO_API_BASE: `http://127.0.0.1:${fakePort}`,
      LINUXDO_MIN_TRUST_LEVEL: '2', LINUXDO_SITES: '', GITHUB_SITES: '', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '',
      WX_APPID: '', WX_APPSECRET: '', GOOGLE_CLIENT_ID: '', LOG_LEVEL: 'warn' },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const deadline = Date.now() + 60_000;
  for (;;) {
    try { if ((await fetch(`http://127.0.0.1:${apiPort}/health`)).ok) break; } catch { /* wait */ }
    if (api.exitCode !== null || Date.now() >= deadline) {
      api.kill('SIGTERM'); fake.close(); throw new Error('API 启动失败或超时');
    }
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  const opened: Client[] = [];
  return {
    frontendUrl, httpUrl: `http://127.0.0.1:${apiPort}`,
    async connect() { const c = await Client.connect(apiPort); opened.push(c); return c; },
    newCode(user: User) { const code = `code-${sequence++}`; codes.set(code, { ...user }); return code; },
    stop() { opened.forEach(c => c.close()); api.kill('SIGTERM'); fake.close(); },
  };
}
export type Harness = Awaited<ReturnType<typeof startHarness>>;
