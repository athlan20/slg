// 校场等级不能超过官府等级（v117，AISLG-269）：BUILD / UPGRADE 校场超过官府返回 PARADE_ABOVE_GOVERNMENT
// （不扣资源、不入队、失败响应附 city）；CityView.deploy 的生效上限与 paradeLevel / governmentCapped。
// 数据库用例需 TEST_DATABASE_URL（一次性临时库，别指向开发库）；纯规则用例不需要数据库。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { runWithCity } from '../api/src/city-scope';
import { handleBuild, handleUpgrade } from '../api/src/handlers-city';
import { loadCityState } from '../api/src/views';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('校场等级受官府限制（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let cityId: string;
  let seq = 0;

  const sent: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
      sent.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  const conn = { accountId: null as string | null, role: 'player' as InitiatorRole } as unknown as ConnInfo;

  async function call(run: () => Promise<void>) {
    sent.length = 0;
    await run();
    return sent[sent.length - 1];
  }

  async function gold(city: string): Promise<number> {
    const row = (await pool.query(`SELECT gold FROM cities WHERE id = $1`, [city])).rows[0];
    return Number(row.gold);
  }

  async function pendingBuilds(city: string): Promise<number> {
    const row = (await pool.query(
      `SELECT count(*)::int AS n FROM builds WHERE city_id = $1 AND status IN ('building','queued')`,
      [city],
    )).rows[0];
    return Number(row.n);
  }

  /** 直接写某建筑等级（造状态用，不走建造流程） */
  async function setLevel(city: string, kind: string, level: number): Promise<void> {
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, $2, $3)
       ON CONFLICT (city_id, kind) DO UPDATE SET level = EXCLUDED.level`,
      [city, kind, level],
    );
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'paradegov');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`paradegov-${Date.now()}`])).rows[0].id as string;
    (ctx as { pool: pg.Pool }).pool = pool;
    (conn as unknown as { accountId: string }).accountId = accountId;
    seq += 1;
    cityId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y)
       VALUES ($1, '校场城', 100000, 100000, 100000, 100000, 100000, $2, $3) RETURNING id`,
      [accountId, 600 + seq, 600 + seq],
    )).rows[0].id as string;
    await setLevel(cityId, 'government', 3);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [600 + seq, 600 + seq, cityId],
    );
  });

  after(async () => {
    setTimeScaleCache(1);
    await pool?.end();
    await tmp?.drop();
  });

  test('BUILD 校场：官府 3 级时建造（目标 1 级）放行', async () => {
    const res = await call(() => runWithCity(cityId, () => handleBuild(ctx, conn, Op.BUILD, 1, 'parade_ground')));
    assert.equal(res?.ok, true, JSON.stringify(res));
    assert.equal(await pendingBuilds(cityId), 1, '入队');
    await pool.query(`UPDATE builds SET status = 'completed' WHERE city_id = $1 AND kind = 'parade_ground'`, [cityId]);
    await setLevel(cityId, 'parade_ground', 1);
  });

  test('UPGRADE 校场目标等级超过官府：PARADE_ABOVE_GOVERNMENT，不扣资源、不入队，响应附 city', async () => {
    await setLevel(cityId, 'parade_ground', 3);
    const before = await gold(cityId);
    const res = await call(() => runWithCity(cityId, () => handleUpgrade(ctx, conn, Op.UPGRADE, 1, 'parade_ground', null)));
    assert.equal(res?.error?.code, 'PARADE_ABOVE_GOVERNMENT', JSON.stringify(res));
    assert.equal(await gold(cityId), before, '资源不变');
    assert.equal(await pendingBuilds(cityId), 0, '不入队');
    const city = (res?.data as { city?: { deploy?: { limit: number; paradeLevel: number; governmentCapped: boolean } } } | undefined)?.city;
    assert.ok(city, '失败响应附 city');
    assert.deepEqual(city?.deploy, { limit: 3, paradeLevel: 3, governmentCapped: false });
  });

  test('UPGRADE 校场 toLevel 超过官府同样被拒；官府升级后放行', async () => {
    await setLevel(cityId, 'parade_ground', 1);
    const before = await gold(cityId);
    const rejected = await call(() => runWithCity(cityId, () => handleUpgrade(ctx, conn, Op.UPGRADE, 1, 'parade_ground', 4)));
    assert.equal(rejected?.error?.code, 'PARADE_ABOVE_GOVERNMENT', JSON.stringify(rejected));
    assert.equal(await gold(cityId), before, '资源不变');
    assert.equal(await pendingBuilds(cityId), 0, '不入队');

    // 官府升到 5 级后，toLevel 4 放行（整链一次性预扣）
    await setLevel(cityId, 'government', 5);
    const ok = await call(() => runWithCity(cityId, () => handleUpgrade(ctx, conn, Op.UPGRADE, 1, 'parade_ground', 4)));
    assert.equal(ok?.ok, true, JSON.stringify(ok));
    assert.equal(await pendingBuilds(cityId), 1, '连升只占 1 个队列位');
    await pool.query(`UPDATE builds SET status = 'completed' WHERE city_id = $1 AND kind = 'parade_ground'`, [cityId]);
    await setLevel(cityId, 'parade_ground', 4);
  });

  test('CityView.deploy：官府 5 / 校场 18 时上限取 5 并标记被官府压住；少建官府按保底 1', async () => {
    await setLevel(cityId, 'parade_ground', 18);
    const snap = await loadCityState(pool, accountId, cityId);
    assert.ok(snap);
    assert.deepEqual(snap.deploy, { count: 0, limit: 5, paradeLevel: 18, governmentCapped: true });

    await setLevel(cityId, 'government', 0);
    const noGov = await loadCityState(pool, accountId, cityId);
    assert.ok(noGov);
    assert.deepEqual(noGov.deploy, { count: 0, limit: 1, paradeLevel: 18, governmentCapped: true }, '未建官府按保底 1');

    await setLevel(cityId, 'government', 3);
    const capped = await loadCityState(pool, accountId, cityId);
    assert.ok(capped);
    assert.deepEqual(capped.deploy, { count: 0, limit: 3, paradeLevel: 18, governmentCapped: true }, '官府 3 / 校场 18 → 上限 3');
  });

  test('官府升级在队列中不算已建成：目标等级仍按当前官府判定', async () => {
    await setLevel(cityId, 'parade_ground', 3);
    const build = await call(() => runWithCity(cityId, () => handleUpgrade(ctx, conn, Op.UPGRADE, 1, 'government', 9)));
    assert.equal(build?.ok, true, JSON.stringify(build));
    assert.equal(await pendingBuilds(cityId), 1);
    const res = await call(() => runWithCity(cityId, () => handleUpgrade(ctx, conn, Op.UPGRADE, 1, 'parade_ground', 4)));
    assert.equal(res?.error?.code, 'PARADE_ABOVE_GOVERNMENT', '排队中的官府升级不算');
  });
});