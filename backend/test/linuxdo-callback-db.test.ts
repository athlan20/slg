// Linux.do 回调（AISLG-258）：state 核对、取消 / 过期 / 资格不足 / code 失效、数据库故障与唯一约束冲突。
// 无数据库的用例直接跑（假 pool；资格不足时断言没有任何 SQL）；建号 / 同号 / 改名 / 绑定占用的用例需要真实
// PostgreSQL：设置 TEST_DATABASE_URL（临时集群，测试在其中新建独立库，别指向开发库），否则跳过。
// 假 Linux.do 通过 fetch 注入 createLinuxdoClient，走真实的换令牌 / 取用户 / 资格判断代码。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import Fastify from 'fastify';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { insertAccountWithCity } from '../api/src/auth';
import { createLinuxdoClient } from '../api/src/linuxdo';
import { registerLinuxdoCallbackRoute } from '../api/src/linuxdo-callback';
import { createLinuxdoService, type LinuxdoService } from '../api/src/handlers-linuxdo';
import { readLinuxdoSites } from '../api/src/linuxdo-sites';
import type { HandlerContext } from '../api/src/handlers';
import { captureConsole } from './diag-capture';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const FRONTEND = 'https://front.test';
const ENV = {
  LINUXDO_CLIENT_ID: 'ld-client',
  LINUXDO_CLIENT_SECRET: 'ld-secret',
  LINUXDO_REDIRECT_URI: 'https://api.test/auth/linuxdo/callback',
  FRONTEND_URL: `${FRONTEND}/`,
  LINUXDO_API_BASE: 'https://provider.test',
} as NodeJS.ProcessEnv;
const ZERO_UUID = '00000000-0000-0000-0000-000000000001';

interface FakeUser { id: number; username: string; trust_level: number; active: boolean; silenced: boolean }

/** 假 Linux.do：只认预先登记的授权码；取用户时返回 provider.user（测试中可随时改名 / 降级 / 禁言） */
function makeProvider() {
  const provider = {
    user: { id: 1001, username: 'alice', trust_level: 2, active: true, silenced: false } as FakeUser,
    validCodes: new Set<string>(),
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const json = (value: unknown, status = 200) =>
        new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
      if (String(url).endsWith('/oauth2/token')) {
        const code = new URLSearchParams(String(init?.body)).get('code') ?? '';
        if (!provider.validCodes.has(code)) return json({ error: 'invalid_grant' }, 400);
        provider.validCodes.delete(code);
        return json({ access_token: 'access-token-secret' });
      }
      return json({ ...provider.user });
    }) as typeof fetch,
  };
  return provider;
}

type Provider = ReturnType<typeof makeProvider>;

function makeService(provider: Provider, minTrustLevel = 1): LinuxdoService {
  const sites = readLinuxdoSites(ENV);
  const service = createLinuxdoService(sites, minTrustLevel);
  const config = sites.defaultSite!;
  service.entries.set(JSON.stringify(config), { config, client: createLinuxdoClient(config, minTrustLevel, provider.fetch) });
  return service;
}

/** 发起一次回调：登记 state（或用传入的 state），请求路由；返回 302 的 location 与 [oauth-callback] 诊断行 */
async function callback(opts: {
  pool: unknown;
  service: LinuxdoService;
  purpose?: 'login' | 'bind';
  accountId?: string | null;
  code?: string;
  state?: string;
  query?: string;
}): Promise<{ location: string | undefined; lines: string[] }> {
  const app = Fastify();
  registerLinuxdoCallbackRoute(app, { linuxdo: opts.service, ctx: { pool: opts.pool } as unknown as HandlerContext });
  const state = opts.state ?? opts.service.states.create(opts.purpose ?? 'login', opts.accountId ?? null, opts.service.now(), null).state;
  const search = opts.query ?? `code=${opts.code ?? ''}&state=${state}`;
  let location: string | undefined;
  const lines = await captureConsole(async () => {
    const res = await app.inject({ method: 'GET', url: `/auth/linuxdo/callback?${search}` });
    location = res.headers.location as string | undefined;
  });
  await app.close();
  return { location, lines };
}

const fail = (params: string) => `${FRONTEND}/?oauth=linuxdo&${params}`;

/** 任何查询都抛错的假 pool（连接卡死 / 超时） */
function brokenPool(error: Error): unknown {
  return { query: async () => { throw error; }, connect: async () => { throw error; } };
}

