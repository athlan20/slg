// 公告切片（AISLG-162，v60）：红点数、生效中 / 往期列表、正文与已读、强提醒弹窗队列。
// 拉取走 GET_ANNOUNCEMENTS / GET_ANNOUNCEMENT / READ_ANNOUNCEMENT；新公告经 PUSH_ANNOUNCEMENT 到达后重拉列表。
// 强提醒：进主界面（登录 / 重连）与推送到达时，把生效中、未读、strongRemind 的公告放进队列，合并成一个弹窗；
// 点「知道了」才全部标记已读。X 关闭只是本次隐藏，下次进主界面还会弹。
// 只依赖 clientRef；与游戏状态无关，由 useGameSession 挂载。

import { useCallback, useState, type RefObject } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type AnnouncementDetailView,
  type AnnouncementView,
  type GetAnnouncementResponseData,
  type GetAnnouncementsResponseData,
  type PushAnnouncementData,
  type ReadAnnouncementResponseData,
} from '../api/protocol';
import { getLang } from '../i18n/lang';

export type AnnouncementTab = 'active' | 'history';

/** 往期每页条数（与服务端默认一致） */
const HISTORY_PAGE = 20;

export interface AnnouncementSlice {
  /** 生效中且未读的公告数（红点） */
  unreadCount: number;
  /** 生效中的公告（置顶在前） */
  items: AnnouncementView[];
  /** 往期（已结束）公告，按发布时间倒序；按需加载 */
  historyItems: AnnouncementView[];
  historyHasMore: boolean;
  tab: AnnouncementTab;
  /** 公告弹窗是否打开 */
  open: boolean;
  /** 当前打开的正文；null = 列表页 */
  detail: AnnouncementDetailView | null;
  detailLoading: boolean;
  detailError: boolean;
  listError: boolean;
  /** 强提醒队列（已带正文）；非空即弹窗 */
  strongQueue: AnnouncementDetailView[];
  openList: () => void;
  /** 直接打开某条公告的正文（全服播报点击用） */
  openAnnouncement: (id: number) => void;
  closeList: () => void;
  setTab: (tab: AnnouncementTab) => void;
  openDetail: (id: number) => Promise<void>;
  backToList: () => void;
  loadMoreHistory: () => Promise<void>;
  /** 拉取列表与红点；popStrong 为真时把未读强提醒放进弹窗队列（进主界面、推送到达） */
  refresh: (popStrong?: boolean) => Promise<void>;
  onPush: (data: PushAnnouncementData) => void;
  /** 强提醒点「知道了」：队列内全部标记已读 */
  confirmStrong: () => Promise<void>;
  /** 强提醒 X 关闭：只隐藏，不标记已读 */
  hideStrong: () => void;
  /** 登出 / 切换账号时清空（已读状态是账号私有的） */
  reset: () => void;
}

