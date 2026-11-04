// 道具协议的对外文档（GET_ITEMS op 148 / BUY_ITEM op 149，v90，AISLG-222）。
// 数值与道具定义引用 common/src/items.ts 的真实常量，不在这里手抄。

import { Op } from './protocol';
import type { FieldDoc, RequestOpDoc } from './protocol-doc';
import { ITEM_DEFS, BUY_COUNT_MAX } from './items';

const SHOP_LINES = ITEM_DEFS.filter((def) => def.shopPrice !== null)
  .map((def) => `${def.name}（${def.id}，礼金 ${def.shopPrice}，堆叠上限 ${def.stackMax}）`)
  .join('；');

/** GET_STATE 的道具字段（接入 protocol-doc-ops.ts 的 REQUEST_GET_STATE.dataFields） */
export const ITEMS_STATE_FIELDS: FieldDoc[] = [
  {
    name: 'items',
    type: 'object',
    desc: '（v90，AISLG-222）账号道具背包：{ [itemId]: count }，每种已定义道具都有键（缺省 0）。与 GET_ITEMS 的 items 同口径。道具随换季清空。',
  },
];

export const REQUEST_GET_ITEMS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ITEMS',
  title: '查询道具背包、道具目录与礼金余额（v90，AISLG-222）',
  preAuth: false,
  summary: `返回账号的道具背包 items（每种道具的数量）、全部道具定义 catalog（名称、说明、礼金单价 shopPrice，null 表示不卖，堆叠上限 stackMax）与礼金余额 gift。商店出售的是 shopPrice 非 null 的道具：${SHOP_LINES}。道具随换季清空，礼金见 GET_STATE 的 gift。`,
  requestFields: [],
  dataFields: [
    { name: 'items', type: 'object', desc: '背包：{ [itemId]: count }，每种已定义道具都有键（缺省 0）。' },
    { name: 'catalog', type: 'object[]', desc: '道具定义：id、name、nameEn、desc、descEn、kind（目前只有 order）、shopPrice（礼金单价，null = 不卖）、stackMax（堆叠上限）。' },
    { name: 'gift', type: 'number', desc: '礼金余额（见 GET_STATE 的 gift）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询背包与商店目录',
      request: { op: Op.GET_ITEMS, seq: 61, data: {} },
      responses: [
        {
          op: Op.GET_ITEMS,
          seq: 61,
          ok: true,
          data: {
            items: { city_order: 2, city_order_adv: 0 },
            catalog: [
              { id: 'city_order', name: '迁城令', nameEn: 'City Move Order', desc: '消耗 1 张，随机迁城一次。', descEn: 'Uses 1 order to relocate the city once to a random spot.', kind: 'order', shopPrice: 200, stackMax: 99 },
              { id: 'city_order_adv', name: '高级迁城令', nameEn: 'Advanced City Move Order', desc: '消耗 1 张，指定坐标迁城一次。', descEn: 'Uses 1 order to relocate the city once to chosen coordinates.', kind: 'order', shopPrice: 500, stackMax: 99 },
            ],
            gift: 600,
          },
        },
      ],
    },
  ],
  agentNote: '买道具前先用本协议看 shopPrice 与 gift，BUY_ITEM 必须带上你看到的单价（expectedPrice）。',
};

export const REQUEST_BUY_ITEM: RequestOpDoc = {
  kind: 'request',
  name: 'BUY_ITEM',
  title: '礼金购买道具（v90，AISLG-222）',
  preAuth: false,
  summary: `用礼金购买道具：礼金按 单价 × 数量 扣除，道具数量按数量增加，写事件 item_bought。校验顺序：itemId 必须在目录里且可卖（未知或 shopPrice 为 null → INVALID_PARAMS）→ count 为 1..${BUY_COUNT_MAX} 的整数 → expectedPrice 必填（缺失或非整数 → INVALID_PARAMS）→ expectedPrice 必须等于当前 shopPrice（不等 → ITEM_PRICE_CHANGED，附当前 price，不扣不改，客户端刷新目录后让玩家重新确认，不自动重试）→ 购买后不超过 stackMax（超出 → ITEM_STACK_FULL，附 stackMax / have / canBuy）→ 礼金不足 → INSUFFICIENT_GIFT（附 balance / cost）。全部在一个事务里，任何一步失败都不扣礼金、不加道具。成功后向该账号其他在线连接推送 PUSH_ACCOUNT_STATE（reason = items_changed）。已买到的道具不因调价而补差价或退款。`,
  requestFields: [
    { name: 'itemId', type: 'string', desc: '必填。道具 id（见 GET_ITEMS 的 catalog）。' },
    { name: 'count', type: 'number', desc: `必填。购买数量，1..${BUY_COUNT_MAX} 的整数。购买后不能超过该道具的堆叠上限。` },
    { name: 'expectedPrice', type: 'number', desc: '必填。你看到的单价（礼金），必须等于当前 shopPrice；不一致返回 ITEM_PRICE_CHANGED。' },
  ],
  dataFields: [
    { name: 'itemId', type: 'string', desc: '购买的道具 id。' },
    { name: 'bought', type: 'number', desc: '本次买入数量。' },
    { name: 'count', type: 'number', desc: '购买后该道具的总数量。' },
    { name: 'price', type: 'number', desc: '本次单价（礼金）。' },
    { name: 'cost', type: 'number', desc: '本次花费的礼金（price × bought）。' },
    { name: 'gift', type: 'number', desc: '购买后的礼金余额。' },
  ],
  errors: ['INVALID_PARAMS', 'ITEM_PRICE_CHANGED', 'ITEM_STACK_FULL', 'INSUFFICIENT_GIFT'],
  examples: [
    {
      caption: '买 2 张迁城令（单价 200）',
      request: { op: Op.BUY_ITEM, seq: 62, data: { itemId: 'city_order', count: 2, expectedPrice: 200 } },
      responses: [
        {
          op: Op.BUY_ITEM,
          seq: 62,
          ok: true,
          data: { itemId: 'city_order', bought: 2, count: 4, price: 200, cost: 400, gift: 200 },
        },
      ],
    },
    {
      caption: '单价已变：返回当前单价，不扣不改',
      request: { op: Op.BUY_ITEM, seq: 63, data: { itemId: 'city_order', count: 1, expectedPrice: 200 } },
      responses: [
        {
          op: Op.BUY_ITEM,
          seq: 63,
          ok: false,
          error: { code: 'ITEM_PRICE_CHANGED', message: '道具单价已变化，请刷新后重新确认' },
          data: { price: 250 },
        },
      ],
    },
  ],
  agentNote: '只在玩家明确要买时调用。收到 ITEM_PRICE_CHANGED 时先 GET_ITEMS 刷新目录，把新单价告诉玩家，等他确认后再带新单价重发，不要用旧价自动重试。',
};
