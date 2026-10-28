// 玩家交易所（v78，AISLG-196）的对外协议文档：查询挂单 / 挂单 / 吃单 / 撤单。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { STARTED_AT } from './protocol-doc-shared';
import {
  MARKET_FEE_PERCENT,
  MARKET_MAX_OPEN_ORDERS,
  MARKET_MIN_AMOUNT,
  MARKET_ORDER_TTL_MS,
  marketPriceRange,
} from './market';

const RULES =
  `玩家之间挂单买卖粮 / 木 / 石 / 铁（可收另一种资源或金币）。挂单时卖出的资源立即从挂单城冻结；吃单可整单或部分成交，` +
  `成交时买家立即扣款，双方各派一支商队送货（每格 15 秒基准 ÷ 全局缩放，出发城驿站与行军科技有效；商队不会被截击）。` +
  `成交双方各扣 ${MARKET_FEE_PERCENT}% 手续费。未成交部分随时可撤，${MARKET_ORDER_TTL_MS / 3_600_000} 小时后自动撤单退还。` +
  `价格：资源之间 0.5–2（每 1 个卖出资源换多少个收取资源），收金币 0.125–0.5；单张最少 ${MARKET_MIN_AMOUNT}，每账号最多 ${MARKET_MAX_OPEN_ORDERS} 张。` +
  `每日成交额度 = 主城官府等级 × 3000 × 全局缩放（按卖出资源数量折算、买卖合计，北京日重置）。` +
  `门槛：主城官府 ≥ 5 且不在新手保护期。可勾选「只卖给盟友」（同联盟成员才可见 / 可买）。`;

const SELLER = {
  accountId: '6f1e2d3c-4b5a-4978-8c6d-5e4f3a2b1c0d',
  username: 'alice',
  nobility: 3,
  nobilityName: '大夫',
  allianceId: '9b2f4c1a-6d3e-4f80-9a71-2c5e8d4b6a10',
  allianceName: '卧龙盟',
};

const ORDER = {
  id: '4a9c2b1d-3e5f-4a60-8b71-2c3d4e5f6a70',
  seller: SELLER,
  city: { id: '5b1c3d2e-4f60-4a71-8c82-3d4e5f6a7b80', name: '主城', x: 612, y: 388 },
  sellResource: 'iron',
  buyResource: 'food',
  total: 10_000,
  remaining: 10_000,
  unitPrice: 1.2,
  allyOnly: false,
  createdAt: STARTED_AT,
  expiresAt: new Date(Date.parse(STARTED_AT) + MARKET_ORDER_TTL_MS).toISOString(),
  mine: false,
} as const;

const LIMITS = {
  minAmount: MARKET_MIN_AMOUNT,
  maxOpenOrders: MARKET_MAX_OPEN_ORDERS,
  activeOrders: 1,
  feePercent: MARKET_FEE_PERCENT,
  government: 10,
  dailyLimit: 30_000,
  dailyUsed: 0,
  dailyRemaining: 30_000,
  locked: false,
  lockedReason: null,
  priceRangeResource: marketPriceRange('food'),
  priceRangeGold: marketPriceRange('gold'),
} as const;