/** 任何 SQL 都不该发生：被调用就记一次，并抛错（资格不足时断言计数为 0） */
function spyPool(): { pool: unknown; calls: () => number } {
  let count = 0;
  const hit = async () => { count += 1; throw new Error('database must not be touched'); };
  return { pool: { query: hit, connect: hit }, calls: () => count };
}

test('登录：数据库查询抛错 → 302 回前端 error=unavailable（不是 500）', async () => {
  const provider = makeProvider();
  provider.validCodes.add('c1');
  const res = await callback({ pool: brokenPool(new Error('connection timeout')), service: makeService(provider), code: 'c1' });
  assert.equal(res.location, fail('error=unavailable'));
});

test('绑定：数据库写入抛错 → 302 回前端 error=unavailable', async () => {
  const provider = makeProvider();
  provider.validCodes.add('c1');
  const res = await callback({ pool: brokenPool(new Error('connection timeout')), service: makeService(provider), purpose: 'bind', accountId: ZERO_UUID, code: 'c1' });
  assert.equal(res.location, fail('error=unavailable'));
});

test('绑定：唯一约束冲突 → already_bound（不被吞成 unavailable）', async () => {
  const provider = makeProvider();
  provider.validCodes.add('c1');
  const conflict = Object.assign(new Error('duplicate key'), { code: '23505' });
  const pool = { query: async () => { throw conflict; } };
  const res = await callback({ pool, service: makeService(provider), purpose: 'bind', accountId: ZERO_UUID, code: 'c1' });
  assert.equal(res.location, fail('error=already_bound'));
});

test('资格不足（等级 / 禁言 / 未激活）：回 not_eligible，登录与绑定都不碰数据库', async () => {
  for (const patch of [{ trust_level: 0 }, { silenced: true }, { active: false }]) {
    const provider = makeProvider();
    provider.user = { ...provider.user, ...patch };
    provider.validCodes.add('c1');
    const spy = spyPool();
    const res = await callback({ pool: spy.pool, service: makeService(provider, 1), code: 'c1' });
    assert.equal(res.location, fail('error=not_eligible'), JSON.stringify(patch));
    assert.equal(spy.calls(), 0, '资格不足不得建号');
  }
  const provider = makeProvider();
  provider.user = { ...provider.user, trust_level: 0 };
  provider.validCodes.add('c2');
  const spy = spyPool();
  const bound = await callback({ pool: spy.pool, service: makeService(provider), purpose: 'bind', accountId: ZERO_UUID, code: 'c2' });
  assert.equal(bound.location, fail('error=not_eligible'));
  assert.equal(spy.calls(), 0, '资格不足不得绑定');
});

test('code 无效 / 已用过 → expired；取消 → canceled；同一 state 重放 → expired', async () => {
  const provider = makeProvider();
  const service = makeService(provider);
  const invalid = await callback({ pool: spyPool().pool, service, code: 'never-issued' });
  assert.equal(invalid.location, fail('error=expired'));

  const cancelState = service.states.create('login', null, service.now(), null).state;
  const cancel = await callback({ pool: spyPool().pool, service, query: `error=access_denied&state=${cancelState}` });
  assert.equal(cancel.location, fail('error=canceled'));

  // 资格不足的 state 不消耗数据库，便于断言「用过的 state 再来一次就是 expired」
  provider.user = { ...provider.user, trust_level: 0 };
  provider.validCodes.add('c3');
  const replayState = service.states.create('login', null, service.now(), null).state;
  const first = await callback({ pool: spyPool().pool, service, code: 'c3', state: replayState });
  assert.equal(first.location, fail('error=not_eligible'));
  provider.validCodes.add('c4');
  const replay = await callback({ pool: spyPool().pool, service, code: 'c4', state: replayState });
  assert.equal(replay.location, fail('error=expired'));
});

test('诊断行只记结果与耗时，不含授权码、state 与访问令牌（provider=linuxdo）', async () => {
  const provider = makeProvider();
  provider.user = { ...provider.user, trust_level: 0 };
  provider.validCodes.add('SECRET-LINUXDO-CODE');
  const service = makeService(provider);
  const state = service.states.create('login', null, service.now(), null).state;
  const res = await callback({ pool: spyPool().pool, service, code: 'SECRET-LINUXDO-CODE', state });
  const line = res.lines.find((text) => text.includes('[oauth-callback]'));
  assert.ok(line, '应输出一行 [oauth-callback]');
  assert.match(line, /result=not_eligible provider=linuxdo purpose=login site=- reason=linuxdo:not_eligible exchange_ms=\d+ /);
  const all = res.lines.join('\n');
  assert.ok(!all.includes('SECRET-LINUXDO-CODE') && !all.includes(state) && !all.includes('access-token-secret'));
});

