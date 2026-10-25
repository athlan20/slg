// 聊天视图映射（v51，AISLG-138）：数据库行 → 协议视图。账号名与文字在这里统一过屏蔽词（展示层兜底）。
// v68（AISLG-183）：系统消息没有发送人，内容快照（ChatSystemView）里的玩家名同样过屏蔽词。

import type { ChatChannel, ChatMessageView, ChatPlayerView, ChatSystemView } from '../../common/src/protocol-chat';
import type { ChatMessageRow } from './chat-db';
import type { BannedWordFilter } from './chat-words';

export function playerView(accountId: string, username: string, filter: BannedWordFilter): ChatPlayerView {
  return { accountId, username: filter.mask(username) };
}

/** 系统消息的快照：每个玩家名过屏蔽词，种类与参数原样保留 */
function systemView(system: ChatSystemView, filter: BannedWordFilter): ChatSystemView {
  const mask = (player: ChatPlayerView): ChatPlayerView => playerView(player.accountId, player.username, filter);
  switch (system.kind) {
    case 'alliance_joined':
      return { kind: system.kind, player: mask(system.player), founder: system.founder };
    case 'alliance_left':
      return { kind: system.kind, player: mask(system.player) };
    case 'alliance_kicked':
      return { kind: system.kind, player: mask(system.player), by: mask(system.by) };
    case 'alliance_leader_changed':
      return { kind: system.kind, from: mask(system.from), to: mask(system.to), reason: system.reason };
    case 'alliance_mark_created':
      return { kind: system.kind, player: mask(system.player), markKind: system.markKind, x: system.x, y: system.y };
  }
}

export function chatMessageView(row: ChatMessageRow, filter: BannedWordFilter): ChatMessageView {
  const type = row.system_event ? 'system' : row.card ? 'card' : 'text';
  return {
    id: Number(row.id),
    channel: row.channel as ChatChannel,
    sender: row.sender_id ? playerView(row.sender_id, row.sender_name ?? '', filter) : null,
    recipient: row.recipient_id ? playerView(row.recipient_id, row.recipient_name ?? '', filter) : null,
    type,
    text: row.text,
    card: row.card,
    system: row.system_event ? systemView(row.system_event, filter) : null,
    createdAt: row.created_at.toISOString(),
  };
}