export const REQUEST_GET_MARKET: RequestOpDoc = {
  kind: 'request',
  name: 'GET_MARKET',
  title: '查询玩家交易所（v78，AISLG-196）',
  preAuth: false,
  summary: `${RULES} 返回可买挂单（可按卖出 / 收取资源筛选、分页）、我的挂单与成交记录、我的额度与门槛；玩家与 Agent 通用。`,
  requestFields: [
    { name: 'sellResource', type: "'food' | 'wood' | 'stone' | 'iron'", desc: '可选。只看卖出该资源的挂单。' },
    { name: 'buyResource', type: "'food' | 'wood' | 'stone' | 'iron' | 'gold'", desc: '可选。只看收取该资源 / 金币的挂单。' },
    { name: 'page', type: 'number', desc: '页码，从 1 起；每页 10 条。' },
  ],
  dataFields: [
    { name: 'orders', type: 'array', desc: '可买挂单（单价升序）：{ id, seller{accountId,username,nobility,nobilityName,allianceId,allianceName}, city{id,name,x,y}, sellResource, buyResource, total, remaining, unitPrice, allyOnly, createdAt, expiresAt, mine }。只卖给盟友的单对非盟友不返回。' },
    { name: 'page / pageSize / total', type: 'number', desc: '分页信息，每页 10 条。' },
    { name: 'mine.orders', type: 'array', desc: '我的挂单（进行中 + 最近结束，最多 20 条），结构同 orders。' },
    { name: 'mine.trades', type: 'array', desc: '我的成交记录（最近 20 条）：{ id, role: buy|sell, other{accountId,username}, sellResource, buyResource, quantity, paid, delivered（扣 5% 后实收）, fee, createdAt, deliveredAt（双方商队都送达才非 null） }。' },
    { name: 'limits', type: 'object', desc: `我的额度与门槛：{ minAmount, maxOpenOrders, activeOrders, feePercent, government, dailyLimit, dailyUsed, dailyRemaining, locked, lockedReason: government|newbie|null, priceRangeResource{min,max}, priceRangeGold{min,max} }。` },
  ],
  errors: [],
  examples: [
    {
      caption: '看铁换粮的挂单',
      request: { op: Op.GET_MARKET, seq: 60, data: { sellResource: 'iron', buyResource: 'food' } },
      responses: [{ op: Op.GET_MARKET, seq: 60, ok: true, data: { orders: [ORDER], page: 1, pageSize: 10, total: 1, mine: { orders: [], trades: [] }, limits: LIMITS } }],
    },
  ],
  agentNote: '先 GET_MARKET 看 orders 与 limits：locked 为 true 时不能交易。单价范围见 limits；吃单前确认自己 buyResource 足够。成交后商队要飞一会儿，deliveredAt 为 null 表示还在路上。',
};

export const REQUEST_CREATE_MARKET_ORDER: RequestOpDoc = {
  kind: 'request',
  name: 'CREATE_MARKET_ORDER',
  title: '挂单卖出资源（v78，AISLG-196）',
  preAuth: false,
  summary: `${RULES} 卖出资源从当前城（可带 cityId）立即冻结；挂单后可在 GET_MARKET 的 mine.orders 看到。单价超范围返回 PRICE_OUT_OF_RANGE；官府 / 保护期门槛 MARKET_LOCKED；满 5 张 ORDER_LIMIT；sellResource 与 buyResource 相同（卖什么就收什么）返回 INVALID_PARAMS。`,
  requestFields: [
    { name: 'sellResource', type: "'food' | 'wood' | 'stone' | 'iron'", desc: '必填。卖出的资源。' },
    { name: 'buyResource', type: "'food' | 'wood' | 'stone' | 'iron' | 'gold'", desc: '必填。收取的资源或金币；必须与 sellResource 不同（同资源挂单返回 INVALID_PARAMS）。' },
    { name: 'amount', type: 'number', desc: `必填。卖出总量，≥ ${MARKET_MIN_AMOUNT}，不能超过挂单城现有数量。` },
    { name: 'unitPrice', type: 'number', desc: '必填。每 1 个卖出资源换多少个收取物；范围见 GET_MARKET 的 limits（资源 0.5–2 / 金币 0.125–0.5，最多 4 位小数）。' },
    { name: 'allyOnly', type: 'boolean', desc: '可选。true = 只卖给同联盟成员。' },
  ],
  dataFields: [
    { name: 'order', type: 'object', desc: '新挂单，结构同 GET_MARKET 的 orders。' },
    { name: 'limits', type: 'object', desc: '挂单后的额度，结构同 GET_MARKET 的 limits。' },
  ],
  errors: ['INVALID_PARAMS', 'MARKET_LOCKED', 'PRICE_OUT_OF_RANGE', 'ORDER_LIMIT', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '卖 1 万铁，每 1 铁换 1.2 粮',
      request: { op: Op.CREATE_MARKET_ORDER, seq: 61, data: { sellResource: 'iron', buyResource: 'food', amount: 10_000, unitPrice: 1.2 } },
      responses: [{ op: Op.CREATE_MARKET_ORDER, seq: 61, ok: true, data: { order: { ...ORDER, mine: true }, limits: { ...LIMITS, activeOrders: 2 } } }],
    },
  ],
  agentNote: '挂单前算好单价：资源之间参考价 1:1，收金币参考价 0.25。只卖给盟友可减少被陌生人吃掉，但也少买家。',
};

