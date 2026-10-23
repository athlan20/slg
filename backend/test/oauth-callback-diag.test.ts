// GitHub 回调诊断行（AISLG-173）：每次回调记一行 [oauth-callback]，含结果、原因与分段耗时；
// 行内绝不出现授权码 code、令牌与 state。假 pool / 假 GitHub 客户端，与 github-callback-db.test.ts 同口径。

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerGithubCallbackRoute } from '../api/src/github-callback';
import { createGithubService, type GithubService, type GithubSiteEntry } from '../api/src/handlers-github';
import { readGithubSites } from '../api/src/site-config';
import type { HandlerContext } from '../api/src/handlers';
import { captureConsole } from './diag-capture';

const FRONTEND = 'https://front.test';
const SECRET_CODE = 'GITHUB-AUTH-CODE-SECRET';

function makeGithub(): GithubService {
  const sites = readGithubSites({
    GITHUB_CLIENT_ID: 'gh-client',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    GITHUB_REDIRECT_URI: 'https://api.test/auth/github/callback',
    FRONTEND_URL: `${FRONTEND}/`,
  } as NodeJS.ProcessEnv);
  const github = createGithubService(sites);
  const clientId = sites.defaultSite!.clientId;
  const client = {
    clientId,
    authorizeUrl: () => 'https://github.test/authorize',
    exchangeCode: async () => ({ id: '42', login: 'octocat' }),
  } as unknown as GithubSiteEntry['client'];
  github.entries.set(clientId, { config: sites.defaultSite!, client });
  return github;
}

async function callback(pool: unknown, purpose: 'login' | 'bind', accountId: string | null = null): Promise<string> {
  const github = makeGithub();
  const app = Fastify();
  registerGithubCallbackRoute(app, { github, ctx: { pool } as unknown as HandlerContext });
  const state = github.states.create(purpose, purpose === 'bind' ? accountId : null, github.now(), null);
  await app.inject({ method: 'GET', url: `/auth/github/callback?code=${SECRET_CODE}&state=${state.state}` });
  await app.close();
  return state.state;
}

test('数据库拿不到连接：[oauth-callback] 记 unavailable 与原因，耗时分段；行内无 code / state', async () => {
  const timeout = new Error('timeout exceeded when trying to connect');
  const pool = {
    query: async () => {
      throw timeout;
    },
    connect: async () => {
      throw timeout;
    },
  };
  let stateValue = '';
  const lines = await captureConsole(async () => {
    stateValue = await callback(pool, 'login');
  });
  const line = lines.find((text) => text.includes('[oauth-callback]'));
  assert.ok(line, '应输出一行 [oauth-callback]');
  assert.match(
    line,
    /^\d{4}-\d{2}-\d{2}T\S+Z \[oauth-callback\] result=unavailable purpose=login site=- reason=db:pool_timeout exchange_ms=\d+ db_ms=\d+ total_ms=\d+$/,
  );
  const all = lines.join('\n');
  assert.ok(!all.includes(SECRET_CODE), '日志不得含授权码');
  assert.ok(!all.includes(stateValue), '日志不得含 state');
});

test('唯一约束冲突：结果记 already_bound', async () => {
  const conflict = Object.assign(new Error('duplicate key'), { code: '23505' });
  const pool = {
    query: async () => {
      throw conflict;
    },
    connect: async () => {
      throw conflict;
    },
  };
  const lines = await captureConsole(async () => {
    await callback(pool, 'bind', '00000000-0000-0000-0000-000000000001');
  });
  const line = lines.find((text) => text.includes('[oauth-callback]'));
  assert.ok(line);
  assert.match(line, /result=already_bound purpose=bind /);
  assert.ok(!lines.join('\n').includes(SECRET_CODE));
});
