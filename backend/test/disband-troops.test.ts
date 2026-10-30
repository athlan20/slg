// 遣散士兵（v84，AISLG-209）：DISBAND_TROOPS 的规则、参数解析、返还公式与事务行为。
// 纯规则（参数解析 / 返还取整）不需要数据库；事务规则（扣城内驻军、入账资源、不动在外部队、
// 敌情拦截、分城作用域、事件与推送）需要 TEST_DATABASE_URL（一次性临时库，别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { EventType, Op, type InitiatorRole } from '../common/src/protocol';
import { DISBAND_REFUND_PERCENT, disbandRefund } from '../common/src/troops';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { readDisbandTroops } from '../api/src/handlers-disband';

import { createTempDatabase, type TempDatabase } from './season-test-db';

describe('DISBAND_TROOPS 的参数解析与返还公式（无需数据库）', () => {
  test('合法 troops 原样返回；空对象 / 未知兵种 / 非正整数 / 非对象一律 null', () => {
    assert.deepEqual(readDisbandTroops({ troops: { pikeman: 40, porter: 2 } }), { troops: { pikeman: 40, porter: 2 } });
    const bad: unknown[] = [undefined, {}, { troops: null }, { troops: {} }, { troops: [] }, { troops: 'pikeman' }, { troops: { dragon: 1 } }, { troops: { pikeman: 0 } }, { troops: { pikeman: -1 } }, { troops: { pikeman: 1.5 } }, { troops: { pikeman: '3' } }];
    for (const data of bad) {
      assert.equal(readDisbandTroops(data as Record<string, unknown> | undefined), null, JSON.stringify(data));
    }
  });

  test('返还 = floor(单兵成本 × 数量 × 50%)，五种资源各取整一次；不退人口', () => {
    assert.equal(DISBAND_REFUND_PERCENT, 50);
    // 验收 1：100 个长枪兵 → 遣散 40（金 150 / 木 80 / 铁 50 / 粮 100）
    assert.deepEqual(disbandRefund({ pikeman: 40 }), { gold: 3000, wood: 1600, food: 2000, stone: 0, iron: 1000 });
    // 需求算例：长枪兵 / 轻骑兵 / 铁骑兵各 100
    assert.deepEqual(disbandRefund({ pikeman: 100 }), { gold: 7500, wood: 4000, food: 5000, stone: 0, iron: 2500 });
    assert.deepEqual(disbandRefund({ cavalry: 100 }), { gold: 15000, wood: 4000, food: 7500, stone: 0, iron: 5000 });
    assert.deepEqual(disbandRefund({ iron_cavalry: 100 }), { gold: 30000, wood: 5000, food: 10000, stone: 0, iron: 15000 });
    // 民夫 1 个（金 50 / 木 30 / 粮 30）与木 20 的义兵 1 个
    assert.deepEqual(disbandRefund({ porter: 1 }), { gold: 25, wood: 15, food: 15, stone: 0, iron: 0 });
    assert.deepEqual(disbandRefund({ militia: 1 }), { gold: 40, wood: 10, food: 25, stone: 0, iron: 0 });
    // 多个兵种先累加再取整一次（不是逐兵种取整）
    assert.deepEqual(disbandRefund({ porter: 1, militia: 1 }), { gold: 65, wood: 25, food: 40, stone: 0, iron: 0 });
    // 冲车带石头成本 → 石也返还一半
    assert.deepEqual(disbandRefund({ siege_ram: 1 }), { gold: 200, wood: 200, food: 40, stone: 50, iron: 50 });
    // 未知 / 0 / 负数不计
    assert.deepEqual(disbandRefund({ pikeman: 0 } as never), { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 });
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('DISBAND_TROOPS 的事务行为（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let otherAccountId: string;
  let mainId: string;
  let branchId: string;
  const MAIN = { x: 610, y: 610 };
  const BRANCH = { x: 611, y: 611 };
  const WILD = { x: 612, y: 611 };
  const ENEMY = { x: 613, y: 611 };

  function makeSink() {
    const frames: Array<{ op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const pushes: Array<{ op: number; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: (_accountId: string, frame: { op: number; data?: Record<string, unknown> }) => {
        pushes.push({ op: frame.op, data: frame.data });
        return 0;
      },
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    return { ctx, frames, pushes };
  }

  /** 以指定账号发 DISBAND_TROOPS（经 handleMessage：同时覆盖分发层的参数解析与 cityId 归属校验） */
  async function disband(account: string, data: Record<string, unknown>) {
    const sink = makeSink();
    const conn = { accountId: account, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op: Op.DISBAND_TROOPS, seq: 7, data }));
    return { res: sink.frames[sink.frames.length - 1], pushes: sink.pushes };
  }

  async function getState(account: string, cityId?: string) {
    const sink = makeSink();
    const conn = { accountId: account, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op: Op.GET_STATE, seq: 1, data: cityId ? { cityId } : {} }));
    const res = sink.frames[sink.frames.length - 1];
    return (res.data?.city ?? null) as null | {
      army: Record<string, number>;
      resources: Record<string, number>;
      population: { current: number };
      armyFoodUsePerHour: number;
      inBattle: boolean;
      mutinyNextAt: string | null;
    };
  }

  async function setArmy(cityId: string, army: Record<string, number>): Promise<void> {
    await pool.query(`DELETE FROM city_army WHERE city_id = $1`, [cityId]);
    for (const [troop, count] of Object.entries(army)) {
      await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`, [cityId, troop, count]);
    }
  }

  async function armyOf(cityId: string): Promise<Record<string, number>> {
    const rows = (await pool.query(`SELECT troop, count FROM city_army WHERE city_id = $1`, [cityId])).rows as Array<{ troop: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.troop, row.count]));
  }

  /** 每个用例开始前：清掉行军 / NPC 来袭 / 事件与本用例临时地块，恢复固定地块归属与城池资源人口 */
  async function reset(): Promise<void> {
    await pool.query(`DELETE FROM marches WHERE account_id = ANY($1::uuid[])`, [[accountId, otherAccountId]]);
    await pool.query(`DELETE FROM npc_attacks WHERE account_id = $1`, [accountId]);
    await pool.query(`DELETE FROM tile_army WHERE (x, y) IN (($1, $2), ($3, $4))`, [WILD.x, WILD.y, ENEMY.x, ENEMY.y]);
    await pool.query(`DELETE FROM world_tiles WHERE (x, y) IN (($1, $2))`, [ENEMY.x, ENEMY.y]);
    await pool.query(`DELETE FROM events WHERE account_id = ANY($1::uuid[])`, [[accountId, otherAccountId]]);
    // 固定地块：主城 / 分城地块与主城名下一块野地（敌情判定靠 owner_city_id 连接）
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES
         ($1, $2, 'plain', 'city', 0, $3, NULL),
         ($4, $5, 'plain', 'city', 0, $6, NULL),
         ($7, $8, 'plain', 'wilderness', 2, $3, NULL)
       ON CONFLICT (x, y) DO UPDATE SET kind = EXCLUDED.kind, level = EXCLUDED.level, owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [MAIN.x, MAIN.y, mainId, BRANCH.x, BRANCH.y, branchId, WILD.x, WILD.y],
    );
    await setArmy(mainId, { pikeman: 100 });
    await setArmy(branchId, { militia: 10 });
    await pool.query(
      `UPDATE cities SET gold = 1000, wood = 1000, food = 1000, stone = 1000, iron = 1000,
                         population = 50, population_rem = 0, settled_at = now(),
                         gold_rem = 0, wood_rem = 0, food_rem = 0, stone_rem = 0, iron_rem = 0,
                         mutiny_next_at = NULL, starve_warned_at = NULL
       WHERE id = ANY($1::uuid[])`,
      [[mainId, branchId]],
    );
  }

  async function cityRow(cityId: string) {
    return (await pool.query(
      `SELECT gold, wood, food, stone, iron, population, mutiny_next_at, starve_warned_at FROM cities WHERE id = $1`,
      [cityId],
    )).rows[0] as { gold: number; wood: number; food: number; stone: number; iron: number; population: number; mutiny_next_at: Date | null; starve_warned_at: Date | null };
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'disband');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    const mk = async (label: string): Promise<string> =>
      (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`])).rows[0].id as string;
    accountId = await mk('disband');
    otherAccountId = await mk('disband-other');
    mainId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, '主城', 1000, 1000, 1000, $2, $3) RETURNING id`,
      [accountId, MAIN.x, MAIN.y],
    )).rows[0].id as string;
    // 官府 5 级：不产金；农田 0 级 → 只有基础粮 100/h，便于构造「断粮 → 遣散后不再断粮」
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 5)`, [mainId]);
    branchId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y, origin_level) VALUES ($1, '分城', 1000, 1000, 1000, $2, $3, 2) RETURNING id`,
      [accountId, BRANCH.x, BRANCH.y],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 2)`, [branchId]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES
         ($1, $2, 'plain', 'city', 0, $3, NULL),
         ($4, $5, 'plain', 'city', 0, $6, NULL),
         ($7, $8, 'plain', 'wilderness', 2, $3, NULL)`,
      [MAIN.x, MAIN.y, mainId, BRANCH.x, BRANCH.y, branchId, WILD.x, WILD.y],
    );
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('遣散成功：扣城内驻军、按 50% 入账、人口不变、写事件并推送', async () => {
    await reset();
    const before = await cityRow(mainId);
    const { res, pushes } = await disband(accountId, { troops: { pikeman: 40 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.deepEqual(res.data?.disbanded, { pikeman: 40 });
    assert.deepEqual(res.data?.refunded, { gold: 3000, wood: 1600, food: 2000, stone: 0, iron: 1000 });
    const city = res.data?.city as { army: Record<string, number>; armyFoodUsePerHour: number };
    assert.equal(city.army.pikeman, 60);
    // 城内 60 长枪兵 → 耗粮 60 × 5/h
    assert.equal(city.armyFoodUsePerHour, 300);
    assert.deepEqual(await armyOf(mainId), { pikeman: 60 });
    const afterRow = await cityRow(mainId);
    assert.equal(afterRow.gold - before.gold, 3000);
    assert.equal(afterRow.wood - before.wood, 1600);
    // 粮会被城内驻军按小时吃掉：读取与结算之间的几毫秒可能按整点取整扣 1~2（余数与其它资源同口径），
    // 因此粮只断言「入账了这么多、最多被吃掉 2」；权威返还数字由响应 refunded 断言。
    const foodGain = afterRow.food - before.food;
    assert.ok(foodGain >= 1998 && foodGain <= 2000, `粮应增加约 2000（实际 ${foodGain}）`);
    assert.equal(afterRow.iron - before.iron, 1000);
    assert.equal(afterRow.stone, before.stone);
    assert.equal(afterRow.population, before.population);
    const event = (await pool.query(`SELECT type, detail FROM events WHERE account_id = $1 AND type = $2`, [accountId, EventType.TROOPS_DISBANDED])).rows[0];
    assert.ok(event, '应写入 troops_disbanded 事件');
    assert.deepEqual(event.detail.troops, { pikeman: 40 });
    assert.deepEqual(event.detail.refunded, { gold: 3000, wood: 1600, food: 2000, stone: 0, iron: 1000 });
    assert.ok(pushes.some((push) => push.op === Op.PUSH_CITY_STATE && push.data?.reason === 'troops_disbanded' && push.data?.cityId === mainId));

    // GET_EVENTS 能看到 troops_disbanded（验收口径：客户端读事件流即可看到遣散记录）
    const sink = makeSink();
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op: Op.GET_EVENTS, seq: 9, data: { limit: 20 } }));
    const events = (sink.frames[sink.frames.length - 1].data?.events ?? []) as Array<{ type: string; detail: Record<string, unknown> }>;
    const listed = events.find((item) => item.type === 'troops_disbanded');
    assert.ok(listed, '事件流应包含 troops_disbanded');
    assert.deepEqual(listed.detail.troops, { pikeman: 40 });
  });

  test('一次遣散多个兵种：返还为各兵种之和、每种资源取整一次', async () => {
    await reset();
    await setArmy(mainId, { porter: 1, militia: 1, pikeman: 2 });
    const { res } = await disband(accountId, { troops: { porter: 1, militia: 1, pikeman: 2 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.deepEqual(res.data?.refunded, disbandRefund({ porter: 1, militia: 1, pikeman: 2 }));
    assert.deepEqual(await armyOf(mainId), {});
  });

  test('分城作用域：不带 cityId 作用于主城；带分城 id 作用于分城；别人的城 → INVALID_PARAMS', async () => {
    await reset();
    const main = await disband(accountId, { troops: { pikeman: 5 } });
    assert.equal(main.res.ok, true);
    assert.equal((await armyOf(mainId)).pikeman, 95);
    assert.equal((await armyOf(branchId)).militia, 10, '主城遣散不动分城');

    const branch = await disband(accountId, { cityId: branchId, troops: { militia: 4 } });
    assert.equal(branch.res.ok, true, JSON.stringify(branch.res.error));
    assert.equal((branch.res.data?.city as { id?: string; army: Record<string, number> }).id, branchId);
    assert.equal((await armyOf(branchId)).militia, 6);
    assert.equal((await armyOf(mainId)).pikeman, 95, '分城遣散不动主城');

    // 他账号的城：分发层归属校验 → INVALID_PARAMS，且主城不变
    const foreignCity = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron) VALUES ($1, '他家', 0, 0, 0, 0, 0) RETURNING id`, [otherAccountId])).rows[0].id as string;
    const foreign = await disband(accountId, { cityId: foreignCity, troops: { pikeman: 1 } });
    assert.equal(foreign.res.ok, false);
    assert.equal(foreign.res.error?.code, 'INVALID_PARAMS');
    assert.equal((await armyOf(mainId)).pikeman, 95);
  });

  test('某兵种超过城内数量 → INSUFFICIENT_TROOPS；出错不改任何数据（含别处的同兵种）', async () => {
    await reset();
    // 野地驻军与在外部队都有长枪兵：只认城内
    await pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, 'pikeman', 999)`, [WILD.x, WILD.y]);
    const before = await cityRow(mainId);
    const over = await disband(accountId, { troops: { pikeman: 101 } });
    assert.equal(over.res.ok, false);
    assert.equal(over.res.error?.code, 'INSUFFICIENT_TROOPS');
    assert.deepEqual(await armyOf(mainId), { pikeman: 100 });
    const after = await cityRow(mainId);
    assert.equal(after.gold, before.gold);
    assert.equal((await pool.query(`SELECT count FROM tile_army WHERE x = $1 AND y = $2 AND troop = 'pikeman'`, [WILD.x, WILD.y])).rows[0].count, 999);

    // 城内清空该兵种后，哪怕野地有 999 个也返回 INSUFFICIENT_TROOPS
    await setArmy(mainId, {});
    const none = await disband(accountId, { troops: { pikeman: 1 } });
    assert.equal(none.res.error?.code, 'INSUFFICIENT_TROOPS');
  });

  test('合法遣散只扣城内：野地驻军不变', async () => {
    await reset();
    await pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, 'pikeman', 30)`, [WILD.x, WILD.y]);
    const { res } = await disband(accountId, { troops: { pikeman: 40 } });
    assert.equal(res.ok, true);
    assert.deepEqual(await armyOf(mainId), { pikeman: 60 });
    assert.equal((await pool.query(`SELECT count FROM tile_army WHERE x = $1 AND y = $2 AND troop = 'pikeman'`, [WILD.x, WILD.y])).rows[0].count, 30);
  });

  test('有敌情 → CITY_IN_BATTLE：行军指向本城或名下野地、未结 NPC 来袭都算，且不改数据', async () => {
    await reset();
    // (a) 未结的 NPC 来袭
    await pool.query(
      `INSERT INTO npc_attacks (account_id, target_city_id, x, y, target, level, army, arrive_at)
       VALUES ($1, $2, $3, $4, 'city', 1, '{}'::jsonb, now() + interval '1 hour')`,
      [accountId, mainId, MAIN.x, MAIN.y],
    );
    const npc = await disband(accountId, { troops: { pikeman: 1 } });
    assert.equal(npc.res.error?.code, 'CITY_IN_BATTLE');
    assert.deepEqual(await armyOf(mainId), { pikeman: 100 });
    assert.equal((await getState(accountId))?.inBattle, true, 'GET_STATE 的 city.inBattle 应为 true');
    await pool.query(`UPDATE npc_attacks SET resolved_at = now() WHERE account_id = $1`, [accountId]);

    // (b) 有行军正指向名下野地（运输 / 来袭 / 占领等一切 marching）
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, $3, $4, '{"pikeman":1}'::jsonb, 'plunder', 'marching', 'player', now() + interval '1 hour')`,
      [otherAccountId, branchId, WILD.x, WILD.y],
    );
    const march = await disband(accountId, { troops: { pikeman: 1 } });
    assert.equal(march.res.error?.code, 'CITY_IN_BATTLE');
    assert.deepEqual(await armyOf(mainId), { pikeman: 100 });
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [otherAccountId]);

    // 敌方行军指向的是别人的野地 → 与本城无关，可以遣散
    const enemyCity = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron) VALUES ($1, '敌城', 0, 0, 0, 0, 0) RETURNING id`, [otherAccountId])).rows[0].id as string;
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', 1, $3, NULL)`,
      [ENEMY.x, ENEMY.y, enemyCity],
    );
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, $3, $4, '{"pikeman":1}'::jsonb, 'plunder', 'marching', 'player', now() + interval '1 hour')`,
      [otherAccountId, enemyCity, ENEMY.x, ENEMY.y],
    );
    const ok = await disband(accountId, { troops: { pikeman: 1 } });
    assert.equal(ok.res.ok, true, JSON.stringify(ok.res.error));
    assert.equal((await armyOf(mainId)).pikeman, 99);
  });

  test('参数非法 → INVALID_PARAMS，不改任何数据', async () => {
    await reset();
    for (const troops of [{}, { dragon: 1 }, { pikeman: 0 }, { pikeman: -1 }, { pikeman: 1.5 }, { pikeman: '3' }, null]) {
      const { res } = await disband(accountId, { troops });
      assert.equal(res.ok, false, JSON.stringify(troops));
      assert.equal(res.error?.code, 'INVALID_PARAMS');
    }
    assert.deepEqual(await armyOf(mainId), { pikeman: 100 });
    // 完全没有 troops 字段
    const missing = await disband(accountId, {});
    assert.equal(missing.res.error?.code, 'INVALID_PARAMS');
  });

  test('断粮状态下遣散：耗粮下降；不再断粮时清空 mutinyNextAt / starveWarnedAt', async () => {
    await reset();
    // 100 长枪兵耗粮 500/h > 基础粮产 100/h → 净 -400/h；粮食归零即断粮
    await pool.query(
      `UPDATE cities SET food = 1, mutiny_next_at = now() + interval '1 hour', starve_warned_at = now() WHERE id = $1`,
      [mainId],
    );
    const starving = await getState(accountId);
    assert.equal(starving?.mutinyNextAt !== null, true);

    // 遣散 90 个 → 剩 10 个耗粮 50/h < 100/h，净产量转正，断粮计时应清空
    const { res } = await disband(accountId, { troops: { pikeman: 90 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal((res.data?.city as { armyFoodUsePerHour: number }).armyFoodUsePerHour, 50);
    const row = await cityRow(mainId);
    assert.equal(row.mutiny_next_at, null);
    assert.equal(row.starve_warned_at, null);
  });
});
