// 玩家交易所（v78，AISLG-196）的协议类型：查询挂单 / 挂单 / 吃单 / 撤单 / 我的挂单与成交记录。

import type { MarketBuyKind, MarketResource } from './market';

export interface MarketSellerView {
  accountId: string;
  username: string;
  nobility: number;
  nobilityName: string;
  allianceId: string | null;
  allianceName: string | null;
}

export interface MarketCityView {
  id: string;
  name: string;
  x: number | null;
  y: number | null;
}

/** 挂单视图 */
export interface MarketOrderView {
  id: string;
  seller: MarketSellerView;
  city: MarketCityView;
  sellResource: MarketResource;
  buyResource: MarketBuyKind;
  total: number;
  remaining: number;
  unitPrice: number;
  allyOnly: boolean;
  createdAt: string;
  expiresAt: string;
  /** 是否是我的挂单 */
  mine: boolean;
}

/** 成交记录（我的视角：买入 / 卖出） */
export interface MarketTradeView {
  id: string;
  role: 'buy' | 'sell';
  other: { accountId: string; username: string };
  sellResource: MarketResource;
  buyResource: MarketBuyKind;
  quantity: number;
  /** 我付出的（买入）或收到的（卖出，扣手续费前）数量 */
  paid: number;
  /** 实际发货数量（扣 5% 手续费后） */
  delivered: number;
  fee: number;
  createdAt: string;
  /** 商队是否已送达（买入方看货物商队、卖出方看货款商队；两者都送达才算完成） */
  deliveredAt: string | null;
}

export interface MarketLimitsView {
  minAmount: number;
  maxOpenOrders: number;
  activeOrders: number;
  feePercent: number;
  government: number;
  dailyLimit: number;
  dailyUsed: number;
  dailyRemaining: number;
  /** 当前是否被交易门槛锁住（主城官府 < 5 或新手保护期） */
  locked: boolean;
  lockedReason: 'government' | 'newbie' | null;
  /** 四资源之间的单价范围与「收金币」的单价范围 */
  priceRangeResource: { min: number; max: number };
  priceRangeGold: { min: number; max: number };
}

/** GET_MARKET 请求：可按卖出 / 收取资源筛选与分页 */
export interface GetMarketRequestData {
  sellResource?: MarketResource;
  buyResource?: MarketBuyKind;
  page?: number;
}

export interface GetMarketResponseData {
  orders: MarketOrderView[];
  page: number;
  pageSize: number;
  total: number;
  mine: {
    orders: MarketOrderView[];
    trades: MarketTradeView[];
  };
  limits: MarketLimitsView;
}

export interface CreateMarketOrderRequestData {
  sellResource: MarketResource;
  buyResource: MarketBuyKind;
  amount: number;
  unitPrice: number;
  allyOnly?: boolean;
}

export interface CreateMarketOrderResponseData {
  order: MarketOrderView;
  limits: MarketLimitsView;
}

export interface BuyMarketOrderRequestData {
  orderId: string;
  quantity: number;
}

export interface BuyMarketOrderResponseData {
  trade: MarketTradeView;
  /** 成交后挂单剩余量（0 = 已售罄） */
  remaining: number;
  limits: MarketLimitsView;
}

export interface CancelMarketOrderRequestData {
  orderId: string;
}

export interface CancelMarketOrderResponseData {
  orderId: string;
  refunded: number;
  resource: MarketResource;
  limits: MarketLimitsView;
}
