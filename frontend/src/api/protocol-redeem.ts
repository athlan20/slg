// 兑换码协议的类型（v109，AISLG-253）：REDEEM_CODE（op 156）。玩家与 Agent 通用——
// 账号是本人的、码是本人拿到的，防刷靠服务端 redeem_attempts 的失败次数限制。
// 与后端 backend/common/src/protocol-redeem.ts 同构；失败提示与码的展示口径见 api/redeemText.ts。

import type { ItemId } from './protocol-items';

/** 奖励里的道具：itemId + 数量（数量按普通道具发放，受堆叠上限约束） */
export interface RedeemItemReward {
  itemId: ItemId;
  count: number;
}

/** 本次领到的奖励包（元宝与 / 或道具，至少一项） */
export interface RedeemRewards {
  ingot?: number;
  items?: RedeemItemReward[];
}

/** REDEEM_CODE 请求：code 是玩家输入的原文（大小写、空格、横线都不敏感，前端不改写） */
export interface RedeemCodeRequestData {
  code: string;
}

/** REDEEM_CODE 响应：本次领到的奖励 + 领取后的元宝余额与背包全量 */
export interface RedeemCodeResponseData {
  rewards: RedeemRewards;
  /** 领取后的元宝余额（福利元宝与充值元宝同账户、永久保留） */
  ingot: number;
  /** 领取后的背包全量（每种道具都有键，缺省 0；与 GET_STATE / GET_ITEMS 同口径） */
  items: Record<ItemId, number>;
}

/** 失败详情：CODE_RATE_LIMITED 与 ITEM_STACK_FULL 在错误响应的 data 里带这些字段 */
export interface RedeemErrorDetail {
  /** CODE_RATE_LIMITED：多少秒后可以再试 */
  retryAfterSeconds?: number;
  /** ITEM_STACK_FULL：哪个道具满了、上限多少、现有多少、本次最多还能收几张 */
  itemId?: ItemId;
  stackMax?: number;
  have?: number;
  canGrant?: number;
}