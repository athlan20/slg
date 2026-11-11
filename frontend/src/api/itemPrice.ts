// 道具单价按货币取值（v108，AISLG-251）：礼金单价 shopPrice、元宝单价 ingotPrice；null = 该货币不卖。
// 不自动混用货币：界面只按玩家选定的货币取单价，购买时把这个单价与货币一起发给服务端（expectedPrice / currency）。

import type { ItemCurrency, ItemDefView } from './protocol';

export function itemPriceIn(def: Pick<ItemDefView, 'shopPrice' | 'ingotPrice'>, currency: ItemCurrency): number | null {
  return currency === 'ingot' ? def.ingotPrice : def.shopPrice;
}
