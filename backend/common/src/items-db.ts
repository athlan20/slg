// 道具背包的存取（AISLG-222，v90；v108 AISLG-251 加 paid_count）：发放 grantItem / grantPaidItem、
// 消耗 consumeItem、读取 loadItems / loadPaidCounts。
// 三个写入函数都必须在调用方的事务里执行（它们写事件流，事件与数量变化同生共死）。
// 锁序：先锁 user_items 的行，再（若需要）锁 accounts 的行（spendGift / spendIngot）；消耗只锁 user_items。
// 购买与消耗并发时不会死锁，数量不会变负。
//
// paid_count（v108，AISLG-251）：user_items.count 是总数，paid_count 是其中「元宝买的」张数。
// 元宝买的道具换季保留（season-reset.ts 改成 count = paid_count），礼金买的 / 发放的照旧清零；
// count 与 paidCount 的语义（含堆叠上限 99）都只看 count，GET_STATE.items / GET_ITEMS.items 不变。

import type pg from 'pg';
import { EventType } from './protocol-city';
import { insertEvent } from './events';
import { INSUFFICIENT_ITEM, isPositiveCount, isItemId, itemDef, emptyItems, type ItemId } from './items';

type Queryable = pg.Pool | pg.PoolClient;

export type ConsumeItemResult =
  | { ok: true; count: number; paidCount: number }
  | { ok: false; code: typeof INSUFFICIENT_ITEM; count: number };

/** 一种道具的持有情况：count = 总数，paidCount = 其中元宝买的（换季保留）张数 */
export interface ItemStack {
  count: number;
  paidCount: number;
}

/** 账号持有的全部道具数量（每种道具都有键，缺省 0；表里的未知 id 忽略） */
export async function loadItems(q: Queryable, accountId: string): Promise<Record<ItemId, number>> {
  const res = await q.query(`SELECT item_id, count FROM user_items WHERE account_id = $1`, [accountId]);
  const items = emptyItems();
  for (const row of res.rows as Array<{ item_id: string; count: number | string }>) {
    if (isItemId(row.item_id)) {
      items[row.item_id] = Math.max(0, Number(row.count));
    }
  }
  return items;
}

/** 每种道具的 paidCount（元宝买的张数；缺省 0），用于 GET_ITEMS / GET_STATE 的「其中 N 张换季保留」 */
export async function loadPaidCounts(q: Queryable, accountId: string): Promise<Record<ItemId, number>> {
  const res = await q.query(`SELECT item_id, paid_count FROM user_items WHERE account_id = $1`, [accountId]);
  const paidCounts = emptyItems();
  for (const row of res.rows as Array<{ item_id: string; paid_count: number | string }>) {
    if (isItemId(row.item_id)) {
      paidCounts[row.item_id] = Math.max(0, Number(row.paid_count));
    }
  }
  return paidCounts;
}

/** 单种道具的当前数量（无行为 0） */
export async function loadItemCount(q: Queryable, accountId: string, itemId: ItemId): Promise<number> {
  const res = await q.query(`SELECT count FROM user_items WHERE account_id = $1 AND item_id = $2`, [accountId, itemId]);
  const row = res.rows[0] as { count: number | string } | undefined;
  return row ? Math.max(0, Number(row.count)) : 0;
}

/**
 * 加锁读一种道具的数量（无行时先建 0 行再锁，保证并发发放 / 购买串行，与计谋令的做法一致）。
 * 调用方事务内使用；返回的数量在本事务提交前不会被别的事务改。
 */
export async function lockItemCount(client: pg.PoolClient, accountId: string, itemId: ItemId): Promise<number> {
  return (await lockItemStack(client, accountId, itemId)).count;
}

/** 加锁读一种道具的 count 与 paid_count（无行时先建 0 行再锁；购买元宝道具用） */
export async function lockItemStack(client: pg.PoolClient, accountId: string, itemId: ItemId): Promise<ItemStack> {
  await client.query(
    `INSERT INTO user_items (account_id, item_id, count) VALUES ($1, $2, 0)
     ON CONFLICT (account_id, item_id) DO NOTHING`,
    [accountId, itemId],
  );
  const res = await client.query(
    `SELECT count, paid_count FROM user_items WHERE account_id = $1 AND item_id = $2 FOR UPDATE`,
    [accountId, itemId],
  );
  const row = res.rows[0] as { count: number | string; paid_count: number | string } | undefined;
  return row
    ? { count: Math.max(0, Number(row.count)), paidCount: Math.max(0, Number(row.paid_count)) }
    : { count: 0, paidCount: 0 };
}

