// 城池迁移的错误码 → 提示与事件流文字（v91，AISLG-220）。文案取 MOVE_CITY_COPY（按界面语言）。

import type { EventView, ErrorCode } from './protocol';
import { getCopy } from '../i18n/bundle';

/** 迁城协议的错误码 → 提示；未知码回退到服务端 message */
export function moveCityErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { MOVE_CITY_COPY } = getCopy();
  const { errors } = MOVE_CITY_COPY;
  switch (code) {
    case 'MOVE_CITY_FAMOUS':
    case 'MOVE_CITY_ARMY_OUTSIDE':
    case 'MOVE_CITY_HAS_ALLY_FORCE':
    case 'MOVE_CITY_IN_BATTLE':
    case 'MOVE_CITY_TILE_INVALID':
    case 'MOVE_CITY_TILE_TAKEN':
    case 'MOVE_CITY_TOO_CLOSE':
    case 'MOVE_CITY_NO_SPACE':
    case 'MOVE_CITY_ATTACK_LOCK':
    case 'INSUFFICIENT_ITEM':
    case 'INVALID_PARAMS':
      return errors[code];
    default:
      return message || errors.fallback;
  }
}

/** 城池迁移事件（city_moved）的文字；其他类型返回 null */
export function moveCityEventText(view: EventView): string | null {
  if (view.type !== 'city_moved') {
    return null;
  }
  const { MOVE_CITY_COPY } = getCopy();
  const from = view.detail.from as { x?: number; y?: number } | undefined;
  const to = view.detail.to as { x?: number; y?: number } | undefined;
  return MOVE_CITY_COPY.event.moved(
    `${Number(from?.x ?? 0)},${Number(from?.y ?? 0)}`,
    `${Number(to?.x ?? 0)},${Number(to?.y ?? 0)}`,
  );
}
