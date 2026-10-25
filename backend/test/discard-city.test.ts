// 放弃分城（v57，AISLG-153）的事务规则：主城拒绝、部队 / 驻军 / 战斗拦截、放弃后的级联清理、
// 地块回到 NPC 城、冷却判定与名城恢复。需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑
// （用一次性的临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { loadDiscardCooldownActive } from '../common/src/branch-city-db';
import { FAMOUS_CITY_LEVEL, famousGarrisons } from '../common/src/famous-city';
import { NPC_CITY_PROFILE } from '../common/src/world';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { runWithCity } from '../api/src/city-scope';
import { handleDiscardCity } from '../api/src/handlers-discard';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('放弃分城（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let mainId: string;
  // 分城 B：官府 2 级、来源 Lv2 NPC 城，地块 (500,500)，名下野地 (501,500)
  let branchId: string;
  // 名城分城 C：地块 (700,700)，登记为名官渡
  let famousBranchId: string;
  const B = { x: 500, y: 500, wild: { x: 501, y: 500 } };
  const C = { x: 700, y: 700, name: '官渡' };

  const sent: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
      sent.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  const conn = { accountId: null as string | null, role: 'player' as InitiatorRole } as unknown as ConnInfo;

  /** 以指定城池身份发起放弃（data 缺省为确认放弃），返回最后一帧响应 */
  async function discard(cityId: string, data?: Record<string, unknown>) {
    sent.length = 0;
    await runWithCity(cityId, () => handleDiscardCity(ctx, conn, Op.DISCARD_CITY, 1, data ?? { confirm: true }));
    return sent[sent.length - 1];
  }

  async function count(sql: string, params: unknown[]): Promise<number> {
    return Number((await pool.query(sql, params)).rows[0].n);
  }

  /** 固定坐标的地块与登记不随账号级联删除，开始与结束都清一遍，避免上次异常退出留下残留 */
  async function cleanFixtures(): Promise<void> {
    await pool.query(`DELETE FROM tile_army WHERE (x, y) IN (($1, $2))`, [B.wild.x, B.wild.y]);
    await pool.query(`DELETE FROM world_tiles WHERE (x, y) IN (($1, $2), ($3, $4), ($5, $6))`, [B.x, B.y, B.wild.x, B.wild.y, C.x, C.y]);
    await pool.query(`DELETE FROM city_discards WHERE (x, y) IN (($1, $2), ($3, $4))`, [B.x, B.y, C.x, C.y]);
    await pool.query(`DELETE FROM famous_cities WHERE name = $1`, [C.name]);
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'discard');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    await cleanFixtures();
    (ctx as { pool: pg.Pool }).pool = pool;
    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`discard-test-${Date.now()}`])).rows[0].id as string;
    (conn as { accountId: string }).accountId = accountId;

    mainId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城', 0, 0, 0, 10, 10) RETURNING id`,
      [accountId],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 5)`, [mainId]);

    branchId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y, origin_level)
       VALUES ($1, '分城B', 1234, 0, 0, $2, $3, 2) RETURNING id`,
      [accountId, B.x, B.y],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 2), ($1, 'farm', 3)`, [branchId]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 40)`, [branchId]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [B.x, B.y, branchId],
    );
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', 1, $3, NULL)`,
      [B.wild.x, B.wild.y, branchId],
    );

    famousBranchId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y, famous_name, origin_level)
       VALUES ($1, '官渡', 0, 0, 0, $2, $3, $4, NULL) RETURNING id`,
      [accountId, C.x, C.y, C.name],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 1)`, [famousBranchId]);
    await pool.query(`INSERT INTO famous_cities (name, x, y) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`, [C.name, C.x, C.y]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
      [C.x, C.y, famousBranchId],
    );
  });

  after(async () => {
    if (accountId) {
      await pool.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
      await cleanFixtures();
    }
    await pool.end();
    await tmp?.drop();
  });

  test('主城不能放弃；缺 confirm 或缺 cityId 返回 INVALID_PARAMS', async () => {
    assert.equal((await discard(mainId)).error?.code, 'DISCARD_MAIN_CITY');
    assert.equal((await discard(branchId, { confirm: false })).error?.code, 'INVALID_PARAMS');
    sent.length = 0;
    await runWithCity(branchId, () => handleDiscardCity(ctx, conn, Op.DISCARD_CITY, 1, undefined));
    assert.equal(sent[0]?.error?.code, 'INVALID_PARAMS', '无 data 同样拒绝');
    assert.equal((await count(`SELECT count(*)::int AS n FROM cities WHERE id = $1`, [branchId])), 1, '被拒后分城仍在');
  });

  test('有部队在外（行军中）时拒绝，返回后可放弃', async () => {
    const marchId = (await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, 900, 900, '{"militia": 5}', 'plunder', 'marching', 'player', now() + interval '1 hour') RETURNING id`,
      [accountId, branchId],
    )).rows[0].id as string;
    assert.equal((await discard(branchId)).error?.code, 'ARMY_OUTSIDE');
    await pool.query(`UPDATE marches SET status = 'completed' WHERE id = $1`, [marchId]);
  });

  test('有行军指向本城或其名下野地（战斗中）时拒绝', async () => {
    const marchId = (await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, $3, $4, '{"militia": 5}', 'plunder', 'marching', 'player', now() + interval '1 hour') RETURNING id`,
      [accountId, mainId, B.wild.x, B.wild.y],
    )).rows[0].id as string;
    assert.equal((await discard(branchId)).error?.code, 'CITY_IN_BATTLE');
    await pool.query(`DELETE FROM marches WHERE id = $1`, [marchId]);
  });

  test('名下野地仍有驻军时拒绝', async () => {
    await pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, 'militia', 7)`, [B.wild.x, B.wild.y]);
    assert.equal((await discard(branchId)).error?.code, 'WILDERNESS_GARRISONED');
    await pool.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [B.wild.x, B.wild.y]);
  });

  test('放弃成功：分城与其城内资源 / 驻军 / 建筑作废，地块回到 Lv2 NPC 城，野地转无主，冷却 = 官府 2 天', async () => {
    const before = Date.now();
    const res = await discard(branchId);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.data?.cityId, branchId);
    const until = Date.parse(String(res.data?.cooldownUntil));
    assert.ok(until - before >= 2 * 24 * 60 * 60 * 1000 - 5_000 && until - before <= 2 * 24 * 60 * 60 * 1000 + 60_000, '冷却约 2 天');

    assert.equal(await count(`SELECT count(*)::int AS n FROM cities WHERE id = $1`, [branchId]), 0, '城池行已删除');
    assert.equal(await count(`SELECT count(*)::int AS n FROM city_buildings WHERE city_id = $1`, [branchId]), 0, '建筑级联清理');
    assert.equal(await count(`SELECT count(*)::int AS n FROM city_army WHERE city_id = $1`, [branchId]), 0, '城内驻军作废');

    const tile = (await pool.query(`SELECT kind, level, owner_city_id, npc FROM world_tiles WHERE x = $1 AND y = $2`, [B.x, B.y])).rows[0];
    assert.equal(tile.kind, 'npc_city');
    assert.equal(tile.level, 2);
    assert.equal(tile.owner_city_id, null);
    assert.deepEqual(tile.npc.garrison, NPC_CITY_PROFILE[2].garrison, '守军回到满编');
    assert.deepEqual(tile.npc.stock, NPC_CITY_PROFILE[2].stockScale, '库存按 NPC 初始档案重置');
    assert.equal(tile.npc.famous, undefined, '普通城无名城标记');

    const wild = (await pool.query(`SELECT owner_city_id FROM world_tiles WHERE x = $1 AND y = $2`, [B.wild.x, B.wild.y])).rows[0];
    assert.equal(wild.owner_city_id, null, '名下野地转为无主');
    assert.equal(await loadDiscardCooldownActive(pool, accountId, B.x, B.y), true, '本账号冷却中');
  });

  test('冷却内本账号不能再占回；其他账号不受影响', async () => {
    assert.equal(await loadDiscardCooldownActive(pool, accountId, B.x, B.y), true);
    const other = `discard-other-${Date.now()}`;
    const otherId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [other])).rows[0].id as string;
    try {
      assert.equal(await loadDiscardCooldownActive(pool, otherId, B.x, B.y), false);
    } finally {
      await pool.query(`DELETE FROM accounts WHERE id = $1`, [otherId]);
    }
  });

  test('名城放弃后恢复为未攻破的名城：外围满编、城守阶段守军、保留名城标记', async () => {
    const res = await discard(famousBranchId);
    assert.equal(res.ok, true, JSON.stringify(res));
    const tile = (await pool.query(`SELECT kind, level, npc FROM world_tiles WHERE x = $1 AND y = $2`, [C.x, C.y])).rows[0];
    assert.equal(tile.kind, 'npc_city');
    assert.equal(tile.level, FAMOUS_CITY_LEVEL);
    assert.deepEqual(tile.npc.garrison, famousGarrisons(FAMOUS_CITY_LEVEL).keeper);
    assert.equal(tile.npc.famous.name, C.name);
    assert.equal(tile.npc.famous.outerClearedAt, null, '外围未清，恢复为未攻破');
    assert.deepEqual(tile.npc.famous.outerGarrison, famousGarrisons(FAMOUS_CITY_LEVEL).outer);
  });
});