/**
 * 发放道具（调用方事务内）：数量增加但不超过 stackMax，超出部分作废；返回实际增加数。
 * 无论是否全额都写 ITEM_GRANTED（detail = { itemId, requested, granted, reason }），便于事后看出作废量。
 * 未知 itemId / 非正整数 n 抛错（调用方错误，与 spendGift 一致）。
 */
export async function grantItem(
  client: pg.PoolClient,
  accountId: string,
  itemId: ItemId,
  n: number,
  reason: string,
): Promise<number> {
  const def = itemDef(itemId);
  if (!def) {
    throw new Error(`grantItem: 未知道具 ${String(itemId)}`);
  }
  if (!isPositiveCount(n)) {
    throw new Error(`grantItem: 数量必须是正整数，收到 ${n}`);
  }
  const have = await lockItemCount(client, accountId, itemId);
  const granted = Math.max(0, Math.min(n, def.stackMax - have));
  if (granted > 0) {
    await client.query(
      `UPDATE user_items SET count = count + $3, updated_at = now() WHERE account_id = $1 AND item_id = $2`,
      [accountId, itemId, granted],
    );
  }
  await insertEvent(client, {
    accountId,
    type: EventType.ITEM_GRANTED,
    detail: { itemId, requested: n, granted, reason },
  });
  return granted;
}

/**
 * 发放元宝买的道具（v108，AISLG-251，调用方事务内）：count 与 paid_count 同时加（这批换季保留），
 * 仍受 stackMax 限制（超出的部分作废，不额外扣元宝——调用方已按 stackMax 预检）。
 * 写 ITEM_GRANTED 事件，detail 多一个 paid = true。
 */
export async function grantPaidItem(
  client: pg.PoolClient,
  accountId: string,
  itemId: ItemId,
  n: number,
  reason: string,
): Promise<number> {
  const def = itemDef(itemId);
  if (!def) {
    throw new Error(`grantPaidItem: 未知道具 ${String(itemId)}`);
  }
  if (!isPositiveCount(n)) {
    throw new Error(`grantPaidItem: 数量必须是正整数，收到 ${n}`);
  }
  const have = await lockItemCount(client, accountId, itemId);
  const granted = Math.max(0, Math.min(n, def.stackMax - have));
  if (granted > 0) {
    await client.query(
      `UPDATE user_items SET count = count + $3, paid_count = paid_count + $3, updated_at = now()
       WHERE account_id = $1 AND item_id = $2`,
      [accountId, itemId, granted],
    );
  }
  await insertEvent(client, {
    accountId,
    type: EventType.ITEM_GRANTED,
    detail: { itemId, requested: n, granted, reason, paid: true },
  });
  return granted;
}

/**
 * 消耗道具（调用方事务内）：单条带条件的原子 UPDATE，count >= n 才扣。数量不足返回 INSUFFICIENT_ITEM，
 * 不扣、不写事件（其他数据不变）；成功写 ITEM_USED（detail = { itemId, amount, left, paidLeft, reason }）。
 * 并发时第二个请求在行锁上等第一个提交后重新判定，数量不会变负。
 *
 * 消耗顺序（v108，AISLG-251）：**优先消耗免费的那部分**（发放的 / 礼金买的 = count − paid_count），
 * 用完才动元宝买的 paid_count——对玩家最有利，元宝买的令尽量留到下一季。玩家不能指定先用哪部分。
 * 付费部分被扣的数量 = max(0, n − 可用的免费数)，paid_count 随之下调，count 仍是总数。
 */
export async function consumeItem(
  client: pg.PoolClient,
  accountId: string,
  itemId: ItemId,
  n: number,
  reason: string,
): Promise<ConsumeItemResult> {
  if (!itemDef(itemId)) {
    throw new Error(`consumeItem: 未知道具 ${String(itemId)}`);
  }
  if (!isPositiveCount(n)) {
    throw new Error(`consumeItem: 数量必须是正整数，收到 ${n}`);
  }
  const res = await client.query(
    `UPDATE user_items
     SET count = count - $3,
         paid_count = paid_count - GREATEST(0, $3 - (count - paid_count)),
         updated_at = now()
     WHERE account_id = $1 AND item_id = $2 AND count >= $3
     RETURNING count, paid_count`,
    [accountId, itemId, n],
  );
  if (res.rowCount === 0) {
    return { ok: false, code: INSUFFICIENT_ITEM, count: await loadItemCount(client, accountId, itemId) };
  }
  const row = res.rows[0] as { count: number | string; paid_count: number | string };
  const left = Math.max(0, Number(row.count));
  const paidLeft = Math.max(0, Number(row.paid_count));
  await insertEvent(client, {
    accountId,
    type: EventType.ITEM_USED,
    detail: { itemId, amount: n, left, paidLeft, reason },
  });
  return { ok: true, count: left, paidCount: paidLeft };
}
