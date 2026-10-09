// 聊天协议的请求封装（AISLG-138，v51）：只负责发请求与拆响应，不持有状态（状态在 useChat.ts）。
// 失败统一成人读提示：协议失败用 chatErrorText；连接异常用调用方给的兜底文案。

import type { ApiClient } from '../api/client';
import { Op } from '../api/protocol';
import type {
  ChatBlockResponseData,
  ChatConversationsResponseData,
  ChatHistoryResponseData,
  ChatReadResponseData,
  ChatReportDetailResponseData,
  ChatSendRequestData,
  ChatSendResponseData,
} from '../api/protocol-chat';
import { chatErrorText } from './chatErrorText';

export type ChatResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function call<T>(client: ApiClient, op: number, fallback: string, data?: Record<string, unknown>): Promise<ChatResult<T>> {
  try {
    const res = await client.request(op, data);
    if (!res.ok) {
      return { ok: false, message: chatErrorText(res) };
    }
    return { ok: true, data: res.data as unknown as T };
  } catch {
    return { ok: false, message: fallback };
  }
}

/** 一页消息（世界频道或与某玩家的私聊）：beforeId 缺省取最新一页 */
export function fetchPage(
  client: ApiClient,
  fallback: string,
  channel: 'world' | 'private',
  peerId: string | null,
  beforeId?: number,
): Promise<ChatResult<ChatHistoryResponseData>> {
  return call(client, Op.CHAT_HISTORY, fallback, {
    channel,
    ...(peerId !== null ? { peerId } : {}),
    limit: 30,
    ...(beforeId !== undefined ? { beforeId } : {}),
  });
}

export function fetchConversations(client: ApiClient, fallback: string): Promise<ChatResult<ChatConversationsResponseData>> {
  return call(client, Op.CHAT_CONVERSATIONS, fallback);
}

export function markRead(client: ApiClient, fallback: string, peerId: string): Promise<ChatResult<ChatReadResponseData>> {
  return call(client, Op.CHAT_READ, fallback, { peerId });
}

export function setBlock(client: ApiClient, fallback: string, accountId: string, blocked: boolean): Promise<ChatResult<ChatBlockResponseData>> {
  return call(client, Op.CHAT_BLOCK, fallback, { accountId, blocked });
}

export function sendMessage(client: ApiClient, fallback: string, payload: ChatSendRequestData): Promise<ChatResult<ChatSendResponseData>> {
  return call(client, Op.CHAT_SEND, fallback, payload as unknown as Record<string, unknown>);
}

export function fetchReport(client: ApiClient, fallback: string, messageId: number): Promise<ChatResult<ChatReportDetailResponseData>> {
  return call(client, Op.CHAT_REPORT_DETAIL, fallback, { messageId });
}
