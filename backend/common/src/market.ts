// 玩家交易所（v78，AISLG-196）的规则与数值：挂单 / 吃单 / 手续费 / 每日成交上限 / 商队。
// 参考价：四资源之间 1:1；4 资源 = 1 金币（与集市兑换 EXCHANGE_INPUT_PER_GOLD 一致）。
// 所有数值为需求给定值；调整需同步协议文档与测试。

import type { Resources } from './protocol';
import { EXCHANGE_INPUT_PER_GOLD } from './exchange';
import { scaledRate } from './time-scale';

/** 可交易的四种资源 */
export const MARKET_RESOURCES = ['food', 'wood', 'stone', 'iron'] as const;
export type MarketResource = (typeof MARKET_RESOURCES)[number];
/** 收取物：四种资源或金币 */
export const MARKET_BUY_KINDS = [...MARKET_RESOURCES, 'gold'] as const;
export type MarketBuyKind = (typeof MARKET_BUY_KINDS)[number];

export function isMarketResource(value: unknown): value is MarketResource {
  return typeof value === 'string' && (MARKET_RESOURCES as readonly string[]).includes(value);
}

export function isMarketBuyKind(value: unknown): value is MarketBuyKind {
  return typeof value === 'string' && (MARKET_BUY_KINDS as readonly string[]).includes(value);
}

/** 单张挂单最小卖出量 */
export const MARKET_MIN_AMOUNT = 1000;
/** 每个账号同时最多挂 5 张 */
export const MARKET_MAX_OPEN_ORDERS = 5;
/** 成交手续费比例（双方各扣 5%，系统回收） */
export const MARKET_FEE_PERCENT = 5;
/** 挂单有效期（现实时间 48 小时） */
export const MARKET_ORDER_TTL_MS = 48 * 3600 * 1000;
/** 每日成交上限 = 主城官府等级 × 本系数 × 全局时间缩放（按参考价折成资源，买卖合计） */
export const MARKET_DAILY_PER_GOVERNMENT = 3000;
/** 交易门槛：主城官府 ≥ 5，且不在新手保护期 */
export const MARKET_MIN_GOVERNMENT = 5;

/** 1 个资源值多少金币（参考价） */
export const MARKET_GOLD_PER_RESOURCE = 1 / EXCHANGE_INPUT_PER_GOLD;

/** 某资源按参考价折算成“资源单位”的价值：资源 1、金币 × 4 */
export function marketReferenceValue(kind: MarketBuyKind, amount: number): number {
  const value = Math.max(0, amount);
  return kind === 'gold' ? value * EXCHANGE_INPUT_PER_GOLD : value;
}

/** 单价下限 / 上限（每 1 个卖出资源换多少个收取物） */
export function marketPriceRange(buy: MarketBuyKind): { min: number; max: number } {
  if (buy === 'gold') {
    return { min: MARKET_GOLD_PER_RESOURCE * 0.5, max: MARKET_GOLD_PER_RESOURCE * 2 };
  }
  return { min: 0.5, max: 2 };
}

/** 单价是否允许（含边界，4 位小数） */
export function isPriceAllowed(buy: MarketBuyKind, price: number): boolean {
  if (!Number.isFinite(price)) {
    return false;
  }
  const { min, max } = marketPriceRange(buy);
  const rounded = Math.round(price * 10_000) / 10_000;
  return rounded >= min && rounded <= max;
}

/** 成交支付 = floor(数量 × 单价)；至少 1 */
export function marketPayment(quantity: number, unitPrice: number): number {
  return Math.max(1, Math.floor(Math.max(0, quantity) * Math.max(0, unitPrice)));
}

/** 扣 5% 手续费后实收（向下取整；手续费 = 原值 - 实收） */
export function marketAfterFee(amount: number): { delivered: number; fee: number } {
  const total = Math.max(0, Math.floor(amount));
  const delivered = Math.floor((total * (100 - MARKET_FEE_PERCENT)) / 100);
  return { delivered, fee: total - delivered };
}

/** 某官府等级的每日成交上限（基数，已 × 时间缩放） */
export function marketDailyLimit(governmentLevel: number): number {
  return Math.max(0, Math.floor(governmentLevel)) * MARKET_DAILY_PER_GOVERNMENT * scaledRate(1);
}

/** 判断某城的产出资源是否足够挂单 / 支付（Resources 视图，含金币） */
export function hasResources(resources: Resources, kind: MarketBuyKind, amount: number): boolean {
  return Math.max(0, Number(resources[kind] ?? 0)) >= amount;
}