// ---- 以下需要真实 PostgreSQL ----
const dbUrl = process.env.TEST_DATABASE_URL;

describe('Linux.do 建号 / 同号 / 绑定（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  let seq = 0;

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'linuxdo');
    pool = new pg.Pool({ connectionString: db.url, max: 8 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  /** 走一次登录回跳，并用 OAUTH_REDEEM 同一存储兑换出载荷（accountId / username / created） */
  async function login(provider: Provider, service: LinuxdoService) {
    const code = `login-${seq++}`;
    provider.validCodes.add(code);
    const res = await callback({ pool, service, code });
    const oneTime = new URL(res.location ?? '').searchParams.get('code');
    assert.ok(oneTime, `登录应回跳一次性码，实际 ${res.location}`);
    return service.codes.take(oneTime, service.now());
  }

  async function newAccount(): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await insertAccountWithCity(client, { username: `ld-test-${Date.now()}-${seq++}`, passwordHash: 'x', signupIp: null });
      await client.query('COMMIT');
      return created.id;
    } finally {
      client.release();
    }
  }

  async function bind(provider: Provider, service: LinuxdoService, accountId: string): Promise<string | undefined> {
    const code = `bind-${seq++}`;
    provider.validCodes.add(code);
    return (await callback({ pool, service, purpose: 'bind', accountId, code })).location;
  }

  async function accountCount(): Promise<number> {
    return (await pool.query('SELECT count(*)::int AS n FROM accounts')).rows[0].n as number;
  }

  test('首次登录自动建号（用户名前缀 ld_，无密码）；同一 Linux.do 账号再次登录进同一个号', async () => {
    const provider = makeProvider();
    provider.user = { ...provider.user, id: 1101, username: 'first-user' };
    const service = makeService(provider);
    const first = await login(provider, service);
    assert.ok(first && first.created === true && first.username.startsWith('ld_'), JSON.stringify(first));
    const row = (await pool.query('SELECT password_hash FROM accounts WHERE id = $1', [first!.accountId])).rows[0];
    assert.equal(row.password_hash, null);

    const again = await login(provider, service);
    assert.equal(again?.accountId, first!.accountId);
    assert.equal(again?.created, false);
  });

  test('改了 Linux.do 用户名仍是同一个号，展示名刷新，绑定键是数字 id', async () => {
    const provider = makeProvider();
    provider.user = { ...provider.user, id: 2002, username: 'bob' };
    const service = makeService(provider);
    const first = await login(provider, service);
    provider.user = { ...provider.user, username: 'bob-renamed' };
    const again = await login(provider, service);
    assert.equal(again?.accountId, first?.accountId);
    const row = (await pool.query(`SELECT display_name FROM oauth_identities WHERE provider = 'linuxdo' AND subject = '2002'`)).rows[0];
    assert.equal(row.display_name, 'bob-renamed');
  });

  test('等级不足不建号：账号数不变，库里没有对应身份', async () => {
    const provider = makeProvider();
    provider.user = { ...provider.user, id: 3003, trust_level: 0 };
    const service = makeService(provider, 1);
    const before = await accountCount();
    provider.validCodes.add('low-trust');
    const res = await callback({ pool, service, code: 'low-trust' });
    assert.equal(res.location, fail('error=not_eligible'));
    assert.equal(await accountCount(), before);
    const rows = await pool.query(`SELECT 1 FROM oauth_identities WHERE provider = 'linuxdo' AND subject = '3003'`);
    assert.equal(rows.rowCount, 0);
  });

  test('绑定：老账号绑定后可用 Linux.do 登录这个老号；别的号已占用 / 当前号已绑别的 Linux.do → already_bound', async () => {
    const provider = makeProvider();
    provider.user = { ...provider.user, id: 4004, username: 'carol' };
    const service = makeService(provider);
    const oldAccount = await newAccount();
    assert.equal(await bind(provider, service, oldAccount), fail('bind=ok'));
    const logged = await login(provider, service);
    assert.equal(logged?.accountId, oldAccount);
    assert.equal(logged?.created, false);

    const otherAccount = await newAccount();
    assert.equal(await bind(provider, service, otherAccount), fail('error=already_bound'), 'subject 已被占用');

    provider.user = { ...provider.user, id: 5005 };
    assert.equal(await bind(provider, service, oldAccount), fail('error=already_bound'), '当前号已绑 Linux.do');
  });
});
