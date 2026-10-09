// 聊天请求参数的校验（v51，AISLG-138）：只做形状与范围判断，归属与业务规则在处理器里查库确认。

import {
  CHAT_TEXT_MAX_CHARS,
  type ChatCardRequest,
  type ChatChannel,
} from '../../common/src/protocol-chat';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function readChannel(value: unknown): ChatChannel | null {
  return value === 'world' || value === 'private' ? value : null;
}

/** 去首尾空白后的文字：空串或超过 100 码点返回 null（调用方据此返回 INVALID_PARAMS） */
export function normalizeChatText(value: string): string | null {
  const text = value.trim();
  if (text.length === 0 || Array.from(text).length > CHAT_TEXT_MAX_CHARS) {
    return null;
  }
  return text;
}

/** 卡片请求：只认 kind 与对应的 id / 坐标；坐标的范围由调用方按地图大小判断 */
export function readCardRequest(value: unknown): ChatCardRequest | null {
  if (value === null || typeof value !== 'object') {
    return null;
  }
  const card = value as Record<string, unknown>;
  if (card.kind === 'coord') {
    const x = card.x;
    const y = card.y;
    return Number.isInteger(x) && Number.isInteger(y) ? { kind: 'coord', x: x as number, y: y as number } : null;
  }
  if (card.kind === 'hero') {
    const heroId = card.heroId;
    return isUuid(heroId) ? { kind: 'hero', heroId } : null;
  }
  if (card.kind === 'report') {
    const reportId = card.reportId;
    return Number.isInteger(reportId) && (reportId as number) >= 1 ? { kind: 'report', reportId: reportId as number } : null;
  }
  if (card.kind === 'city') {
    const cityId = card.cityId;
    return isUuid(cityId) ? { kind: 'city', cityId } : null;
  }
  return null;
}
