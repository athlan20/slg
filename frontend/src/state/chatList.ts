// 聊天消息列表的共用小工具（AISLG-138 / AISLG-183）：内存上限与按 id 去重的追加 / 接前页。
// 从 useChat.ts 拆出，供 useChat 与联盟频道切片 chatAlliance.ts 共用（避免两者互相引用）。

import type { ChatMessageView } from '../api/protocol-chat';

/** 内存里每个列表最多保留的条数（超出从最旧端丢弃；翻页可再取回） */
export const KEEP = 200;

/** 追加一条（按 id 去重，超出 KEEP 时从最旧端截掉） */
export function appendMessage(list: ChatMessageView[], message: ChatMessageView): ChatMessageView[] {
  if (list.some((item) => item.id === message.id)) {
    return list;
  }
  return [...list, message].slice(-KEEP);
}

/** 更早一页接到列表前面（按 id 去重，保持从旧到新） */
export function prependPage(list: ChatMessageView[], page: ChatMessageView[]): ChatMessageView[] {
  const known = new Set(list.map((item) => item.id));
  const fresh = page.filter((item) => !known.has(item.id));
  return [...fresh, ...list].slice(-KEEP * 2);
}
