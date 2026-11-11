// 充值的入账与退款回收（AISLG-251，v108）。**业务规则都在这里**，HTTP 路由只做验签与回 200。
// 一次回调的全部处理（写去重表 + 结算）在同一个事务里完成：中途失败整体回滚，渠道重试时还能重新处理；
// 成功提交后同一事件 id 再来一次直接当重复（不重复入账）。
// 入账（checkout.completed）：订单必须是 pending 或 expired（迟到的成功回调也要入账，钱已经收了）；
//   用渠道商品 id 对照我们的商品校验（含税金额会浮动，不用金额）；事务内：订单置 paid、
//   accounts.ingot += ingot_amount、写 TOPUP_PAID。
// 幂等有两道：回调事件 id 去重（payment_webhook_events 联合唯一）+ 订单状态（已是 paid / refunded 就忽略，
//   覆盖后台手动重发换了新事件 id 的情况）。
// 退款 / 拒付：按比例回收元宝（部分退款），累计退款达到整单才置 refunded；ingot 最多减到 0，
//   减不够的部分记 clawback_short；不收回已买的道具（含 paid_count 部分）、不动礼金、不自动封号。
// 锁序（与创建订单一致）：先锁订单行，再锁 accounts 行——两条路径顺序相同，不会互相死锁。

import type pg from 'pg';
import { EventType } from './protocol-city';
import { insertEvent } from './events';
import { topupProduct } from './ingot';
import { recordWebhookEvent, topupOrderFromRow, type RawOrderRow, type TopupOrder } from './topup-db';
import type { PaymentEvent, PaymentProvider } from './payments/types';

type CheckoutEvent = Extract<PaymentEvent, { kind: 'checkout_completed' }>;
type RefundEvent = Extract<PaymentEvent, { kind: 'refund' }>;
type DisputeEvent = Extract<PaymentEvent, { kind: 'dispute' }>;

export type SettleOutcome =
  /** 已入账：accountId 与入账后的余额供在线推送 */
  | { status: 'credited'; orderId: string; accountId: string; ingot: number; balance: number }
  /** 已回收：退款 / 拒付 */
  | {
      status: 'refunded';
      orderId: string;
      accountId: string;
      clawed: number;
      shortfall: number;
      balance: number;
    }
  /** 不处理（订单不存在 / 已入账 / 商品不匹配等），路由照旧回 200，避免渠道重试 */
  | { status: 'ignored'; orderId: string | null; reason: string };

/** 一次回调的处理结果：duplicate = 同一个事件 id 之前已经处理过（直接回 200） */
export interface PaymentEventResult {
  duplicate: boolean;
  outcome: SettleOutcome;
}

