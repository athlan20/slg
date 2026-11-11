// 充值订单的存取与限额（AISLG-251，v108）：创建待支付订单（含月限额 / 每小时订单数 / 作废旧 pending）、
// 记录结账会话 id、作废、按 id 读、Worker 的 24 小时作废、回调事件去重。
// 入账与退款回收的结算逻辑在 topup-settle.ts（那里要改订单 + 账号余额 + 事件流，必须同一事务）。
// 锁序（与需求单一致）：订单行 → accounts 行。创建订单先锁旧 pending 行（UPDATE）、再锁账号行；
// 结算先锁订单行、再锁账号行——两条路径顺序一致，不会互相死锁。

import type pg from 'pg';
import {
  TOPUP_HOURLY_MAX,
  TOPUP_HOURLY_WINDOW_MS,
  TOPUP_MONTHLY_LIMIT,
  TOPUP_MONTHLY_MAX,
  TOPUP_ORDER_TTL_MS,
  TOPUP_TOO_MANY_PENDING,
  utcMonthStart,
  type TopupOrderStatus,
  type TopupProduct,
} from './ingot';

type Queryable = pg.Pool | pg.PoolClient;

export interface TopupOrder {
  id: string;
  accountId: string;
  productId: string;
  usdCents: number;
  ingotAmount: number;
  status: TopupOrderStatus;
  provider: string;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
  createdAt: Date;
  paidAt: Date | null;
  refundedAt: Date | null;
  clawbackShort: number;
  refundedCents: number;
}

/** 订单行的原始列（topup-settle 的 FOR UPDATE 读取共用） */
export interface RawOrderRow {
  id: string;
  account_id: string;
  product_id: string;
  usd_cents: number | string;
  ingot_amount: number | string;
  status: string;
  provider: string;
  provider_checkout_id: string | null;
  provider_order_id: string | null;
  created_at: Date;
  paid_at: Date | null;
  refunded_at: Date | null;
  clawback_short: number | string;
  refunded_cents: number | string;
}

const ORDER_COLUMNS = `id, account_id, product_id, usd_cents, ingot_amount, status, provider,
  provider_checkout_id, provider_order_id, created_at, paid_at, refunded_at, clawback_short, refunded_cents`;

export function topupOrderFromRow(row: RawOrderRow): TopupOrder {
  return {
    id: row.id,
    accountId: row.account_id,
    productId: row.product_id,
    usdCents: Number(row.usd_cents),
    ingotAmount: Number(row.ingot_amount),
    status: row.status as TopupOrderStatus,
    provider: row.provider,
    providerCheckoutId: row.provider_checkout_id,
    providerOrderId: row.provider_order_id,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    refundedAt: row.refunded_at,
    clawbackShort: Number(row.clawback_short),
    refundedCents: Number(row.refunded_cents),
  };
}

/** 按 id 读订单（不存在返回 null） */
export async function loadTopupOrder(q: Queryable, orderId: string): Promise<TopupOrder | null> {
  const res = await q.query(`SELECT ${ORDER_COLUMNS} FROM topup_orders WHERE id = $1`, [orderId]);
  return res.rowCount ? topupOrderFromRow(res.rows[0] as RawOrderRow) : null;
}

/** 账号的全部订单（新→旧；测试与对账用） */
export async function listTopupOrders(q: Queryable, accountId: string): Promise<TopupOrder[]> {
  const res = await q.query(`SELECT ${ORDER_COLUMNS} FROM topup_orders WHERE account_id = $1 ORDER BY created_at DESC`, [
    accountId,
  ]);
  return (res.rows as RawOrderRow[]).map(topupOrderFromRow);
}

export type CreateTopupOrderResult =
  | { ok: true; orderId: string }
  | { ok: false; code: typeof TOPUP_MONTHLY_LIMIT; used: number; limit: number }
  | { ok: false; code: typeof TOPUP_TOO_MANY_PENDING; used: number; limit: number };

/**
 * 创建待支付订单（调用方事务内）。顺序：
 * ① 把本账号旧的 pending 订单置 expired（同时拿到它们的行锁，锁序在最前）；
 * ② 锁账号行（同一账号的并发下单串行化，限额判定不会被并发绕过）；
 * ③ 本月（UTC）已入账的订单数 ≥ 10 → TOPUP_MONTHLY_LIMIT；
 * ④ 最近 1 小时创建的订单数 ≥ 5 → TOPUP_TOO_MANY_PENDING；
 * ⑤ 插入新的 pending 行。金额与元宝数一律取服务端配置（product），不看客户端。
 */
