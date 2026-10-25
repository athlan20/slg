// 进行中的取消（v71，AISLG-190）：建造中 / 征募中条目取消后全额返还、等级不变、排队的下一条立即开工；
// 连升进行中只退未完成的级；历练取消不给经验；与到点结算并发时先生效者为准；主动免战提前解除与被动免战的拦截。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（指向一次性临时集群，会在其上新建临时库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { upgradeChainCost, upgradeCost } from '../common/src/rules';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole, type Resources } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleCancelBuild } from '../api/src/handlers-city';
import { handleCancelRecruit } from '../api/src/handlers-army';
import { handleCancelTraining } from '../api/src/handlers-hero-growth';
import { handleCancelTruce } from '../api/src/handlers-pvp';
import { processDueRecruits } from '../worker/src/queue-tick';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const RES_KEYS = ['gold', 'wood', 'food', 'stone', 'iron'] as const;

describe('进行中的取消（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
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

  /** 以本账号发起一次协议调用，返回最后一帧响应 */
  async function call(run: () => Promise<void>) {
    sent.length = 0;
    await run();
    return sent[sent.length - 1];
  }

  async function newCity(name: string, gold = 0): Promise<string> {
    seq += 1;
    const res = await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, $2, $3, 0, 0, 0, 0, $4, $5) RETURNING id`,
      [accountId, name, gold, 300 + seq, 300 + seq],
    );
    return res.rows[0].id as string;
  }

  async function resources(cityId: string): Promise<Resources> {
    const res = await pool.query(`SELECT gold, wood, food, stone, iron FROM cities WHERE id = $1`, [cityId]);
    const row = res.rows[0];
    return { gold: Number(row.gold), wood: Number(row.wood), food: Number(row.food), stone: Number(row.stone), iron: Number(row.iron) };
  }

  /** 插入一条建造条目；cost 为发起时的成本快照 */
  async function insertBuild(cityId: string, kind: string, status: string, level: number, toLevel: number | null, cost: Resources, dueSecs: number | null): Promise<string> {
    const res = await pool.query(
      `INSERT INTO builds (account_id, city_id, kind, status, level, to_level, initiator, cost, due_at, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'player', $7::jsonb, CASE WHEN $8::int IS NULL THEN NULL ELSE now() + make_interval(secs => $8::int) END, now() - interval '1 minute')
       RETURNING id`,
      [accountId, cityId, kind, status, level, toLevel, JSON.stringify(cost), dueSecs],
    );
    return res.rows[0].id as string;
  }

  async function insertRecruit(cityId: string, status: string, cost: Resources, population: number, dueSecs: number | null, count = 10): Promise<string> {
    const res = await pool.query(
      `INSERT INTO recruits (account_id, city_id, troop, count, status, initiator, cost, population, unit_seconds, started_at, due_at)
       VALUES ($1, $2, 'militia', $3, $4, 'player', $5::jsonb, $6, 5, now() - interval '1 minute',
               CASE WHEN $7::int IS NULL THEN NULL ELSE now() + make_interval(secs => $7::int) END)
       RETURNING id`,
      [accountId, cityId, count, status, JSON.stringify(cost), population, dueSecs],
    );
    return res.rows[0].id as string;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'cancel');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;
    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`cancel-test-${Date.now()}`])).rows[0].id as string;
    (conn as { accountId: string }).accountId = accountId;
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('建造中取消：成本全额返还、建筑等级不变，排队的下一条立即开工', async () => {
    const cityId = await newCity('建造中', 0);
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'barracks', 1)`, [cityId]);
    const cost = upgradeCost('barracks', 1);
    const buildId = await insertBuild(cityId, 'barracks', 'building', 2, null, cost, 3600);
    const queuedId = await insertBuild(cityId, 'farm', 'queued', 1, null, { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 }, null);
    const before = await resources(cityId);

    const res = await call(() => handleCancelBuild(ctx, conn, Op.CANCEL_BUILD, 1, buildId));
    assert.equal(res.ok, true);
    assert.equal((res.data?.build as { status: string }).status, 'cancelled');
    const after = await resources(cityId);
    for (const key of RES_KEYS) {
      assert.equal(after[key], before[key] + cost[key], key);
    }
    const level = await pool.query(`SELECT level FROM city_buildings WHERE city_id = $1 AND kind = 'barracks'`, [cityId]);
    assert.equal(Number(level.rows[0].level), 1, '建筑等级不变');
    const next = await pool.query(`SELECT status, due_at FROM builds WHERE id = $1`, [queuedId]);
    assert.equal(next.rows[0].status, 'building');
    assert.ok(next.rows[0].due_at, '排队的下一条获得到期时刻');
  });

  test('连升进行中取消：只退未完成的级，已完成的级保留等级', async () => {
    const cityId = await newCity('连升中');
    // 整链 3 → 6 发起时一次预扣；当前推进中的是 5 级（4 级已完成，等级已到 4）
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'barracks', 4)`, [cityId]);
    const chainCost = upgradeChainCost('barracks', 3, 6);
    const buildId = await insertBuild(cityId, 'barracks', 'building', 5, 6, chainCost, 600);
    const before = await resources(cityId);

    const res = await call(() => handleCancelBuild(ctx, conn, Op.CANCEL_BUILD, 1, buildId));
    assert.equal(res.ok, true);
    const refund = upgradeChainCost('barracks', 4, 6);
    const after = await resources(cityId);
    for (const key of RES_KEYS) {
      assert.equal(after[key], before[key] + refund[key], key);
    }
    const level = await pool.query(`SELECT level FROM city_buildings WHERE city_id = $1 AND kind = 'barracks'`, [cityId]);
    assert.equal(Number(level.rows[0].level), 4);
  });

  test('已完成的建造条目取消返回 BUILD_NOT_CANCELLABLE', async () => {
    const cityId = await newCity('已完成');
    const buildId = await insertBuild(cityId, 'farm', 'completed', 1, null, { gold: 1, wood: 1, food: 1, stone: 1, iron: 1 }, null);
    const res = await call(() => handleCancelBuild(ctx, conn, Op.CANCEL_BUILD, 1, buildId));
    assert.equal(res.error?.code, 'BUILD_NOT_CANCELLABLE');
  });

  test('征募中取消：资源与人口全额返还，排队的下一条立即开始征募', async () => {
    const cityId = await newCity('征募中', 0);
    await pool.query(`UPDATE cities SET population = 40 WHERE id = $1`, [cityId]);
    const cost = { gold: 100, wood: 50, food: 20, stone: 0, iron: 0 };
    const recruitId = await insertRecruit(cityId, 'recruiting', cost, 10, 3600);
    const queuedId = await insertRecruit(cityId, 'queued', { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 }, 0, null);
    const before = await resources(cityId);

    const res = await call(() => handleCancelRecruit(ctx, conn, Op.CANCEL_RECRUIT, 1, recruitId));
    assert.equal(res.ok, true);
    assert.equal((res.data?.recruit as { status: string }).status, 'cancelled');
    const after = await resources(cityId);
    for (const key of RES_KEYS) {
      assert.equal(after[key], before[key] + cost[key], key);
    }
    const pop = await pool.query(`SELECT population FROM cities WHERE id = $1`, [cityId]);
    assert.equal(Number(pop.rows[0].population), 50, '人口全额回到城池');
    const next = await pool.query(`SELECT status, due_at FROM recruits WHERE id = $1`, [queuedId]);
    assert.equal(next.rows[0].status, 'recruiting');
    assert.ok(next.rows[0].due_at);
  });

  test('征募到点与取消并发：先完成则取消返回 RECRUIT_NOT_CANCELLABLE（兵只入一次）', async () => {
    const cityId = await newCity('到点先');
    const recruitId = await insertRecruit(cityId, 'recruiting', { gold: 1, wood: 0, food: 0, stone: 0, iron: 0 }, 0, -1, 7);
    await processDueRecruits(pool);
    const res = await call(() => handleCancelRecruit(ctx, conn, Op.CANCEL_RECRUIT, 1, recruitId));
    assert.equal(res.error?.code, 'RECRUIT_NOT_CANCELLABLE');
    const army = await pool.query(`SELECT count FROM city_army WHERE city_id = $1 AND troop = 'militia'`, [cityId]);
    assert.equal(Number(army.rows[0].count), 7);
  });

  test('征募取消先生效：到点结算不再入兵', async () => {
    const cityId = await newCity('取消先');
    const recruitId = await insertRecruit(cityId, 'recruiting', { gold: 1, wood: 0, food: 0, stone: 0, iron: 0 }, 0, -1, 7);
    const res = await call(() => handleCancelRecruit(ctx, conn, Op.CANCEL_RECRUIT, 1, recruitId));
    assert.equal(res.ok, true);
    await processDueRecruits(pool);
    const army = await pool.query(`SELECT count FROM city_army WHERE city_id = $1 AND troop = 'militia'`, [cityId]);
    assert.equal(army.rowCount, 0);
  });

  test('历练取消：武将立刻回家，不给经验；已到点或未在历练返回 TRAINING_NOT_CANCELLABLE', async () => {
    const hero = await pool.query(
      `INSERT INTO account_heroes (account_id, name, level, exp, lead, force, wit, train_until, train_tier, train_exp)
       VALUES ($1, '甲', 3, 50, 80, 90, 60, now() + interval '1 hour', 2, 500) RETURNING id`,
      [accountId],
    );
    const heroId = hero.rows[0].id as string;
    const res = await call(() => handleCancelTraining(ctx, conn, Op.CANCEL_TRAINING, 1, { heroId }));
    assert.equal(res.ok, true);
    const row = (await pool.query(`SELECT level, exp, train_until, train_tier, train_exp FROM account_heroes WHERE id = $1`, [heroId])).rows[0];
    assert.equal(row.train_until, null);
    assert.equal(row.train_tier, null);
    assert.equal(row.train_exp, null);
    assert.equal(Number(row.exp), 50, '不给经验');
    assert.equal(Number(row.level), 3);

    const again = await call(() => handleCancelTraining(ctx, conn, Op.CANCEL_TRAINING, 2, { heroId }));
    assert.equal(again.error?.code, 'TRAINING_NOT_CANCELLABLE');

    const dueHero = await pool.query(
      `INSERT INTO account_heroes (account_id, name, level, exp, lead, force, wit, train_until, train_tier, train_exp)
       VALUES ($1, '乙', 3, 0, 80, 90, 60, now() - interval '1 second', 1, 200) RETURNING id`,
      [accountId],
    );
    const dueRes = await call(() => handleCancelTraining(ctx, conn, Op.CANCEL_TRAINING, 3, { heroId: dueHero.rows[0].id }));
    assert.equal(dueRes.error?.code, 'TRAINING_NOT_CANCELLABLE');
    const dueRow = (await pool.query(`SELECT train_until, train_exp FROM account_heroes WHERE id = $1`, [dueHero.rows[0].id])).rows[0];
    assert.ok(dueRow.train_until, '到点未结算的历练不被取消，交给 Worker 结算');
  });

  test('主动免战提前解除：立即清开启截止、本周次数不返还；无主动免战时区分被动免战与未开启', async () => {
    await pool.query(
      `UPDATE accounts SET self_truce_until = now() + interval '12 hours', self_truce_used_at = now() - interval '1 day' WHERE id = $1`,
      [accountId],
    );
    const usedBefore = (await pool.query(`SELECT self_truce_used_at FROM accounts WHERE id = $1`, [accountId])).rows[0].self_truce_used_at;
    const res = await call(() => handleCancelTruce(ctx, conn, Op.CANCEL_TRUCE, 1));
    assert.equal(res.ok, true);
    assert.equal(res.data?.shieldUntil, null);
    const row = (await pool.query(`SELECT self_truce_until, self_truce_used_at FROM accounts WHERE id = $1`, [accountId])).rows[0];
    assert.equal(row.self_truce_until, null);
    assert.equal(row.self_truce_used_at.getTime(), usedBefore.getTime(), '本周次数不返还');

    const again = await call(() => handleCancelTruce(ctx, conn, Op.CANCEL_TRUCE, 2));
    assert.equal(again.error?.code, 'TRUCE_NOT_ACTIVE');

    const cityId = await newCity('被动免战');
    await pool.query(`UPDATE cities SET truce_until = now() + interval '1 hour' WHERE id = $1`, [cityId]);
    const passive = await call(() => handleCancelTruce(ctx, conn, Op.CANCEL_TRUCE, 3));
    assert.equal(passive.error?.code, 'PASSIVE_TRUCE_NOT_CANCELLABLE');
    await pool.query(`UPDATE cities SET truce_until = NULL WHERE id = $1`, [cityId]);
  });
});
