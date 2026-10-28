// 英文文案孪生：copy-market.ts 的英文版；satisfies 校验结构与函数签名一致。

import type { MARKET_COPY } from './copy-market';

export const MARKET_COPY_EN = {
  launcher: {
    open: 'Market',
    title: 'Player Market',
  },
  tabs: {
    orders: 'Orders',
    mine: 'Mine',
    create: 'Sell',
  },
  filters: {
    sell: 'Sell',
    buy: 'Receive',
    all: 'All',
    apply: 'Filter',
    reset: 'Reset',
  },
  list: {
    empty: 'No matching orders',
    remaining: (n: number) => `${n} left`,
    price: (price: number, sell: string, buy: string) => `1 ${sell} → ${price} ${buy}`,
    seller: (name: string) => `Seller ${name}`,
    allyOnly: 'Allies only',
    expires: (time: string) => `Expires ${time}`,
    buy: 'Buy',
  },
  buy: {
    title: 'Buy',
    quantity: 'Quantity',
    hint: (max: number) => `Max ${max}`,
    cost: (amount: number, kind: string) => `Cost: ${amount} ${kind}`,
    submit: 'Confirm buy',
    done: 'Traded — caravans are on the way',
    pick: 'Pick an order from the list first',
  },
  create: {
    title: 'Create sell order',
    sell: 'Sell resource',
    buy: 'Receive',
    amount: 'Amount',
    price: 'Unit price',
    priceHint: (min: number, max: number, sell: string, buy: string) => `How many ${buy} per 1 ${sell}; range ${min}–${max}`,
    allyOnly: 'Allies only',
    submit: 'Create order',
    done: 'Order created; resources are frozen',
    min: (n: number) => `At least ${n}`,
  },
  mine: {
    orders: 'My orders',
    trades: 'Trades',
    empty: 'Nothing yet',
    cancel: 'Cancel',
    cancelled: 'Order cancelled; resources refunded',
    status: (status: string) => status,
    tradeRow: (role: string, name: string, quantity: number, sell: string, buy: string, paid: number) =>
      `${role === 'buy' ? 'Bought' : 'Sold'} ${quantity} ${sell} · ${role === 'buy' ? `paid ${paid} ${buy}` : `received ${paid} ${buy}`} · ${name}`,
    delivered: 'Delivered',
    delivering: 'Caravan en route',
  },
  limits: {
    title: 'Trading limits',
    line: (active: number, max: number, used: number, limit: number) => `Open ${active}/${max} · traded today ${used}/${limit}`,
    lockedGovernment: 'Requires Main City Government level 5',
    lockedNewbie: 'Unavailable during newbie protection',
    fee: (percent: number) => `Both sides pay a ${percent}% fee`,
  },
  errors: {
    fallback: 'Trading failed, please retry',
    MARKET_LOCKED: 'Requires Main City Government level 5 and no newbie protection',
    PRICE_OUT_OF_RANGE: (min: number, max: number) => `Price out of range (${min}–${max})`,
    ORDER_LIMIT: 'You already have 5 open orders',
    DAILY_TRADE_LIMIT: (remaining: number) => `Daily trade limit reached; ${remaining} left`,
    ORDER_NOT_FOUND: 'Order not found, sold out, or expired',
    MARKET_ALLY_ONLY: 'This order is limited to alliance members',
    ORDER_NOT_CANCELLABLE: 'Order is sold out or expired',
    INSUFFICIENT_RESOURCES: 'Not enough resources',
    INVALID_PARAMS: 'Invalid parameters',
  },
  close: 'Close',
} satisfies typeof MARKET_COPY;
