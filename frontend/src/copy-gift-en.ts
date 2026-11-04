// 英文文案孪生（AISLG-137 / AISLG-221）：copy-gift.ts 的英文版；satisfies 校验结构与函数签名一致。
import { GIFT_COPY } from './copy-gift';

export const GIFT_COPY_EN = {
  label: 'Gift credits',
  loading: '—',
  value: (balance: number, grant: number) => `${balance} / ${grant}`,
  explain: (grant: number) => `${grant.toLocaleString('en-US')} per season, reset at each season change, for convenience features only`,
  event: {
    spent: (reason: string, amount: number, balance: number) => `Spent ${amount} gift credits (${reason}), ${balance} left`,
  },
} satisfies typeof GIFT_COPY;
