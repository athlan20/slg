// 「活动」页签的已读位置（v112，AISLG-260）：聊天按钮红点只看本机记下的最后一条已看活动消息 id。
// 只写 localStorage（键里带账号 id），不新增服务端字段 / 表；读写都用 try/catch 包住——
// 隐私模式 / 存储被禁用时不当崩溃。读不到或首次（没有记录）一律视为全部已读，避免首次登录就一片红点。

import { appStorage } from '../storage.ts';

/** 已读位置的存储键前缀（拼上账号 id） */
const KEY_PREFIX = 'slg.chat.event.seen.';

/** 某个账号的存储键（测试与排查用） */
export function eventSeenKey(accountId: string): string {
  return `${KEY_PREFIX}${accountId}`;
}

/** 读已看到的最后一条活动播报 id；没有记录 / 值非法 / 存储不可用都返回 null（= 全部已读） */
export function readEventSeenId(accountId: string | null): number | null {
  if (!accountId) {
    return null;
  }
  try {
    const raw = appStorage.getItem(eventSeenKey(accountId));
    if (raw === null) {
      return null;
    }
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? Math.floor(id) : null;
  } catch {
    return null;
  }
}

/** 记下已看到的最后一条活动播报 id（写失败不影响本次已读） */
export function writeEventSeenId(accountId: string | null, id: number): void {
  if (!accountId || !Number.isFinite(id) || id <= 0) {
    return;
  }
  try {
    appStorage.setItem(eventSeenKey(accountId), String(Math.floor(id)));
  } catch {
    // 存储不可用：这次不记，下次进入页签再试
  }
}

/**
 * 有没有未看过的新活动消息：没有记录（首次登录）视为全部已读；
 * 只看 id 递增（播报 id 是 bigserial，断线补拉与实时推送都靠它比较）。
 */
export function hasUnseenEvent(seenId: number | null, latestId: number | null): boolean {
  return seenId !== null && latestId !== null && latestId > seenId;
}