// 玩家交易所（v78，AISLG-196）的前端协议镜像：与 backend/common/src/protocol-market.ts 同构。

export const MARKET_RESOURCES = ['food', 'wood', 'stone', 'iron'] as const;
export type MarketResource = (typeof MARKET_RESOURCES)[number];
export const MARKET_BUY_KINDS = [...MARKET_RESOURCES, 'gold'] as const;
export type MarketBuyKind = (typeof MARKET_BUY_KINDS)[number];

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
  mine: boolean;
}

export interface MarketTradeView {
  id: string;
  role: 'buy' | 'sell';
  other: { accountId: string; username: string };
  sellResource: MarketResource;
  buyResource: MarketBuyKind;
  quantity: number;
  paid: number;
  delivered: number;
  fee: number;
  createdAt: string;
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
  locked: boolean;
  lockedReason: 'government' | 'newbie' | null;
  priceRangeResource: { min: number; max: number };
  priceRangeGold: { min: number; max: number };
}

export interface GetMarketResponseData {
  orders: MarketOrderView[];
  page: number;
  pageSize: number;
  total: number;
  mine: { orders: MarketOrderView[]; trades: MarketTradeView[] };
  limits: MarketLimitsView;
}

export interface CreateMarketOrderResponseData {
  order: MarketOrderView;
  limits: MarketLimitsView;
}

export interface BuyMarketOrderResponseData {
  trade: MarketTradeView;
  remaining: number;
  limits: MarketLimitsView;
}

export interface CancelMarketOrderResponseData {
  orderId: string;
  refunded: number;
  resource: MarketResource;
  limits: MarketLimitsView;
}
