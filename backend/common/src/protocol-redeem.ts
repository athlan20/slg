// 兑换码协议的类型（AISLG-253，v109）：REDEEM_CODE（op 156）。玩家与 Agent 通用——
// 账号是本人的、码是本人拿到的，防刷靠 redeem_attempts 的失败次数限制。
// 规则与规范化见 redeem-code.ts，存取见 redeem-db.ts，事务在 api/src/handlers-redeem.ts。

import type { ItemId } from './items';
import type { RedeemRewards } from './redeem-code';

/** REDEEM_CODE（op 156）请求：code 是玩家输入的原文（大小写、空格、横线都不敏感） */
export interface RedeemCodeRequestData {
  code: string;
}

/** REDEEM_CODE 响应 */
export interface RedeemCodeResponseData {
  /** 本次领到的奖励包（元宝与 / 或道具，至少一项） */
  rewards: RedeemRewards;
  /** 领取后的元宝余额（福利元宝与充值元宝同账户、永久保留） */
  ingot: number;
  /** 领取后的背包全量（每种道具都有键，缺省 0；与 GET_STATE / GET_ITEMS 的 items 同口径） */
  items: Record<ItemId, number>;
}