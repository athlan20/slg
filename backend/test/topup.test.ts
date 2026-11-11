// 充值订单与入账（AISLG-251，v108）：创建订单的月限额 / 每小时订单数 / 旧 pending 作废、
// 入账幂等（同一事件 id 重复、后台手动重发换新 id）、迟到成功回调（订单已 expired 仍入账）、
// 商品不匹配不入账、退款整单 / 部分 / 余额不足记 clawback_short、拒付按整单回收、
// Worker 的 24 小时作废、CREATE_TOPUP 的参数与限制、Agent 被拒、没配渠道时 TOPUP_UNAVAILABLE、
// 回调验签（篡改 / 缺签名）。需要真实 PostgreSQL：设置 TEST_DATABASE_URL，否则跳过。

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { loadGift } from '../common/src/gift-db';
import { grantItem, loadItems } from '../common/src/items-db';
import { loadIngot } from '../common/src/ingot-db';
import {
  TOPUP_HOURLY_MAX,
  TOPUP_MONTHLY_LIMIT,
  TOPUP_MONTHLY_MAX,
  topupProduct,
  TOPUP_TOO_MANY_PENDING,
} from '../common/src/ingot';
import {
  createPendingTopupOrder,
  expireStaleTopupOrders,
  hasWebhookEvent,
  listTopupOrders,
  loadTopupOrder,
  recordWebhookEvent,
} from '../common/src/topup-db';
import { handlePaymentEvent, settleCheckoutCompleted } from '../common/src/topup-settle';
import { FakeProvider } from '../common/src/payments/fake';
import { creemSignature } from '../common/src/payments/creem';
import type { PaymentEvent, PaymentProvider } from '../common/src/payments/types';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { insertAccountWithCity } from '../api/src/auth';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const SECRET = 'test-webhook-secret';
const provider = new FakeProvider(SECRET);
const product = topupProduct('topup_199');

