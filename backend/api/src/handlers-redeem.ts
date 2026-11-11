// 兑换码（AISLG-253，v109）：REDEEM_CODE（op 156）。玩家与 Agent 都能调用——账号是本人的、
// 码是本人拿到的，防刷靠 redeem_attempts 的失败次数限制（每账号每小时 10 次，超过 1 小时内拒绝）。
// 参数只有 code（原文：大小写、空格、横线都不敏感）；业务规则与事务在 common/src/redeem-db.ts。
// 成功后推 PUSH_ACCOUNT_STATE（reason = items_changed）给该账号其他在线连接——背包与元宝余额都变了。

import { redeemCode } from '../../common/src/redeem-db';
import type { RedeemCodeResponseData } from '../../common/src/protocol';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { pushItemsState } from './handlers-items';

/** REDEEM_CODE（op 156）：输入兑换码领奖励 */
export async function handleRedeemCode(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const raw = data?.code;
  // 非字符串（缺失 / 数字 / 对象）是参数错误；字符串长度或字符不对由 redeemCode 返回 CODE_INVALID
  if (typeof raw !== 'string') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const result = await redeemCode(ctx.pool, {
    accountId,
    code: raw,
    initiator: conn.role,
  });
  if (!result.ok) {
    respondError(ctx.registry, conn, op, seq, result.code, result.detail as unknown as Record<string, unknown>);
    return;
  }
  const payload: RedeemCodeResponseData = {
    rewards: result.rewards,
    ingot: result.ingot,
    items: result.items,
  };
  respondOk(ctx.registry, conn, op, seq, payload as unknown as Record<string, unknown>);
  await pushItemsState(ctx, accountId, conn);
}