// GitHub 回调数据库故障（AISLG-171）：数据库抛错时不返回裸 500，而是 302 回前端带 error=unavailable；
// 唯一约束冲突的 already_bound 仍是正常结果。假 pool 每次查询都抛错，假 GitHub 客户端换令牌成功。

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerGithubCallbackRoute } from '../api/src/github-callback';
import { createGithubService, type GithubService, type GithubSiteEntry } from '../api/src/handlers-github';
import { readGithubSites } from '../api/src/site-config';
import type { HandlerContext } from '../api/src/handlers';

const FRONTEND = 'https://front.test';

function makeGithub(): GithubService {
  const sites = readGithubSites({
    GITHUB_CLIENT_ID: 'gh-client',
    GITHUB_CLIENT_SECRET: 'gh-secret',
    GITHUB_REDIRECT_URI: 'https://api.test/auth/github/callback',
    FRONTEND_URL: `${FRONTEND}/`,
  } as NodeJS.ProcessEnv);
  const github = createGithubService(sites);
  const clientId = sites.defaultSite!.clientId;
  // 换令牌直接给出用户，不出站；数据库故障在它之后发生
  const client = {
    clientId,
    authorizeUrl: () => 'https://github.test/authorize',
    exchangeCode: async () => ({ id: '42', login: 'octocat' }),
  } as unknown as GithubSiteEntry['client'];
  github.entries.set(clientId, { config: sites.defaultSite!, client });
  return github;
}

async function callback(pool: unknown, purpose: 'login' | 'bind'): Promise<{ status: number; location: string | undefined; body: string }> {
  const github = makeGithub();
  const app = Fastify();
  registerGithubCallbackRoute(app, { github, ctx: { pool } as unknown as HandlerContext });
  const state = github.states.create(purpose, purpose === 'bind' ? '00000000-0000-0000-0000-000000000001' : null, github.now(), null);
  const res = await app.inject({ method: 'GET', url: `/auth/github/callback?code=abc&state=${state.state}` });
  await app.close();
  return { status: res.statusCode, location: res.headers.location as string | undefined, body: res.body };
}

/** 每次查询都抛错的假 pool（模拟数据库连接卡死后超时） */
function brokenPool(error: Error): unknown {
  return {
    query: async () => {
      throw error;
    },
    connect: async () => {
      throw error;
    },
  };
}

/** 唯一约束冲突（23505）的假 pool：bindOauth 应返回 already_bound */
function conflictPool(): unknown {
  const conflict = Object.assign(new Error('duplicate key'), { code: '23505' });
  return {
    query: async () => {
      throw conflict;
    },
  };
}

test('login：数据库查询抛错 → 302 回前端 error=unavailable，不是 500', async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const res = await callback(brokenPool(new Error('connection timeout')), 'login');
    assert.equal(res.status, 302);
    assert.equal(res.location, `${FRONTEND}/?oauth=github&error=unavailable`);
  } finally {
    console.error = originalError;
  }
});

test('bind：数据库写入抛错 → 302 回前端 error=unavailable', async () => {
  const originalError = console.error;
  console.error = () => undefined;
  try {
    const res = await callback(brokenPool(new Error('connection timeout')), 'bind');
    assert.equal(res.status, 302);
    assert.equal(res.location, `${FRONTEND}/?oauth=github&error=unavailable`);
  } finally {
    console.error = originalError;
  }
});

test('bind：唯一约束冲突仍返回 already_bound（不被吞成 unavailable）', async () => {
  const res = await callback(conflictPool(), 'bind');
  assert.equal(res.status, 302);
  assert.equal(res.location, `${FRONTEND}/?oauth=github&error=already_bound`);
});
