// 世界小地图总览（v58，AISLG-160）：GET_MAP_OVERVIEW 的归属区分（本方 / 他方 / NPC / 未占领名城）、
// 野地不返回、点位排序。需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑（用一次性的临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleGetMapOverview } from '../api/src/map-overview';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

// 固定坐标：测试库可能残留，开始与结束都清一遍
const P = {
  own: { x: 901, y: 902 },
  enemy: { x: 903, y: 902 },
  npc: { x: 905, y: 902 },
  famous: { x: 907, y: 903 },
  wild: { x: 909, y: 903 },
};

describe('世界小地图总览（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let otherAccountId: string;
  const ownerAccounts: string[] = [];

  const sent: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
      sent.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  const conn = { accountId: null as string | null, role: 'player' as InitiatorRole } as unknown as ConnInfo;

  /** 发起一次总览查询，返回城池点位（按坐标查表用） */
  async function overview(): Promise<Map<string, string>> {
    sent.length = 0;
    await handleGetMapOverview(ctx, conn, Op.GET_MAP_OVERVIEW, 1);
    const frame = sent[sent.length - 1];
    assert.equal(frame.ok, true);
    const cities = frame.data?.cities as Array<[number, number, string]>;
    assert.ok(Array.isArray(cities));
    return new Map(cities.map(([x, y, side]) => [`${x},${y}`, side]));
  }

  async function cleanFixtures(): Promise<void> {
    await pool.query(`DELETE FROM world_tiles WHERE (x, y) IN (($1, $2), ($3, $4), ($5, $6), ($7, $8), ($9, $10))`, [
      P.own.x, P.own.y, P.enemy.x, P.enemy.y, P.npc.x, P.npc.y, P.famous.x, P.famous.y, P.wild.x, P.wild.y,
    ]);
    await pool.query(`DELETE FROM famous_cities WHERE name = $1`, ['小地图测试名城']);
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'map_overview');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    await cleanFixtures();
    (ctx as { pool: pg.Pool }).pool = pool;

    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`map-overview-a-${Date.now()}`])).rows[0].id as string;
    otherAccountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`map-overview-b-${Date.now()}`])).rows[0].id as string;
    ownerAccounts.push(accountId, otherAccountId);
    (conn as { accountId: string }).accountId = accountId;

    const ownCity = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '本方测试城', 0, 0, 0, $2, $3) RETURNING id`,
      [accountId, P.own.x, P.own.y],
    )).rows[0].id as string;
    const enemyCity = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '他方测试城', 0, 0, 0, $2, $3) RETURNING id`,
      [otherAccountId, P.enemy.x, P.enemy.y],
    )).rows[0].id as string;
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [P.own.x, P.own.y, ownCity],
    );
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [P.enemy.x, P.enemy.y, enemyCity],
    );
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'npc_city', 2, NULL, '{}'::jsonb)`,
      [P.npc.x, P.npc.y],
    );
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'npc_city', 3, NULL, $3::jsonb)`,
      [P.famous.x, P.famous.y, JSON.stringify({ famous: { name: '小地图测试名城', stage: 'outer' } })],
    );
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', 1, NULL, NULL)`,
      [P.wild.x, P.wild.y],
    );
  });

  after(async () => {
    if (ownerAccounts.length) {
      await pool.query(`DELETE FROM accounts WHERE id = ANY($1::uuid[])`, [ownerAccounts]);
      await cleanFixtures();
    }
    await pool.end();
    await tmp?.drop();
  });

  test('按归属区分本方 / 他方 / NPC / 名城，野地不返回', async () => {
    const points = await overview();
    assert.equal(points.get(`${P.own.x},${P.own.y}`), 'own');
    assert.equal(points.get(`${P.enemy.x},${P.enemy.y}`), 'enemy');
    assert.equal(points.get(`${P.npc.x},${P.npc.y}`), 'npc');
    assert.equal(points.get(`${P.famous.x},${P.famous.y}`), 'famous');
    assert.equal(points.has(`${P.wild.x},${P.wild.y}`), false);
  });

  test('换成他方账号查询时本方与他方对调', async () => {
    (conn as { accountId: string }).accountId = otherAccountId;
    try {
      const points = await overview();
      assert.equal(points.get(`${P.own.x},${P.own.y}`), 'enemy');
      assert.equal(points.get(`${P.enemy.x},${P.enemy.y}`), 'own');
    } finally {
      (conn as { accountId: string }).accountId = accountId;
    }
  });

  test('返回带 size 与统计时刻，点位按 y 行 x 列排序', async () => {
    sent.length = 0;
    await handleGetMapOverview(ctx, conn, Op.GET_MAP_OVERVIEW, 2);
    const data = sent[sent.length - 1].data as { size: number; at: string; cities: Array<[number, number, string]> };
    assert.equal(data.size, 1000);
    assert.ok(!Number.isNaN(Date.parse(data.at)));
    const keys = data.cities.map(([x, y]) => y * 1000 + x);
    assert.deepEqual(keys, [...keys].sort((a, b) => a - b));
  });
});
