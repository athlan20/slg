// 道具背包的存取（AISLG-222，v90）：发放 grantItem、消耗 consumeItem、读取 loadItems。
// 三个写入函数都必须在调用方的事务里执行（它们写事件流，事件与数量变化同生共死）。
// 锁序：先锁 user_items 的行，再（若需要）锁 accounts 的行（spendGift）；消耗只锁 user_items。购买与消耗并发时不会死锁，数量不会变负。

import type pg from 'pg';
import { EventType } from './protocol-city';
import { insertEvent } from './events';
import { INSUFFICIENT_ITEM, isPositiveCount, isItemId, itemDef, emptyItems, type ItemId } from './items';

type Queryable = pg.Pool | pg.PoolClient;

export type ConsumeItemResult =
  | { ok: true; count: number }
  | { ok: false; code: typeof INSUFFICIENT_ITEM; count: number };

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
  await client.query(
    `INSERT INTO user_items (account_id, item_id, count) VALUES ($1, $2, 0)
     ON CONFLICT (account_id, item_id) DO NOTHING`,
    [accountId, itemId],
  );
  const res = await client.query(
    `SELECT count FROM user_items WHERE account_id = $1 AND item_id = $2 FOR UPDATE`,
    [accountId, itemId],
  );
  const row = res.rows[0] as { count: number | string } | undefined;
  return row ? Math.max(0, Number(row.count)) : 0;
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
 * 消耗道具（调用方事务内）：单条带条件的原子 UPDATE，count >= n 才扣。数量不足返回 INSUFFICIENT_ITEM，
 * 不扣、不写事件（其他数据不变）；成功写 ITEM_USED（detail = { itemId, amount, left, reason }）。
 * 并发时第二个请求在行锁上等第一个提交后重新判定，数量不会变负。
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
    `UPDATE user_items SET count = count - $3, updated_at = now()
     WHERE account_id = $1 AND item_id = $2 AND count >= $3
     RETURNING count`,
    [accountId, itemId, n],
  );
  if (res.rowCount === 0) {
    return { ok: false, code: INSUFFICIENT_ITEM, count: await loadItemCount(client, accountId, itemId) };
  }
  const left = Math.max(0, Number((res.rows[0] as { count: number | string }).count));
  await insertEvent(client, {
    accountId,
    type: EventType.ITEM_USED,
    detail: { itemId, amount: n, left, reason },
  });
  return { ok: true, count: left };
}