export async function createPendingTopupOrder(
  client: pg.PoolClient,
  params: { accountId: string; product: TopupProduct; provider: string; now?: Date },
): Promise<CreateTopupOrderResult> {
  const now = params.now ?? new Date();
  await client.query(`UPDATE topup_orders SET status = 'expired' WHERE account_id = $1 AND status = 'pending'`, [
    params.accountId,
  ]);
  await client.query(`SELECT id FROM accounts WHERE id = $1 FOR UPDATE`, [params.accountId]);

  const monthUsed = await client.query(
    `SELECT count(*)::int AS n FROM topup_orders WHERE account_id = $1 AND paid_at IS NOT NULL AND paid_at >= $2`,
    [params.accountId, utcMonthStart(now)],
  );
  const paidThisMonth = Number((monthUsed.rows[0] as { n: number }).n);
  if (paidThisMonth >= TOPUP_MONTHLY_MAX) {
    return { ok: false, code: TOPUP_MONTHLY_LIMIT, used: paidThisMonth, limit: TOPUP_MONTHLY_MAX };
  }
  const hourUsed = await client.query(
    `SELECT count(*)::int AS n FROM topup_orders WHERE account_id = $1 AND created_at >= $2`,
    [params.accountId, new Date(now.getTime() - TOPUP_HOURLY_WINDOW_MS)],
  );
  const createdLastHour = Number((hourUsed.rows[0] as { n: number }).n);
  if (createdLastHour >= TOPUP_HOURLY_MAX) {
    return { ok: false, code: TOPUP_TOO_MANY_PENDING, used: createdLastHour, limit: TOPUP_HOURLY_MAX };
  }
  const inserted = await client.query(
    `INSERT INTO topup_orders (account_id, product_id, usd_cents, ingot_amount, status, provider)
     VALUES ($1, $2, $3, $4, 'pending', $5) RETURNING id`,
    [params.accountId, params.product.id, params.product.usdCents, params.product.ingot, params.provider],
  );
  return { ok: true, orderId: (inserted.rows[0] as { id: string }).id };
}

/** 记下渠道返回的结账会话 id（渠道调用成功后立刻写） */
export async function setTopupCheckoutId(q: Queryable, orderId: string, checkoutId: string): Promise<void> {
  await q.query(`UPDATE topup_orders SET provider_checkout_id = $2 WHERE id = $1`, [orderId, checkoutId]);
}

/** 作废一个待支付订单（渠道调用失败时用：不留 pending） */
export async function expireTopupOrder(q: Queryable, orderId: string): Promise<void> {
  await q.query(`UPDATE topup_orders SET status = 'expired' WHERE id = $1 AND status = 'pending'`, [orderId]);
}

/** Worker 定时任务：把超过 24 小时仍未支付的订单置 expired；返回处理条数 */
export async function expireStaleTopupOrders(pool: pg.Pool, now: Date = new Date()): Promise<number> {
  const res = await pool.query(
    `UPDATE topup_orders SET status = 'expired'
     WHERE status = 'pending' AND created_at < $1`,
    [new Date(now.getTime() - TOPUP_ORDER_TTL_MS)],
  );
  return res.rowCount ?? 0;
}

/**
 * 记录一条回调事件用于去重（provider + event_id 联合唯一）。
 * 返回 true = 本次是新事件（继续处理）；false = 之前已经处理过（直接回 200，不重复入账）。
 * 注意：后台手动重发的事件会换新的 event_id，所以入账还要看订单状态（见 topup-settle.ts）。
 */
export async function recordWebhookEvent(
  q: Queryable,
  event: { provider: string; eventId: string; eventType: string; orderId: string | null },
): Promise<boolean> {
  const res = await q.query(
    `INSERT INTO payment_webhook_events (provider, event_id, event_type, order_id)
     VALUES ($1, $2, $3, $4) ON CONFLICT (provider, event_id) DO NOTHING`,
    [event.provider, event.eventId, event.eventType, event.orderId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 回调事件是否已记录过（测试与排查用） */
export async function hasWebhookEvent(q: Queryable, provider: string, eventId: string): Promise<boolean> {
  const res = await q.query(`SELECT 1 FROM payment_webhook_events WHERE provider = $1 AND event_id = $2`, [provider, eventId]);
  return (res.rowCount ?? 0) > 0;
}
