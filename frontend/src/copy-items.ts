// 道具文案（AISLG-222，v90；v108 AISLG-251 加元宝与换季保留）：账号菜单「背包 / 商店」弹窗、道具事件流文字、道具错误提示。
// 英文孪生见 copy-items-en.ts。道具可用礼金或元宝买（不自动混用），价格与堆叠上限以服务端 GET_ITEMS 为准，这里不写死数值。

export const ITEM_COPY = {
  menu: '背包 / 商店',
  title: '背包与商店',
  tabBag: '背包',
  tabShop: '商店',
  /** 余额条：礼金（换季清零） */
  balanceGift: (balance: number) => `礼金 ${balance}（换季清零）`,
  names: {
    city_order: '迁城令',
    city_order_adv: '高级迁城令',
  },
  descs: {
    city_order: '消耗 1 张，随机迁城一次。',
    city_order_adv: '消耗 1 张，指定坐标迁城一次。',
  },
  owned: (count: number) => `拥有 ${count}`,
  /** 道具数量旁：其中元宝买的张数（换季保留） */
  paidKept: (count: number) => `其中 ${count} 张换季保留`,
  price: (price: number) => `${price} 礼金`,
  priceIngot: (price: number) => `${price} 元宝`,
  /** 付款方式（选货币的控件） */
  currencyChoice: '付款方式',
  currencyGift: '礼金',
  currencyIngot: '元宝',
  currencyNotSold: '不收此货币',
  stackMax: (max: number) => `堆叠上限 ${max}`,
  qty: '数量',
  qtyDown: '减少数量',
  qtyUp: '增加数量',
  buy: '购买',
  reasonFull: '已达堆叠上限',
  reasonGift: '礼金不足',
  reasonIngot: '元宝不足，可先充值',
  seasonNote: '礼金买的道具随换季清空；元宝买的道具换季保留',
  priceChanged: (price: number, currency: 'gift' | 'ingot') =>
    `价格已变为 ${price} ${currency === 'ingot' ? '元宝' : '礼金'}，请重新确认`,
  bought: (name: string, count: number, gift: number) => `已购买 ${name} × ${count}，剩余礼金 ${gift}`,
  boughtIngot: (name: string, count: number, ingot: number) => `已用元宝购买 ${name} × ${count}，剩余元宝 ${ingot}`,
  shopEmpty: '暂无可购买的道具',
  loading: '加载中…',
  errors: {
    INVALID_PARAMS: '参数不正确，请刷新后再试',
    INSUFFICIENT_GIFT: '礼金不足（每个赛季发 1000，换季清零）',
    INSUFFICIENT_INGOT: '元宝不足，可以先充值再买',
    INSUFFICIENT_ITEM: '道具数量不足',
    ITEM_STACK_FULL: '该道具已达堆叠上限，请减少数量',
    ITEM_PRICE_CHANGED: '道具单价已变化，请刷新后重新确认',
    fallback: '操作失败，请稍后再试',
  },
  event: {
    granted: (name: string, granted: number, requested: number) =>
      granted < requested ? `获得道具 ${name} × ${granted}（超出堆叠上限作废 ${requested - granted}）` : `获得道具 ${name} × ${granted}`,
    used: (name: string, amount: number, left: number) => `消耗道具 ${name} × ${amount}，余 ${left}`,
    bought: (name: string, count: number, cost: number) => `礼金购买 ${name} × ${count}，花费 ${cost} 礼金`,
  },
};
