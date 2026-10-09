// 聊天视图映射（v51，AISLG-138）：数据库行 → 协议视图。账号名与文字在这里统一过屏蔽词（展示层兜底）。

import type { ChatChannel, ChatMessageView, ChatPlayerView } from '../../common/src/protocol-chat';
import type { ChatMessageRow } from './chat-db';
import type { BannedWordFilter } from './chat-words';

export function playerView(accountId: string, username: string, filter: BannedWordFilter): ChatPlayerView {
  return { accountId, username: filter.mask(username) };
}

export function chatMessageView(row: ChatMessageRow, filter: BannedWordFilter): ChatMessageView {
  const type = row.card ? 'card' : 'text';
  return {
    id: Number(row.id),
    channel: row.channel as ChatChannel,
    sender: playerView(row.sender_id, row.sender_name, filter),
    recipient: row.recipient_id ? playerView(row.recipient_id, row.recipient_name ?? '', filter) : null,
    type,
    text: row.text,
    card: row.card,
    createdAt: row.created_at.toISOString(),
  };
}
