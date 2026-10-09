// 聊天错误响应 → 人读提示（AISLG-138，v51）。文案取当前语言（getCopy），不在模块顶层取用。

import { CHAT_WORLD_MIN_GOVERNMENT, type ResponseFrame } from '../api/protocol';
import { getCopy } from '../i18n/bundle';

/** 把聊天协议的失败响应拼成一句提示：限频带秒数、禁言带解禁时间、官府门槛带等级 */
export function chatErrorText(frame: ResponseFrame): string {
  const { CHAT_COPY } = getCopy();
  const { errors } = CHAT_COPY;
  const code = frame.error?.code;
  const data = frame.data as Record<string, unknown> | undefined;
  if (code === 'CHAT_RATE_LIMITED') {
    const seconds = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 10;
    return errors.CHAT_RATE_LIMITED(seconds);
  }
  if (code === 'CHAT_MUTED') {
    const until = typeof data?.until === 'string' ? formatUntil(data.until) : '';
    return errors.CHAT_MUTED(until);
  }
  if (code === 'CHAT_GOVERNMENT_TOO_LOW') {
    return errors.CHAT_GOVERNMENT_TOO_LOW(CHAT_WORLD_MIN_GOVERNMENT);
  }
  if (code === 'CHAT_BLOCKED') {
    return errors.CHAT_BLOCKED;
  }
  if (code === 'INVALID_PARAMS') {
    return errors.INVALID_PARAMS;
  }
  if (code === 'AGENT_FORBIDDEN') {
    return errors.AGENT_FORBIDDEN;
  }
  if (code === 'NOT_LOGGED_IN') {
    return errors.NOT_LOGGED_IN;
  }
  if (code === 'INTERNAL') {
    return errors.INTERNAL;
  }
  return errors.generic;
}

function formatUntil(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