export function useAnnouncements(clientRef: RefObject<ApiClient | null>): AnnouncementSlice {
  const [unreadCount, setUnreadCount] = useState(0);
  const [items, setItems] = useState<AnnouncementView[]>([]);
  const [historyItems, setHistoryItems] = useState<AnnouncementView[]>([]);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [tab, setTabState] = useState<AnnouncementTab>('active');
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AnnouncementDetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState(false);
  const [listError, setListError] = useState(false);
  const [strongQueue, setStrongQueue] = useState<AnnouncementDetailView[]>([]);

  /** 已连接时发请求；失败或未连接返回 null（保留现有数据） */
  const request = useCallback(
    async <T,>(op: number, data: Record<string, unknown>): Promise<T | null> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return null;
      }
      try {
        const res = await client.request(op, data);
        return res.ok && res.data ? (res.data as unknown as T) : null;
      } catch {
        return null;
      }
    },
    [clientRef],
  );

  /** 把已读状态回写到列表、往期与正文，并同步红点数 */
  const applyRead = useCallback((id: number, count: number) => {
    setUnreadCount(count);
    const mark = <T extends AnnouncementView>(list: T[]) => list.map((item) => (item.id === id ? { ...item, read: true } : item));
    setItems(mark);
    setHistoryItems(mark);
    setDetail((current) => (current && current.id === id ? { ...current, read: true } : current));
  }, []);

  const markRead = useCallback(
    async (id: number) => {
      const res = await request<ReadAnnouncementResponseData>(Op.READ_ANNOUNCEMENT, { id });
      if (res) {
        applyRead(id, res.unreadCount);
      }
    },
    [request, applyRead],
  );

  const refresh = useCallback(
    async (popStrong = false) => {
      const data = await request<GetAnnouncementsResponseData>(Op.GET_ANNOUNCEMENTS, { lang: getLang() });
      if (!data) {
        setListError(true);
        return;
      }
      setListError(false);
      setItems(data.announcements);
      setUnreadCount(data.unreadCount);
      if (!popStrong) {
        return;
      }
      const pending = data.announcements.filter((item) => item.strongRemind && !item.read);
      if (pending.length === 0) {
        return;
      }
      const bodies = await Promise.all(
        pending.map((item) => request<GetAnnouncementResponseData>(Op.GET_ANNOUNCEMENT, { id: item.id, lang: getLang() })),
      );
      const loaded = bodies.flatMap((res) => (res ? [res.announcement] : []));
      setStrongQueue((prev) => {
        const known = new Set(prev.map((item) => item.id));
        return [...prev, ...loaded.filter((item) => !known.has(item.id))];
      });
    },
    [request],
  );

  const loadHistory = useCallback(
    async (beforeId?: number) => {
      const data = await request<GetAnnouncementsResponseData>(Op.GET_ANNOUNCEMENTS, {
        lang: getLang(),
        history: true,
        limit: HISTORY_PAGE,
        ...(beforeId !== undefined ? { beforeId } : {}),
      });
      if (!data) {
        setListError(true);
        return;
      }
      setListError(false);
      setHistoryItems((prev) => (beforeId === undefined ? data.announcements : [...prev, ...data.announcements]));
      setHistoryHasMore(data.announcements.length === HISTORY_PAGE);
      setHistoryLoaded(true);
    },
    [request],
  );

  /** 离开正文（返回列表 / 换页签 / 重开列表）：正文与加载失败态一起清，否则失败页会一直盖住列表 */
  const clearDetail = useCallback(() => {
    setDetail(null);
    setDetailError(false);
  }, []);

  const setTab = useCallback(
    (next: AnnouncementTab) => {
      setTabState(next);
      clearDetail();
      if (next === 'history' && !historyLoaded) {
        void loadHistory();
      }
    },
    [historyLoaded, loadHistory, clearDetail],
  );

  const openDetail = useCallback(
    async (id: number) => {
      setDetailLoading(true);
      setDetailError(false);
      setDetail(null);
      const res = await request<GetAnnouncementResponseData>(Op.GET_ANNOUNCEMENT, { id, lang: getLang() });
      setDetailLoading(false);
      if (!res) {
        setDetailError(true);
        return;
      }
      setDetail(res.announcement);
      if (!res.announcement.read) {
        await markRead(id);
      }
    },
    [request, markRead],
  );

  const openList = useCallback(() => {
    setOpen(true);
    setTabState('active');
    clearDetail();
    void refresh(false);
  }, [refresh, clearDetail]);

  const openAnnouncement = useCallback(
    (id: number) => {
      setOpen(true);
      setTabState('active');
      void refresh(false);
      void openDetail(id);
    },
    [refresh, openDetail],
  );

  const closeList = useCallback(() => {
    setOpen(false);
    clearDetail();
  }, [clearDetail]);

  const loadMoreHistory = useCallback(async () => {
    const last = historyItems[historyItems.length - 1];
    if (last) {
      await loadHistory(last.id);
    }
  }, [historyItems, loadHistory]);

  const onPush = useCallback(
    (data: PushAnnouncementData) => {
      void refresh(data.strongRemind);
    },
    [refresh],
  );

  const confirmStrong = useCallback(async () => {
    const queue = strongQueue;
    setStrongQueue([]);
    for (const item of queue) {
      await markRead(item.id);
    }
  }, [strongQueue, markRead]);

  const hideStrong = useCallback(() => setStrongQueue([]), []);

  const reset = useCallback(() => {
    setUnreadCount(0);
    setItems([]);
    setHistoryItems([]);
    setHistoryHasMore(false);
    setHistoryLoaded(false);
    setTabState('active');
    setOpen(false);
    setDetail(null);
    setDetailError(false);
    setListError(false);
    setStrongQueue([]);
  }, []);

  return {
    unreadCount,
    items,
    historyItems,
    historyHasMore,
    tab,
    open,
    detail,
    detailLoading,
    detailError,
    listError,
    strongQueue,
    openList,
    openAnnouncement,
    closeList,
    setTab,
    openDetail,
    backToList: clearDetail,
    loadMoreHistory,
    refresh,
    onPush,
    confirmStrong,
    hideStrong,
    reset,
  };
}
