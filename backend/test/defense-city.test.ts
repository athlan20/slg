// 城防器械按城打造（v81，AISLG-204）：CRAFT_DEFENSE 带 cityId 时扣该城资源、进该城队列与库存，
// 缺省主城；传别人的 cityId 返回 INVALID_PARAMS；取消打造按条目所属城退款。
// 走 handleMessage 全链路（分发层城池归属校验 → runWithCity → handleCraftDefense）。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑（用一次性的临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleMessage } from '../api/src/handlers';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('城防器械按城打造（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let otherAccountId: string;
  let mainId: string;
  let branchId: string;
  let otherCityId: string;

  const sent: Array<{ op?: number; ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
      sent.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  const conn = { accountId: null as string | null, role: 'player' as InitiatorRole } as unknown as ConnInfo;

  /** 以账号 accountId 身份发起一条协议（经分发层），返回最后一帧响应 */
  async function send(op: number, data: Record<string, unknown>) {
    sent.length = 0;
    await handleMessage(ctx, conn, JSON.stringify({ op, seq: 1, data }));
    return sent[sent.length - 1];
  }

  async function craft(data: Record<string, unknown>) {
    return send(Op.CRAFT_DEFENSE, data);
  }

  /** 读取城池的资源（gold / wood / iron） */
  async function resources(cityId: string) {
    const row = (await pool.query(`SELECT gold, wood, iron FROM cities WHERE id = $1`, [cityId])).rows[0];
    return { gold: Number(row.gold), wood: Number(row.wood), iron: Number(row.iron) };
  }

  async function craftRows(cityId: string) {
    return (await pool.query(`SELECT id, count, status FROM defense_crafts WHERE city_id = $1 ORDER BY started_at`, [cityId])).rows;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'defcity');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;

    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`defcity-test-${Date.now()}`])).rows[0].id as string;
    otherAccountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`defcity-other-${Date.now()}`])).rows[0].id as string;
    (conn as { accountId: string }).accountId = accountId;

    // 主城先建（归属判定取最早创建的城）：城墙 3 级，库存上限 180
    mainId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, '主城', 10000, 10000, 0, 0, 10000, 10, 10) RETURNING id`,
      [accountId],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'wall', 3)`, [mainId]);

    // 分城：城墙 10 级，库存上限 600，资源与主城同额便于对照
    branchId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y, origin_level)
       VALUES ($1, '分城', 10000, 10000, 0, 0, 10000, 500, 500, 2) RETURNING id`,
      [accountId],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'wall', 10)`, [branchId]);

    // 他人的城（归属校验用）
    otherCityId = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, '别人的城', 0, 0, 0, 0, 0, 900, 900) RETURNING id`,
      [otherAccountId],
    )).rows[0].id as string;
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('带分城 cityId 打造：扣分城资源、主城不变，队列与库存上限都按分城', async () => {
    const before = await resources(mainId);
    const res = await craft({ kind: 'trap', count: 10, cityId: branchId });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal((res.data?.craft as { cityId: string }).cityId, branchId);
    assert.equal(res.data?.cap, 600, '库存上限按分城城墙 10 级');
    // trap 单件 金/木/铁 = 20/60/40，10 件
    assert.deepEqual(await resources(branchId), { gold: 9800, wood: 9400, iron: 9600 });
    assert.deepEqual(await resources(mainId), before, '主城资源不变');
    assert.deepEqual(await craftRows(branchId), [{ id: (res.data?.craft as { id: string }).id, count: 10, status: 'crafting' }]);
    assert.deepEqual(await craftRows(mainId), []);
  });

  test('不带 cityId 打造：仍记到主城（向后兼容），上限按主城城墙', async () => {
    const res = await craft({ kind: 'chevaux', count: 2 });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal((res.data?.craft as { cityId: string }).cityId, mainId);
    assert.equal(res.data?.cap, 180, '主城城墙 3 级');
    // chevaux 单件 金/木/铁 = 40/200/80，2 件；主城在造为空，与分城在造互不占队列
    assert.deepEqual(await resources(mainId), { gold: 9920, wood: 9600, iron: 9840 });
    assert.equal((await craftRows(mainId)).length, 1);
    assert.equal((await craftRows(branchId)).length, 1, '分城的在造条目不受影响');
  });

  test('传别人的 cityId 或格式非法的 cityId：INVALID_PARAMS，不扣资源', async () => {
    const mainBefore = await resources(mainId);
    const branchBefore = await resources(branchId);
    assert.equal((await craft({ kind: 'trap', count: 1, cityId: otherCityId })).error?.code, 'INVALID_PARAMS');
    assert.equal((await craft({ kind: 'trap', count: 1, cityId: 'not-a-uuid' })).error?.code, 'INVALID_PARAMS');
    assert.deepEqual(await resources(mainId), mainBefore);
    assert.deepEqual(await resources(branchId), branchBefore);
    assert.equal((await craftRows(otherCityId)).length, 0);
  });

  test('取消分城的打造：资源退回分城，主城不变', async () => {
    const [row] = await craftRows(branchId);
    const mainBefore = await resources(mainId);
    const res = await send(Op.CANCEL_DEFENSE_CRAFT, { craftId: row.id });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal((res.data?.craft as { status: string }).status, 'cancelled');
    assert.deepEqual(await resources(branchId), { gold: 10000, wood: 10000, iron: 10000 }, '全额返还到分城');
    assert.deepEqual(await resources(mainId), mainBefore);
  });
});
