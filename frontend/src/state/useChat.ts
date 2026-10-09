// 聊天会话切片（AISLG-138，v51）：浮窗的开合与页签、当前私聊对象、世界 / 私聊消息（游标分页）、会话与未读、
// 屏蔽名单、发送与卡片草稿，以及 PUSH_CHAT_MESSAGE 到达后的实时合并。协议请求在 chatApi.ts，这里只管状态。
// 只依赖 clientRef 与在线状态（与 session-extras 同一模式）；开合与页签只记在本机（localStorage，刷新后恢复），
// 消息与未读一律以服务端为准。

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ApiClient } from '../api/client';
import { Op } from '../api/protocol';
import type {
  ChatCardRequest,
  ChatConversationView,
  ChatMessageView,
  ChatPlayerView,
  PushChatMessageData,
} from '../api/protocol-chat';
import type { BattleReportView } from '../api/protocol-world';
import { getCopy } from '../i18n/bundle';
import * as api from './chatApi';

export type ChatTab = 'world' | 'system' | 'private';

/** 卡片草稿：分享入口放进输入框的卡片（label 为发送前预览，由调用方按当前语言拼好） */
export interface ChatDraft {
  card: ChatCardRequest;
  label: string;
}

export type ChatSendResult = { ok: true } | { ok: false; message: string };

export interface ChatSendInput {
  channel: 'world' | 'private';
  text?: string;
  emoji?: string;
  card?: ChatCardRequest;
}

export interface ChatState {
  /** 浮窗是否展开（桌面浮窗 / 手机全屏共用） */
  open: boolean;
  setOpen: (open: boolean) => void;
  tab: ChatTab;
  setTab: (tab: ChatTab) => void;
  /** 当前私聊对象；null = 停在会话列表 */
  peer: ChatPlayerView | null;
  openPrivate: (peer: ChatPlayerView) => void;
  leavePrivate: () => void;
  /** 世界频道消息（从旧到新）与「更早」翻页 */
  world: ChatMessageView[];
  worldHasMore: boolean;
  worldLoading: boolean;
  loadOlderWorld: () => Promise<void>;
  /** 当前私聊对象的消息（从旧到新）与翻页 */
  thread: ChatMessageView[];
  threadHasMore: boolean;
  threadLoading: boolean;
  loadOlderThread: () => Promise<void>;
  /** 私聊会话（按最后一条消息倒序）、私聊未读总数、我的屏蔽名单 */
  conversations: ChatConversationView[];
  unreadTotal: number;
  blocked: ChatPlayerView[];
  refreshConversations: () => Promise<void>;
  /** 世界频道最新一条（收起条展示） */
  latestWorld: ChatMessageView | null;
  /** 卡片草稿（分享入口放进来，发送或移除后清空） */
  draft: ChatDraft | null;
  setDraft: (draft: ChatDraft | null) => void;
  /** 分享入口：放进草稿并展开浮窗（系统播报页签切到世界） */
  shareDraft: (draft: ChatDraft) => void;
  send: (input: ChatSendInput) => Promise<ChatSendResult>;
  /** 屏蔽 / 取消屏蔽；失败返回提示文字，成功返回 null */
  setBlocked: (accountId: string, blocked: boolean) => Promise<string | null>;
  /** 打开聊天里的战报卡片：返回分享时刻的快照；失败返回 null */
  openReport: (messageId: number) => Promise<Omit<BattleReportView, 'comment'> | null>;
  /** 最近一次加载失败的提示（列表区展示，下次成功加载后清空） */
  error: string | null;
}

/** 内存里每个列表最多保留的条数（超出从最旧端丢弃；翻页可再取回） */
const KEEP = 200;
const OPEN_KEY = 'slg.chat.open';
const TAB_KEY = 'slg.chat.tab';
const TABS: readonly ChatTab[] = ['world', 'system', 'private'];

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // 记忆失败不影响本次展开 / 收起
  }
}

/** 追加一条（按 id 去重，超出 KEEP 时从最旧端截掉） */
function appendMessage(list: ChatMessageView[], message: ChatMessageView): ChatMessageView[] {
  if (list.some((item) => item.id === message.id)) {
    return list;
  }
  return [...list, message].slice(-KEEP);
}

/** 更早一页接到列表前面（按 id 去重，保持从旧到新） */
function prependPage(list: ChatMessageView[], page: ChatMessageView[]): ChatMessageView[] {
  const known = new Set(list.map((item) => item.id));
  const fresh = page.filter((item) => !known.has(item.id));
  return [...fresh, ...list].slice(-KEEP * 2);
}

