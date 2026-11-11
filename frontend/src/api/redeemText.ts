// 兑换码文字（v109，AISLG-253）：失败码 → 人读提示，以及本次奖励包 → 「元宝 +500、迁城令 ×2」。
// 文案取 REDEEM_COPY（按界面语言），道具名取 ITEM_COPY.names（未知道具 id 原样显示）。
// CODE_RATE_LIMITED 的 retryAfterSeconds 折成分钟（向上取整、至少 1 分钟）；
// ITEM_STACK_FULL 带上哪个道具满了、最多还能收几张——码本身不作废，提示玩家先消耗。

import type { ErrorCode, RedeemErrorDetail, RedeemRewards } from './protocol';
import { getCopy } from '../i18n/bundle';

function itemName(itemId: unknown): string {
  const { names } = getCopy().ITEM_COPY;
  const key = String(itemId ?? '') as keyof typeof names;
  return names[key] ?? String(itemId ?? '');
}

/** 剩余秒数折成分钟：向上取整（不足 1 分钟也说 1 分钟，别让玩家每分钟重试一次） */
export function retryAfterMinutes(retryAfterSeconds: unknown): number {
  const seconds = typeof retryAfterSeconds === 'number' && Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : 0;
  return Math.max(1, Math.ceil(seconds / 60));
}

/** 本次领到的内容：元宝在前、道具在后，没有内容时返回空串 */
export function redeemRewardText(rewards: RedeemRewards | undefined): string {
  const { REDEEM_COPY } = getCopy();
  const parts: string[] = [];
  if (typeof rewards?.ingot === 'number' && rewards.ingot > 0) {
    parts.push(REDEEM_COPY.rewardIngot(rewards.ingot));
  }
  for (const item of rewards?.items ?? []) {
    parts.push(REDEEM_COPY.rewardItem(itemName(item.itemId), Number(item.count ?? 0)));
  }
  return parts.join(REDEEM_COPY.rewardJoiner);
}

/** REDEEM_CODE 失败码 → 提示；detail 是错误响应里的 data（限流剩余秒数、堆叠详情） */
export function redeemErrorText(code: ErrorCode | undefined, detail?: RedeemErrorDetail, message?: string): string {
  const { errors } = getCopy().REDEEM_COPY;
  switch (code) {
    case 'CODE_INVALID':
      return errors.CODE_INVALID;
    case 'CODE_EXPIRED':
      return errors.CODE_EXPIRED;
    case 'CODE_USED':
      return errors.CODE_USED;
    case 'CODE_BATCH_CLAIMED':
      return errors.CODE_BATCH_CLAIMED;
    case 'CODE_EXHAUSTED':
      return errors.CODE_EXHAUSTED;
    case 'CODE_RATE_LIMITED':
      return errors.CODE_RATE_LIMITED(retryAfterMinutes(detail?.retryAfterSeconds));
    case 'ITEM_STACK_FULL':
      return errors.ITEM_STACK_FULL(itemName(detail?.itemId), Math.max(0, Number(detail?.canGrant ?? 0)), Number(detail?.stackMax ?? 0));
    case 'INVALID_PARAMS':
      return errors.INVALID_PARAMS;
    default:
      return message || errors.fallback;
  }
}