// 道具协议的类型（AISLG-222，v90；v108 AISLG-251 加元宝价与换季保留数）：GET_ITEMS（op 148）与
// BUY_ITEM（op 149），推送复用 PUSH_ACCOUNT_STATE（op 2020，reason = items_changed）。
// 规则与配置见 common/src/items.ts，存取见 items-db.ts，购买事务见 api/src/handlers-items.ts。

import type { ItemCurrency, ItemId, ItemKind } from './items';

/** 道具定义（GET_ITEMS 的 catalog 项；shopPrice 为 null 表示不卖） */
export interface ItemDefView {
  id: ItemId;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  kind: ItemKind;
  /** 礼金单价（null = 礼金不卖） */
  shopPrice: number | null;
  /** 元宝单价（v108，AISLG-251；null = 元宝不卖） */
  ingotPrice: number | null;
  stackMax: number;
}

/** GET_ITEMS（op 148）响应：背包 + 道具目录 + 礼金余额 */
export interface GetItemsResponseData {
  /** 每种道具的数量（每种都有键，缺省 0；**总数**，与换季保留数无关） */
  items: Record<ItemId, number>;
  /** 每种道具里有多少张是元宝买的（换季保留这么多；v108，AISLG-251） */
  paidCounts: Record<ItemId, number>;
  /** 全部道具定义；商店出售的是 shopPrice 或 ingotPrice 非 null 的项 */
  catalog: ItemDefView[];
  /** 礼金余额 */
  gift: number;
  /** 元宝余额（v108，AISLG-251；永久保留、换季不清零） */
  ingot: number;
}

/** BUY_ITEM（op 149）请求 */
export interface BuyItemRequestData {
  itemId: ItemId;
  /** 1..99 的整数 */
  count: number;
  /** 玩家看到的单价：必须等于所选货币的当前单价，否则 ITEM_PRICE_CHANGED */
  expectedPrice: number;
  /** 用哪种货币付（v108，AISLG-251）：'gift'（缺省，旧客户端行为不变）或 'ingot'；不自动混用 */
  currency?: ItemCurrency;
}

/** BUY_ITEM（op 149）响应 */
export interface BuyItemResponseData {
  itemId: ItemId;
  /** 本次买入数量 */
  bought: number;
  /** 购买后该道具的总数量 */
  count: number;
  /** 购买后其中元宝买的张数（换季保留；用礼金买时不变） */
  paidCount: number;
  /** 本次实际使用的货币 */
  currency: ItemCurrency;
  /** 本次单价（所选货币） */
  price: number;
  /** 本次花费（price × bought，所选货币） */
  cost: number;
  /** 购买后的礼金余额 */
  gift: number;
  /** 购买后的元宝余额（v108，AISLG-251） */
  ingot: number;
}

/** PUSH_ACCOUNT_STATE（op 2020）的道具推送载荷（reason = items_changed，发给该账号其他在线连接） */
export interface ItemsStatePushData {
  reason: 'items_changed';
  items: Record<ItemId, number>;
  /** 每种道具里元宝买的张数（v108，AISLG-251） */
  paidCounts: Record<ItemId, number>;
  gift: number;
  /** 元宝余额（v108，AISLG-251） */
  ingot: number;
}
