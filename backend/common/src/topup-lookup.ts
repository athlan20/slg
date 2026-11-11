// 回调找订单（AISLG-251）：只用服务端订单表里保存的 id 去匹配，回调里的 id 只是「去哪一行找」的线索，
// 找到后账号归属、金额、元宝数一律以订单行为准。查找顺序：
//   ① request_id / metadata.orderId（创建结账时我们填进去的订单 uuid，必须是 uuid 才查）；
//   ② provider_checkout_id = 回调里的渠道结账会话 id（object.checkout.id）；
//   ③ provider_order_id = 回调里的渠道订单 id（object.order.id，入账时从 checkout.completed 存下）。
// ②③ 只给退款 / 拒付用：入账（checkout.completed）只认 ①，因为只有我们自己建过的订单才能入账，
// 不能让一个渠道订单 id 去匹配到别的已付款订单。
// 三者（入账时只有 ①）都对不上返回 null（调用方按 order_not_found 忽略，不改任何数据）。
// 本函数只读 id、不加锁：调用方随后用 lockOrder 按 id 加订单行锁并重读状态（锁序仍是先订单行、再 accounts 行）。

import type pg from 'pg';
import type { PaymentEvent } from './payments/types';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 回调里可用来找单的 id（checkout_completed 没有渠道结账会话 id 字段，记为 null） */
export interface OrderLookupKeys {
  /** request_id，缺失时用 metadata.orderId */
  orderIds: string[];
  providerCheckoutId: string | null;
  providerOrderId: string | null;
}

export function lookupKeysOf(event: Exclude<PaymentEvent, { kind: 'ignored' }>): OrderLookupKeys {
  const orderIds = [event.requestId, event.metadataOrderId].filter(
    (id, index, all): id is string => typeof id === 'string' && id.length > 0 && all.indexOf(id) === index,
  );
  return {
    orderIds,
    providerCheckoutId: ('providerCheckoutId' in event ? event.providerCheckoutId : null) ?? null,
    providerOrderId: event.providerOrderId ?? null,
  };
}

/** 按 ① ② ③ 的顺序找订单，返回服务端订单表里的 id；找不到返回 null */
export async function resolveTopupOrderId(
  client: pg.PoolClient,
  provider: string,
  event: PaymentEvent,
): Promise<string | null> {
  if (event.kind === 'ignored') {
    return null;
  }
  const keys = lookupKeysOf(event);
  for (const orderId of keys.orderIds) {
    if (!UUID_PATTERN.test(orderId)) {
      continue;
    }
    const hit = await client.query(`SELECT id FROM topup_orders WHERE id = $1`, [orderId]);
    if (hit.rowCount) {
      return orderId;
    }
  }
  if (event.kind === 'checkout_completed') {
    return null;
  }
  if (keys.providerCheckoutId) {
    const hit = await client.query(
      `SELECT id FROM topup_orders WHERE provider = $1 AND provider_checkout_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [provider, keys.providerCheckoutId],
    );
    if (hit.rowCount) {
      return (hit.rows[0] as { id: string }).id;
    }
  }
  if (keys.providerOrderId) {
    const hit = await client.query(
      `SELECT id FROM topup_orders WHERE provider = $1 AND provider_order_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [provider, keys.providerOrderId],
    );
    if (hit.rowCount) {
      return (hit.rows[0] as { id: string }).id;
    }
  }
  return null;
}
