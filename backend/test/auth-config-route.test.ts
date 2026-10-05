// GET /auth/config 的站点口径（v47，AISLG-130）：双站点下 passwordLogin / wechatEnabled /
// githubEnabled 按请求 Host 计算。不依赖数据库：直接注册路由后用 fastify.inject 打。

import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { registerAuthConfigRoute } from '../api/src/auth-config-routes';
import {
  githubSiteFor,
  isPasswordLoginDisabled,
  readGithubSites,
  readPasswordDisabledHosts,
} from '../api/src/site-config';

const CN = 'slg.example.cn';
const CC = 'slg.yuntianyou.cc';

const disabledHosts = readPasswordDisabledHosts({ PASSWORD_LOGIN_DISABLED_HOSTS: CC } as NodeJS.ProcessEnv);
const githubSites = readGithubSites({
  GITHUB_SITES: JSON.stringify({
    [CN]: {
      clientId: 'cn-id',
      clientSecret: 'cn-secret',
      redirectUri: `https://slgws.example.cn/auth/github/callback`,
      frontendUrl: `https://${CN}`,
    },
    [CC]: {
      clientId: 'cc-id',
      clientSecret: 'cc-secret',
      redirectUri: `https://${CC}/auth/github/callback`,
      frontendUrl: `https://${CC}`,
    },
  }),
} as NodeJS.ProcessEnv);

async function configFor(host: string): Promise<Record<string, unknown>> {
  const app = Fastify();
  registerAuthConfigRoute(app, {
    googleClientId: 'google-client-id',
    wechatEnabled: true,
    trustProxy: false,
    isPasswordLoginDisabled: (h) => isPasswordLoginDisabled(h, disabledHosts),
    githubSiteForHost: (h) => githubSiteFor(h, githubSites),
  });
  const res = await app.inject({ method: 'GET', url: '/auth/config', headers: { host } });
  await app.close();
  return JSON.parse(res.body) as Record<string, unknown>;
}

test('国内站：密码登录可用，微信与 GitHub 按配置显示', async () => {
  const body = await configFor(CN);
  assert.equal(body.passwordLogin, true);
  assert.equal(body.wechatEnabled, true);
  assert.equal(body.githubEnabled, true);
  assert.equal(body.googleClientId, 'google-client-id');
});

test('国际站：无密码登录，微信入口一并关掉，Google / GitHub 照常', async () => {
  const body = await configFor(CC);
  assert.equal(body.passwordLogin, false);
  assert.equal(body.wechatEnabled, false);
  assert.equal(body.githubEnabled, true);
  assert.equal(body.googleClientId, 'google-client-id');
});

test('未知 Host：按默认处理（密码登录可用，GitHub 走 default 套 / 无则关闭）', async () => {
  const body = await configFor('localhost:5175');
  assert.equal(body.passwordLogin, true);
  assert.equal(body.wechatEnabled, true);
  // GITHUB_SITES 只配了 .cn / .cc 两站且无 default 套 → 未知 Host 没有 GitHub 配置
  assert.equal(body.githubEnabled, false);
});
