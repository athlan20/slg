// 道具协议的对外文档（GET_ITEMS op 148 / BUY_ITEM op 149，v90，AISLG-222；v108 AISLG-251 加元宝支付）。
// 数值与道具定义引用 common/src/items.ts 的真实常量，不在这里手抄。

import { Op } from './protocol';
import type { FieldDoc, RequestOpDoc } from './protocol-doc';
import { ITEM_DEFS, BUY_COUNT_MAX } from './items';

const SHOP_LINES = ITEM_DEFS.filter((def) => def.shopPrice !== null)
  .map(
    (def) =>
      `${def.name}（${def.id}，礼金 ${def.shopPrice} / 元宝 ${def.ingotPrice ?? '不卖'}，堆叠上限 ${def.stackMax}）`,
  )
  .join('；');

/** GET_STATE 的道具字段（接入 protocol-doc-ops.ts 的 REQUEST_GET_STATE.dataFields） */
export const ITEMS_STATE_FIELDS: FieldDoc[] = [
  {
    name: 'items',
    type: 'object',
    desc: '（v90，AISLG-222）账号道具背包：{ [itemId]: count }，每种已定义道具都有键（缺省 0）。与 GET_ITEMS 的 items 同口径，count 是**总数**。v108（AISLG-251）：元宝买的道具换季保留，保留多少见 paidCounts（每种道具里元宝买的张数）。',
  },
];

