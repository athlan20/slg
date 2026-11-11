// 回调找订单（AISLG-251）：拒付 / 退款事件的 Creem 形状里没有 request_id 与 metadata（拒付文档示例的
// object.checkout 只有 id、object、product、units、custom_fields、status、mode），所以按
// ① request_id / metadata → ② 渠道结账会话 id（provider_checkout_id）→ ③ 渠道订单 id（provider_order_id）找单。
// 覆盖：拒付整单回收（文档示例原样）、退款缺 request_id 按比例回收、order.id 兜底、三者都对不上则忽略且不改数据、
// 入账时存下渠道订单 id、去重表记的是解析出的订单 id。需要真实 PostgreSQL：设置 TEST_DATABASE_URL，否则跳过。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { loadGift } from '../common/src/gift-db';
import { grantItem, loadItems } from '../common/src/items-db';
import { loadIngot } from '../common/src/ingot-db';
import { topupProduct } from '../common/src/ingot';
import { createPendingTopupOrder, loadTopupOrder, setTopupCheckoutId } from '../common/src/topup-db';
import { handlePaymentEvent } from '../common/src/topup-settle';
import { CreemProvider, parseCreemEvent } from '../common/src/payments/creem';
import type { PaymentEvent } from '../common/src/payments/types';
import { setTimeScaleCache } from '../common/src/time-scale';
import { insertAccountWithCity } from '../api/src/auth';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const product = topupProduct('topup_199');
/** 渠道商品 id 对照用：我们的 topup_199 对应的 Creem 商品 id（测试里随便给一个） */
const PROVIDER_PRODUCT_ID = 'prod_lookup_test';
const provider = new CreemProvider({
  apiKey: 'test-api-key',
  webhookSecret: 'test-webhook-secret',
  apiBase: 'https://test-api.creem.io',
  productIds: { topup_199: PROVIDER_PRODUCT_ID },
});

