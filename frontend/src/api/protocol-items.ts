// 道具协议的类型（v90，AISLG-222；v108 AISLG-251 加元宝价与换季保留数）：GET_ITEMS（op 148）/ BUY_ITEM（op 149）；
// 推送复用 PUSH_ACCOUNT_STATE（reason = items_changed）。与后端 backend/common/src/protocol-items.ts 同构；
// 道具文案取 copy-items.ts，这里只放数据形状。

export type ItemId = 'city_order' | 'city_order_adv';

/** 付款货币（v108，AISLG-251）：礼金（缺省，换季清零）或元宝（永久，买的道具换季保留） */
export type ItemCurrency = 'gift' | 'ingot';

export interface ItemDefView {
  id: ItemId;
  name: string;
  nameEn: string;
  desc: string;
  descEn: string;
  kind: 'order';
  /** 礼金单价；null = 礼金不卖 */
  shopPrice: number | null;
  /** 元宝单价（v108）；null = 元宝不卖 */
  ingotPrice: number | null;
  stackMax: number;
}

export type ItemCounts = Record<ItemId, number>;

export interface GetItemsResponseData {
  items: ItemCounts;
  /** 每种道具里元宝买的张数（v108；换季保留这么多） */
  paidCounts: ItemCounts;
  catalog: ItemDefView[];
  gift: number;
  /** 元宝余额（v108） */
  ingot: number;
}

export interface BuyItemRequestData {
  itemId: ItemId;
  count: number;
  expectedPrice: number;
  /** 缺省 gift；选元宝时显式传 'ingot'（v108） */
  currency?: ItemCurrency;
}

export interface BuyItemResponseData {
  itemId: ItemId;
  bought: number;
  count: number;
  /** 购买后其中元宝买的张数（v108） */
  paidCount: number;
  /** 本次实际使用的货币（v108） */
  currency: ItemCurrency;
  price: number;
  cost: number;
  gift: number;
  /** 购买后的元宝余额（v108） */
  ingot: number;
}

/** PUSH_ACCOUNT_STATE（reason = items_changed）载荷 */
export interface ItemsStatePushData {
  reason: 'items_changed';
  items: ItemCounts;
  paidCounts: ItemCounts;
  gift: number;
  ingot: number;
}
