// 英文文案孪生：copy-legal.ts，逐成员 satisfies 对应中文对象的类型。
// 登录页页脚文案（英文）

import { LEGAL_COPY } from './copy-legal';

export const LEGAL_COPY_EN = {
  footerLabel: 'Privacy and terms',
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  pricing: 'Pricing',
  support: 'Support email',
  priceNote: 'US$1.99 = 1,000 Ingots, one-time payment, no subscription. The game is free; Ingots only buy convenience items.',
} satisfies typeof LEGAL_COPY;