describe('回调找订单：checkout id / order id 兜底（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `lookup-${Date.now()}`;
  let seq = 0;

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

  /** 新账号 + 一笔已创建结账会话的 pending 订单（provider 用 creem，与线上一致） */
  async function pendingOrder(name: string): Promise<{ accountId: string; orderId: string; checkoutId: string }> {
    seq += 1;
    const accountId = await inTx(async (client) => {
      const created = await insertAccountWithCity(client, { username: `${tag}-${name}`, passwordHash: 'x', signupIp: null });
      return created.id;
    });
    const orderId = await inTx(async (client) => {
      const created = await createPendingTopupOrder(client, { accountId, product: product!, provider: 'creem' });
      assert.equal(created.ok, true, JSON.stringify(created));
      return (created as { ok: true; orderId: string }).orderId;
    });
    const checkoutId = `ch_${tag}_${seq}`;
    await setTopupCheckoutId(pool, orderId, checkoutId);
    return { accountId, orderId, checkoutId };
  }

  /** 入账：checkout.completed 按 Creem 结构（request_id + metadata + order.id） */
  async function credit(orderId: string, providerOrderId: string) {
    const event = parseCreemEvent({
      id: `evt-credit-${randomUUID()}`,
      eventType: 'checkout.completed',
      object: {
        request_id: orderId,
        metadata: { orderId },
        order: { id: providerOrderId, amount_paid: 216, amount: 199, currency: 'USD' },
        product: { id: PROVIDER_PRODUCT_ID },
      },
    });
    assert.equal(event?.kind, 'checkout_completed');
    const result = await handlePaymentEvent(pool, event as PaymentEvent, provider);
    assert.equal(result.outcome.status, 'credited', JSON.stringify(result.outcome));
  }

  /** 拒付回调：文档示例形状，object.checkout 没有 request_id / metadata，只有 id 与 order.id */
  function disputeEvent(options: { checkoutId: string; providerOrderId?: string; transactionOrder?: string }): PaymentEvent {
    const object: Record<string, unknown> = {
      id: `dispute_${randomUUID()}`,
      object: 'dispute',
      amount: 199,
      currency: 'USD',
      checkout: {
        id: options.checkoutId,
        object: 'checkout',
        product: PROVIDER_PRODUCT_ID,
        units: 1,
        custom_fields: {},
        status: 'completed',
        mode: 'live',
      },
    };
    if (options.providerOrderId) {
      object.order = { id: options.providerOrderId, object: 'order', status: 'paid' };
    }
    if (options.transactionOrder) {
      object.transaction = { id: `txn_${randomUUID()}`, object: 'transaction', order: options.transactionOrder };
    }
    const event = parseCreemEvent({ id: `evt-dispute-${randomUUID()}`, eventType: 'dispute.created', object });
    assert.equal(event?.kind, 'dispute');
    return event as PaymentEvent;
  }

  /** 退款回调：只带 checkout.id（无 request_id / metadata），transaction.amount_paid 给出实付金额 */
  function refundEvent(options: { checkoutId: string; refundCents: number; amountPaidCents?: number; request?: string }): PaymentEvent {
    const object: Record<string, unknown> = {
      id: `ref_${randomUUID()}`,
      object: 'refund',
      refund_amount: options.refundCents,
      checkout: { id: options.checkoutId, object: 'checkout', status: 'completed' },
    };
    if (options.amountPaidCents !== undefined) {
      object.transaction = { id: `txn_${randomUUID()}`, object: 'transaction', amount_paid: options.amountPaidCents };
    }
    if (options.request) {
      object.request_id = options.request;
    }
    const event = parseCreemEvent({ id: `evt-refund-${randomUUID()}`, eventType: 'refund.created', object });
    assert.equal(event?.kind, 'refund');
    return event as PaymentEvent;
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'topup-lookup');
    pool = new pg.Pool({ connectionString: db.url, max: 8 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('入账时把渠道订单 id（object.order.id）存进 provider_order_id', async () => {
    const { orderId, checkoutId } = await pendingOrder('store-order-id');
    await credit(orderId, 'ord_store_1');
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.status, 'paid');
    assert.equal(order?.providerOrderId, 'ord_store_1');
    assert.equal(order?.providerCheckoutId, checkoutId);
  });

  test('拒付（文档示例形状，无 request_id / metadata）：靠 checkout.id 找到订单，整单回收，订单 refunded', async () => {
    const { accountId, orderId, checkoutId } = await pendingOrder('dispute-doc');
    await credit(orderId, 'ord_dispute_doc');
    await inTx((client) => grantItem(client, accountId, 'city_order', 3, 'test'));
    const giftBefore = await loadGift(pool, accountId);
    const itemsBefore = (await loadItems(pool, accountId)).city_order;
    assert.equal(await loadIngot(pool, accountId), 1000);

    const event = disputeEvent({ checkoutId });
    const result = await handlePaymentEvent(pool, event, provider);
    assert.equal(result.outcome.status, 'refunded', JSON.stringify(result.outcome));
    assert.equal((result.outcome as { orderId: string }).orderId, orderId);
    assert.equal(await loadIngot(pool, accountId), 0);
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.status, 'refunded');
    assert.equal(order?.clawbackShort, 0);
    assert.equal(await loadGift(pool, accountId), giftBefore, '礼金不动');
    assert.equal((await loadItems(pool, accountId)).city_order, itemsBefore, '道具不动');

    // 去重表记的是解析出的订单 id
    const row = await pool.query(`SELECT order_id FROM payment_webhook_events WHERE event_id = $1`, [event.eventId]);
    assert.equal((row.rows[0] as { order_id: string }).order_id, orderId);
  });

  test('退款缺 request_id：靠 checkout.id 找到订单，部分退款按比例回收（退 105 / 实付 210 → 回收 500）', async () => {
    const { accountId, orderId, checkoutId } = await pendingOrder('refund-by-checkout');
    await credit(orderId, 'ord_refund_checkout');
    const result = await handlePaymentEvent(pool, refundEvent({ checkoutId, refundCents: 105, amountPaidCents: 210 }), provider);
    assert.equal(result.outcome.status, 'refunded', JSON.stringify(result.outcome));
    assert.equal((result.outcome as { clawed: number }).clawed, 500);
    assert.equal(await loadIngot(pool, accountId), 500);
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.status, 'paid', '只退了一半，订单仍为 paid');
    assert.equal(order?.refundedCents, 105);
  });

  test('order.id 兜底：checkout.id 对不上时，用 object.order.id 找到订单', async () => {
    const { accountId, orderId } = await pendingOrder('dispute-order-id');
    await credit(orderId, 'ord_fallback_1');
    const result = await handlePaymentEvent(
      pool,
      disputeEvent({ checkoutId: 'ch_not_stored', providerOrderId: 'ord_fallback_1' }),
      provider,
    );
    assert.equal(result.outcome.status, 'refunded', JSON.stringify(result.outcome));
    assert.equal(await loadIngot(pool, accountId), 0);
    assert.equal((await loadTopupOrder(pool, orderId))?.status, 'refunded');
  });

  test('order.id 没有时取 transaction.order 兜底', async () => {
    const { accountId, orderId } = await pendingOrder('dispute-transaction-order');
    await credit(orderId, 'ord_fallback_2');
    const result = await handlePaymentEvent(
      pool,
      disputeEvent({ checkoutId: 'ch_not_stored_2', transactionOrder: 'ord_fallback_2' }),
      provider,
    );
    assert.equal(result.outcome.status, 'refunded', JSON.stringify(result.outcome));
    assert.equal(await loadIngot(pool, accountId), 0);
  });

  test('顺序：request_id 找不到（或不是 uuid）时继续用 checkout.id；request_id 命中时优先它', async () => {
    const first = await pendingOrder('order-chain-1');
    await credit(first.orderId, 'ord_chain_1');
    // request_id 是不存在的 uuid：落到 checkout.id
    const byCheckout = await handlePaymentEvent(
      pool,
      refundEvent({ checkoutId: first.checkoutId, refundCents: 210, amountPaidCents: 210, request: randomUUID() }),
      provider,
    );
    assert.equal(byCheckout.outcome.status, 'refunded', JSON.stringify(byCheckout.outcome));
    assert.equal(await loadIngot(pool, first.accountId), 0);

    // request_id 不是 uuid：不能让 SQL 报错，继续往下找
    const second = await pendingOrder('order-chain-2');
    await credit(second.orderId, 'ord_chain_2');
    const notUuid = await handlePaymentEvent(
      pool,
      refundEvent({ checkoutId: second.checkoutId, refundCents: 210, amountPaidCents: 210, request: 'not-a-uuid' }),
      provider,
    );
    assert.equal(notUuid.outcome.status, 'refunded', JSON.stringify(notUuid.outcome));
    assert.equal((notUuid.outcome as { orderId: string }).orderId, second.orderId);
  });

  test('三种方式都对不上：忽略，不改任何订单与余额数据', async () => {
    const { accountId, orderId } = await pendingOrder('no-match');
    await credit(orderId, 'ord_no_match');
    const before = await loadTopupOrder(pool, orderId);
    const ingotBefore = await loadIngot(pool, accountId);

    const event = disputeEvent({ checkoutId: 'ch_nobody', providerOrderId: 'ord_nobody' });
    const result = await handlePaymentEvent(pool, event, provider);
    assert.equal(result.duplicate, false);
    assert.equal(result.outcome.status, 'ignored');
    assert.equal((result.outcome as { reason: string }).reason, 'order_not_found');
    assert.equal(await loadIngot(pool, accountId), ingotBefore);
    const after = await loadTopupOrder(pool, orderId);
    assert.equal(after?.status, 'paid');
    assert.equal(after?.refundedCents, before?.refundedCents);
    assert.equal(after?.clawbackShort, 0);

    // 事件记录仍写入去重表，但 order_id 为空（没有找到订单）
    const row = await pool.query(`SELECT order_id FROM payment_webhook_events WHERE event_id = $1`, [event.eventId]);
    assert.equal((row.rows[0] as { order_id: string | null }).order_id, null);
  });
});
