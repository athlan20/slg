// 充值 / 元宝协议的对外文档（CREATE_TOPUP op 155 与 GET_STATE 的元宝字段，v108，AISLG-251）。
// CREATE_TOPUP **只对玩家开放**：不进 agent-api.md / agent-api.json，MCP 也不生成对应工具
// （AGENT_HIDDEN_OPS 见下），Agent 连接调用返回 AGENT_FORBIDDEN。Agent 仍能在 GET_STATE 看到 ingot、
// 并用 BUY_ITEM（currency = 'ingot'）花掉——账号是本人的。
// 数值引用 common/src/ingot.ts 的真实常量，不在这里手抄。

import { Op } from './protocol';
import type { FieldDoc, RequestOpDoc } from './protocol-doc';
import { TOPUP_HOURLY_MAX, TOPUP_MONTHLY_MAX, TOPUP_ORDER_TTL_MS, TOPUP_PRODUCTS } from './ingot';

const PRODUCT_LINES = TOPUP_PRODUCTS.map(
  (product) => `${product.id}（${product.usdCents / 100} 美元 = ${product.ingot} 元宝，${product.name} / ${product.nameEn}）`,
).join('；');

const TTL_HOURS = TOPUP_ORDER_TTL_MS / 3600_000;

/** GET_STATE 的元宝字段（接入 protocol-doc-ops.ts 的 REQUEST_GET_STATE.dataFields） */
export const INGOT_STATE_FIELDS: FieldDoc[] = [
  {
    name: 'ingot',
    type: 'number',
    desc: '（v108，AISLG-251）账号元宝余额（付费货币）。永久保留——换季不清零、重置账号也不动，不能转让 / 赠送 / 交易；用途与礼金相同：在道具商店买便利道具。充值只能由玩家本人在道具商店页发起（Agent 无权充值）。',
  },
  {
    name: 'paidCounts',
    type: 'object',
    desc: '（v108，AISLG-251）每种道具里有多少张是**元宝买的**（= 换季后保留的数量）：{ [itemId]: paidCount }，每种已定义道具都有键（缺省 0）。GET_STATE.items / GET_ITEMS.items 仍是**总数**；换成免费的那部分优先消耗，元宝买的尽量留到下一季。',
  },
];

/** 不写进 Agent 文档的协议号：付款必须真人在浏览器里完成 */
export const TOPUP_AGENT_HIDDEN_OPS: ReadonlySet<number> = new Set<number>([Op.CREATE_TOPUP]);

/** 不写进 Agent 文档的错误码：只有玩家端 CREATE_TOPUP 会返回（INSUFFICIENT_INGOT 保留，Agent 的 BUY_ITEM 会遇到） */
export const TOPUP_AGENT_HIDDEN_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  'TOPUP_PRODUCT_INVALID',
  'TOPUP_MONTHLY_LIMIT',
  'TOPUP_TOO_MANY_PENDING',
  'TOPUP_UNAVAILABLE',
]);

export const REQUEST_CREATE_TOPUP: RequestOpDoc = {
  kind: 'request',
  name: 'CREATE_TOPUP',
  title: '发起充值（v108，AISLG-251；仅玩家连接）',
  preAuth: false,
  summary: `创建一笔充值订单并返回渠道（Creem）的结账页地址，玩家在新窗口打开它完成付款。目前只有一个档位：${PRODUCT_LINES}。服务端校验：商品必须在服务端商品表里（否则 TOPUP_PRODUCT_INVALID）→ 渠道可用（否则 TOPUP_UNAVAILABLE）→ 本月（UTC 自然月）已成功充值 ${TOPUP_MONTHLY_MAX} 次则 TOPUP_MONTHLY_LIMIT → 最近 1 小时已创建 ${TOPUP_HOURLY_MAX} 个订单则 TOPUP_TOO_MANY_PENDING → 落一条 pending 订单。同一账号同时最多 1 个未支付订单：新建订单会把旧的 pending 作废（旧订单不能再付款入账）。未支付订单 ${TTL_HOURS} 小时后自动作废。金额、元宝数与商品全部来自服务端配置，请求里只有 productId。付款成功后由渠道回调服务端入账（元宝到账后用 PUSH_ACCOUNT_STATE 的 ingot_changed 推送，丢了下次 GET_STATE / GET_ITEMS 也能看到）。失败、放弃、超时都不扣不加。`,
  requestFields: [
    { name: 'productId', type: 'string', desc: `必填。充值商品 id，目前只接受 ${TOPUP_PRODUCTS.map((p) => p.id).join(' / ')}。` },
  ],
  dataFields: [
    { name: 'orderId', type: 'string', desc: '服务端订单 id（uuid）。回调按它归属账号，客户端不需要回传。' },
    { name: 'checkoutUrl', type: 'string', desc: '渠道结账页地址：在新窗口打开，付完款关闭窗口回游戏。' },
    { name: 'productId', type: 'string', desc: '本次购买的商品 id。' },
    { name: 'usdCents', type: 'number', desc: '美元金额（分），1.99 美元 = 199。' },
    { name: 'ingot', type: 'number', desc: '付款成功后到账的元宝数（本档 1000）。' },
  ],
  errors: ['AGENT_FORBIDDEN', 'TOPUP_PRODUCT_INVALID', 'TOPUP_MONTHLY_LIMIT', 'TOPUP_TOO_MANY_PENDING', 'TOPUP_UNAVAILABLE'],
  examples: [
    {
      caption: '发起充值：返回结账页地址',
      request: { op: Op.CREATE_TOPUP, seq: 71, data: { productId: 'topup_199' } },
      responses: [
        {
          op: Op.CREATE_TOPUP,
          seq: 71,
          ok: true,
          data: {
            orderId: '0f2b6c1e-7a1c-4b0e-9c1a-2d3e4f5a6b7c',
            checkoutUrl: 'https://checkout.creem.io/checkout/example-session',
            productId: 'topup_199',
            usdCents: 199,
            ingot: 1000,
          },
        },
      ],
    },
    {
      caption: '没配置支付渠道：充值按钮置灰',
      request: { op: Op.CREATE_TOPUP, seq: 72, data: { productId: 'topup_199' } },
      responses: [
        {
          op: Op.CREATE_TOPUP,
          seq: 72,
          ok: false,
          error: { code: 'TOPUP_UNAVAILABLE', message: '充值暂不可用：支付渠道还没配置好或暂时连不上，请稍后再试' },
        },
      ],
    },
  ],
  agentNote:
    'Agent 连接无权调用（AGENT_FORBIDDEN）：付款必须玩家本人。需要元宝时提示玩家在道具商店页点「充值」；Agent 可以在 GET_STATE 看到 ingot，并用 BUY_ITEM（currency = "ingot"）花掉已有的元宝。',
};