export const REQUEST_GET_ITEMS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ITEMS',
  title: '查询道具背包、道具目录与礼金余额（v90，AISLG-222）',
  preAuth: false,
  summary: `返回账号的道具背包 items（每种道具的总数）、每种道具里元宝买的张数 paidCounts（= 换季后保留的数量）、全部道具定义 catalog（名称、说明、礼金单价 shopPrice、元宝单价 ingotPrice，null 表示该货币不卖，堆叠上限 stackMax）、礼金余额 gift 与元宝余额 ingot。商店出售的是 shopPrice 或 ingotPrice 非 null 的道具：${SHOP_LINES}。礼金是每季免费发的，换季清零、礼金买的道具也换季作废；元宝是付费货币，永久保留、元宝买的道具换季保留（paidCounts）。`,
  requestFields: [],
  dataFields: [
    { name: 'items', type: 'object', desc: '背包：{ [itemId]: count }，每种已定义道具都有键（缺省 0）。count 是**总数**（免费 + 元宝买的）。' },
    { name: 'paidCounts', type: 'object', desc: '（v108）{ [itemId]: paidCount }：每种道具里元宝买的张数，换季后只剩这么多（免费的那部分换季作废）。' },
    { name: 'catalog', type: 'object[]', desc: '道具定义：id、name、nameEn、desc、descEn、kind（目前只有 order）、shopPrice（礼金单价，null = 礼金不卖）、ingotPrice（元宝单价，null = 元宝不卖；目前与礼金价 1:1）、stackMax（堆叠上限，按 count 总数算）。' },
    { name: 'gift', type: 'number', desc: '礼金余额（见 GET_STATE 的 gift）。' },
    { name: 'ingot', type: 'number', desc: '元宝余额（v108；见 GET_STATE 的 ingot，永久保留、换季不清零）。' },
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
            paidCounts: { city_order: 1, city_order_adv: 0 },
            catalog: [
              { id: 'city_order', name: '迁城令', nameEn: 'City Move Order', desc: '消耗 1 张，随机迁城一次。', descEn: 'Uses 1 order to relocate the city once to a random spot.', kind: 'order', shopPrice: 50, ingotPrice: 50, stackMax: 99 },
              { id: 'city_order_adv', name: '高级迁城令', nameEn: 'Advanced City Move Order', desc: '消耗 1 张，指定坐标迁城一次。', descEn: 'Uses 1 order to relocate the city once to chosen coordinates.', kind: 'order', shopPrice: 100, ingotPrice: 100, stackMax: 99 },
            ],
            gift: 600,
            ingot: 1000,
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
  title: '购买道具（礼金或元宝；v90，AISLG-222；v108 加元宝）',
  preAuth: false,
  summary: `用礼金或元宝购买道具（currency 选一种，**不自动混用**）：所选货币按 单价 × 数量 扣除，道具数量按数量增加，写事件 item_bought。校验顺序：currency 只能是 gift / ingot（缺省 gift，旧客户端行为不变；非法值 → INVALID_PARAMS）→ itemId 必须在目录里且所选货币可卖（未知或该货币单价为 null → INVALID_PARAMS）→ count 为 1..${BUY_COUNT_MAX} 的整数 → expectedPrice 必填（缺失或非整数 → INVALID_PARAMS）→ expectedPrice 必须等于所选货币的当前单价（不等 → ITEM_PRICE_CHANGED，附当前 price 与 currency，不扣不改，客户端刷新目录后让玩家重新确认，不自动重试）→ 购买后不超过 stackMax（按 count 总数算，超出 → ITEM_STACK_FULL，附 stackMax / have / canBuy）→ 余额不足（礼金 → INSUFFICIENT_GIFT；元宝 → INSUFFICIENT_INGOT，均附 balance / cost）。全部在一个事务里，任何一步失败都不扣货币、不加道具。用元宝买时该道具的 paidCount 同步增加（换季保留这些张），用礼金买只增加 count（换季作废）。成功后向该账号其他在线连接推送 PUSH_ACCOUNT_STATE（reason = items_changed）。已买到的道具不因调价而补差价或退款。`,
  requestFields: [
    { name: 'itemId', type: 'string', desc: '必填。道具 id（见 GET_ITEMS 的 catalog）。' },
    { name: 'count', type: 'number', desc: `必填。购买数量，1..${BUY_COUNT_MAX} 的整数。购买后不能超过该道具的堆叠上限（按总数）。` },
    { name: 'expectedPrice', type: 'number', desc: '必填。你看到的单价（**所选货币**的单价），必须等于当前 shopPrice / ingotPrice；不一致返回 ITEM_PRICE_CHANGED。' },
    { name: 'currency', type: 'string', desc: "（v108）可选。付款货币：'gift'（礼金，缺省）或 'ingot'（元宝）。只扣所选的那种，另一种不够不影响。" },
  ],
  dataFields: [
    { name: 'itemId', type: 'string', desc: '购买的道具 id。' },
    { name: 'bought', type: 'number', desc: '本次买入数量。' },
    { name: 'count', type: 'number', desc: '购买后该道具的总数量。' },
    { name: 'paidCount', type: 'number', desc: '（v108）购买后该道具里元宝买的张数（换季保留）。' },
    { name: 'currency', type: 'string', desc: '本次实际使用的货币（gift / ingot）。' },
    { name: 'price', type: 'number', desc: '本次单价（所选货币）。' },
    { name: 'cost', type: 'number', desc: '本次花费（price × bought，所选货币）。' },
    { name: 'gift', type: 'number', desc: '购买后的礼金余额。' },
    { name: 'ingot', type: 'number', desc: '购买后的元宝余额（v108）。' },
  ],
  errors: ['INVALID_PARAMS', 'ITEM_PRICE_CHANGED', 'ITEM_STACK_FULL', 'INSUFFICIENT_GIFT', 'INSUFFICIENT_INGOT'],
  examples: [
    {
      caption: '买 2 张迁城令（单价 50）',
      request: { op: Op.BUY_ITEM, seq: 62, data: { itemId: 'city_order', count: 2, expectedPrice: 50 } },
      responses: [
        {
          op: Op.BUY_ITEM,
          seq: 62,
          ok: true,
          data: { itemId: 'city_order', bought: 2, count: 4, paidCount: 0, currency: 'gift', price: 50, cost: 100, gift: 900, ingot: 1000 },
        },
      ],
    },
    {
      caption: '用元宝买 1 张高级迁城令（128 → 28）',
      request: { op: Op.BUY_ITEM, seq: 64, data: { itemId: 'city_order_adv', count: 1, expectedPrice: 100, currency: 'ingot' } },
      responses: [
        {
          op: Op.BUY_ITEM,
          seq: 64,
          ok: true,
          data: { itemId: 'city_order_adv', bought: 1, count: 1, paidCount: 1, currency: 'ingot', price: 100, cost: 100, gift: 900, ingot: 900 },
        },
      ],
    },
    {
      caption: '元宝不够：INSUFFICIENT_INGOT（余额与背包都不变）',
      request: { op: Op.BUY_ITEM, seq: 65, data: { itemId: 'city_order_adv', count: 1, expectedPrice: 100, currency: 'ingot' } },
      responses: [
        {
          op: Op.BUY_ITEM,
          seq: 65,
          ok: false,
          error: { code: 'INSUFFICIENT_INGOT', message: '元宝不足以支付这次购买' },
          data: { balance: 0, cost: 100, currency: 'ingot' },
        },
      ],
    },
    {
      caption: '单价已变：返回当前单价，不扣不改',
      request: { op: Op.BUY_ITEM, seq: 63, data: { itemId: 'city_order', count: 1, expectedPrice: 50 } },
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
  agentNote:
    '只在玩家明确要买时调用。收到 ITEM_PRICE_CHANGED 时先 GET_ITEMS 刷新目录，把新单价告诉玩家，等他确认后再带新单价重发，不要用旧价自动重试。玩家没说用哪种货币时按礼金（不带 currency）；元宝是玩家真金白银充的，不要擅自用元宝付款——要问过玩家。元宝不够时提示玩家自己在道具商店页点「充值」（Agent 无权发起充值）。',
};
