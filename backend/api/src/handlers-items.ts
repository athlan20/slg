// 道具（AISLG-222，v90；v108 AISLG-251 加元宝支付）：GET_ITEMS（op 148）与 BUY_ITEM（op 149）。
// BUY_ITEM 的校验顺序：itemId 在目录里且所选货币可卖 → count 合法 → expectedPrice 存在且为非负整数
// → expectedPrice 等于所选货币的当前单价 → 购买后不超过 stackMax → 扣所选货币（礼金 spendGift / 元宝 spendIngot）
// → 发道具（礼金 grantItem 只加 count；元宝 grantPaidItem 同时加 paid_count）→ 写 ITEM_BOUGHT。
// 全部在一个事务里，失败都不扣货币、不加道具。**不自动混用两种货币**：选哪种就只扣哪种。
// 锁序：先锁 user_items 行（lockItemStack），再锁 accounts 行（spendGift / spendIngot）。
// 数量变化后推 PUSH_ACCOUNT_STATE（reason = items_changed）给该账号其他在线连接；pushItemsState 也供 AISLG-220 的消耗方调用。

import { Op, EventType } from '../../common/src/protocol';
import {
  BUY_COUNT_MAX,
  BUY_COUNT_MIN,
  ITEM_DEFS,
  isItemCurrency,
  isItemId,
  itemDef,
  itemPrice,
  type ItemCurrency,
} from '../../common/src/items';
import { grantItem, grantPaidItem, loadItems, loadPaidCounts, lockItemStack } from '../../common/src/items-db';
import { loadGift, spendGift } from '../../common/src/gift-db';
import { loadIngot, spendIngot } from '../../common/src/ingot-db';
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
    ingotPrice: def.ingotPrice,
    stackMax: def.stackMax,
  }));
}

/** 向账号的其他在线连接推送背包与两种货币余额（快照在调用前已提交；发起连接用 except 排除，它的直接响应里已带） */
export async function pushItemsState(ctx: HandlerContext, accountId: string, except?: ConnInfo): Promise<void> {
  const data: ItemsStatePushData = {
    reason: 'items_changed',
    items: await loadItems(ctx.pool, accountId),
    paidCounts: await loadPaidCounts(ctx.pool, accountId),
    gift: await loadGift(ctx.pool, accountId),
    ingot: await loadIngot(ctx.pool, accountId),
  };
  ctx.registry.broadcast(accountId, { op: Op.PUSH_ACCOUNT_STATE, push: true, data: data as unknown as Record<string, unknown> }, except);
}

/** GET_ITEMS（op 148）：只读，不开事务 */
export async function handleGetItems(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const accountId = conn.accountId as string;
  const data: GetItemsResponseData = {
    items: await loadItems(ctx.pool, accountId),
    paidCounts: await loadPaidCounts(ctx.pool, accountId),
    catalog: itemCatalogView(),
    gift: await loadGift(ctx.pool, accountId),
    ingot: await loadIngot(ctx.pool, accountId),
  };
  respondOk(ctx.registry, conn, op, seq, data as unknown as Record<string, unknown>);
}

/** BUY_ITEM（op 149）：用礼金或元宝买道具，校验顺序见文件头 */
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
  const rawCurrency = data?.currency;

  // 0. currency 可选：缺省 gift（旧客户端行为不变）；给了就必须是 gift / ingot
  if (rawCurrency !== undefined && rawCurrency !== null && !isItemCurrency(rawCurrency)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const currency: ItemCurrency = isItemCurrency(rawCurrency) ? rawCurrency : 'gift';

  // 1. itemId 在目录里且该货币可卖（未知或不卖都是参数错误）
  const def = isItemId(rawItemId) ? itemDef(rawItemId) : null;
  const price = def ? itemPrice(def, currency) : null;
  if (!def || price === null) {
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
  // 3. expectedPrice 与所选货币的当前单价一致（不一致则不扣不改，客户端刷新后让玩家重新确认）
  if (rawExpected !== price) {
    respondError(ctx.registry, conn, op, seq, 'ITEM_PRICE_CHANGED', { price, currency });
    return;
  }

  const count = rawCount;
  const cost = price * count;
  const client = await ctx.pool.connect();
  let result: BuyItemResponseData | undefined;
  try {
    await client.query('BEGIN');
    // 4. 购买后不超过堆叠上限（行锁下读数量，并发购买不会超限；上限按 count 总数算）
    const have = await lockItemStack(client, accountId, def.id);
    if (have.count + count > def.stackMax) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ITEM_STACK_FULL', {
        stackMax: def.stackMax,
        have: have.count,
        canBuy: Math.max(0, def.stackMax - have.count),
      });
      return;
    }
    // 5. 扣所选货币（余额不足：回滚，不加道具）
    const spent =
      currency === 'ingot'
        ? await spendIngot(client, accountId, cost, `buy:${def.id}`)
        : await spendGift(client, accountId, cost, `buy:${def.id}`);
    if (!spent.ok) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, currency === 'ingot' ? 'INSUFFICIENT_INGOT' : 'INSUFFICIENT_GIFT', {
        balance: spent.balance,
        cost,
        currency,
      });
      return;
    }
    // 6. 发道具（上限已在第 4 步校验，这里必然全额）并写 ITEM_BOUGHT
    //    元宝买的 count 与 paid_count 同时加（换季保留），礼金买的只加 count
    const granted =
      currency === 'ingot'
        ? await grantPaidItem(client, accountId, def.id, count, 'buy')
        : await grantItem(client, accountId, def.id, count, 'buy');
    const owned = have.count + granted;
    const paidCount = currency === 'ingot' ? have.paidCount + granted : have.paidCount;
    const balances = {
      gift: currency === 'gift' ? spent.balance : await loadGift(client, accountId),
      ingot: currency === 'ingot' ? spent.balance : await loadIngot(client, accountId),
    };
    await insertEvent(client, {
      accountId,
      type: EventType.ITEM_BOUGHT,
      initiator: conn.role,
      detail: {
        itemId: def.id,
        count: granted,
        price,
        cost,
        currency,
        owned,
        paidCount,
        gift: balances.gift,
        ingot: balances.ingot,
      },
    });
    await client.query('COMMIT');
    result = {
      itemId: def.id,
      bought: granted,
      count: owned,
      paidCount,
      currency,
      price,
      cost,
      gift: balances.gift,
      ingot: balances.ingot,
    };
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