export const REQUEST_BUY_MARKET_ORDER: RequestOpDoc = {
  kind: 'request',
  name: 'BUY_MARKET_ORDER',
  title: '吃单（v78，AISLG-196）',
  preAuth: false,
  summary: `${RULES} 吃单可整单或部分（quantity ≤ remaining）。成交时锁挂单行、扣买家款、按 5% 手续费拆出双方实收并各派一支商队。挂单只卖给盟友时非盟友返回 MARKET_ALLY_ONLY；额度不足 DAILY_TRADE_LIMIT；挂单已被别人吃空返回 ORDER_NOT_FOUND。`,
  requestFields: [
    { name: 'orderId', type: 'string', desc: '必填。挂单 id。' },
    { name: 'quantity', type: 'number', desc: '必填。买入数量（正整数，≤ 挂单剩余量）。' },
  ],
  dataFields: [
    { name: 'trade', type: 'object', desc: '成交记录（买家视角），结构同 GET_MARKET 的 mine.trades。' },
    { name: 'remaining', type: 'number', desc: '成交后挂单剩余量（0 = 售罄）。' },
    { name: 'limits', type: 'object', desc: '成交后的额度，结构同 GET_MARKET 的 limits。' },
  ],
  errors: ['INVALID_PARAMS', 'MARKET_LOCKED', 'MARKET_ALLY_ONLY', 'DAILY_TRADE_LIMIT', 'ORDER_NOT_FOUND', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '买 4000 铁（付 4800 粮，实收 3800 铁）',
      request: { op: Op.BUY_MARKET_ORDER, seq: 62, data: { orderId: ORDER.id, quantity: 4000 } },
      responses: [{ op: Op.BUY_MARKET_ORDER, seq: 62, ok: true, data: { trade: { id: '…', role: 'buy', other: { accountId: SELLER.accountId, username: 'alice' }, sellResource: 'iron', buyResource: 'food', quantity: 4000, paid: 4800, delivered: 3800, fee: 200, createdAt: STARTED_AT, deliveredAt: null }, remaining: 6000, limits: { ...LIMITS, dailyUsed: 4000 } } }],
    },
  ],
  agentNote: '部分成交可以拆单降低一次性投入；注意 5% 手续费与商队飞行时间。额度按卖出资源数量计，买卖都占额度。',
};

export const REQUEST_CANCEL_MARKET_ORDER: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_MARKET_ORDER',
  title: '撤单（v78，AISLG-196）',
  preAuth: false,
  summary: `${RULES} 卖家可随时撤回未成交部分，冻结资源立即退还到挂单城；已售罄 / 已过期返回 ORDER_NOT_CANCELLABLE。`,
  requestFields: [{ name: 'orderId', type: 'string', desc: '必填。挂单 id（只能是自己的）。' }],
  dataFields: [
    { name: 'orderId', type: 'string', desc: '撤单的挂单 id。' },
    { name: 'refunded', type: 'number', desc: '退还数量。' },
    { name: 'resource', type: 'string', desc: '退还的资源种类。' },
    { name: 'limits', type: 'object', desc: '撤单后的额度，结构同 GET_MARKET 的 limits。' },
  ],
  errors: ['INVALID_PARAMS', 'ORDER_NOT_FOUND', 'ORDER_NOT_CANCELLABLE'],
  examples: [
    {
      caption: '撤回 6000 铁',
      request: { op: Op.CANCEL_MARKET_ORDER, seq: 63, data: { orderId: ORDER.id } },
      responses: [{ op: Op.CANCEL_MARKET_ORDER, seq: 63, ok: true, data: { orderId: ORDER.id, refunded: 6000, resource: 'iron', limits: LIMITS } }],
    },
  ],
  agentNote: '挂单 48 小时会自动撤单退款，不需要手动撤；急着用资源时再撤。',
};
