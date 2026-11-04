// 道具（AISLG-222，v90）：配置表（纯规则，无需数据库）；grantItem / consumeItem 的堆叠上限、足额与不足、并发不扣负；
// BUY_ITEM 的校验顺序与失败不扣礼金不加道具、改价、推送；GET_ITEMS 与 GET_STATE 一致；换季清空。
// DB 部分需要真实 PostgreSQL：设置 TEST_DATABASE_URL（临时集群，测试在其中新建独立库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { ITEM_DEFS, INSUFFICIENT_ITEM, isItemId, itemDef, emptyItems, shopItemDefs } from '../common/src/items';
import { consumeItem, grantItem, loadItems } from '../common/src/items-db';
import { loadGift, spendGift } from '../common/src/gift-db';
import { SEASON_GIFT } from '../common/src/gift';
import { enterCurrentSeason } from '../common/src/season-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { insertAccountWithCity } from '../api/src/auth';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { runSeasonReset } from '../worker/src/season-reset';

import { createTempDatabase, type TempDatabase } from './season-test-db';

// ---- 纯规则（不需要数据库）----

test('道具配置：首批两种，价格与堆叠上限按需求单（50 / 100，上限 99）', () => {
  assert.deepEqual(
    ITEM_DEFS.map((def) => [def.id, def.name, def.shopPrice, def.stackMax]),
    [
      ['city_order', '迁城令', 50, 99],
      ['city_order_adv', '高级迁城令', 100, 99],
    ],
  );
  assert.equal(shopItemDefs().length, 2);
});

test('未知 itemId 不是道具：isItemId / itemDef 都拒绝', () => {
  assert.equal(isItemId('no_such_item'), false);
  assert.equal(isItemId(42), false);
  assert.equal(itemDef('no_such_item'), null);
  assert.equal(itemDef(undefined), null);
  assert.ok(itemDef('city_order'));
});

