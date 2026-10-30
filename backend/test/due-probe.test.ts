// Worker 到期探针与慢步骤节流（AISLG-208）：探针的 8 个条件与各自 processDueXxx 的领取条件一致，
// 非到期时为假、置为到期后只有对应位变真；探针失败走 ALL_DUE 兜底；交易所 10 秒、洛阳 5 秒、
// 战场慢步骤 5 秒、换季 5 秒的节流窗口内不再访问数据库。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（临时集群，测试在其中新建独立库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ALL_DUE, probeDueWork, type DueProbe } from '../worker/src/due-probe';
import { MARKET_TICK_MS, processMarketOrders } from '../worker/src/market-tick';
import { LUOYANG_TICK_MS, processLuoyang } from '../worker/src/luoyang-tick';
import { BATTLEFIELD_SLOW_TICK_MS, processBattlefield } from '../worker/src/battlefield-tick';
import { SEASON_CHECK_MS, processSeasonTick, resetSeasonTickStateForTest } from '../worker/src/season-tick';
import { insertAccountWithCity } from '../api/src/auth';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

interface Counting {
  pool: pg.Pool;
  stats: { connect: number; query: number };
}

/** 包一层计数的池：节流是否生效看窗口内有没有 acquire 连接 / 发查询 */
function countingPool(pool: pg.Pool): Counting {
  const stats = { connect: 0, query: 0 };
  const wrapper = {
    connect: (...args: unknown[]) => {
      stats.connect += 1;
      return (pool.connect as (...a: unknown[]) => unknown)(...args);
    },
    query: (...args: unknown[]) => {
      stats.query += 1;
      return (pool.query as (...a: unknown[]) => unknown)(...args);
    },
  } as unknown as pg.Pool;
  return { pool: wrapper, stats };
}

/** 断言探针只有 key 为真 */
function only(probe: DueProbe, key: keyof DueProbe): void {
  for (const [field, value] of Object.entries(probe)) {
    assert.equal(value, field === key, `${field} 应为 ${field === key}`);
  }
}

