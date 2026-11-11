// 英文文案孪生（AISLG-222；v108 AISLG-251）：copy-items.ts 的英文版；satisfies 校验结构与函数签名一致。
import { ITEM_COPY } from './copy-items';

export const ITEM_COPY_EN = {
  menu: 'Bag / Shop',
  title: 'Bag and shop',
  tabBag: 'Bag',
  tabShop: 'Shop',
  balanceGift: (balance: number) => `Gift ${balance} (reset each season)`,
  names: {
    city_order: 'City Move Order',
    city_order_adv: 'Advanced City Move Order',
  },
  descs: {
    city_order: 'Uses 1 order to relocate the city once to a random spot.',
    city_order_adv: 'Uses 1 order to relocate the city once to chosen coordinates.',
  },
  owned: (count: number) => `Owned ${count}`,
  paidKept: (count: number) => `${count} kept across seasons`,
  price: (price: number) => `${price} gift`,
  priceIngot: (price: number) => `${price} ingots`,
  currencyChoice: 'Pay with',
  currencyGift: 'Gift',
  currencyIngot: 'Ingots',
  currencyNotSold: 'Not accepted',
  stackMax: (max: number) => `Stack limit ${max}`,
  qty: 'Qty',
  qtyDown: 'Decrease quantity',
  qtyUp: 'Increase quantity',
  buy: 'Buy',
  reasonFull: 'Stack limit reached',
  reasonGift: 'Not enough gift credits',
  reasonIngot: 'Not enough ingots. You can top up first.',
  seasonNote: 'Items bought with gift credits are cleared at each season change; items bought with ingots are kept',
  priceChanged: (price: number, currency: 'gift' | 'ingot') =>
    `The price is now ${price} ${currency === 'ingot' ? 'ingots' : 'gift credits'}. Please confirm again.`,
  bought: (name: string, count: number, gift: number) => `Bought ${name} × ${count}, ${gift} gift credits left`,
  boughtIngot: (name: string, count: number, ingot: number) => `Bought ${name} × ${count} with ingots, ${ingot} ingots left`,
  shopEmpty: 'Nothing to buy right now',
  loading: 'Loading…',
  errors: {
    INVALID_PARAMS: 'Invalid request. Refresh and try again.',
    INSUFFICIENT_GIFT: 'Not enough gift credits (1000 per season, reset at each season change)',
    INSUFFICIENT_INGOT: 'Not enough ingots. You can top up first.',
    INSUFFICIENT_ITEM: 'Not enough of this item',
    ITEM_STACK_FULL: 'This item is at its stack limit. Lower the quantity.',
    ITEM_PRICE_CHANGED: 'The price has changed. Refresh and confirm again.',
    fallback: 'Something went wrong. Please try again later.',
  },
  event: {
    granted: (name: string, granted: number, requested: number) =>
      granted < requested
        ? `Received ${name} × ${granted} (${requested - granted} dropped at the stack limit)`
        : `Received ${name} × ${granted}`,
    used: (name: string, amount: number, left: number) => `Used ${name} × ${amount}, ${left} left`,
    bought: (name: string, count: number, cost: number) => `Bought ${name} × ${count} for ${cost} gift credits`,
  },
} satisfies typeof ITEM_COPY;
