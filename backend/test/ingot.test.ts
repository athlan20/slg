// 元宝（AISLG-251，v108）：spendIngot 的足额 / 不足 / 非法参数 / 并发不扣负；BUY_ITEM 用元宝
// （够 / 不够 / 堆叠上限满 / currency 缺省为礼金 / 非法 currency / 元宝价核对）；consumeItem 先消耗
// 不保留（免费）的那部分；换季保留 paid_count（礼金买的被删）；换季与重置账号都不动元宝；
// GET_STATE / GET_ITEMS 的新字段；迁移幂等与 CHECK 约束。需要真实 PostgreSQL：设置 TEST_DATABASE_URL
// （临时集群，测试在其中新建独立库），否则跳过。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { SEASON_GIFT } from '../common/src/gift';
import { loadGift, spendGift } from '../common/src/gift-db';
import { INSUFFICIENT_INGOT } from '../common/src/ingot';
import { loadIngot, spendIngot } from '../common/src/ingot-db';
import { migrateIngotColumns } from '../common/src/ingot-schema';
import { consumeItem, grantItem, grantPaidItem, loadItems, loadPaidCounts } from '../common/src/items-db';
import { createPendingTopupOrder } from '../common/src/topup-db';
import { settleCheckoutCompleted } from '../common/src/topup-settle';
import { FakeProvider } from '../common/src/payments/fake';
import { topupProduct } from '../common/src/ingot';
import { enterCurrentSeason } from '../common/src/season-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { insertAccountWithCity } from '../api/src/auth';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { runSeasonReset } from '../worker/src/season-reset';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('元宝（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `ingot-${Date.now()}`;

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

  async function newAccount(name: string): Promise<string> {
    return inTx(async (client) => {
      const created = await insertAccountWithCity(client, { username: `${tag}-${name}`, passwordHash: 'x', signupIp: null });
      return created.id;
    });
  }

  /** 测试准备：直接把元宝写进账号（生产上只有充值入账会加） */
  async function setIngot(accountId: string, amount: number): Promise<void> {
    await pool.query(`UPDATE accounts SET ingot = $2 WHERE id = $1`, [accountId, amount]);
  }

  async function spend(accountId: string, amount: number, reason = 'test') {
    return inTx((client) => spendIngot(client, accountId, amount, reason));
  }

  async function eventsOf(accountId: string, type: string): Promise<Array<{ detail: Record<string, unknown> }>> {
    const res = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id`, [accountId, type]);
    return res.rows as Array<{ detail: Record<string, unknown> }>;
  }

  async function give(accountId: string, itemId: 'city_order' | 'city_order_adv', n: number): Promise<number> {
    return inTx((client) => grantItem(client, accountId, itemId, n, 'test'));
  }

  async function givePaid(accountId: string, itemId: 'city_order' | 'city_order_adv', n: number): Promise<number> {
    return inTx((client) => grantPaidItem(client, accountId, itemId, n, 'test'));
  }

  async function callAs(
    accountId: string,
    op: number,
    data?: Record<string, unknown>,
    role: 'player' | 'agent' = 'player',
  ): Promise<ResponseFrame> {
    const sent: ResponseFrame[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = {
      socket,
      ip: null,
      host: null,
      accountId,
      username: null,
      role,
      sessionId: null,
      connectedAt: new Date(),
    };
    registry.add(conn);
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
    await handleMessage(ctx, conn, JSON.stringify({ op, seq: 1, data }));
    const frame = sent.find((f) => f.op === op);
    assert.ok(frame, `op ${op} 没有响应`);
    return frame;
  }

  async function buy(accountId: string, data: Record<string, unknown>): Promise<ResponseFrame> {
    return callAs(accountId, Op.BUY_ITEM, data);
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'ingot');
    pool = new pg.Pool({ connectionString: db.url, max: 12 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  // ---- 列与迁移 ----

  test('迁移幂等：accounts.ingot 与 user_items.paid_count 已建好，重复执行不报错；默认 0、不回填', async () => {
    const client = await pool.connect();
    try {
      await migrateIngotColumns(client);
      await migrateIngotColumns(client);
    } finally {
      client.release();
    }
    const columns = await pool.query(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = current_schema() AND (
         (table_name = 'accounts' AND column_name = 'ingot') OR
         (table_name = 'user_items' AND column_name = 'paid_count'))`,
    );
    assert.equal(columns.rowCount, 2);
    const id = await newAccount('migrate-default');
    assert.equal(await loadIngot(pool, id), 0);
    assert.deepEqual(await loadPaidCounts(pool, id), { city_order: 0, city_order_adv: 0 });
  });

  test('user_items.paid_count 的 CHECK：paid_count 不能超过 count、不能为负', async () => {
    const id = await newAccount('check');
    await give(id, 'city_order', 1);
    await assert.rejects(
      pool.query(`UPDATE user_items SET paid_count = 2 WHERE account_id = $1 AND item_id = 'city_order'`, [id]),
      (err: { code?: string }) => err.code === '23514',
    );
    await assert.rejects(
      pool.query(`UPDATE user_items SET paid_count = -1 WHERE account_id = $1 AND item_id = 'city_order'`, [id]),
      (err: { code?: string }) => err.code === '23514',
    );
  });

  // ---- spendIngot ----

  test('足额扣除：余额减少、写 ingot_spent 事件（detail = { reason, amount, balance }）', async () => {
    const id = await newAccount('spend-ok');
    await setIngot(id, 500);
    const result = await spend(id, 300, 'buy:city_order_adv');
    assert.deepEqual(result, { ok: true, balance: 200 });
    assert.equal(await loadIngot(pool, id), 200);
    assert.deepEqual((await eventsOf(id, 'ingot_spent'))[0].detail, { reason: 'buy:city_order_adv', amount: 300, balance: 200 });
  });

  test('余额不足：返回 INSUFFICIENT_INGOT，余额与事件流都不变', async () => {
    const id = await newAccount('spend-short');
    await setIngot(id, 99);
    const before = await eventsOf(id, 'ingot_spent');
    const result = await spend(id, 100, 'buy:city_order_adv');
    assert.deepEqual(result, { ok: false, code: INSUFFICIENT_INGOT, balance: 99 });
    assert.equal(await loadIngot(pool, id), 99);
    assert.equal((await eventsOf(id, 'ingot_spent')).length, before.length);
  });

  test('非法数量（0 / 负数 / 小数）抛错，不改任何数据', async () => {
    const id = await newAccount('spend-invalid');
    await setIngot(id, 100);
    for (const amount of [0, -1, 1.5]) {
      await assert.rejects(spend(id, amount), /正整数/);
    }
    assert.equal(await loadIngot(pool, id), 100);
  });

  test('并发扣除：10 个请求抢 100 元宝（每次 30），只有 3 次成功，余额不为负', async () => {
    const id = await newAccount('spend-race');
    await setIngot(id, 100);
    const results = await Promise.all(Array.from({ length: 10 }, () => spend(id, 30, 'race')));
    assert.equal(results.filter((r) => r.ok).length, 3);
    assert.equal(results.filter((r) => !r.ok && r.code === INSUFFICIENT_INGOT).length, 7);
    assert.equal(await loadIngot(pool, id), 10);
    assert.equal((await eventsOf(id, 'ingot_spent')).length, 3);
  });

  test('并发：两次元宝扣费 + 一次充值入账，余额不为负、总额守恒', async () => {
    const id = await newAccount('spend-credit-race');
    await setIngot(id, 200);
    const orderId = await inTx(async (client) => {
      const created = await createPendingTopupOrder(client, { accountId: id, product: topupProduct('topup_199')!, provider: 'fake' });
      assert.equal(created.ok, true);
      return (created as { ok: true; orderId: string }).orderId;
    });
    const event = {
      kind: 'checkout_completed',
      eventId: `evt-race-${Date.now()}`,
      requestId: orderId,
      metadataOrderId: null,
      providerProductId: 'topup_199',
      amountPaidCents: 216,
      providerOrderId: null,
    } as const;
    await Promise.all([
      settleCheckoutCompleted(pool, event, new FakeProvider('race-secret')),
      spend(id, 150, 'race'),
      spend(id, 150, 'race'),
    ]);
    const balance = await loadIngot(pool, id);
    const success = (await eventsOf(id, 'ingot_spent')).length;
    assert.ok(balance >= 0, `余额不能为负：${balance}`);
    // 总额守恒：初始 200 + 入账 1000 − 成功扣掉的（每次 150）——与三者的先后无关
    assert.equal(balance, 200 + 1000 - 150 * success);
    assert.ok(success >= 1 && success <= 2);
  });

  // ---- BUY_ITEM 用元宝 ----

  test('BUY_ITEM 用元宝：扣元宝、count 与 paidCount 同时加，写三个事件，返回带新余额', async () => {
    const id = await newAccount('buy-ingot-ok');
    await setIngot(id, 1000);
    const frame = await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 50, currency: 'ingot' });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.deepEqual(frame.data, {
      itemId: 'city_order_adv',
      bought: 1,
      count: 1,
      paidCount: 1,
      currency: 'ingot',
      price: 50,
      cost: 50,
      gift: SEASON_GIFT,
      ingot: 950,
    });
    assert.equal(await loadIngot(pool, id), 950);
    assert.equal(await loadGift(pool, id), SEASON_GIFT, '礼金不动');
    assert.equal((await loadItems(pool, id)).city_order_adv, 1);
    assert.equal((await loadPaidCounts(pool, id)).city_order_adv, 1);
    assert.equal((await eventsOf(id, 'ingot_spent')).length, 1);
    assert.equal((await eventsOf(id, 'item_granted'))[0].detail.paid, true);
    const bought = (await eventsOf(id, 'item_bought'))[0].detail;
    assert.equal(bought.currency, 'ingot');
    assert.equal(bought.paidCount, 1);
    assert.equal(bought.ingot, 950);
  });

  test('元宝不够（49 买 50 的令）：INSUFFICIENT_INGOT，余额与背包都不变', async () => {
    const id = await newAccount('buy-ingot-short');
    await setIngot(id, 49);
    const frame = await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 50, currency: 'ingot' });
    assert.equal(frame.ok, false);
    assert.equal(frame.error?.code, 'INSUFFICIENT_INGOT');
    assert.deepEqual(frame.data, { balance: 49, cost: 50, currency: 'ingot' });
    assert.equal(await loadIngot(pool, id), 49);
    assert.equal((await loadItems(pool, id)).city_order_adv, 0);
    assert.equal((await eventsOf(id, 'item_bought')).length, 0);
  });

  test('元宝够但礼金不够：选礼金返回 INSUFFICIENT_GIFT，选元宝成功', async () => {
    const id = await newAccount('buy-currency-choice');
    await setIngot(id, 100);
    await inTx((client) => spendGift(client, id, SEASON_GIFT, 'drain'));
    const giftBuy = await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 50, currency: 'gift' });
    assert.equal(giftBuy.error?.code, 'INSUFFICIENT_GIFT');
    assert.equal(await loadIngot(pool, id), 100, '礼金不够时不扣元宝（不自动混用）');
    const ingotBuy = await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 50, currency: 'ingot' });
    assert.equal(ingotBuy.ok, true, JSON.stringify(ingotBuy));
    assert.equal(await loadIngot(pool, id), 50);
  });

  test('不传 currency 时按礼金支付（旧客户端行为不变）', async () => {
    const id = await newAccount('buy-default-gift');
    await setIngot(id, 1000);
    const frame = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 30 });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.equal((frame.data as { currency: string }).currency, 'gift');
    assert.equal(await loadGift(pool, id), SEASON_GIFT - 30);
    assert.equal(await loadIngot(pool, id), 1000, '元宝不动');
    assert.equal((await loadPaidCounts(pool, id)).city_order, 0, '礼金买的不算换季保留');
  });

  test('非法 currency（如 topup）返回 INVALID_PARAMS，什么都不改', async () => {
    const id = await newAccount('buy-currency-invalid');
    await setIngot(id, 1000);
    const frame = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 30, currency: 'gold' });
    assert.equal(frame.error?.code, 'INVALID_PARAMS');
    assert.equal(await loadIngot(pool, id), 1000);
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
  });

  test('元宝价核对：expectedPrice 传礼金的自报价也按所选货币核对（ITEM_PRICE_CHANGED 附 currency）', async () => {
    const id = await newAccount('buy-price-ingot');
    await setIngot(id, 1000);
    const frame = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 999, currency: 'ingot' });
    assert.equal(frame.error?.code, 'ITEM_PRICE_CHANGED');
    assert.deepEqual(frame.data, { price: 30, currency: 'ingot' });
    assert.equal(await loadIngot(pool, id), 1000);
  });

  test('count 已是 99（堆叠满）时用元宝再买：ITEM_STACK_FULL，不扣元宝', async () => {
    const id = await newAccount('buy-ingot-stack');
    await setIngot(id, 1000);
    await givePaid(id, 'city_order', 99);
    const frame = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 30, currency: 'ingot' });
    assert.equal(frame.error?.code, 'ITEM_STACK_FULL');
    assert.equal(await loadIngot(pool, id), 1000);
    assert.equal((await loadItems(pool, id)).city_order, 99);
  });

  // ---- consumeItem 的消耗顺序 ----

  test('consumeItem 先消耗免费的部分：count=8 / paid=3，用 5 张后 3/3，再用 1 张后 2/2', async () => {
    const id = await newAccount('consume-order');
    await give(id, 'city_order', 5);
    await givePaid(id, 'city_order', 3);
    assert.deepEqual({ count: (await loadItems(pool, id)).city_order, paid: (await loadPaidCounts(pool, id)).city_order }, {
      count: 8,
      paid: 3,
    });
    const first = await inTx((client) => consumeItem(client, id, 'city_order', 5, 'move_city'));
    assert.deepEqual(first, { ok: true, count: 3, paidCount: 3 });
    const second = await inTx((client) => consumeItem(client, id, 'city_order', 1, 'move_city'));
    assert.deepEqual(second, { ok: true, count: 2, paidCount: 2 });
    assert.equal((await eventsOf(id, 'item_used'))[1].detail.paidLeft, 2);
  });

  test('consumeItem 数量不足时 paidCount 也不变（都不改）', async () => {
    const id = await newAccount('consume-short-paid');
    await givePaid(id, 'city_order_adv', 2);
    const result = await inTx((client) => consumeItem(client, id, 'city_order_adv', 3, 'move_city'));
    assert.equal(result.ok, false);
    assert.deepEqual(await loadPaidCounts(pool, id), { city_order: 0, city_order_adv: 2 });
  });

  // ---- 换季与重置 ----

  test('换季保留 paid_count：count=8 / paid=3 换季后 3/3；paid=0 的行被删除；礼金回 1000、元宝不变', async () => {
    const id = await newAccount('season-keep');
    await enterCurrentSeason(pool, id);
    await setIngot(id, 700);
    await give(id, 'city_order', 5);
    await givePaid(id, 'city_order', 3);
    await give(id, 'city_order_adv', 2);
    await givePaid(id, 'city_order_adv', 1);
    await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
    const outcome = await runSeasonReset(pool);
    assert.equal(outcome.status, 'reset');
    const counts = await loadItems(pool, id);
    assert.deepEqual(counts, { city_order: 3, city_order_adv: 1 });
    assert.deepEqual(await loadPaidCounts(pool, id), { city_order: 3, city_order_adv: 1 });
    assert.equal(await loadGift(pool, id), 0, '换季后礼金由赛季进入逻辑重新发放（此处账号尚未进入新赛季）');
    assert.equal(await loadIngot(pool, id), 700, '元宝换季不清零');
    const joined = await enterCurrentSeason(pool, id);
    assert.equal(joined.joined, true);
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
    assert.equal(await loadIngot(pool, id), 700);
  });

  test('paid_count = 0 的道具行在换季后被删除（没有残留行）', async () => {
    const id = await newAccount('season-free-only');
    await give(id, 'city_order', 4);
    await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
    await runSeasonReset(pool);
    const rows = await pool.query(`SELECT 1 FROM user_items WHERE account_id = $1`, [id]);
    assert.equal(rows.rowCount, 0);
  });

  test('玩家自己重置账号：元宝不动（与礼金同口径：重置只清游戏态）', async () => {
    const id = await newAccount('reset-account');
    await setIngot(id, 500);
    await givePaid(id, 'city_order_adv', 2);
    const frame = await callAs(id, Op.RESET_ACCOUNT, { confirm: true });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.equal(await loadIngot(pool, id), 500, '重置账号不动元宝');
    // 背包与礼金都不受重置影响（与 v89/v90 的行为一致：重置只清城池 / 队列 / 行军等游戏态）
    assert.equal((await loadItems(pool, id)).city_order_adv, 2);
    assert.equal(await loadGift(pool, id), SEASON_GIFT);
  });

  // ---- GET_STATE / GET_ITEMS ----

  test('GET_STATE 与 GET_ITEMS 带出 ingot、paidCounts 与 catalog 的 ingotPrice', async () => {
    const id = await newAccount('get-state');
    await setIngot(id, 300);
    await givePaid(id, 'city_order', 2);
    const state = await callAs(id, Op.GET_STATE);
    assert.equal(state.ok, true, JSON.stringify(state));
    const data = state.data as { ingot: number; paidCounts: Record<string, number>; items: Record<string, number> };
    assert.equal(data.ingot, 300);
    assert.deepEqual(data.paidCounts, { city_order: 2, city_order_adv: 0 });
    assert.deepEqual(data.items, { city_order: 2, city_order_adv: 0 });
    const items = await callAs(id, Op.GET_ITEMS);
    const itemsData = items.data as {
      ingot: number;
      paidCounts: Record<string, number>;
      catalog: Array<{ id: string; shopPrice: number | null; ingotPrice: number | null }>;
    };
    assert.equal(itemsData.ingot, 300);
    assert.deepEqual(itemsData.paidCounts, data.paidCounts);
    assert.deepEqual(
      itemsData.catalog.map((def) => [def.id, def.shopPrice, def.ingotPrice]),
      [
        ['city_order', 30, 30],
        ['city_order_adv', 50, 50],
      ],
    );
  });

  test('Agent 连接也能看到 ingot，并可用 currency=ingot 买道具', async () => {
    const id = await newAccount('agent-buy-ingot');
    await setIngot(id, 200);
    const state = await callAs(id, Op.GET_STATE, undefined, 'agent');
    assert.equal((state.data as { ingot: number }).ingot, 200);
    const frame = await callAs(id, Op.BUY_ITEM, { itemId: 'city_order', count: 1, expectedPrice: 30, currency: 'ingot' }, 'agent');
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.equal(await loadIngot(pool, id), 170);
  });

  // ---- 迁城令降价（AISLG-254）----

  test('迁城令调价：目录 30 / 30 / 50 / 50，礼金买扣 30、元宝买扣 50；旧价（50 / 100）作 expectedPrice 返回 ITEM_PRICE_CHANGED 且不扣不加', async () => {
    const id = await newAccount('price-cut');
    await setIngot(id, 100);

    // 一、GET_ITEMS 目录：迁城令 30 / 30，高级迁城令 50 / 50
    const items = await callAs(id, Op.GET_ITEMS);
    assert.equal(items.ok, true, JSON.stringify(items));
    const catalog = (items.data as { catalog: Array<{ id: string; shopPrice: number | null; ingotPrice: number | null }> }).catalog;
    assert.deepEqual(
      catalog.map((def) => [def.id, def.shopPrice, def.ingotPrice]),
      [
        ['city_order', 30, 30],
        ['city_order_adv', 50, 50],
      ],
    );

    // 二、客户端还拿着调价前的旧价（50 / 100）：ITEM_PRICE_CHANGED，礼金 / 元宝 / 背包都不变
    const staleGift = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 50 });
    assert.equal(staleGift.error?.code, 'ITEM_PRICE_CHANGED');
    assert.deepEqual(staleGift.data, { price: 30, currency: 'gift' }, '返回当前礼金单价');
    const staleIngot = await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 100, currency: 'ingot' });
    assert.equal(staleIngot.error?.code, 'ITEM_PRICE_CHANGED');
    assert.deepEqual(staleIngot.data, { price: 50, currency: 'ingot' }, '返回当前元宝单价');
    assert.equal(await loadGift(pool, id), SEASON_GIFT, '礼金不变');
    assert.equal(await loadIngot(pool, id), 100, '元宝不变');
    assert.deepEqual(await loadItems(pool, id), { city_order: 0, city_order_adv: 0 }, '不加道具');

    // 三、礼金买一张迁城令扣 30
    const byGift = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 30 });
    assert.equal(byGift.ok, true, JSON.stringify(byGift));
    assert.deepEqual(
      { currency: (byGift.data as { currency: string }).currency, cost: (byGift.data as { cost: number }).cost, gift: (byGift.data as { gift: number }).gift },
      { currency: 'gift', cost: 30, gift: SEASON_GIFT - 30 },
    );
    assert.equal(await loadGift(pool, id), SEASON_GIFT - 30);

    // 四、元宝买一张高级迁城令扣 50
    const byIngot = await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 50, currency: 'ingot' });
    assert.equal(byIngot.ok, true, JSON.stringify(byIngot));
    assert.deepEqual(
      { currency: (byIngot.data as { currency: string }).currency, cost: (byIngot.data as { cost: number }).cost, ingot: (byIngot.data as { ingot: number }).ingot },
      { currency: 'ingot', cost: 50, ingot: 50 },
    );
    assert.equal(await loadIngot(pool, id), 50);
    assert.equal(await loadGift(pool, id), SEASON_GIFT - 30, '元宝付款不动礼金');
    assert.deepEqual(await loadItems(pool, id), { city_order: 1, city_order_adv: 1 });
  });
});