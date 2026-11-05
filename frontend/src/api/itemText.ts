// 道具文字（AISLG-222，v90）：道具事件流（item_granted / item_used / item_bought）与购买 / 消耗的错误提示。
// 文案取 ITEM_COPY（按界面语言），道具名取 ITEM_COPY.names；未知道具 id 原样显示。

import type { EventView, ErrorCode } from './protocol';
import { getCopy } from '../i18n/bundle';

function itemName(itemId: unknown): string {
  const { names } = getCopy().ITEM_COPY;
  const key = String(itemId ?? '') as keyof typeof names;
  return names[key] ?? String(itemId ?? '');
}

/** 道具事件的文字；其他类型返回 null，交给 mapping-world 的下一级处理 */
export function itemEventText(view: EventView): string | null {
  const { event } = getCopy().ITEM_COPY;
  const detail = view.detail;
  switch (view.type) {
    case 'item_granted':
      return event.granted(itemName(detail.itemId), Number(detail.granted ?? 0), Number(detail.requested ?? 0));
    case 'item_used':
      return event.used(itemName(detail.itemId), Number(detail.amount ?? 0), Number(detail.left ?? 0));
    case 'item_bought':
      return event.bought(itemName(detail.itemId), Number(detail.count ?? 0), Number(detail.cost ?? 0));
    default:
      return null;
  }
}

/** 道具协议的错误码 → 提示（ITEM_PRICE_CHANGED / ITEM_STACK_FULL 的数据由调用方另行处理） */
export function itemErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { errors } = getCopy().ITEM_COPY;
  switch (code) {
    case 'INVALID_PARAMS':
      return errors.INVALID_PARAMS;
    case 'INSUFFICIENT_GIFT':
      return errors.INSUFFICIENT_GIFT;
    case 'INSUFFICIENT_ITEM':
      return errors.INSUFFICIENT_ITEM;
    case 'ITEM_STACK_FULL':
      return errors.ITEM_STACK_FULL;
    case 'ITEM_PRICE_CHANGED':
      return errors.ITEM_PRICE_CHANGED;
    default:
      return message || errors.fallback;
  }
}
