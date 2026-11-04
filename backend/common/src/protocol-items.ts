// 道具协议的类型（AISLG-222，v90）：GET_ITEMS（op 148）与 BUY_ITEM（op 149），推送复用 PUSH_ACCOUNT_STATE（op 2020，reason = items_changed）。
// 规则与配置见 common/src/items.ts，存取见 items-db.ts，购买事务见 api/src/handlers-items.ts。

import type { ItemId, ItemKind } from './items';

/** 道具定义（GET_ITEMS 的 catalog 项；shopPrice 为 null 表示不卖） */
export interface ItemDefView {
  id: ItemId;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  kind: ItemKind;
  shopPrice: number | null;
  stackMax: number;
}

/** GET_ITEMS（op 148）响应：背包 + 道具目录 + 礼金余额 */
export interface GetItemsResponseData {
  /** 每种道具的数量（每种都有键，缺省 0） */
  items: Record<ItemId, number>;
  /** 全部道具定义；商店出售的是 shopPrice 非 null 的项 */
  catalog: ItemDefView[];
  /** 礼金余额 */
  gift: number;
}

/** BUY_ITEM（op 149）请求 */
export interface BuyItemRequestData {
  itemId: ItemId;
  /** 1..99 的整数 */
  count: number;
  /** 玩家看到的单价（礼金）：必须等于当前 shopPrice，否则 ITEM_PRICE_CHANGED */
  expectedPrice: number;
}

/** BUY_ITEM（op 149）响应 */
export interface BuyItemResponseData {
  itemId: ItemId;
  /** 本次买入数量 */
  bought: number;
  /** 购买后该道具的总数量 */
  count: number;
  /** 本次单价 */
  price: number;
  /** 本次花费（price × bought） */
  cost: number;
  /** 购买后的礼金余额 */
  gift: number;
}

/** PUSH_ACCOUNT_STATE（op 2020）的道具推送载荷（reason = items_changed，发给该账号其他在线连接） */
export interface ItemsStatePushData {
  reason: 'items_changed';
  items: Record<ItemId, number>;
  gift: number;
}
