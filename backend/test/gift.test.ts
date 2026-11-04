// 礼金（AISLG-221，v89）：spendGift 的足额 / 不足 / 非法参数 / 并发不扣负；赛季发放（新号、惰性加入、同季不回弹）；
// 重置账号不动礼金；GET_STATE 带出余额；v89 迁移幂等；换季清零。需要真实 PostgreSQL：设置 TEST_DATABASE_URL
// （临时集群，测试在其中新建独立库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { SEASON_GIFT, INSUFFICIENT_GIFT } from '../common/src/gift';
import { loadGift, spendGift } from '../common/src/gift-db';
import { migrateGiftColumn } from '../common/src/gift-schema';
import { enterCurrentSeason } from '../common/src/season-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { insertAccountWithCity } from '../api/src/auth';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { runSeasonReset } from '../worker/src/season-reset';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('礼金（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `gift-${Date.now()}`;

  /** 在事务里调用 spendGift（与施计 / 迁城一样由调用方开事务） */
  async function spend(accountId: string, amount: number, reason = 'test') {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await spendGift(client, accountId, amount, reason);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function newAccount(name: string): Promise<string> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await insertAccountWithCity(client, { username: `${tag}-${name}`, passwordHash: 'x', signupIp: null });
      await client.query('COMMIT');
      return created.id;
    } finally {
      client.release();
    }
  }

  /** 造一个“上一赛季”的老账号（season_id 指向不存在的旧赛季，礼金为 0） */
  async function oldAccount(name: string): Promise<string> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash, season_id, gift) VALUES ($1, 'x', -7, 0) RETURNING id`,
      [`${tag}-${name}`],
    );
    return res.rows[0].id as string;
  }

  async function giftSpentEvents(accountId: string): Promise<Array<{ detail: Record<string, unknown> }>> {
    const res = await pool.query(
      `SELECT detail FROM events WHERE account_id = $1 AND type = 'gift_spent' ORDER BY id`,
      [accountId],
    );
    return res.rows as Array<{ detail: Record<string, unknown> }>;
  }

  /** 以玩家连接身份走 handleMessage，收集该 op 的响应帧 */
  async function callAs(accountId: string, op: number, data?: Record<string, unknown>): Promise<ResponseFrame> {
    const sent: ResponseFrame[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = { socket, ip: null, host: null, accountId, username: null, role: 'player', sessionId: null, connectedAt: new Date() };
    registry.add(conn);
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
    await handleMessage(ctx, conn, JSON.stringify({ op, seq: 1, data }));
    const frame = sent.find((f) => f.op === op);
    assert.ok(frame, `op ${op} 没有响应`);
    return frame;
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'gift');
    pool = new pg.Pool({ connectionString: db.url, max: 12 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('足额扣除：余额减少、写 gift_spent 事件（detail = { reason, amount, balance }）', async () => {
    const id = await newAccount('spend-ok');
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
    const result = await spend(id, 300, 'relocate');
    assert.deepEqual(result, { ok: true, balance: 700 });
    assert.equal(await loadGift(pool, id), 700);
    const events = await giftSpentEvents(id);
    assert.equal(events.length, 1);
    assert.deepEqual(events[0].detail, { reason: 'relocate', amount: 300, balance: 700 });
  });

  test('余额不足：返回 INSUFFICIENT_GIFT，余额与事件流都不变', async () => {
    const id = await newAccount('spend-short');
    await spend(id, 600);
    const before = await loadGift(pool, id);
    const cities = (await pool.query(`SELECT count(*)::int AS n FROM cities WHERE account_id = $1`, [id])).rows[0].n;
    const result = await spend(id, 500, 'relocate');
    assert.deepEqual(result, { ok: false, code: INSUFFICIENT_GIFT, balance: before });
    assert.equal(await loadGift(pool, id), before, '余额不变');
    assert.equal((await giftSpentEvents(id)).length, 1, '不写第二条事件');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM cities WHERE account_id = $1`, [id])).rows[0].n, cities);
  });

  test('恰好扣到 0 允许，再扣 1 返回不足', async () => {
    const id = await newAccount('spend-exact');
    assert.equal((await spend(id, SEASON_GIFT)).ok, true);
    assert.equal(await loadGift(pool, id), 0);
    const short = await spend(id, 1);
    assert.equal(short.ok, false);
    assert.equal(await loadGift(pool, id), 0);
  });

  test('非法数量（0 / 负数 / 小数）抛错，不改数据', async () => {
    const id = await newAccount('spend-invalid');
    for (const amount of [0, -5, 1.5]) {
      await assert.rejects(() => spend(id, amount), /正整数/);
    }
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
  });

  test('并发扣同一笔余额：总扣额不超过余额，余额不为负（1000 余额 × 10 个 300 请求 → 恰好 3 个成功）', async () => {
    const id = await newAccount('spend-race');
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => spend(id, 300, `race-${i}`)));
    const ok = results.filter((r) => r.ok).length;
    assert.equal(ok, 3);
    assert.equal(results.filter((r) => !r.ok && r.code === INSUFFICIENT_GIFT).length, 7);
    const balance = await loadGift(pool, id);
    assert.equal(balance, SEASON_GIFT - 300 * ok);
    assert.ok(balance >= 0);
    assert.equal((await giftSpentEvents(id)).length, ok);
  });

  test('新号归入当前赛季时礼金为 1000', async () => {
    const id = await newAccount('signup');
    const row = (await pool.query(`SELECT gift, season_id FROM accounts WHERE id = $1`, [id])).rows[0];
    assert.equal(Number(row.gift), SEASON_GIFT);
    assert.notEqual(row.season_id, null);
  });

  test('无进行中赛季时注册礼金为 0，登录惰性加入后补到 1000', async () => {
    await pool.query(`UPDATE seasons SET status = 'ended' WHERE status = 'active'`);
    let id: string;
    try {
      id = await newAccount('no-season');
    } finally {
      await pool.query(`UPDATE seasons SET status = 'active' WHERE id = (SELECT max(id) FROM seasons)`);
    }
    assert.equal(await loadGift(pool, id), 0);
    const joined = await enterCurrentSeason(pool, id);
    assert.equal(joined.joined, true);
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
  });

  test('老号进入新赛季：惰性加入置为 1000；同赛季再次登录不回弹（用掉 300 后仍是 700）', async () => {
    const id = await oldAccount('lazy');
    const first = await enterCurrentSeason(pool, id);
    assert.equal(first.joined, true);
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
    await spend(id, 300);
    const again = await enterCurrentSeason(pool, id);
    assert.equal(again.joined, false);
    assert.equal(await loadGift(pool, id), 700, '不回弹');
  });

  test('重置账号（RESET_ACCOUNT）不补发、不清零礼金', async () => {
    const id = await newAccount('reset-keep');
    await spend(id, 300);
    const frame = await callAs(id, Op.RESET_ACCOUNT, { confirm: true });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.equal(await loadGift(pool, id), 700);
  });

  test('GET_STATE 带出账号级 gift（余额）与 giftSeasonGrant（= 1000）', async () => {
    const id = await newAccount('get-state');
    await spend(id, 250);
    const frame = await callAs(id, Op.GET_STATE, undefined);
    assert.equal(frame.ok, true, JSON.stringify(frame));
    const data = frame.data as { gift: number; giftSeasonGrant: number };
    assert.equal(data.gift, 750);
    assert.equal(data.giftSeasonGrant, SEASON_GIFT);
  });

  test('v89 迁移幂等：列不存在时建列并只给当前赛季账号补发一次，重复执行不再补', async () => {
    const withSeason = await newAccount('mig-season');
    await pool.query(`UPDATE accounts SET season_id = NULL WHERE id = $1`, [withSeason]);
    const active = (await pool.query(`SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`)).rows[0].id as number;
    await pool.query(`UPDATE accounts SET season_id = $2 WHERE id = $1`, [withSeason, active]);
    await pool.query(`ALTER TABLE accounts DROP COLUMN gift`);
    const migrate = async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await migrateGiftColumn(client);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    };
    await migrate();
    assert.equal(await loadGift(pool, withSeason), SEASON_GIFT, '存量在赛季的账号补发 1000');
    await spend(withSeason, 400);
    await migrate();
    assert.equal(await loadGift(pool, withSeason), 600, '重复迁移不再补发');
  });

  test('换季清零：重置后所有账号礼金为 0，第一次登录新赛季回到 1000', async () => {
    const id = await newAccount('season-reset');
    await spend(id, 200);
    await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
    const outcome = await runSeasonReset(pool);
    assert.equal(outcome.status, 'reset');
    const left = (await pool.query(`SELECT count(*)::int AS n FROM accounts WHERE gift <> 0`)).rows[0].n;
    assert.equal(left, 0, '换季后没有任何账号残留礼金');
    assert.equal(await loadGift(pool, id), 0);
    const joined = await enterCurrentSeason(pool, id);
    assert.equal(joined.joined, true);
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
  });
});