export function useChat(deps: {
  clientRef: RefObject<ApiClient | null>;
  /** 连接已登录在线（reconnecting / 未登录时为 false，聊天入口置灰） */
  online: boolean;
  accountId: string | null;
}): ChatState {
  const { clientRef, online, accountId } = deps;
  const [open, setOpenState] = useState<boolean>(() => readStored(OPEN_KEY) === '1');
  const [tab, setTabState] = useState<ChatTab>(() => {
    const stored = readStored(TAB_KEY);
    return TABS.includes(stored as ChatTab) ? (stored as ChatTab) : 'world';
  });
  const [peer, setPeer] = useState<ChatPlayerView | null>(null);
  const [world, setWorld] = useState<ChatMessageView[]>([]);
  const [worldHasMore, setWorldHasMore] = useState(false);
  const [worldLoading, setWorldLoading] = useState(false);
  const [thread, setThread] = useState<ChatMessageView[]>([]);
  const [threadHasMore, setThreadHasMore] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [conversations, setConversations] = useState<ChatConversationView[]>([]);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [blocked, setBlockedList] = useState<ChatPlayerView[]>([]);
  const [draft, setDraft] = useState<ChatDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 推送回调读取的是最新状态（回调注册一次，不随每次渲染重绑）
  const live = useRef({ open, tab, peer, accountId });
  live.current = { open, tab, peer, accountId };
  const worldRef = useRef<ChatMessageView[]>([]);
  worldRef.current = world;
  const threadRef = useRef<ChatMessageView[]>([]);
  threadRef.current = thread;

  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    writeStored(OPEN_KEY, next ? '1' : '0');
  }, []);

  const setTab = useCallback((next: ChatTab) => {
    setTabState(next);
    writeStored(TAB_KEY, next);
  }, []);

  const client = useCallback(() => (online ? clientRef.current : null), [clientRef, online]);
  const loadFailed = (): string => getCopy().CHAT_COPY.list.loadFailed;

  /** 失败时记下提示；成功时清空 */
  const settle = useCallback((result: { ok: boolean; message?: string }): boolean => {
    if (result.ok) {
      setError(null);
      return true;
    }
    setError(result.message ?? loadFailed());
    return false;
  }, []);

  const loadWorld = useCallback(async () => {
    const c = client();
    if (!c) {
      return;
    }
    setWorldLoading(true);
    const result = await api.fetchPage(c, loadFailed(), 'world', null);
    if (settle(result) && result.ok) {
      setWorld(result.data.messages.slice(-KEEP));
      setWorldHasMore(result.data.hasMore);
    }
    setWorldLoading(false);
  }, [client, settle]);

  const loadOlderWorld = useCallback(async () => {
    const c = client();
    const first = worldRef.current[0];
    if (!c || !first || !worldHasMore || worldLoading) {
      return;
    }
    setWorldLoading(true);
    const result = await api.fetchPage(c, loadFailed(), 'world', null, first.id);
    if (settle(result) && result.ok) {
      setWorld((prev) => prependPage(prev, result.data.messages));
      setWorldHasMore(result.data.hasMore);
    }
    setWorldLoading(false);
  }, [client, settle, worldHasMore, worldLoading]);

  const refreshConversations = useCallback(async () => {
    const c = client();
    if (!c) {
      return;
    }
    // 会话列表拉取失败不打断浮窗，下次推送或展开时再拉
    const result = await api.fetchConversations(c, loadFailed());
    if (result.ok) {
      setConversations(result.data.conversations);
      setUnreadTotal(result.data.unreadTotal);
      setBlockedList(result.data.blocked);
    }
  }, [client]);

  const markRead = useCallback(
    async (peerId: string) => {
      const c = client();
      if (!c) {
        return;
      }
      // 已读标记失败只影响角标，下次刷新会校正
      const result = await api.markRead(c, loadFailed(), peerId);
      if (result.ok) {
        setUnreadTotal(result.data.unreadTotal);
        setConversations((prev) => prev.map((item) => (item.peer.accountId === peerId ? { ...item, unread: 0 } : item)));
      }
    },
    [client],
  );

  const loadThread = useCallback(
    async (peerId: string) => {
      const c = client();
      if (!c) {
        return;
      }
      setThreadLoading(true);
      const result = await api.fetchPage(c, loadFailed(), 'private', peerId);
      if (settle(result) && result.ok) {
        setThread(result.data.messages.slice(-KEEP));
        setThreadHasMore(result.data.hasMore);
        void markRead(peerId);
      }
      setThreadLoading(false);
    },
    [client, markRead, settle],
  );

  const loadOlderThread = useCallback(async () => {
    const c = client();
    const peerId = live.current.peer?.accountId;
    const first = threadRef.current[0];
    if (!c || !peerId || !first || !threadHasMore || threadLoading) {
      return;
    }
    setThreadLoading(true);
    const result = await api.fetchPage(c, loadFailed(), 'private', peerId, first.id);
    if (settle(result) && result.ok) {
      setThread((prev) => prependPage(prev, result.data.messages));
      setThreadHasMore(result.data.hasMore);
    }
    setThreadLoading(false);
  }, [client, settle, threadHasMore, threadLoading]);

  // 登录态变化：未登录清空；在线后拉世界频道与会话（收起条需要最新一条与未读）
  useEffect(() => {
    if (!accountId) {
      setWorld([]);
      setWorldHasMore(false);
      setThread([]);
      setConversations([]);
      setUnreadTotal(0);
      setBlockedList([]);
      setPeer(null);
      setDraft(null);
      setError(null);
      return;
    }
    if (online) {
      void loadWorld();
      void refreshConversations();
    }
  }, [accountId, online, loadWorld, refreshConversations]);

  // 切换私聊对象：清空旧线程并拉新线程
  useEffect(() => {
    setThread([]);
    setThreadHasMore(false);
    if (peer && online) {
      void loadThread(peer.accountId);
    }
  }, [peer?.accountId, online, loadThread]);

  // 展开浮窗 / 切页签：刷新当前页签的数据（推送断过的消息由此补齐）
  useEffect(() => {
    if (!open || !online || !accountId) {
      return;
    }
    void refreshConversations();
    if (tab === 'world') {
      void loadWorld();
    }
  }, [open, tab]);

  /** PUSH_CHAT_MESSAGE 到达：世界频道直接并入；私聊若正在看这位对方就并入线程并已读，否则只刷新会话与角标 */
  const handleIncoming = useCallback(
    (message: ChatMessageView) => {
      if (message.channel === 'world') {
        setWorld((prev) => appendMessage(prev, message));
        return;
      }
      const me = live.current.accountId;
      const peerId = message.sender.accountId === me ? message.recipient?.accountId : message.sender.accountId;
      if (!peerId) {
        return;
      }
      const viewing = live.current.open && live.current.tab === 'private' && live.current.peer?.accountId === peerId;
      if (viewing) {
        setThread((prev) => appendMessage(prev, message));
        if (message.sender.accountId !== me) {
          void markRead(peerId);
        }
      } else {
        void refreshConversations();
      }
    },
    [markRead, refreshConversations],
  );

  useEffect(() => {
    const c = client();
    if (!c || !accountId) {
      return undefined;
    }
    return c.onPush((frame) => {
      if (frame.op === Op.PUSH_CHAT_MESSAGE) {
        handleIncoming((frame.data as unknown as PushChatMessageData).message);
      }
    });
  }, [client, accountId, handleIncoming]);

  const openPrivate = useCallback(
    (target: ChatPlayerView) => {
      setPeer(target);
      setTab('private');
      setOpen(true);
    },
    [setOpen, setTab],
  );

  const leavePrivate = useCallback(() => setPeer(null), []);

  const shareDraft = useCallback(
    (next: ChatDraft) => {
      setDraft(next);
      if (live.current.tab === 'system') {
        setTab('world');
      }
      setOpen(true);
    },
    [setOpen, setTab],
  );

  const send = useCallback(
    async (input: ChatSendInput): Promise<ChatSendResult> => {
      const c = client();
      const { CHAT_COPY } = getCopy();
      if (!c) {
        return { ok: false, message: CHAT_COPY.offline };
      }
      const target = live.current.peer;
      if (input.channel === 'private' && !target) {
        return { ok: false, message: CHAT_COPY.composer.channelPrivate('') };
      }
      const result = await api.sendMessage(c, CHAT_COPY.errors.generic, {
        channel: input.channel,
        ...(input.channel === 'private' && target ? { peerId: target.accountId } : {}),
        ...(input.text ? { text: input.text } : {}),
        ...(input.emoji ? { emoji: input.emoji } : {}),
        ...(input.card ? { card: input.card } : {}),
      });
      if (!result.ok) {
        return { ok: false, message: result.message };
      }
      const message = result.data.message;
      if (message.channel === 'world') {
        setWorld((prev) => appendMessage(prev, message));
      } else {
        setThread((prev) => appendMessage(prev, message));
      }
      setError(null);
      return { ok: true };
    },
    [client],
  );

  const setBlocked = useCallback(
    async (targetId: string, next: boolean): Promise<string | null> => {
      const c = client();
      if (!c) {
        return getCopy().CHAT_COPY.offline;
      }
      const result = await api.setBlock(c, loadFailed(), targetId, next);
      if (!result.ok) {
        return result.message;
      }
      setBlockedList(result.data.blocked);
      // 屏蔽立即影响世界频道的可见性：重拉一页
      void loadWorld();
      return null;
    },
    [client, loadWorld],
  );

  const openReport = useCallback(
    async (messageId: number): Promise<Omit<BattleReportView, 'comment'> | null> => {
      const c = client();
      if (!c) {
        return null;
      }
      const result = await api.fetchReport(c, loadFailed(), messageId);
      return result.ok ? result.data.report : null;
    },
    [client],
  );

  const latestWorld = world.length > 0 ? world[world.length - 1] : null;

  return {
    open,
    setOpen,
    tab,
    setTab,
    peer,
    openPrivate,
    leavePrivate,
    world,
    worldHasMore,
    worldLoading,
    loadOlderWorld,
    thread,
    threadHasMore,
    threadLoading,
    loadOlderThread,
    conversations,
    unreadTotal,
    blocked,
    refreshConversations,
    latestWorld,
    draft,
    setDraft,
    shareDraft,
    send,
    setBlocked,
    openReport,
    error,
  };
}
