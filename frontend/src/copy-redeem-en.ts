// 英文文案孪生（AISLG-253）：copy-redeem.ts 的英文版；satisfies 校验结构与函数签名一致。
import { REDEEM_COPY } from './copy-redeem';

export const REDEEM_COPY_EN = {
  entry: 'Redeem code',
  title: 'Redeem code',
  backToShop: 'Back to shop',
  placeholder: 'Enter your code',
  submit: 'Redeem',
  submitting: 'Redeeming…',
  hint: 'A code from a shop or event. Case-insensitive, hyphens optional.',
  hintTaobao: 'Find your code in your order; case-insensitive, hyphens optional.',
  success: (rewards: string) => `Redeemed: ${rewards}`,
  rewardIngot: (amount: number) => `Ingots +${amount}`,
  rewardItem: (name: string, count: number) => `${name} ×${count}`,
  rewardJoiner: ', ',
  errors: {
    CODE_INVALID: 'That code does not exist. Check for typos.',
    CODE_EXPIRED: 'That code has expired.',
    CODE_USED: 'That code has already been used.',
    CODE_BATCH_CLAIMED: 'You have already claimed this batch of rewards. Other codes from the same batch can go to other players.',
    CODE_EXHAUSTED: 'That code has been fully claimed.',
    CODE_RATE_LIMITED: (minutes: number) => `Too many wrong codes. Please try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
    ITEM_STACK_FULL: (name: string, canGrant: number, stackMax: number) =>
      canGrant > 0
        ? `Your ${name} can only take ${canGrant} more (limit ${stackMax}). Use some up and redeem again — the code is still valid.`
        : `Your ${name} is at the limit of ${stackMax}. Use some up and redeem again — the code is still valid.`,
    INVALID_PARAMS: 'That code is not in a valid format. Check it and try again.',
    fallback: 'Redeeming failed. Please try again later.',
  },
} satisfies typeof REDEEM_COPY;