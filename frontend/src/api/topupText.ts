// 充值错误码 → 提示（v108，AISLG-251）。文案取 TOPUP_COPY（按界面语言）；未知错误码回退通用提示。

import type { ErrorCode } from './protocol';
import { getCopy } from '../i18n/bundle';

export function topupErrorText(code: ErrorCode | undefined): string {
  const { errors } = getCopy().TOPUP_COPY;
  switch (code) {
    case 'TOPUP_MONTHLY_LIMIT':
      return errors.TOPUP_MONTHLY_LIMIT;
    case 'TOPUP_TOO_MANY_PENDING':
      return errors.TOPUP_TOO_MANY_PENDING;
    case 'TOPUP_UNAVAILABLE':
      return errors.TOPUP_UNAVAILABLE;
    case 'TOPUP_PRODUCT_INVALID':
      return errors.TOPUP_PRODUCT_INVALID;
    case 'AGENT_FORBIDDEN':
      return errors.AGENT_FORBIDDEN;
    default:
      return errors.fallback;
  }
}