test('emptyItems 每种已定义道具都有键，缺省 0', () => {
  assert.deepEqual(emptyItems(), { city_order: 0, city_order_adv: 0 });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('道具（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `items-${Date.now()}`;
  const originalPrices = new Map(ITEM_DEFS.map((def) => [def.id, def.shopPrice]));

  function setPrice(id: 'city_order' | 'city_order_adv', price: number | null): void {
    const def = itemDef(id);
    assert.ok(def);
    def.shopPrice = price;
  }

  /** 在事务里执行一段（与计谋 / 迁城一样由调用方开事务） */
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

  async function eventsOf(accountId: string, type: string): Promise<Array<{ detail: Record<string, unknown> }>> {
    const res = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id`, [accountId, type]);
    return res.rows as Array<{ detail: Record<string, unknown> }>;
  }

  async function countEvents(accountId: string): Promise<number> {
    return (await pool.query(`SELECT count(*)::int AS n FROM events WHERE account_id = $1`, [accountId])).rows[0].n as number;
  }

  /** 直接发放（测试准备数据） */
  async function give(accountId: string, itemId: 'city_order' | 'city_order_adv', n: number): Promise<number> {
    return inTx((client) => grantItem(client, accountId, itemId, n, 'test'));
  }

  /** 以玩家连接身份走 handleMessage，收集该 op 的响应帧（每次新建连接与注册表） */
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

  async function buy(accountId: string, data: Record<string, unknown>): Promise<ResponseFrame> {
    return callAs(accountId, Op.BUY_ITEM, data);
  }

  async function giftOf(accountId: string): Promise<number> {
    return loadGift(pool, accountId);
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'items');
    pool = new pg.Pool({ connectionString: db.url, max: 12 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    for (const [id, price] of originalPrices) {
      setPrice(id, price);
    }
    await pool?.end();
    await db?.drop();
  });

  // ---- grantItem / consumeItem ----

  test('grantItem 堆叠到上限：超出部分作废，返回实际增加数，事件写 requested / granted', async () => {
    const id = await newAccount('grant-stack');
    assert.equal(await give(id, 'city_order', 90), 90);
    assert.equal(await give(id, 'city_order', 20), 9, '只加到 99，超出 11 张中的 11 张作废（这里 90+20 只能加 9）');
    assert.equal((await loadItems(pool, id)).city_order, 99);
    const events = await eventsOf(id, 'item_granted');
    assert.equal(events.length, 2);
    assert.deepEqual(events[1].detail, { itemId: 'city_order', requested: 20, granted: 9, reason: 'test' });
  });

  test('grantItem 已满时返回 0，仍写一条事件（granted = 0）', async () => {
    const id = await newAccount('grant-full');
    await give(id, 'city_order_adv', 99);
    assert.equal(await give(id, 'city_order_adv', 5), 0);
    assert.equal((await loadItems(pool, id)).city_order_adv, 99);
    const last = (await eventsOf(id, 'item_granted')).pop();
    assert.deepEqual(last?.detail, { itemId: 'city_order_adv', requested: 5, granted: 0, reason: 'test' });
  });

  test('grantItem 非正整数 / 未知道具抛错，不改数据', async () => {
    const id = await newAccount('grant-invalid');
    await assert.rejects(() => inTx((c) => grantItem(c, id, 'city_order', 0, 'x')), /正整数/);
    await assert.rejects(() => inTx((c) => grantItem(c, id, 'city_order', 1.5, 'x')), /正整数/);
    await assert.rejects(() => inTx((c) => grantItem(c, id, 'nope' as 'city_order', 1, 'x')), /未知道具/);
    assert.equal((await loadItems(pool, id)).city_order, 0);
  });

  test('consumeItem 数量足够：扣 1，写 item_used，返回剩余', async () => {
    const id = await newAccount('consume-ok');
    await give(id, 'city_order', 2);
    const result = await inTx((c) => consumeItem(c, id, 'city_order', 1, 'move'));
    assert.deepEqual(result, { ok: true, count: 1 });
    assert.equal((await loadItems(pool, id)).city_order, 1);
    const events = await eventsOf(id, 'item_used');
    assert.deepEqual(events[0].detail, { itemId: 'city_order', amount: 1, left: 1, reason: 'move' });
  });

  test('consumeItem 数量不够：返回 INSUFFICIENT_ITEM，数量不变，不写事件', async () => {
    const id = await newAccount('consume-short');
    await give(id, 'city_order', 1);
    const before = await countEvents(id);
    const result = await inTx((c) => consumeItem(c, id, 'city_order', 2, 'move'));
    assert.deepEqual(result, { ok: false, code: INSUFFICIENT_ITEM, count: 1 });
    assert.equal((await loadItems(pool, id)).city_order, 1);
    assert.equal(await countEvents(id), before, '不写事件');
  });

  test('consumeItem 从未持有过的道具：返回 INSUFFICIENT_ITEM，count 为 0', async () => {
    const id = await newAccount('consume-none');
    const result = await inTx((c) => consumeItem(c, id, 'city_order_adv', 1, 'move'));
    assert.deepEqual(result, { ok: false, code: INSUFFICIENT_ITEM, count: 0 });
  });

  test('并发消耗同一道具：3 张只能成功 3 次，数量恰好为 0 不会变负', async () => {
    const id = await newAccount('consume-race');
    await give(id, 'city_order', 3);
    const results = await Promise.all(Array.from({ length: 10 }, () => inTx((c) => consumeItem(c, id, 'city_order', 1, 'race'))));
    assert.equal(results.filter((r) => r.ok).length, 3);
    assert.equal(results.filter((r) => !r.ok && r.code === INSUFFICIENT_ITEM).length, 7);
    assert.equal((await loadItems(pool, id)).city_order, 0);
    assert.equal((await eventsOf(id, 'item_used')).length, 3);
  });

  test('并发购买与消耗同一道具：数量守恒且不为负，礼金不为负', async () => {
    const id = await newAccount('mix-race');
    await give(id, 'city_order', 4);
    const jobs: Array<Promise<unknown>> = [];
    for (let i = 0; i < 10; i += 1) {
      jobs.push(buy(id, { itemId: 'city_order', count: 1, expectedPrice: 50 }));
      jobs.push(inTx((c) => consumeItem(c, id, 'city_order', 1, 'mix')));
    }
    const settled = await Promise.all(jobs);
    const buyFrames = settled.filter((_, i) => i % 2 === 0) as ResponseFrame[];
    const consumeResults = settled.filter((_, i) => i % 2 === 1) as Array<{ ok: boolean }>;
    const bought = buyFrames.filter((f) => f.ok).length;
    const consumed = consumeResults.filter((r) => r.ok).length;
    const count = (await loadItems(pool, id)).city_order;
    assert.equal(count, 4 + bought - consumed, '数量 = 原有 + 买入 - 消耗');
    assert.ok(count >= 0);
    const gift = await giftOf(id);
    assert.equal(gift, SEASON_GIFT - 50 * bought);
    assert.ok(gift >= 0);
  });

  // ---- BUY_ITEM ----

  test('BUY_ITEM 成功：礼金按 单价 × 数量 扣，道具增加，写 item_bought，响应带新数量与余额', async () => {
    const id = await newAccount('buy-ok');
    const frame = await buy(id, { itemId: 'city_order', count: 2, expectedPrice: 50 });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.deepEqual(frame.data, { itemId: 'city_order', bought: 2, count: 2, price: 50, cost: 100, gift: SEASON_GIFT - 100 });
    assert.equal(await giftOf(id), SEASON_GIFT - 100);
    assert.equal((await loadItems(pool, id)).city_order, 2);
    const bought = await eventsOf(id, 'item_bought');
    assert.deepEqual(bought[0].detail, { itemId: 'city_order', count: 2, price: 50, cost: 100, owned: 2, gift: SEASON_GIFT - 100 });
    // 礼金扣除与道具发放各自也有事件
    assert.equal((await eventsOf(id, 'gift_spent')).length, 1);
    assert.equal((await eventsOf(id, 'item_granted')).length, 1);
  });

  test('BUY_ITEM 参数校验：未知 / 不卖的道具、count 非法、expectedPrice 缺失，都是 INVALID_PARAMS 且不改数据', async () => {
    const id = await newAccount('buy-invalid');
    const cases: Array<Record<string, unknown>> = [
      { itemId: 'no_such', count: 1, expectedPrice: 50 },
      { count: 1, expectedPrice: 50 },
      { itemId: 'city_order', count: 0, expectedPrice: 50 },
      { itemId: 'city_order', count: 100, expectedPrice: 50 },
      { itemId: 'city_order', count: 1.5, expectedPrice: 50 },
      { itemId: 'city_order', count: 1 },
      { itemId: 'city_order', count: 1, expectedPrice: 'abc' },
    ];
    for (const data of cases) {
      const frame = await buy(id, data);
      assert.equal(frame.ok, false, JSON.stringify(data));
      assert.equal(frame.error?.code, 'INVALID_PARAMS', JSON.stringify(data));
    }
    assert.equal(await giftOf(id), SEASON_GIFT);
    assert.equal((await loadItems(pool, id)).city_order, 0);
  });

  test('BUY_ITEM 不卖的道具（shopPrice 为 null）：INVALID_PARAMS', async () => {
    const id = await newAccount('buy-unsold');
    setPrice('city_order_adv', null);
    try {
      const frame = await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 100 });
      assert.equal(frame.error?.code, 'INVALID_PARAMS');
    } finally {
      setPrice('city_order_adv', 100);
    }
    assert.equal(await giftOf(id), SEASON_GIFT);
  });

  test('BUY_ITEM 校验顺序：count 非法先于 expectedPrice 比对（count 0 + 错价仍是 INVALID_PARAMS，不是 ITEM_PRICE_CHANGED）', async () => {
    const id = await newAccount('buy-order');
    const frame = await buy(id, { itemId: 'city_order', count: 0, expectedPrice: 999 });
    assert.equal(frame.error?.code, 'INVALID_PARAMS');
  });

  test('BUY_ITEM 单价已变：ITEM_PRICE_CHANGED（附当前 price），礼金与道具都不变', async () => {
    const id = await newAccount('buy-price');
    await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 50 });
    const gift = await giftOf(id);
    setPrice('city_order', 80);
    try {
      const frame = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 50 });
      assert.equal(frame.ok, false);
      assert.equal(frame.error?.code, 'ITEM_PRICE_CHANGED');
      assert.deepEqual(frame.data, { price: 80 });
      assert.equal(await giftOf(id), gift, '礼金不变');
      assert.equal((await loadItems(pool, id)).city_order, 1, '道具不变');
      // 带新价通过；已有道具数量不因调价变化
      const ok = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 80 });
      assert.equal(ok.ok, true, JSON.stringify(ok));
      assert.equal((ok.data as { cost: number }).cost, 80);
      assert.equal((await loadItems(pool, id)).city_order, 2);
    } finally {
      setPrice('city_order', 50);
    }
  });

  test('BUY_ITEM 超过堆叠上限：ITEM_STACK_FULL（附 canBuy），礼金与道具都不变', async () => {
    const id = await newAccount('buy-stack');
    await give(id, 'city_order', 95);
    const frame = await buy(id, { itemId: 'city_order', count: 10, expectedPrice: 50 });
    assert.equal(frame.error?.code, 'ITEM_STACK_FULL');
    assert.deepEqual(frame.data, { stackMax: 99, have: 95, canBuy: 4 });
    assert.equal(await giftOf(id), SEASON_GIFT);
    assert.equal((await loadItems(pool, id)).city_order, 95);
    // 正好买到上限可以
    const exact = await buy(id, { itemId: 'city_order', count: 4, expectedPrice: 50 });
    assert.equal(exact.ok, true);
    assert.equal((await loadItems(pool, id)).city_order, 99);
  });

  test('BUY_ITEM 校验顺序：堆叠已满且礼金也不够时，先报 ITEM_STACK_FULL（不扣礼金）', async () => {
    const id = await newAccount('buy-order-stack');
    await give(id, 'city_order', 99);
    await inTx((c) => spendGift(c, id, SEASON_GIFT, 'drain'));
    const frame = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 50 });
    assert.equal(frame.error?.code, 'ITEM_STACK_FULL');
  });

  test('BUY_ITEM 礼金不足：INSUFFICIENT_GIFT（附 balance / cost），礼金与道具都不变', async () => {
    const id = await newAccount('buy-gift');
    const frame = await buy(id, { itemId: 'city_order_adv', count: 11, expectedPrice: 100 });
    assert.equal(frame.error?.code, 'INSUFFICIENT_GIFT');
    assert.deepEqual(frame.data, { balance: SEASON_GIFT, cost: 1100 });
    assert.equal(await giftOf(id), SEASON_GIFT);
    assert.equal((await loadItems(pool, id)).city_order_adv, 0);
    assert.equal((await eventsOf(id, 'item_bought')).length, 0);
  });

  test('BUY_ITEM 恰好花光礼金可以；之后再买报 INSUFFICIENT_GIFT', async () => {
    const id = await newAccount('buy-exact');
    const first = await buy(id, { itemId: 'city_order_adv', count: 10, expectedPrice: 100 });
    assert.equal(first.ok, true);
    assert.equal(await giftOf(id), 0);
    const second = await buy(id, { itemId: 'city_order', count: 1, expectedPrice: 50 });
    assert.equal(second.error?.code, 'INSUFFICIENT_GIFT');
  });

  test('BUY_ITEM 成功后推送 PUSH_ACCOUNT_STATE（items_changed）给同账号其他连接，发起连接不收推送', async () => {
    const id = await newAccount('buy-push');
    const registry = new ConnectionRegistry();
    const sentA: ResponseFrame[] = [];
    const sentB: ResponseFrame[] = [];
    const makeConn = (sink: ResponseFrame[]): ConnInfo => {
      const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sink.push(JSON.parse(raw)), close: () => undefined } as never;
      return { socket, ip: null, host: null, accountId: id, username: null, role: 'player', sessionId: null, connectedAt: new Date() };
    };
    const connA = makeConn(sentA);
    const connB = makeConn(sentB);
    registry.bind(connA, id);
    registry.bind(connB, id);
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
    await handleMessage(ctx, connA, JSON.stringify({ op: Op.BUY_ITEM, seq: 9, data: { itemId: 'city_order', count: 1, expectedPrice: 50 } }));
    assert.equal(sentA.filter((f) => f.op === Op.BUY_ITEM && f.ok).length, 1);
    assert.equal(sentA.filter((f) => f.op === Op.PUSH_ACCOUNT_STATE).length, 0, '发起连接不收推送');
    const push = sentB.find((f) => f.op === Op.PUSH_ACCOUNT_STATE) as unknown as { push: boolean; data: Record<string, unknown> };
    assert.ok(push, '其他连接收到推送');
    assert.equal(push.push, true);
    assert.deepEqual(push.data, { reason: 'items_changed', items: { city_order: 1, city_order_adv: 0 }, gift: SEASON_GIFT - 50 });
  });

  test('GET_ITEMS 与 GET_STATE.items 一致；catalog 含全部定义，shopPrice 与配置一致', async () => {
    const id = await newAccount('get-items');
    await buy(id, { itemId: 'city_order_adv', count: 1, expectedPrice: 100 });
    const items = await callAs(id, Op.GET_ITEMS, {});
    assert.equal(items.ok, true, JSON.stringify(items));
    const data = items.data as { items: Record<string, number>; catalog: Array<{ id: string; shopPrice: number | null }>; gift: number };
    assert.deepEqual(data.items, { city_order: 0, city_order_adv: 1 });
    assert.deepEqual(data.catalog.map((c) => [c.id, c.shopPrice]), [['city_order', 50], ['city_order_adv', 100]]);
    assert.equal(data.gift, SEASON_GIFT - 100);
    const state = await callAs(id, Op.GET_STATE, undefined);
    assert.deepEqual((state.data as { items: unknown }).items, data.items);
  });

  test('换季清空：背包整表清空（与礼金一起回到换季后的口径）', async () => {
    const id = await newAccount('season-reset');
    await give(id, 'city_order', 7);
    await give(id, 'city_order_adv', 2);
    await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
    const outcome = await runSeasonReset(pool);
    assert.equal(outcome.status, 'reset');
    const left = (await pool.query(`SELECT count(*)::int AS n FROM user_items`)).rows[0].n;
    assert.equal(left, 0, '换季后没有任何账号残留道具');
    assert.deepEqual(await loadItems(pool, id), emptyItems());
    const joined = await enterCurrentSeason(pool, id);
    assert.equal(joined.joined, true);
    assert.equal(await giftOf(id), SEASON_GIFT);
  });
});
