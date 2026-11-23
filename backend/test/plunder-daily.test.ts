// 野地掠夺按账号每日递减 + 战斗所得超出储量上限作废（v118，AISLG-270）。
// 纯规则（倍数分档 / 打折 / 钳上限）不需要数据库；计数读写与 GET_STATE 的 plunderDaily
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（临时集群，测试在其中新建独立库），否则跳过。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { arenaDayIndex, arenaNextDayAt } from '../common/src/arena';
import { Op, type Resources, type ResponseFrame } from '../common/src/protocol';
import {
  PLUNDER_DAILY_FULL_LIMIT,
  PLUNDER_DAILY_HALF_LIMIT,
  plunderDailyView,
  plunderLootPercent,
  scaleLoot,
} from '../common/src/plunder';
import { capLootByStorage, emptyResources, resourcesTotal } from '../common/src/loot-cap';
import { consumeWildernessPlunder, loadPlunderDaily } from '../common/src/plunder-daily-db';
import { insertAccountWithCity } from '../api/src/auth';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';

import { createTempDatabase, type TempDatabase } from './season-test-db';

// 本文件断言未加速基准值（时间缩放语义由 time-scale.test.ts 专测）
setTimeScaleCache(1);

function res(gold: number, food: number, wood: number, stone: number, iron: number): Resources {
  return { gold, food, wood, stone, iron };
}

// ---- 规则一：倍数分档 ----

test('倍数分档：第 1~200 次全额、201~400 次减半、401 次起两成（含本次）', () => {
  assert.equal(PLUNDER_DAILY_FULL_LIMIT, 200);
  assert.equal(PLUNDER_DAILY_HALF_LIMIT, 400);
  for (const n of [1, 2, 100, 199, 200]) {
    assert.equal(plunderLootPercent(n), 100, `第 ${n} 次全额`);
  }
  for (const n of [201, 250, 399, 400]) {
    assert.equal(plunderLootPercent(n), 50, `第 ${n} 次减半`);
  }
  for (const n of [401, 402, 1000, 5000]) {
    assert.equal(plunderLootPercent(n), 20, `第 ${n} 次两成`);
  }
  // 非法输入按第 1 次处理（纯函数兜底，正常流程不会传入）
  assert.equal(plunderLootPercent(0), 100);
  assert.equal(plunderLootPercent(-5), 100);
  assert.equal(plunderLootPercent(200.9), 100, '向下取整后仍是第 200 次');
});

test('scaleLoot：每种资源乘倍数向下取整，倍数 100 原样返回', () => {
  const loot = res(999, 1001, 3, 0, 7);
  assert.deepEqual(scaleLoot(loot, 100), loot);
  assert.deepEqual(scaleLoot(loot, 50), res(499, 500, 1, 0, 3));
  assert.deepEqual(scaleLoot(loot, 20), res(199, 200, 0, 0, 1));
  assert.deepEqual(scaleLoot(loot, 0), emptyResources());
  assert.deepEqual(loot, res(999, 1001, 3, 0, 7), '不改入参');
});

test('plunderDailyView：count 为今日已用次数，lootPercent 为下一次的倍数，resetAt 为下个游戏日零点', () => {
  const now = new Date('2026-11-20T03:00:00.000Z');
  const fresh = plunderDailyView(0, now);
  assert.equal(fresh.count, 0);
  assert.equal(fresh.lootPercent, 100);
  assert.equal(fresh.resetAt, arenaNextDayAt(now).toISOString());

  assert.equal(plunderDailyView(199, now).lootPercent, 100, '第 200 次仍全额');
  assert.equal(plunderDailyView(200, now).lootPercent, 50, '第 201 次减半');
  assert.equal(plunderDailyView(400, now).lootPercent, 20, '第 401 次两成');
  assert.equal(plunderDailyView(-3, now).count, 0, '负数按 0');
});

// ---- 规则二：战斗所得钳储量上限 ----

test('capLootByStorage：满仓 → 全作废、一点不进', () => {
  const caps = res(1_000_000, 50_000, 50_000, 50_000, 50_000);
  const current = res(0, 50_000, 50_000, 50_000, 50_000);
  const loot = res(2_000, 1_000, 500, 0, 0);
  const split = capLootByStorage(current, caps, loot);
  assert.deepEqual(split.credited, res(2_000, 0, 0, 0, 0), '金币未满照常入账');
  assert.deepEqual(split.wasted, res(0, 1_000, 500, 0, 0));
});

test('capLootByStorage：半满 → 只补到上限，其余作废', () => {
  const caps = res(1_000_000, 10_000, 10_000, 10_000, 10_000);
  const current = res(0, 9_400, 0, 10_000, 1_234);
  const loot = res(0, 1_000, 250, 500, 0);
  const split = capLootByStorage(current, caps, loot);
  assert.deepEqual(split.credited, res(0, 600, 250, 0, 0));
  assert.deepEqual(split.wasted, res(0, 400, 0, 500, 0));
});

test('capLootByStorage：已超上限 → 全作废且不扣存量（存量由调用方保持不变）', () => {
  const caps = res(1_000_000, 10_000, 10_000, 10_000, 10_000);
  const current = res(0, 930_000, 1_150_000, 10_000, 10_500);
  const loot = res(0, 800, 800, 800, 800);
  const split = capLootByStorage(current, caps, loot);
  assert.equal(resourcesTotal(split.credited), 0);
  assert.deepEqual(split.wasted, loot);
  // 得到作废结果的入账量为 0，故调用方不会下发扣减（存量原样保留，即「不扣减」）
  const after = res(
    current.gold + split.credited.gold,
    current.food + split.credited.food,
    current.wood + split.credited.wood,
    current.stone + split.credited.stone,
    current.iron + split.credited.iron,
  );
  assert.deepEqual(after, current);
});

