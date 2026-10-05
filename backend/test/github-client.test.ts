// GitHub OAuth 接口封装（api/src/github.ts）的单元测试（AISLG-128）：
// 假 fetch 覆盖授权地址生成、code 换令牌 + 取用户、code 无效（bad_verification_code）、
// 接口故障与网络失败、配置读取的缺项行为。访问令牌只用在 /user 请求头里、不进日志。

import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithubClient, GithubError, readGithubConfig, type GithubConfig } from '../api/src/github';

const CONFIG: GithubConfig = {
  clientId: 'Iv1.test-client',
  clientSecret: 'test-secret',
  redirectUri: 'http://api.test/auth/github/callback',
  frontendUrl: 'https://front.test/',
  apiBase: 'http://git.test',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('readGithubConfig：四项缺一即 null；FRONTEND_URL 尾斜杠剥掉', () => {
  const full = {
    GITHUB_CLIENT_ID: 'id',
    GITHUB_CLIENT_SECRET: 'secret',
    GITHUB_REDIRECT_URI: 'https://cb.test/x',
    FRONTEND_URL: 'https://front.test/',
  };
  assert.equal(readGithubConfig({}), null);
  assert.equal(readGithubConfig({ ...full, GITHUB_CLIENT_SECRET: '' }), null);
  assert.equal(readGithubConfig({ ...full, GITHUB_REDIRECT_URI: undefined }), null);
  assert.deepEqual(readGithubConfig(full), {
    clientId: 'id',
    clientSecret: 'secret',
    redirectUri: 'https://cb.test/x',
    frontendUrl: 'https://front.test',
    apiBase: 'https://github.com',
  });
});

test('authorizeUrl：带 client_id / redirect_uri / state，不带 scope（只读公开资料）', () => {
  const client = createGithubClient(CONFIG, async () => jsonResponse({}));
  const url = new URL(client.authorizeUrl('state-xyz'));
  assert.equal(url.origin + url.pathname, 'http://git.test/login/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'Iv1.test-client');
  assert.equal(url.searchParams.get('redirect_uri'), 'http://api.test/auth/github/callback');
  assert.equal(url.searchParams.get('state'), 'state-xyz');
  assert.equal(url.searchParams.get('scope'), null);
});

test('exchangeCode：code 换令牌后取用户 id/login，数字 id 转字符串', async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createGithubClient(CONFIG, async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/login/oauth/access_token')) {
      return jsonResponse({ access_token: 'gho-token-1' });
    }
    return jsonResponse({ id: 12345678, login: 'octocat' });
  });
  const user = await client.exchangeCode('code-1');
  assert.deepEqual(user, { id: '12345678', login: 'octocat' });
  // /user 请求带上了访问令牌（accept JSON），且访问令牌只出现在这里
  const userReq = requests.find((r) => r.url.endsWith('/user'));
  assert.ok(userReq);
  assert.equal((userReq?.init?.headers as Record<string, string>).authorization, 'Bearer gho-token-1');
});

test('code 无效 / 已用过（bad_verification_code）→ code_invalid，与其余失败区分', async () => {
  const badCode = createGithubClient(CONFIG, async (url) =>
    String(url).endsWith('/login/oauth/access_token')
      ? jsonResponse({ error: 'bad_verification_code', error_description: 'The code passed is incorrect' })
      : jsonResponse({}),
  );
  await assert.rejects(() => badCode.exchangeCode('used'), (err: unknown) => {
    assert.ok(err instanceof GithubError);
    assert.equal(err.kind, 'code_invalid');
    return true;
  });

  const secretWrong = createGithubClient(CONFIG, async (url) =>
    String(url).endsWith('/login/oauth/access_token')
      ? jsonResponse({ error: 'incorrect_client_secret' })
      : jsonResponse({}),
  );
  await assert.rejects(() => secretWrong.exchangeCode('code'), (err: unknown) => {
    assert.ok(err instanceof GithubError);
    assert.equal(err.kind, 'unavailable');
    return true;
  });
});

test('/user 返回缺 id 或 login → unavailable；HTTP 失败 → unavailable', async () => {
  const malformed = createGithubClient(CONFIG, async (url) =>
    String(url).endsWith('/user') ? jsonResponse({ login: 'octocat' }) : jsonResponse({ access_token: 't' }),
  );
  await assert.rejects(() => malformed.exchangeCode('c'), (err: unknown) => {
    assert.ok(err instanceof GithubError);
    assert.equal(err.kind, 'unavailable');
    return true;
  });

  const httpFail = createGithubClient(CONFIG, async (url) =>
    String(url).endsWith('/user') ? new Response('boom', { status: 500 }) : jsonResponse({ access_token: 't' }),
  );
  await assert.rejects(() => httpFail.exchangeCode('c'), (err: unknown) => {
    assert.ok(err instanceof GithubError);
    assert.equal(err.kind, 'unavailable');
    return true;
  });
});

test('网络失败（连不上 GitHub）→ unavailable', async () => {
  const down = createGithubClient(CONFIG, async () => {
    throw new Error('network down');
  });
  await assert.rejects(() => down.exchangeCode('c'), (err: unknown) => {
    assert.ok(err instanceof GithubError);
    assert.equal(err.kind, 'unavailable');
    return true;
  });
});