describe('充值订单与入账（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  const tag = `topup-${Date.now()}`;

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

  /** 直接落一条订单（测试准备：指定状态与时刻，绕过限额） */
  async function seedOrder(
    accountId: string,
    options: { status?: string; createdAt?: Date; paidAt?: Date | null; ingot?: number } = {},
  ): Promise<string> {
    const res = await pool.query(
      `INSERT INTO topup_orders (account_id, product_id, usd_cents, ingot_amount, status, provider, created_at, paid_at)
       VALUES ($1, 'topup_199', 199, $2, $3, 'fake', $4, $5) RETURNING id`,
      [
        accountId,
        options.ingot ?? 1000,
        options.status ?? 'pending',
        options.createdAt ?? new Date(),
        options.paidAt ?? null,
      ],
    );
    return res.rows[0].id as string;
  }

  async function setIngot(accountId: string, amount: number): Promise<void> {
    await pool.query(`UPDATE accounts SET ingot = $2 WHERE id = $1`, [accountId, amount]);
  }

  async function eventsOf(accountId: string, type: string): Promise<Array<{ detail: Record<string, unknown> }>> {
    const res = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id`, [accountId, type]);
    return res.rows as Array<{ detail: Record<string, unknown> }>;
  }

  /** 建一笔 pending 订单（走真实限额逻辑） */
  async function createOrder(accountId: string): Promise<string> {
    return inTx(async (client) => {
      const created = await createPendingTopupOrder(client, {
        accountId,
        product: product!,
        provider: 'fake',
      });
      assert.equal(created.ok, true, JSON.stringify(created));
      return (created as { ok: true; orderId: string }).orderId;
    });
  }

  function checkoutEvent(orderId: string | null, overrides: Partial<Record<string, unknown>> = {}): PaymentEvent {
    return {
      kind: 'checkout_completed',
      eventId: `evt-${Math.random().toString(36).slice(2)}`,
      requestId: orderId,
      metadataOrderId: null,
      providerProductId: 'topup_199',
      amountPaidCents: 210,
      providerOrderId: 'ord-1',
      ...overrides,
    } as PaymentEvent;
  }

  function refundEvent(orderId: string | null, refundCents: number, amountPaidCents = 210): PaymentEvent {
    return {
      kind: 'refund',
      eventId: `evt-${Math.random().toString(36).slice(2)}`,
      requestId: orderId,
      metadataOrderId: null,
      refundCents,
      amountPaidCents,
    };
  }

  /** 入账 + 事件去重的完整路径（与回调路由一致：同一事务里写去重表 + 结算） */
  async function deliver(event: PaymentEvent) {
    return handlePaymentEvent(pool, event, provider);
  }

  async function callAs(
    accountId: string,
    op: number,
    data?: Record<string, unknown>,
    role: 'player' | 'agent' = 'player',
    payments: HandlerContext['payments'] = {
      provider,
      productIds: { topup_199: 'topup_199' },
      publicSiteUrl: 'https://slg.example.test',
    },
  ): Promise<ResponseFrame> {
    const sent: ResponseFrame[] = [];
    const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
    const registry = new ConnectionRegistry();
    const conn: ConnInfo = { socket, ip: null, host: null, accountId, username: null, role, sessionId: null, connectedAt: new Date() };
    registry.add(conn);
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set(), payments };
    await handleMessage(ctx, conn, JSON.stringify({ op, seq: 1, data }));
    const frame = sent.find((f) => f.op === op);
    assert.ok(frame, `op ${op} 没有响应`);
    return frame;
  }

  before(async () => {
    setTimeScaleCache(1);
    db = await createTempDatabase(dbUrl as string, 'topup');
    pool = new pg.Pool({ connectionString: db.url, max: 12 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
  });

  after(async () => {
    await pool?.end();
    await db?.drop();
  });

  test('商品配置：只有一档 topup_199 = 1.99 美元 / 1000 元宝', () => {
    assert.deepEqual(product, { id: 'topup_199', name: '1000 元宝', nameEn: '1000 Ingots', usdCents: 199, ingot: 1000 });
    assert.equal(topupProduct('topup_999'), null);
    assert.equal(topupProduct(42), null);
  });

  test('创建订单：落 pending，账号与金额取服务端配置', async () => {
    const id = await newAccount('create');
    const orderId = await createOrder(id);
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.status, 'pending');
    assert.equal(order?.accountId, id);
    assert.equal(order?.usdCents, 199);
    assert.equal(order?.ingotAmount, 1000);
    assert.equal(order?.provider, 'fake');
  });

  test('同一账号第二个未支付订单会让第一个作废', async () => {
    const id = await newAccount('pending-replace');
    const first = await createOrder(id);
    const second = await createOrder(id);
    assert.equal((await loadTopupOrder(pool, first))?.status, 'expired');
    assert.equal((await loadTopupOrder(pool, second))?.status, 'pending');
  });

  test(`每小时第 ${TOPUP_HOURLY_MAX + 1} 个订单返回 TOPUP_TOO_MANY_PENDING`, async () => {
    const id = await newAccount('hourly');
    for (let i = 0; i < TOPUP_HOURLY_MAX; i += 1) {
      await createOrder(id);
    }
    const results = await inTx(async (client) => createPendingTopupOrder(client, { accountId: id, product: product!, provider: 'fake' }));
    assert.equal(results.ok, false);
    assert.equal((results as { code: string }).code, TOPUP_TOO_MANY_PENDING);
  });

  test('月限额：本月已入账 10 次后再创建任何订单返回 TOPUP_MONTHLY_LIMIT；上月的不算', async () => {
    const id = await newAccount('monthly');
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
    for (let i = 0; i < TOPUP_MONTHLY_MAX - 1; i += 1) {
      // 上个月的订单不算本月额度，也不占每小时额度（created_at 一起放到上个月）
      await seedOrder(id, {
        status: 'paid',
        paidAt: new Date(monthStart.getTime() - 86_400_000),
        createdAt: new Date(monthStart.getTime() - 86_400_000),
      });
    }
    const ok = await inTx((client) => createPendingTopupOrder(client, { accountId: id, product: product!, provider: 'fake' }));
    assert.equal(ok.ok, true, '上月的 9 笔不占本月额度');
    for (let i = 0; i < TOPUP_MONTHLY_MAX; i += 1) {
      await seedOrder(id, {
        status: 'paid',
        paidAt: new Date(monthStart.getTime() + (i + 1) * 3_600_000),
        createdAt: new Date(monthStart.getTime() + (i + 1) * 3_600_000),
      });
    }
    const denied = await inTx((client) => createPendingTopupOrder(client, { accountId: id, product: product!, provider: 'fake' }));
    assert.equal(denied.ok, false);
    assert.equal((denied as { code: string }).code, TOPUP_MONTHLY_LIMIT);
    assert.equal((denied as { used: number }).used, TOPUP_MONTHLY_MAX);
  });

  test('入账：订单置 paid、元宝 +1000、写 TOPUP_PAID；同一事件 id 重复只入账一次', async () => {
    const id = await newAccount('settle');
    const orderId = await createOrder(id);
    const event = checkoutEvent(orderId);
    const first = await deliver(event);
    assert.equal(first.outcome.status, 'credited');
    assert.equal(await loadIngot(pool, id), 1000);
    assert.equal((await loadTopupOrder(pool, orderId))?.status, 'paid');
    const second = await deliver(event);
    assert.equal(second.duplicate, true, '同一事件 id 直接判重复');
    assert.equal(await loadIngot(pool, id), 1000, '不重复入账');
    const paidEvents = await eventsOf(id, 'topup_paid');
    assert.equal(paidEvents.length, 1);
    assert.deepEqual(
      { orderId: paidEvents[0].detail.orderId, ingot: paidEvents[0].detail.ingot, balance: paidEvents[0].detail.balance },
      { orderId, ingot: 1000, balance: 1000 },
    );
    assert.equal(paidEvents[0].detail.amountPaidCents, 210);
  });

  test('后台手动重发已入账的成功回调（新事件 id）：不重复入账', async () => {
    const id = await newAccount('resend');
    const orderId = await createOrder(id);
    await deliver(checkoutEvent(orderId));
    const resent = await deliver(checkoutEvent(orderId));
    assert.equal(resent.outcome.status, 'ignored');
    assert.equal((resent.outcome as { reason: string }).reason, 'status_paid');
    assert.equal(await loadIngot(pool, id), 1000);
    assert.equal((await eventsOf(id, 'topup_paid')).length, 1);
  });

  test('迟到的成功回调（订单已 expired）：仍然入账', async () => {
    const id = await newAccount('late');
    const orderId = await seedOrder(id, { createdAt: new Date(Date.now() - 30 * 3600_000) });
    await expireStaleTopupOrders(pool);
    assert.equal((await loadTopupOrder(pool, orderId))?.status, 'expired');
    const result = await deliver(checkoutEvent(orderId));
    assert.equal(result.outcome.status, 'credited');
    assert.equal(await loadIngot(pool, id), 1000);
    assert.equal((await loadTopupOrder(pool, orderId))?.status, 'paid');
  });

  test('渠道商品 id 不匹配 topup_199：不入账（不看金额）', async () => {
    const id = await newAccount('product-mismatch');
    const orderId = await createOrder(id);
    const result = await deliver(checkoutEvent(orderId, { providerProductId: 'prod_other' }));
    assert.equal(result.outcome.status, 'ignored');
    assert.equal((result.outcome as { reason: string }).reason, 'product_mismatch');
    assert.equal(await loadIngot(pool, id), 0);
    assert.equal((await loadTopupOrder(pool, orderId))?.status, 'pending');
  });

  test('订单不存在：忽略，不入账', async () => {
    const result = await deliver(checkoutEvent('00000000-0000-4000-8000-000000000000'));
    assert.equal(result.outcome.status, 'ignored');
    assert.equal((result.outcome as { reason: string }).reason, 'order_not_found');
  });

  test('整单退款：元宝减少 1000，订单置 refunded；礼金与道具不动', async () => {
    const id = await newAccount('refund-full');
    const orderId = await createOrder(id);
    await deliver(checkoutEvent(orderId));
    await inTx((client) => grantItem(client, id, 'city_order', 3, 'test'));
    const giftBefore = await loadGift(pool, id);
    const result = await deliver(refundEvent(orderId, 210));
    assert.equal(result.outcome.status, 'refunded');
    assert.equal(await loadIngot(pool, id), 0);
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.status, 'refunded');
    assert.equal(order?.refundedCents, 210);
    assert.equal(order?.clawbackShort, 0);
    assert.ok(order?.refundedAt);
    assert.equal(await loadGift(pool, id), giftBefore, '礼金不动');
    assert.equal((await loadItems(pool, id)).city_order, 3, '道具不动');
    const events = await eventsOf(id, 'topup_refunded');
    assert.equal(events.length, 1);
    assert.deepEqual(
      { clawed: events[0].detail.clawed, shortfall: events[0].detail.shortfall, balance: events[0].detail.balance },
      { clawed: 1000, shortfall: 0, balance: 0 },
    );
  });

  test('余额只剩 200 时整单退款：减到 0，clawback_short 记 800', async () => {
    const id = await newAccount('refund-short');
    const orderId = await createOrder(id);
    await deliver(checkoutEvent(orderId));
    await setIngot(id, 200);
    const result = await deliver(refundEvent(orderId, 210));
    assert.equal(result.outcome.status, 'refunded');
    assert.equal(await loadIngot(pool, id), 0);
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.clawbackShort, 800);
    assert.equal((result.outcome as { shortfall: number }).shortfall, 800);
  });

  test('部分退款（退 50%）：回收 500，订单仍为 paid', async () => {
    const id = await newAccount('refund-partial');
    const orderId = await createOrder(id);
    await deliver(checkoutEvent(orderId));
    const result = await deliver(refundEvent(orderId, 105, 210));
    assert.equal(result.outcome.status, 'refunded');
    assert.equal((result.outcome as { clawed: number }).clawed, 500);
    assert.equal(await loadIngot(pool, id), 500);
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.status, 'paid');
    assert.equal(order?.refundedCents, 105);
    // 再退剩下的一半 → 累计退满整单，订单置 refunded
    await deliver(refundEvent(orderId, 105, 210));
    assert.equal(await loadIngot(pool, id), 0);
    assert.equal((await loadTopupOrder(pool, orderId))?.status, 'refunded');
  });

  test('拒付：按整单回收，订单置 refunded（即使余额不足也封顶到 0）', async () => {
    const id = await newAccount('dispute');
    const orderId = await createOrder(id);
    await deliver(checkoutEvent(orderId));
    await setIngot(id, 300);
    const event: PaymentEvent = {
      kind: 'dispute',
      eventId: `evt-${Date.now()}-dispute`,
      requestId: orderId,
      metadataOrderId: null,
      amountCents: 210,
      amountPaidCents: 210,
    };
    const result = await deliver(event);
    assert.equal(result.outcome.status, 'refunded');
    assert.equal(await loadIngot(pool, id), 0);
    const order = await loadTopupOrder(pool, orderId);
    assert.equal(order?.status, 'refunded');
    assert.equal(order?.clawbackShort, 700);
  });

  test('未支付订单退款 / 拒付：忽略（订单没入过账）', async () => {
    const id = await newAccount('refund-pending');
    const orderId = await createOrder(id);
    const result = await deliver(refundEvent(orderId, 210));
    assert.equal(result.outcome.status, 'ignored');
    assert.equal((result.outcome as { reason: string }).reason, 'status_pending');
    assert.equal(await loadIngot(pool, id), 0);
  });

  test('Worker 的 24 小时作废：只有超时的 pending 变 expired', async () => {
    const id = await newAccount('expire');
    const old = await seedOrder(id, { createdAt: new Date(Date.now() - 25 * 3600_000) });
    const recent = await seedOrder(id, { createdAt: new Date(Date.now() - 3600_000) });
    const expired = await expireStaleTopupOrders(pool);
    assert.equal(expired, 1);
    assert.equal((await loadTopupOrder(pool, old))?.status, 'expired');
    assert.equal((await loadTopupOrder(pool, recent))?.status, 'pending');
  });

  test('回调去重表：同一 provider + event_id 只能记录一次', async () => {
    const event = { provider: 'fake', eventId: `dedupe-${Date.now()}`, eventType: 'checkout_completed', orderId: null };
    assert.equal(await recordWebhookEvent(pool, event), true);
    assert.equal(await recordWebhookEvent(pool, event), false);
    assert.equal(await hasWebhookEvent(pool, 'fake', event.eventId), true);
  });

  test('处理失败时整体回滚：事件不留在去重表，渠道重试仍能入账', async () => {
    const id = await newAccount('dedupe-rollback');
    const orderId = await createOrder(id);
    const event = checkoutEvent(orderId);
    // 模拟结算中途故障（渠道适配器抛错）：去重表与订单 / 余额都要回滚
    const broken: PaymentProvider = {
      provider: provider.provider,
      createCheckout: provider.createCheckout.bind(provider),
      verifyAndParseWebhook: provider.verifyAndParseWebhook.bind(provider),
      matchesProduct: () => {
        throw new Error('boom');
      },
    };
    await assert.rejects(handlePaymentEvent(pool, event, broken), /boom/);
    assert.equal(await hasWebhookEvent(pool, 'fake', (event as { eventId: string }).eventId), false, '失败的事件不留在去重表');
    assert.equal(await loadIngot(pool, id), 0);
    assert.equal((await loadTopupOrder(pool, orderId))?.status, 'pending');
    // 渠道按自己的节奏重试：这次能处理
    const retry = await deliver(event);
    assert.equal(retry.duplicate, false);
    assert.equal(retry.outcome.status, 'credited');
    assert.equal(await loadIngot(pool, id), 1000);
    const rows = await pool.query(`SELECT count(*)::int AS n FROM payment_webhook_events WHERE event_id = $1`, [
      (event as { eventId: string }).eventId,
    ]);
    assert.equal((rows.rows[0] as { n: number }).n, 1);
  });

  test('回调验签：签名正确才解析；篡改 body 或缺少头直接 null', async () => {
    const body = Buffer.from(
      JSON.stringify({ id: 'evt-1', eventType: 'checkout.completed', object: { request_id: 'x', product: { id: 'topup_199' } } }),
    );
    const good = provider.verifyAndParseWebhook(body, { 'creem-signature': creemSignature(body, SECRET) });
    assert.equal(good?.kind, 'checkout_completed');
    assert.equal(provider.verifyAndParseWebhook(body, { 'creem-signature': 'deadbeef' }), null);
    assert.equal(provider.verifyAndParseWebhook(body, {}), null);
    const tampered = Buffer.from(body.toString().replace('topup_199', 'topup_199 '));
    assert.equal(provider.verifyAndParseWebhook(tampered, { 'creem-signature': creemSignature(body, SECRET) }), null);
  });

  // ---- CREATE_TOPUP ----

  test('CREATE_TOPUP：落 pending 订单、返回 orderId 与 checkoutUrl、记下渠道会话 id', async () => {
    const id = await newAccount('create-op');
    const frame = await callAs(id, Op.CREATE_TOPUP, { productId: 'topup_199' });
    assert.equal(frame.ok, true, JSON.stringify(frame));
    const data = frame.data as { orderId: string; checkoutUrl: string; usdCents: number; ingot: number };
    assert.equal(data.usdCents, 199);
    assert.equal(data.ingot, 1000);
    assert.match(data.checkoutUrl, /^https:\/\/fake\.creem\.local\/checkout\//);
    const order = await loadTopupOrder(pool, data.orderId);
    assert.equal(order?.status, 'pending');
    assert.equal(order?.providerCheckoutId, `fake_checkout_${data.orderId}`);
    // 玩家拿到地址后付款 → 回调入账
    await deliver(checkoutEvent(data.orderId));
    assert.equal(await loadIngot(pool, id), 1000);
  });

  test('CREATE_TOPUP：未知 / 缺失商品返回 TOPUP_PRODUCT_INVALID，不落订单', async () => {
    const id = await newAccount('create-invalid');
    for (const data of [{ productId: 'topup_999' }, { productId: 42 }, {}]) {
      const frame = await callAs(id, Op.CREATE_TOPUP, data);
      assert.equal(frame.error?.code, 'TOPUP_PRODUCT_INVALID', JSON.stringify(data));
    }
    assert.equal((await listTopupOrders(pool, id)).length, 0);
  });

  test('CREATE_TOPUP：Agent 连接返回 AGENT_FORBIDDEN，不落订单', async () => {
    const id = await newAccount('create-agent');
    const frame = await callAs(id, Op.CREATE_TOPUP, { productId: 'topup_199' }, 'agent');
    assert.equal(frame.error?.code, 'AGENT_FORBIDDEN');
    assert.equal((await listTopupOrders(pool, id)).length, 0);
  });

  test('CREATE_TOPUP：没配置支付渠道返回 TOPUP_UNAVAILABLE（礼金买道具仍然正常）', async () => {
    const id = await newAccount('create-unavailable');
    const frame = await callAs(id, Op.CREATE_TOPUP, { productId: 'topup_199' }, 'player', null);
    assert.equal(frame.error?.code, 'TOPUP_UNAVAILABLE');
    const buy = await callAs(id, Op.BUY_ITEM, { itemId: 'city_order', count: 1, expectedPrice: 50 }, 'player', null);
    assert.equal(buy.ok, true, JSON.stringify(buy));
  });

  test('CREATE_TOPUP：本月已入账 10 次 → TOPUP_MONTHLY_LIMIT（附 limit / used）', async () => {
    const id = await newAccount('create-monthly');
    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 0, 0, 0, 0));
    for (let i = 0; i < TOPUP_MONTHLY_MAX; i += 1) {
      await seedOrder(id, {
        status: 'paid',
        paidAt: new Date(monthStart.getTime() + (i + 1) * 3_600_000),
        createdAt: new Date(monthStart.getTime() + (i + 1) * 3_600_000),
      });
    }
    const frame = await callAs(id, Op.CREATE_TOPUP, { productId: 'topup_199' });
    assert.equal(frame.error?.code, 'TOPUP_MONTHLY_LIMIT');
    assert.deepEqual(frame.data, { limit: TOPUP_MONTHLY_MAX, used: TOPUP_MONTHLY_MAX });
  });
});