// 兑换码协议的对外文档（REDEEM_CODE op 156，v109，AISLG-253）。玩家与 Agent 通用——
// 账号是本人的、码是本人拿到的，防刷靠失败次数限制，所以本协议**不**进隐藏列表，
// MCP 会从 docs/agent-api.json 自动生成对应工具。
// 数值与规则引用 common/src/redeem-code.ts 的真实常量，不在这里手抄。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  REDEEM_BATCH_MAX_CODES,
  REDEEM_FAIL_LIMIT,
  REDEEM_FAIL_WINDOW_MS,
  REDEEM_INGOT_MAX,
  REDEEM_INGOT_MIN,
  REDEEM_ITEM_COUNT_MAX,
  REDEEM_ITEM_COUNT_MIN,
} from './redeem-code';

const WINDOW_MINUTES = REDEEM_FAIL_WINDOW_MS / 60_000;

export const REQUEST_REDEEM_CODE: RequestOpDoc = {
  kind: 'request',
  name: 'REDEEM_CODE',
  title: '兑换码兑换（v109，AISLG-253）',
  preAuth: false,
  summary:
    `输入运营发出的兑换码领取福利（元宝与 / 或道具），成功返回本次领到的奖励包与领取后的余额、背包。` +
    `码是 ${CODE_LENGTH} 位（字符集是去掉 I / L / O / U 的 32 个字符：${CODE_ALPHABET}），玩家看到的显示形式是 XXXX-XXXX-XXXX-XXXX；` +
    `输入不区分大小写，空格与横线都可以带（\`abcd efgh-ijkl mnop\` 与 \`ABCDEFGHIJKLMNOP\` 等价）。` +
    `两种码：一次性码（每个码只能被一个账号兑换一次，兑换后作废；同一玩家可以兑同一批次的任意多张码）与通用码（同一个码多人都能兑，每人只能兑一次，有兑换人数上限）。` +
    `**同一个通用码** 每个账号只能兑一次：重复兑换返回 CODE_BATCH_CLAIMED，那个码本身不作废、可以给别人。` +
    `一次性码没有「同一批次只能兑一张」的限制：拿到同一批的另一个码照样能兑。` +
    `奖励与码无关，由批次决定：元宝 ${REDEEM_INGOT_MIN}..${REDEEM_INGOT_MAX}（与充值元宝同账户、永久保留、不可转让）与 / 或道具 ×${REDEEM_ITEM_COUNT_MIN}..${REDEEM_ITEM_COUNT_MAX}` +
    `（按普通道具发放，超出堆叠上限 ${REDEEM_ITEM_COUNT_MAX} 时整次兑换失败返回 ITEM_STACK_FULL，码不作废、也没有元宝）。` +
    `福利发的道具换季会清空，福利发的元宝不会。` +
    `失败次数限制：每账号每小时最多失败 ${REDEEM_FAIL_LIMIT} 次（码不存在、格式不对、已被使用、过期、同一个通用码已兑过、已被领完都算），` +
    `超过后 ${WINDOW_MINUTES} 分钟内所有兑换请求返回 CODE_RATE_LIMITED；成功兑换不计入失败次数。`,
  requestFields: [
    {
      name: 'code',
      type: 'string',
      desc: '必填。玩家输入的兑换码原文（大小写、空格、横线都不敏感，全角空格 / 横线也可以）。非字符串 → INVALID_PARAMS；规范化后不是 16 位 → CODE_INVALID（含字符集外的字符时不可能对上任何码，同样返回 CODE_INVALID）。',
    },
  ],
  dataFields: [
    {
      name: 'rewards',
      type: 'object',
      desc: '本次领到的奖励包：{ ingot?: 元宝数, items?: [{ itemId, count }] }，至少一项。',
    },
    { name: 'ingot', type: 'number', desc: '领取后的元宝余额（与 GET_STATE 的 ingot 同口径，永久保留）。' },
    {
      name: 'items',
      type: 'object',
      desc: '领取后的背包全量 { [itemId]: count }，每种已定义道具都有键（缺省 0），与 GET_STATE / GET_ITEMS 的 items 同口径（总数）。',
    },
  ],
  errors: [
    'INVALID_PARAMS',
    'CODE_INVALID',
    'CODE_EXPIRED',
    'CODE_USED',
    'CODE_BATCH_CLAIMED',
    'CODE_EXHAUSTED',
    'CODE_RATE_LIMITED',
    'ITEM_STACK_FULL',
  ],
  examples: [
    {
      caption: '兑换成功：元宝 ×500、迁城令 ×2',
      request: { op: Op.REDEEM_CODE, seq: 91, data: { code: 'abcd efgh-ijkl mnop' } },
      responses: [
        {
          op: Op.REDEEM_CODE,
          seq: 91,
          ok: true,
          data: {
            rewards: { ingot: 500, items: [{ itemId: 'city_order', count: 2 }] },
            ingot: 1500,
            items: { city_order: 4, city_order_adv: 0 },
          },
        },
      ],
    },
    {
      caption: '一次性码已被别人兑换：CODE_USED',
      request: { op: Op.REDEEM_CODE, seq: 92, data: { code: 'ABCD-EFGH-JKMN-PQRS' } },
      responses: [
        {
          op: Op.REDEEM_CODE,
          seq: 92,
          ok: false,
          error: { code: 'CODE_USED', message: '这个兑换码已经被使用过了' },
        },
      ],
    },
    {
      caption: '同一个通用码已经兑过一次：CODE_BATCH_CLAIMED（这个码本身还有效，可以给别人）',
      request: { op: Op.REDEEM_CODE, seq: 93, data: { code: 'TVWX-YZ01-2345-6789' } },
      responses: [
        {
          op: Op.REDEEM_CODE,
          seq: 93,
          ok: false,
          error: {
            code: 'CODE_BATCH_CLAIMED',
            message: '这个兑换码你已经兑换过了',
          },
        },
      ],
    },
    {
      caption: '输错次数太多：CODE_RATE_LIMITED（附 retryAfterSeconds）',
      request: { op: Op.REDEEM_CODE, seq: 94, data: { code: '0000-0000-0000-0000' } },
      responses: [
        {
          op: Op.REDEEM_CODE,
          seq: 94,
          ok: false,
          error: { code: 'CODE_RATE_LIMITED', message: '输错次数太多，请稍后再试（每账号每小时最多 10 次）' },
          data: { retryAfterSeconds: 1800 },
        },
      ],
    },
    {
      caption: '背包里迁城令已满 99 张：ITEM_STACK_FULL（整单回滚，码不作废、元宝没发）',
      request: { op: Op.REDEEM_CODE, seq: 95, data: { code: 'ABCD-EFGH-JKMN-PQRS' } },
      responses: [
        {
          op: Op.REDEEM_CODE,
          seq: 95,
          ok: false,
          error: { code: 'ITEM_STACK_FULL', message: '该道具已达堆叠上限，不能再买这么多' },
          data: { itemId: 'city_order', stackMax: 99, have: 99, canGrant: 0 },
        },
      ],
    },
  ],
  agentNote:
    '码是玩家自己拿到的，可以替玩家兑换（账号是本人的）。玩家把码贴给你时直接调用，不用先确认；成功后把 rewards 报给玩家。' +
    `不要猜码或批量尝试：每账号每小时最多失败 ${REDEEM_FAIL_LIMIT} 次，超过后 1 小时内连正确的码都会被拒（CODE_RATE_LIMITED，` +
    '按返回的 retryAfterSeconds 等待）。CODE_BATCH_CLAIMED 只会出现在通用码上：这个号已经兑过这个码，换别的码没用；' +
    '一次性码可以兑同一批次的多张，拿到新码直接兑就行。' +
    'ITEM_STACK_FULL 提示玩家先消耗一些同种道具再兑换，码仍然有效。',
};