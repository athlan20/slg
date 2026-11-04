// 道具协议的类型（v90，AISLG-222）：GET_ITEMS（op 148）/ BUY_ITEM（op 149）；推送复用 PUSH_ACCOUNT_STATE（reason = items_changed）。
// 与后端 backend/common/src/protocol-items.ts 同构；道具文案取 copy-items.ts，这里只放数据形状。

export type ItemId = 'city_order' | 'city_order_adv';

export interface ItemDefView {
  id: ItemId;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  kind: 'order';
  /** 礼金单价；null = 不卖 */
  shopPrice: number | null;
  stackMax: number;
}

export type ItemCounts = Record<ItemId, number>;

export interface GetItemsResponseData {
  items: ItemCounts;
  catalog: ItemDefView[];
  gift: number;
}

export interface BuyItemRequestData {
  itemId: ItemId;
  count: number;
  expectedPrice: number;
}

export interface BuyItemResponseData {
  itemId: ItemId;
  bought: number;
  count: number;
  price: number;
  cost: number;
  gift: number;
}

/** PUSH_ACCOUNT_STATE（reason = items_changed）载荷 */
export interface ItemsStatePushData {
  reason: 'items_changed';
  items: ItemCounts;
  gift: number;
}
