// 礼金事件文字（v89，AISLG-221）：gift_spent 的 detail = { reason, amount, balance }。
// 独立成文件，mapping-world.ts 已超过单文件行数提醒线，这里只做拼装；文案取 GIFT_COPY（按界面语言）。

import type { EventView } from './protocol';
import { getCopy } from '../i18n/bundle';

/** 礼金扣除事件的文字；其他类型返回 null，交给 eventText 的下一级处理 */
export function giftEventText(view: EventView): string | null {
  if (view.type !== 'gift_spent') {
    return null;
  }
  const { GIFT_COPY } = getCopy();
  return GIFT_COPY.event.spent(String(view.detail.reason ?? ''), Number(view.detail.amount ?? 0), Number(view.detail.balance ?? 0));
}
