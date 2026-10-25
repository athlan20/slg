// 聊天「联盟」频道切片（AISLG-183，F2）：本盟消息的最新一页与「更早」翻页（服务端只给入盟之后的消息）、
// 发送后并入、PUSH_CHAT_MESSAGE（channel=alliance）增量合并。没有联盟时不拉取；离盟 / 登出时清空。
// 协议请求复用 chatApi.fetchPage；错误提示经 onError 交给 useChat 统一显示在浮窗的错误行。

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ApiClient } from '../api/client';
import type { ChatMessageView } from '../api/protocol-chat';
import { getCopy } from '../i18n/bundle';
import * as api from './chatApi';
import { appendMessage, prependPage } from './chatList';

export interface AllianceChatSlice {
  messages: ChatMessageView[];
  hasMore: boolean;
  loading: boolean;
  /** 重拉最新一页（切到联盟页签时） */
  reload: () => Promise<void>;
  loadOlder: () => Promise<void>;
  /** 收到或发出的一条联盟消息并入列表（按 id 去重） */
  append: (message: ChatMessageView) => void;
}

export function useAllianceChat(deps: {
  clientRef: RefObject<ApiClient | null>;
  /** 连接已登录在线 */
  online: boolean;
  /** 我所在的联盟；null = 没有联盟（不拉取、列表清空） */
  allianceId: string | null;
  accountId: string | null;
  onError: (message: string | null) => void;
}): AllianceChatSlice {
  const { clientRef, online, allianceId, accountId, onError } = deps;
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  // 异步回调读最新状态：列表镜像、以及拉取时的联盟（切换联盟后丢弃旧响应）
  const messagesRef = useRef<ChatMessageView[]>([]);
  messagesRef.current = messages;
  const allianceRef = useRef<string | null>(allianceId);
  allianceRef.current = allianceId;
  const hasMoreRef = useRef(false);
  hasMoreRef.current = hasMore;
  const loadingRef = useRef(false);

  const fallback = (): string => getCopy().CHAT_COPY.list.loadFailed;

  const reload = useCallback(async () => {
    const c = online ? clientRef.current : null;
    const target = allianceRef.current;
    if (!c || !target) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    const result = await api.fetchPage(c, fallback(), 'alliance', null);
    if (allianceRef.current !== target) {
      return; // 中途换了联盟：旧响应作废
    }
    if (result.ok) {
      setMessages(result.data.messages);
      setHasMore(result.data.hasMore);
      onError(null);
    } else {
      onError(result.message);
    }
    loadingRef.current = false;
    setLoading(false);
  }, [clientRef, online, onError]);

  const loadOlder = useCallback(async () => {
    const c = online ? clientRef.current : null;
    const first = messagesRef.current[0];
    if (!c || !allianceRef.current || !first || !hasMoreRef.current || loadingRef.current) {
      return;
    }
    const target = allianceRef.current;
    loadingRef.current = true;
    setLoading(true);
    const result = await api.fetchPage(c, fallback(), 'alliance', null, first.id);
    if (allianceRef.current === target) {
      if (result.ok) {
        setMessages((prev) => prependPage(prev, result.data.messages));
        setHasMore(result.data.hasMore);
        onError(null);
      } else {
        onError(result.message);
      }
    }
    loadingRef.current = false;
    setLoading(false);
  }, [clientRef, online, onError]);

  const append = useCallback((message: ChatMessageView) => {
    setMessages((prev) => appendMessage(prev, message));
  }, []);

  // 联盟变化 / 登录态变化：没有联盟或未登录清空；入盟（或重连）后拉最新一页
  useEffect(() => {
    if (!accountId || !allianceId) {
      setMessages([]);
      setHasMore(false);
      return;
    }
    if (online) {
      void reload();
    }
  }, [accountId, allianceId, online, reload]);

  return { messages, hasMore, loading, reload, loadOlder, append };
}
