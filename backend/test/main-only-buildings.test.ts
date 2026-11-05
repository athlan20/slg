// 酒馆 / 书院只在主城建造（v87，AISLG-217）：规则标记、建造 / 升级拦截（分城返回 BUILDING_MAIN_ONLY、
// 不扣资源、不入队）与 CityView 对分城不下发这两项。验收口径 1–2。
// 数据库用例需 TEST_DATABASE_URL（一次性临时库，别指向开发库）；纯规则用例不需要数据库。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import {
  BUILDING_INFO,
  MAIN_CITY_ONLY_KINDS,
  isMainCityOnlyBuilding,
  judgeMainCityOnly,
  upgradeCost,
} from '../common/src/rules';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole, type Resources } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { runWithCity } from '../api/src/city-scope';
import { handleBuild, handleUpgrade } from '../api/src/handlers-city';
import { loadCityState } from '../api/src/views';

import { createTempDatabase, type TempDatabase } from './season-test-db';

describe('仅主城建筑的规则标记（无需数据库）', () => {
  test('只有酒馆与书院标记为 mainOnly', () => {
    assert.deepEqual([...MAIN_CITY_ONLY_KINDS].sort(), ['academy', 'tavern']);
    for (const kind of MAIN_CITY_ONLY_KINDS) {
      assert.equal(BUILDING_INFO[kind].mainOnly, true, kind);
      assert.equal(isMainCityOnlyBuilding(kind), true, kind);
    }
    assert.equal(isMainCityOnlyBuilding('farm'), false);
    assert.equal(isMainCityOnlyBuilding('government'), false);
  });

  test('judgeMainCityOnly：分城拒绝酒馆 / 书院，主城与其他建筑放行', () => {
    assert.deepEqual(judgeMainCityOnly('tavern', false), { ok: false, code: 'BUILDING_MAIN_ONLY' });
    assert.deepEqual(judgeMainCityOnly('academy', false), { ok: false, code: 'BUILDING_MAIN_ONLY' });
    assert.equal(judgeMainCityOnly('tavern', true), null);
    assert.equal(judgeMainCityOnly('academy', true), null);
    assert.equal(judgeMainCityOnly('farm', false), null);
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('分城不能建酒馆 / 书院（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let mainCityId: string;
  let branchCityId: string;
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

  async function resources(cityId: string): Promise<Resources> {
    const row = (await pool.query(`SELECT gold, wood, food, stone, iron FROM cities WHERE id = $1`, [cityId])).rows[0];
    return { gold: Number(row.gold), wood: Number(row.wood), food: Number(row.food), stone: Number(row.stone), iron: Number(row.iron) };
  }

  async function pendingBuilds(cityId: string): Promise<number> {
    const row = (await pool.query(`SELECT count(*)::int AS n FROM builds WHERE city_id = $1 AND status IN ('building','queued')`, [cityId])).rows[0];
    return Number(row.n);
  }

  async function newCity(name: string, rich = false): Promise<string> {
    seq += 1;
    const gold = rich ? 100_000 : 1000;
    const id = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y)
       VALUES ($1, $2, $3, $3, $3, $3, $3, $4, $5) RETURNING id`,
      [accountId, name, gold, 500 + seq, 500 + seq],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 3)`, [id]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [500 + seq, 500 + seq, id],
    );
    return id;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'mainonly');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`mainonly-${Date.now()}`])).rows[0].id as string;
    (ctx as { pool: pg.Pool }).pool = pool;
    (conn as unknown as { accountId: string }).accountId = accountId;
    mainCityId = await newCity('主城', true);
    branchCityId = await newCity('分城', true);
  });

  after(async () => {
    setTimeScaleCache(1);
    await pool?.end();
    await tmp?.drop();
  });

  test('分城 BUILD 酒馆 / 书院返回 BUILDING_MAIN_ONLY：不扣资源、不入队', async () => {
    for (const kind of ['tavern', 'academy'] as const) {
      const before = await resources(branchCityId);
      const res = await call(() => runWithCity(branchCityId, () => handleBuild(ctx, conn, Op.BUILD, 1, kind)));
      assert.equal(res?.error?.code, 'BUILDING_MAIN_ONLY', kind);
      assert.deepEqual(await resources(branchCityId), before, `${kind}：分城资源不变`);
      assert.equal(await pendingBuilds(branchCityId), 0, `${kind}：不入队`);
      assert.equal((await pool.query(`SELECT count(*)::int AS n FROM builds WHERE city_id = $1`, [branchCityId])).rows[0].n, 0);
    }
  });

  test('分城 UPGRADE（含连续升级 toLevel）酒馆 / 书院同样被拒，不扣资源、不入队', async () => {
    // 存量数据（迁移前分城可能有这两项）+ 一条在建条目：升级仍应被拒
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'tavern', 3), ($1, 'academy', 2)`, [branchCityId]);
    const before = await resources(branchCityId);
    for (const [kind, toLevel] of [['tavern', null], ['academy', null], ['tavern', 8]] as const) {
      const res = await call(() => runWithCity(branchCityId, () => handleUpgrade(ctx, conn, Op.UPGRADE, 1, kind, toLevel)));
      assert.equal(res?.error?.code, 'BUILDING_MAIN_ONLY', `${kind} toLevel=${toLevel}`);
    }
    assert.deepEqual(await resources(branchCityId), before, '资源不变');
    assert.equal(await pendingBuilds(branchCityId), 0, '不入队');
  });

  test('主城 BUILD / UPGRADE 酒馆与书院照旧可用（扣资源并开工）', async () => {
    const tavern = await call(() => runWithCity(mainCityId, () => handleBuild(ctx, conn, Op.BUILD, 1, 'tavern')));
    assert.equal(tavern?.ok, true, JSON.stringify(tavern));
    const afterBuild = await resources(mainCityId);
    assert.equal(afterBuild.gold, 100_000 - BUILDING_INFO.tavern.cost.gold, '扣掉酒馆建造成本');
    await pool.query(`UPDATE builds SET status = 'completed' WHERE city_id = $1 AND kind = 'tavern'`, [mainCityId]);
    await pool.query(
      `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'tavern', 1) ON CONFLICT (city_id, kind) DO UPDATE SET level = 1`,
      [mainCityId],
    );
    const beforeUpgrade = await resources(mainCityId);
    const up = await call(() => runWithCity(mainCityId, () => handleUpgrade(ctx, conn, Op.UPGRADE, 1, 'tavern', 4)));
    assert.equal(up?.ok, true, JSON.stringify(up));
    const step2 = upgradeCost('tavern', 1);
    assert.equal((await resources(mainCityId)).gold, beforeUpgrade.gold - step2.gold - upgradeCost('tavern', 2).gold - upgradeCost('tavern', 3).gold, '连升整链预扣');
    assert.equal(await pendingBuilds(mainCityId), 1, '连升只占 1 个队列位');
  });

  test('CityView：分城的 levels / costs / buildings 不含酒馆与书院，主城照旧下发', async () => {
    const main = await loadCityState(pool, accountId, mainCityId);
    const branch = await loadCityState(pool, accountId, branchCityId);
    assert.ok(main && branch);
    assert.equal(main.levels.tavern, 1, '主城有酒馆等级');
    assert.ok(main.costs.tavern, '主城有酒馆成本');
    for (const kind of ['tavern', 'academy'] as const) {
      assert.equal(kind in branch.levels, false, `分城 levels 不含 ${kind}`);
      assert.equal(kind in branch.costs, false, `分城 costs 不含 ${kind}`);
      assert.equal(kind in branch.buildings, false, `分城 buildings 不含 ${kind}`);
      assert.ok(main.levelMax[kind] > 0, 'levelMax 仍按建筑类型给全');
    }
    assert.ok(branch.costs.farm, '分城其他建筑的成本照旧');
    assert.equal(branch.levels.government, 3);
  });
});