describe('到期探针与慢步骤节流（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  let accountId: string;
  let cityId: string;
  const rows: Record<string, string> = {};

  before(async () => {
    db = await createTempDatabase(dbUrl as string, 'probe');
    pool = new pg.Pool({ connectionString: db.url, max: 6 });
    await ensureSchema(pool);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await insertAccountWithCity(client, { username: `probe-${Date.now()}`, passwordHash: 'x', signupIp: null });
      await client.query('COMMIT');
      accountId = created.id;
    } finally {
      client.release();
    }
    cityId = (await pool.query(`SELECT id FROM cities WHERE account_id = $1 LIMIT 1`, [accountId])).rows[0].id as string;

    // 基线：8 类队列都有行，但都不满足到期条件
    rows.builds = (await pool.query(
      `INSERT INTO builds (account_id, city_id, kind, status, level, initiator, due_at)
       VALUES ($1, $2, 'farm', 'queued', 1, 'player', NULL) RETURNING id`,
      [accountId, cityId],
    )).rows[0].id;
    rows.recruits = (await pool.query(
      `INSERT INTO recruits (account_id, city_id, troop, count, status, initiator, due_at)
       VALUES ($1, $2, 'militia', 10, 'queued', 'player', NULL) RETURNING id`,
      [accountId, cityId],
    )).rows[0].id;
    rows.defenseCrafts = (await pool.query(
      `INSERT INTO defense_crafts (account_id, city_id, kind, count, status, initiator, unit_seconds, due_at)
       VALUES ($1, $2, 'trap', 1, 'queued', 'player', 10, NULL) RETURNING id`,
      [accountId, cityId],
    )).rows[0].id;
    rows.research = (await pool.query(
      `INSERT INTO tech_research (account_id, city_id, tech, level, status, initiator, due_at)
       VALUES ($1, $2, 'farming', 1, 'completed', 'player', now() + interval '1 hour') RETURNING id`,
      [accountId, cityId],
    )).rows[0].id;
    rows.marches = (await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, 0, 0, '{}'::jsonb, 'return', 'completed', 'player', now() + interval '1 hour') RETURNING id`,
      [accountId, cityId],
    )).rows[0].id;
    rows.npcAttacks = (await pool.query(
      `INSERT INTO npc_attacks (account_id, target_city_id, x, y, target, level, army, arrive_at, resolved_at)
       VALUES ($1, $2, 0, 0, 'city', 1, '{}'::jsonb, now() - interval '1 minute', now()) RETURNING id`,
      [accountId, cityId],
    )).rows[0].id;
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, reserve_empty_at)
       VALUES (0, 0, 'grass', 'wilderness', 1, $1, now() + interval '1 hour')`,
      [cityId],
    );
    const eventId = (await pool.query(
      `INSERT INTO battlefield_events (script, signup_start, start_at, end_at, status)
       VALUES ('guandu', now() - interval '1 day', now() - interval '1 hour', now() + interval '1 day', 'active') RETURNING id`,
    )).rows[0].id as string;
    rows.battlefieldMovements = (await pool.query(
      `INSERT INTO battlefield_squads (event_id, account_id, camp, x, y, origin_x, origin_y, troops, status, arrive_at)
       VALUES ($1, $2, 'yuan', 0, 0, 0, 0, '{}'::jsonb, 'idle', now() + interval '1 hour') RETURNING id`,
      [eventId, accountId],
    )).rows[0].id;
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('都不到期时 8 个位全为假', async () => {
    const probe = await probeDueWork(pool);
    assert.ok(Object.values(probe).every((value) => value === false), JSON.stringify(probe));
  });

  test('逐队列置为到期：只有对应位变真', async () => {
    const cases: Array<{ key: keyof DueProbe; due: string; idle: string }> = [
      { key: 'builds', due: `UPDATE builds SET status = 'building', due_at = now() - interval '1 minute' WHERE id = $1`, idle: `UPDATE builds SET status = 'queued', due_at = NULL WHERE id = $1` },
      { key: 'recruits', due: `UPDATE recruits SET status = 'recruiting', due_at = now() - interval '1 minute' WHERE id = $1`, idle: `UPDATE recruits SET status = 'queued', due_at = NULL WHERE id = $1` },
      { key: 'defenseCrafts', due: `UPDATE defense_crafts SET status = 'crafting', due_at = now() - interval '1 minute' WHERE id = $1`, idle: `UPDATE defense_crafts SET status = 'queued', due_at = NULL WHERE id = $1` },
      { key: 'research', due: `UPDATE tech_research SET status = 'researching', due_at = now() - interval '1 minute' WHERE id = $1`, idle: `UPDATE tech_research SET status = 'completed', due_at = now() + interval '1 hour' WHERE id = $1` },
      { key: 'marches', due: `UPDATE marches SET status = 'marching', arrive_at = now() - interval '1 minute' WHERE id = $1`, idle: `UPDATE marches SET status = 'completed', arrive_at = now() + interval '1 hour' WHERE id = $1` },
      { key: 'npcAttacks', due: `UPDATE npc_attacks SET resolved_at = NULL WHERE id = $1`, idle: `UPDATE npc_attacks SET resolved_at = now() WHERE id = $1` },
      { key: 'reserves', due: `UPDATE world_tiles SET reserve_empty_at = now() - interval '1 minute' WHERE x = 0 AND y = 0`, idle: `UPDATE world_tiles SET reserve_empty_at = now() + interval '1 hour' WHERE x = 0 AND y = 0` },
      { key: 'battlefieldMovements', due: `UPDATE battlefield_squads SET status = 'marching', arrive_at = now() - interval '1 minute' WHERE id = $1`, idle: `UPDATE battlefield_squads SET status = 'idle', arrive_at = now() + interval '1 hour' WHERE id = $1` },
    ];
    for (const item of cases) {
      // 野地储量按坐标更新，其余按行 id 更新
      const params = item.key === 'reserves' ? [] : [rows[item.key]];
      await pool.query(item.due, params);
      only(await probeDueWork(pool), item.key);
      await pool.query(item.idle, params);
    }
  });

  test('战场探针只看进行中的事件：已结束事件的到期小队不算', async () => {
    const finished = (await pool.query(
      `INSERT INTO battlefield_events (script, signup_start, start_at, end_at, status)
       VALUES ('guandu', now() + interval '1 hour', now() + interval '2 hours', now() + interval '3 hours', 'finished') RETURNING id`,
    )).rows[0].id as string;
    try {
      await pool.query(
        `INSERT INTO battlefield_squads (event_id, account_id, camp, x, y, origin_x, origin_y, troops, status, arrive_at)
         VALUES ($1, $2, 'yuan', 0, 0, 0, 0, '{}'::jsonb, 'marching', now() - interval '1 minute')`,
        [finished, accountId],
      );
      const probe = await probeDueWork(pool);
      assert.equal(probe.battlefieldMovements, false, '非 active 事件的到期小队不触发探针');
      assert.ok(Object.values(probe).every((value) => value === false), JSON.stringify(probe));
    } finally {
      await pool.query(`DELETE FROM battlefield_events WHERE id = $1`, [finished]);
    }
  });

  test('探针失败兜底：ALL_DUE 全部为真（退回逐步骤自检）', () => {
    assert.ok(Object.values(ALL_DUE).every((value) => value === true));
  });

  test('交易所过期挂单：10 秒窗口内不再进库', async () => {
    const counter = countingPool(pool);
    await processMarketOrders(counter.pool, 1_000_000);
    const first = counter.stats.connect;
    assert.ok(first > 0);
    await processMarketOrders(counter.pool, 1_000_000 + MARKET_TICK_MS - 1);
    assert.equal(counter.stats.connect, first, '窗口内跳过');
    await processMarketOrders(counter.pool, 1_000_000 + MARKET_TICK_MS);
    assert.equal(counter.stats.connect, first + 1, '窗口结束再跑');
  });

  test('洛阳窗口：5 秒窗口内不再进库', async () => {
    const counter = countingPool(pool);
    await processLuoyang(counter.pool, 2_000_000);
    const first = counter.stats.connect;
    assert.equal(first, 1);
    await processLuoyang(counter.pool, 2_000_000 + LUOYANG_TICK_MS - 1);
    assert.equal(counter.stats.connect, first, '窗口内跳过');
    await processLuoyang(counter.pool, 2_000_000 + LUOYANG_TICK_MS);
    assert.equal(counter.stats.connect, first + 1, '窗口结束再跑');
  });

  test('战场：慢步骤 5 秒节流，行军按探针每秒结算', async () => {
    const counter = countingPool(pool);
    await processBattlefield(counter.pool, false, 3_000_000);
    const slow = counter.stats.connect;
    assert.equal(slow, 4, '首次执行生命周期 / 耗粮 / 积分 / 风向');
    await processBattlefield(counter.pool, false, 3_000_000 + BATTLEFIELD_SLOW_TICK_MS - 1);
    assert.equal(counter.stats.connect, slow, '窗口内慢步骤跳过，探针为假时也不跑行军');
    await processBattlefield(counter.pool, true, 3_000_000 + 1_500);
    assert.equal(counter.stats.connect, slow + 1, '探针为真时行军每秒结算');
    await processBattlefield(counter.pool, true, 3_000_000 + BATTLEFIELD_SLOW_TICK_MS);
    assert.equal(counter.stats.connect, slow + 6, '窗口结束：慢步骤 4 次 + 行军 1 次，加上前一次行军的 1 次');
  });

  test('换季检查：5 秒窗口内不再查库', async () => {
    resetSeasonTickStateForTest();
    const counter = countingPool(pool);
    await processSeasonTick(counter.pool, 4_000_000);
    const first = counter.stats.query;
    assert.ok(first > 0, '首次至少读一次赛季状态');
    await processSeasonTick(counter.pool, 4_000_000 + SEASON_CHECK_MS - 1);
    assert.equal(counter.stats.query, first, '窗口内跳过');
    await processSeasonTick(counter.pool, 4_000_000 + SEASON_CHECK_MS);
    assert.ok(counter.stats.query > first, '窗口结束再查');
  });
});