test('capLootByStorage：金币按金币上限（100 万 × 缩放）单独判定', () => {
  const caps = res(1_000_000, 10_000, 10_000, 10_000, 10_000);
  const current = res(999_500, 0, 0, 0, 0);
  const split = capLootByStorage(current, caps, res(5_000, 0, 0, 0, 0));
  assert.deepEqual(split.credited, res(500, 0, 0, 0, 0));
  assert.deepEqual(split.wasted, res(4_500, 0, 0, 0, 0));
  // 负数 / 小数按 0 / 向下取整（兜底）
  const odd = capLootByStorage(res(0, 0, 0, 0, 0), caps, res(-5, 10.9, 0, 0, 0));
  assert.deepEqual(odd.credited, res(0, 10, 0, 0, 0));
  assert.deepEqual(odd.wasted, emptyResources());
});

// ---- 计数读写（需 TEST_DATABASE_URL） ----

const dbUrl = process.env.TEST_DATABASE_URL;

describe('野地掠夺每日计数（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `plunder-daily-${Date.now()}`;

  async function inTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function newAccount(name: string): Promise<{ id: string; cityId: string }> {
    return inTx(async (client) => {
      const created = await insertAccountWithCity(client, { username: `${tag}-${name}`, passwordHash: 'x', signupIp: null });
      const city = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [created.id]);
      return { id: created.id, cityId: (city.rows[0] as { id: string }).id };
    });
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'plunder_daily');
    pool = new pg.Pool({ connectionString: db.url, max: 4 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('存量账号视为今天还没掠夺：count=0、下一次 100%、resetAt 为下个游戏日', async () => {
    const { id } = await newAccount('fresh');
    const now = new Date();
    const view = await loadPlunderDaily(pool, id, now);
    assert.equal(view.count, 0);
    assert.equal(view.lootPercent, 100);
    assert.equal(view.resetAt, arenaNextDayAt(now).toISOString());
  });

  test('每次成功野地掠夺 +1（本次倍数按第 N 次算），GET_STATE 的 plunderDaily 与实际次数一致', async () => {
    const { id } = await newAccount('count');
    const now = new Date();
    const first = await inTx((client) => consumeWildernessPlunder(client, id, now));
    assert.equal(first.count, 1);
    assert.equal(first.lootPercent, 100);
    const second = await inTx((client) => consumeWildernessPlunder(client, id, now));
    assert.equal(second.count, 2);
    assert.deepEqual((await loadPlunderDaily(pool, id, now)).count, 2);
    // 直接把计数推到门槛上，验证第 201 / 401 次的倍数（不必跑 200 次结算）
    await pool.query(`UPDATE accounts SET plunder_day_count = $2 WHERE id = $1`, [id, PLUNDER_DAILY_FULL_LIMIT]);
    const boundary = await inTx((client) => consumeWildernessPlunder(client, id, now));
    assert.equal(boundary.count, 201);
    assert.equal(boundary.lootPercent, 50);
    await pool.query(`UPDATE accounts SET plunder_day_count = $2 WHERE id = $1`, [id, PLUNDER_DAILY_HALF_LIMIT]);
    const tail = await inTx((client) => consumeWildernessPlunder(client, id, now));
    assert.equal(tail.count, 401);
    assert.equal(tail.lootPercent, 20);
    const view = await loadPlunderDaily(pool, id, now);
    assert.deepEqual({ count: view.count, lootPercent: view.lootPercent }, { count: 401, lootPercent: 20 });
  });

  test('跨游戏日重置为 1（存的日序号不是今天就清零）', async () => {
    const { id } = await newAccount('reset');
    const now = new Date();
    // 造一条「昨天已经打了 400 次」的记录
    await pool.query(`UPDATE accounts SET plunder_day = $2, plunder_day_count = 400 WHERE id = $1`, [id, arenaDayIndex(now) - 1]);
    assert.equal((await loadPlunderDaily(pool, id, now)).count, 0, '跨日读出来是 0');
    const used = await inTx((client) => consumeWildernessPlunder(client, id, now));
    assert.equal(used.count, 1);
    assert.equal(used.lootPercent, 100);
    assert.equal((await loadPlunderDaily(pool, id, now)).count, 1);
  });

  test('GET_STATE 带出账号级 plunderDaily（与计数一致）', async () => {
    const { id } = await newAccount('state');
    const now = new Date();
    await inTx((client) => consumeWildernessPlunder(client, id, now));
    const sent: ResponseFrame[] = [];
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = {
      socket: { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)) } as never,
      ip: null,
      host: null,
      accountId: id,
      username: `${tag}-state`,
      role: 'player',
      sessionId: null,
      connectedAt: new Date(),
    };
    registry.add(conn);
    await handleMessage({ pool, registry, passwordDisabledHosts: new Set() } as HandlerContext, conn, JSON.stringify({ op: Op.GET_STATE, seq: 1 }));
    const frame = sent.find((f) => f.op === Op.GET_STATE);
    assert.ok(frame?.ok, JSON.stringify(sent.map((f) => f.ok)));
    const view = (frame.data as { plunderDaily?: { count: number; lootPercent: number; resetAt: string } }).plunderDaily;
    assert.ok(view, 'GET_STATE 带 plunderDaily');
    assert.equal(view.count, 1);
    assert.equal(view.lootPercent, 100);
    assert.equal(typeof view.resetAt, 'string');
  });
});