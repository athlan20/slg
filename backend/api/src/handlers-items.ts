// 道具（AISLG-222，v90）：GET_ITEMS（op 148）与 BUY_ITEM（op 149）。
// BUY_ITEM 的校验顺序：itemId 在目录里且可卖 → count 合法 → expectedPrice 存在且为非负整数 → expectedPrice 等于当前单价
// → 购买后不超过 stackMax → 扣礼金（spendGift）→ 发道具（grantItem）→ 写 ITEM_BOUGHT。全部在一个事务里，失败都不扣礼金、不加道具。
// 锁序：先锁 user_items 行（lockItemCount），再锁 accounts 行（spendGift）。
// 数量变化后推 PUSH_ACCOUNT_STATE（reason = items_changed）给该账号其他在线连接；pushItemsState 也供 AISLG-220 的消耗方调用。

import { Op, EventType } from '../../common/src/protocol';
import { BUY_COUNT_MAX, BUY_COUNT_MIN, ITEM_DEFS, itemDef, isItemId } from '../../common/src/items';
import { grantItem, loadItems, lockItemCount } from '../../common/src/items-db';
import { loadGift, spendGift } from '../../common/src/gift-db';
import { insertEvent } from '../../common/src/events';
import type { ItemDefView, GetItemsResponseData, BuyItemResponseData, ItemsStatePushData } from '../../common/src/protocol';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** 道具定义视图（GET_ITEMS 的 catalog） */
export function itemCatalogView(): ItemDefView[] {
  return ITEM_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    nameEn: def.nameEn,
    desc: def.desc,
    descEn: def.descEn,
    kind: def.kind,
    shopPrice: def.shopPrice,
    stackMax: def.stackMax,
  }));
}

/** 向账号的其他在线连接推送背包与礼金余额（快照在调用前已提交；发起连接用 except 排除，它的直接响应里已带） */
export async function pushItemsState(ctx: HandlerContext, accountId: string, except?: ConnInfo): Promise<void> {
  const data: ItemsStatePushData = {
    reason: 'items_changed',
    items: await loadItems(ctx.pool, accountId),
    gift: await loadGift(ctx.pool, accountId),
  };
  ctx.registry.broadcast(accountId, { op: Op.PUSH_ACCOUNT_STATE, push: true, data: data as unknown as Record<string, unknown> }, except);
}

/** GET_ITEMS（op 148）：只读，不开事务 */
export async function handleGetItems(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const accountId = conn.accountId as string;
  const data: GetItemsResponseData = {
    items: await loadItems(ctx.pool, accountId),
    catalog: itemCatalogView(),
    gift: await loadGift(ctx.pool, accountId),
  };
  respondOk(ctx.registry, conn, op, seq, data as unknown as Record<string, unknown>);
}

/** BUY_ITEM（op 149）：礼金买道具，校验顺序见文件头 */
export async function handleBuyItem(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const rawItemId = data?.itemId;
  const rawCount = data?.count;
  const rawExpected = data?.expectedPrice;

  // 1. itemId 在目录里且可卖（未知或不卖都是参数错误）
  const def = isItemId(rawItemId) ? itemDef(rawItemId) : null;
  if (!def || def.shopPrice === null) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  // 2. count 为 1..99 的整数
  if (typeof rawCount !== 'number' || !Number.isInteger(rawCount) || rawCount < BUY_COUNT_MIN || rawCount > BUY_COUNT_MAX) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  // expectedPrice 必填，为非负整数（缺失即参数错误）
  if (typeof rawExpected !== 'number' || !Number.isInteger(rawExpected) || rawExpected < 0) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  // 3. expectedPrice 与当前单价一致（不一致则不扣不改，客户端刷新后让玩家重新确认）
  const price = def.shopPrice;
  if (rawExpected !== price) {
    respondError(ctx.registry, conn, op, seq, 'ITEM_PRICE_CHANGED', { price });
    return;
  }

  const count = rawCount;
  const cost = price * count;
  const client = await ctx.pool.connect();
  let result: BuyItemResponseData | undefined;
  try {
    await client.query('BEGIN');
    // 4. 购买后不超过堆叠上限（行锁下读数量，并发购买不会超限）
    const have = await lockItemCount(client, accountId, def.id);
    if (have + count > def.stackMax) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ITEM_STACK_FULL', {
        stackMax: def.stackMax,
        have,
        canBuy: Math.max(0, def.stackMax - have),
      });
      return;
    }
    // 5. 扣礼金（余额不足：回滚，不加道具）
    const spent = await spendGift(client, accountId, cost, `buy:${def.id}`);
    if (!spent.ok) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_GIFT', { balance: spent.balance, cost });
      return;
    }
    // 6. 发道具（上限已在第 4 步校验，这里必然全额）并写 ITEM_BOUGHT
    const granted = await grantItem(client, accountId, def.id, count, 'buy');
    const owned = have + granted;
    await insertEvent(client, {
      accountId,
      type: EventType.ITEM_BOUGHT,
      initiator: conn.role,
      detail: { itemId: def.id, count: granted, price, cost, owned, gift: spent.balance },
    });
    await client.query('COMMIT');
    result = { itemId: def.id, bought: granted, count: owned, price, cost, gift: spent.balance };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  if (!result) {
    return;
  }
  respondOk(ctx.registry, conn, op, seq, result as unknown as Record<string, unknown>);
  await pushItemsState(ctx, accountId, conn);
}
