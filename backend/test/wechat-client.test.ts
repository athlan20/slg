// 微信接口封装的单元测试：注入假 fetch，不访问真实微信。

import test from 'node:test';
import assert from 'node:assert/strict';
import { WechatError, createWechatClient, readWechatConfig } from '../api/src/wechat';

const CONFIG = { appId: 'wx-test', appSecret: 'secret-test', envVersion: 'develop' as const, apiBase: 'https://wx.test' };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('readWechatConfig：没配 AppID / AppSecret 时关闭；WX_CODE_ENV 只认 trial / develop，其余按 release', () => {
  assert.equal(readWechatConfig({}), null);
  assert.equal(readWechatConfig({ WX_APPID: 'a' }), null);
  assert.equal(readWechatConfig({ WX_APPID: 'a', WX_APPSECRET: 's' })?.envVersion, 'release');
  assert.equal(readWechatConfig({ WX_APPID: 'a', WX_APPSECRET: 's', WX_CODE_ENV: 'develop' })?.envVersion, 'develop');
  assert.equal(readWechatConfig({ WX_APPID: 'a', WX_APPSECRET: 's', WX_CODE_ENV: 'oops' })?.envVersion, 'release');
  assert.equal(readWechatConfig({ WX_APPID: 'a', WX_APPSECRET: 's' })?.apiBase, 'https://api.weixin.qq.com');
});

test('生成小游戏码：先取 stable_token（缓存复用），scene / check_path / env_version 正确，返回 data URI', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown> | null }> = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url, body });
    if (url.endsWith('/cgi-bin/stable_token')) {
      return json({ access_token: 'AT-1', expires_in: 7200 });
    }
    return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }) as unknown as typeof fetch;
  const client = createWechatClient(CONFIG, fetchFn);

  const image = await client.createQrCode('ticket-abc');
  assert.equal(image, `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString('base64')}`);
  await client.createQrCode('ticket-def');

  assert.equal(calls.filter((c) => c.url.endsWith('/cgi-bin/stable_token')).length, 1, 'access_token 应缓存');
  const qr = calls.filter((c) => c.url.includes('getwxacodeunlimit'));
  assert.equal(qr.length, 2);
  assert.ok(qr[0].url.includes('access_token=AT-1'));
  assert.deepEqual(qr[0].body, { scene: 'ticket-abc', check_path: false, width: 280, env_version: 'develop' });
});

test('access_token 失效（42001）时清缓存重取并重试一次', async () => {
  let tokenCalls = 0;
  const fetchFn = (async (url: string) => {
    if (url.endsWith('/cgi-bin/stable_token')) {
      tokenCalls += 1;
      return json({ access_token: `AT-${tokenCalls}`, expires_in: 7200 });
    }
    if (url.includes('access_token=AT-1')) {
      return json({ errcode: 42001, errmsg: 'access_token expired' });
    }
    return new Response(Buffer.from([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } });
  }) as unknown as typeof fetch;
  const image = await createWechatClient(CONFIG, fetchFn).createQrCode('t');
  assert.match(image, /^data:image\/png;base64,/);
  assert.equal(tokenCalls, 2);
});

test('生成码失败、网络异常一律是 unavailable', async () => {
  const failing = (async (url: string) =>
    url.endsWith('/cgi-bin/stable_token') ? json({ access_token: 'AT', expires_in: 7200 }) : json({ errcode: 45009, errmsg: 'reach max api daily quota limit' })) as unknown as typeof fetch;
  await assert.rejects(createWechatClient(CONFIG, failing).createQrCode('t'), (err: unknown) => err instanceof WechatError && err.kind === 'unavailable');

  const down = (async () => {
    throw new Error('ECONNREFUSED');
  }) as unknown as typeof fetch;
  await assert.rejects(createWechatClient(CONFIG, down).createQrCode('t'), (err: unknown) => err instanceof WechatError && err.kind === 'unavailable');
});

test('jscode2session：成功返回 openid / unionid；40029 / 40163 是 code_invalid，其余 unavailable', async () => {
  const make = (body: unknown) => createWechatClient(CONFIG, (async () => json(body)) as unknown as typeof fetch);
  assert.deepEqual(await make({ openid: 'o1', session_key: 'sk', unionid: 'u1' }).codeToSession('c'), { openid: 'o1', unionid: 'u1' });
  assert.deepEqual(await make({ openid: 'o2', session_key: 'sk' }).codeToSession('c'), { openid: 'o2', unionid: null });
  for (const errcode of [40029, 40163]) {
    await assert.rejects(make({ errcode, errmsg: 'invalid code' }).codeToSession('c'), (err: unknown) => err instanceof WechatError && err.kind === 'code_invalid');
  }
  await assert.rejects(make({ errcode: 45011, errmsg: 'api minute-quota reach limit' }).codeToSession('c'), (err: unknown) => err instanceof WechatError && err.kind === 'unavailable');
});

test('jscode2session 请求带 appid / secret / js_code，且返回里不暴露 session_key', async () => {
  let requested = '';
  const client = createWechatClient(CONFIG, (async (url: string) => {
    requested = url;
    return json({ openid: 'o', session_key: 'SECRET-SK' });
  }) as unknown as typeof fetch);
  const session = await client.codeToSession('the-code');
  const query = new URL(requested).searchParams;
  assert.equal(query.get('appid'), 'wx-test');
  assert.equal(query.get('js_code'), 'the-code');
  assert.equal(query.get('grant_type'), 'authorization_code');
  assert.ok(!JSON.stringify(session).includes('SECRET-SK'));
});
