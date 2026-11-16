// 聊天「活动」页签的已读状态（v112，AISLG-260）：负责聊天按钮红点的消失 / 亮起。
// 已读位置只在本机（见 chatEventRead.ts 的纯函数），不新增服务端字段 / 表。
// 规则：首次拿到播报时把最新一条记为已读（避免首次登录一片红点）；进页签即视为已读到最新一条。

import { useEffect, useState } from 'react';
import type { ServerBroadcastView } from '../api/protocol-server';
import { hasUnseenEvent, readEventSeenId, writeEventSeenId } from './chatEventRead';

export interface ChatEventTabState {
  /** 「活动」页签有未看过的新消息（聊天按钮红点） */
  eventUnread: boolean;
}

export function useChatEventTab(deps: {
  accountId: string | null;
  /** 正在看「活动」页签（浮窗展开且页签是活动） */
  viewing: boolean;
  /** 活动播报（新→旧）：用最新一条的 id 判断未读 */
  eventBroadcasts: ServerBroadcastView[];
}): ChatEventTabState {
  const { accountId, viewing, eventBroadcasts } = deps;
  // 看到过的最新一条 id（只在本机，换账号重新读）
  const [eventSeenId, setEventSeenId] = useState<number | null>(() => readEventSeenId(accountId));
  const latestEventId = eventBroadcasts.length > 0 ? eventBroadcasts[0].id : null;

  // 换账号：重新读该账号的已读位置（没有记录 = 全部已读）
  useEffect(() => {
    setEventSeenId(readEventSeenId(accountId));
  }, [accountId]);

  // 预置基线：第一次拿到活动播报时把「最新一条」记为已读，只有之后新到的才亮红点
  useEffect(() => {
    if (!accountId || latestEventId === null || eventSeenId !== null) {
      return;
    }
    setEventSeenId(latestEventId);
    writeEventSeenId(accountId, latestEventId);
  }, [accountId, latestEventId, eventSeenId]);

  // 进活动页签即视为已读（之后实时推送的新消息也在这里一并记下）
  useEffect(() => {
    if (!viewing || !accountId || latestEventId === null || latestEventId <= (eventSeenId ?? 0)) {
      return;
    }
    setEventSeenId(latestEventId);
    writeEventSeenId(accountId, latestEventId);
  }, [viewing, accountId, latestEventId, eventSeenId]);

  return { eventUnread: hasUnseenEvent(eventSeenId, latestEventId) };
}