async function inTransaction<T>(pool: pg.Pool, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 回调里用来找订单的 id：request_id 优先，metadata.orderId 兜底（账号归属一律以订单行为准） */
export function eventOrderId(event: PaymentEvent): string | null {
  if (event.kind === 'ignored') {
    return null;
  }
  return event.requestId ?? event.metadataOrderId;
}

async function lockOrder(client: pg.PoolClient, orderId: string): Promise<TopupOrder | null> {
  const res = await client.query(
    `SELECT id, account_id, product_id, usd_cents, ingot_amount, status, provider,
            provider_checkout_id, provider_order_id, created_at, paid_at, refunded_at, clawback_short, refunded_cents
     FROM topup_orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  return res.rowCount ? topupOrderFromRow(res.rows[0] as RawOrderRow) : null;
}

/** 支付成功入账（事务内）。返回 credited / ignored */
async function settleCheckoutInTx(
  client: pg.PoolClient,
  event: CheckoutEvent,
  provider: PaymentProvider,
): Promise<SettleOutcome> {
  const orderId = eventOrderId(event);
  if (!orderId) {
    return { status: 'ignored', orderId: null, reason: 'no_request_id' };
  }
  const order = await lockOrder(client, orderId);
  if (!order) {
    return { status: 'ignored', orderId, reason: 'order_not_found' };
  }
  const product = topupProduct(order.productId);
  if (!product) {
    return { status: 'ignored', orderId, reason: 'product_unknown' };
  }
  // 商品校验用渠道商品 id（同一订单被换成别的商品时不入账）；金额只用于退款按比例回收
  if (!provider.matchesProduct(product, event.providerProductId)) {
    return { status: 'ignored', orderId, reason: 'product_mismatch' };
  }
  // 迟到的成功回调：订单已 expired 也要入账（钱已经收了）。已 paid / refunded 则忽略（重复入账）
  if (order.status !== 'pending' && order.status !== 'expired') {
    return { status: 'ignored', orderId, reason: `status_${order.status}` };
  }
  await client.query(
    `UPDATE topup_orders
     SET status = 'paid', paid_at = now(), provider_order_id = COALESCE($2, provider_order_id)
     WHERE id = $1`,
    [order.id, event.providerOrderId],
  );
  const credited = await client.query(`UPDATE accounts SET ingot = ingot + $2 WHERE id = $1 RETURNING ingot`, [
    order.accountId,
    order.ingotAmount,
  ]);
  const balance = Math.max(0, Number((credited.rows[0] as { ingot: number | string }).ingot));
  await insertEvent(client, {
    accountId: order.accountId,
    type: EventType.TOPUP_PAID,
    detail: {
      orderId: order.id,
      productId: order.productId,
      usdCents: order.usdCents,
      amountPaidCents: event.amountPaidCents,
      ingot: order.ingotAmount,
      balance,
      provider: order.provider,
    },
  });
  return { status: 'credited', orderId: order.id, accountId: order.accountId, ingot: order.ingotAmount, balance };
}

/** 退款按比例回收的元宝数：floor(refund_amount ÷ amount_paid × ingot_amount) */
export function clawbackIngots(refundCents: number, amountPaidCents: number, ingotAmount: number): number {
  if (!Number.isFinite(refundCents) || !Number.isFinite(amountPaidCents) || amountPaidCents <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(ingotAmount, Math.floor((refundCents / amountPaidCents) * ingotAmount)));
}

/** 从账号扣回元宝（最多减到 0），返回扣后余额与没能回收的部分（余额不够时记到 clawback_short） */
async function clawback(
  client: pg.PoolClient,
  accountId: string,
  clawed: number,
): Promise<{ balance: number; shortfall: number }> {
  const before = await client.query(`SELECT ingot FROM accounts WHERE id = $1 FOR UPDATE`, [accountId]);
  const beforeBalance = before.rowCount ? Math.max(0, Number((before.rows[0] as { ingot: number | string }).ingot)) : 0;
  const res = await client.query(
    `UPDATE accounts SET ingot = GREATEST(0, ingot - $2) WHERE id = $1 RETURNING ingot`,
    [accountId, clawed],
  );
  const balance = Math.max(0, Number((res.rows[0] as { ingot: number | string }).ingot));
  return { balance, shortfall: Math.max(0, clawed - (beforeBalance - balance)) };
}

/** 退款（refund.created，Creem 在退款成功后发；事务内）：按比例回收，累计退满整单才置 refunded */
async function settleRefundInTx(client: pg.PoolClient, event: RefundEvent): Promise<SettleOutcome> {
  const refundCents = event.refundCents;
  const orderId = eventOrderId(event);
  if (!orderId) {
    return { status: 'ignored', orderId: null, reason: 'no_request_id' };
  }
  if (!Number.isInteger(refundCents) || refundCents <= 0) {
    return { status: 'ignored', orderId, reason: 'refund_amount_invalid' };
  }
  const order = await lockOrder(client, orderId);
  if (!order) {
    return { status: 'ignored', orderId, reason: 'order_not_found' };
  }
  if (order.status !== 'paid') {
    return { status: 'ignored', orderId, reason: `status_${order.status}` };
  }
  const amountPaidCents = event.amountPaidCents ?? order.usdCents;
  const clawed = clawbackIngots(refundCents, amountPaidCents, order.ingotAmount);
  const { balance, shortfall } = await clawback(client, order.accountId, clawed);
  const refundedCents = order.refundedCents + refundCents;
  const fullyRefunded = refundedCents >= amountPaidCents;
  await client.query(
    `UPDATE topup_orders
     SET refunded_cents = $2, clawback_short = clawback_short + $3, refunded_at = now(),
         status = CASE WHEN $4 THEN 'refunded' ELSE status END
     WHERE id = $1`,
    [order.id, refundedCents, shortfall, fullyRefunded],
  );
  await insertEvent(client, {
    accountId: order.accountId,
    type: EventType.TOPUP_REFUNDED,
    detail: {
      orderId: order.id,
      provider: order.provider,
      dispute: false,
      refundedCents,
      amountPaidCents,
      clawed,
      shortfall,
      balance,
      orderStatus: fullyRefunded ? 'refunded' : 'paid',
    },
  });
  return { status: 'refunded', orderId: order.id, accountId: order.accountId, clawed, shortfall, balance };
}

/** 拒付（dispute.created；事务内）：按整单回收，订单置 refunded（没有单独的 disputed 状态） */
async function settleDisputeInTx(client: pg.PoolClient, event: DisputeEvent): Promise<SettleOutcome> {
  const orderId = eventOrderId(event);
  if (!orderId) {
    return { status: 'ignored', orderId: null, reason: 'no_request_id' };
  }
  const order = await lockOrder(client, orderId);
  if (!order) {
    return { status: 'ignored', orderId, reason: 'order_not_found' };
  }
  if (order.status !== 'paid') {
    return { status: 'ignored', orderId, reason: `status_${order.status}` };
  }
  const amountPaidCents = event.amountPaidCents ?? order.usdCents;
  const clawed = order.ingotAmount;
  const { balance, shortfall } = await clawback(client, order.accountId, clawed);
  await client.query(
    `UPDATE topup_orders
     SET refunded_cents = GREATEST(refunded_cents, $2), clawback_short = clawback_short + $3,
         refunded_at = now(), status = 'refunded'
     WHERE id = $1`,
    [order.id, amountPaidCents, shortfall],
  );
  await insertEvent(client, {
    accountId: order.accountId,
    type: EventType.TOPUP_REFUNDED,
    detail: {
      orderId: order.id,
      provider: order.provider,
      dispute: true,
      refundedCents: amountPaidCents,
      amountPaidCents,
      clawed,
      shortfall,
      balance,
      orderStatus: 'refunded',
    },
  });
  return { status: 'refunded', orderId: order.id, accountId: order.accountId, clawed, shortfall, balance };
}

/** 单个回调的完整处理：同一事务里「事件去重 + 结算」。回调路由只调这一个函数 */
export async function handlePaymentEvent(
  pool: pg.Pool,
  event: PaymentEvent,
  provider: PaymentProvider,
): Promise<PaymentEventResult> {
  return inTransaction(pool, async (client) => {
    const orderId = eventOrderId(event);
    if (event.kind !== 'ignored' && event.eventId) {
      const fresh = await recordWebhookEvent(client, {
        provider: provider.provider,
        eventId: event.eventId,
        eventType: event.kind,
        orderId,
      });
      if (!fresh) {
        return { duplicate: true, outcome: { status: 'ignored', orderId, reason: 'duplicate' } };
      }
    }
    const outcome =
      event.kind === 'checkout_completed'
        ? await settleCheckoutInTx(client, event, provider)
        : event.kind === 'refund'
          ? await settleRefundInTx(client, event)
          : event.kind === 'dispute'
            ? await settleDisputeInTx(client, event)
            : ({ status: 'ignored', orderId: null, reason: `ignored_${event.eventType}` } as SettleOutcome);
    return { duplicate: false, outcome };
  });
}

/** 单独入账（测试与人工补单用；回调路径请用 handlePaymentEvent，它还会写去重表） */
export async function settleCheckoutCompleted(
  pool: pg.Pool,
  event: CheckoutEvent,
  provider: PaymentProvider,
): Promise<SettleOutcome> {
  return inTransaction(pool, (client) => settleCheckoutInTx(client, event, provider));
}

/** 单独处理退款（同上） */
export async function settleRefund(pool: pg.Pool, event: RefundEvent): Promise<SettleOutcome> {
  return inTransaction(pool, (client) => settleRefundInTx(client, event));
}

/** 单独处理拒付（同上） */
export async function settleDispute(pool: pg.Pool, event: DisputeEvent): Promise<SettleOutcome> {
  return inTransaction(pool, (client) => settleDisputeInTx(client, event));
}
