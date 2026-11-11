// 英文文案孪生（AISLG-251）：copy-topup.ts 的英文版；satisfies 校验结构与函数签名一致。
import { TOPUP_COPY } from './copy-topup';

export const TOPUP_COPY_EN = {
  entry: 'Top up',
  entryUnavailable: 'Top-up unavailable',
  balanceIngot: (balance: number) => `Ingots ${balance} (permanent)`,
  backToShop: 'Back to shop',
  productName: (ingot: number) => `${ingot} Ingots`,
  productPrice: 'US$1.99',
  productNote: 'One-time payment, not a subscription',
  buy: 'Buy',
  buying: 'Creating your order…',
  unavailableBadge: 'Top-up is unavailable: the payment channel is not set up yet or cannot be reached. Please try again later.',
  opened: 'Finish paying in the page that just opened. Come back here when you are done, and your balance will update automatically.',
  arrived: (amount: number) => `Ingots received +${amount}`,
  returnPending: 'Payment is being processed. Your ingots will update automatically once they arrive.',
  note: 'Ingots can only be spent in the game on convenience items. They cannot be transferred or cashed out.',
  noteLinks: { prefix: 'See the', terms: 'Terms of Service', pricing: 'Pricing', joiner: ' and ', end: '.' },
  errors: {
    TOPUP_MONTHLY_LIMIT: 'You have reached this month’s top-up limit. Please try again next month.',
    TOPUP_TOO_MANY_PENDING: 'Too many unpaid orders. Please try again later.',
    TOPUP_UNAVAILABLE: 'Top-up is unavailable right now. Please try again later.',
    TOPUP_PRODUCT_INVALID: 'This top-up option is invalid. Refresh the page and try again.',
    AGENT_FORBIDDEN: 'Only the player can top up.',
    fallback: 'Top-up failed. Please try again later.',
  },
} satisfies typeof TOPUP_COPY;
