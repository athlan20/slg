// 聊天协议（v51，AISLG-138）的前端镜像：与 backend/common/src/protocol-chat.ts 同构，手工同步
// （协议调整时以后端为准）。仅限玩家连接；Agent 连接不可用。

import type { BattleReportView, TerrainKind, TileKind } from './protocol-world';

export type ChatChannel = 'world' | 'private';
export type ChatCardKind = 'coord' | 'hero' | 'report' | 'city';

/** 单条文字上限（字符数，去首尾空白后） */
export const CHAT_TEXT_MAX_CHARS = 100;
/** 世界频道发言所需的主城官府等级 */
export const CHAT_WORLD_MIN_GOVERNMENT = 3;
/** 同一频道两次发言的最小间隔（毫秒） */
export const CHAT_RATE_LIMIT_MS = 10_000;

export interface ChatPlayerView {
  accountId: string;
  username: string;
}

export type ChatCardView =
  | { kind: 'coord'; x: number; y: number; terrain: TerrainKind; tileKind: TileKind; level: number }
  | { kind: 'hero'; name: string; famous: boolean; level: number; lead: number; force: number; wit: number }
  | {
      kind: 'report';
      battleKind: BattleReportView['kind'];
      role: 'attacker' | 'defender';
      won: boolean;
      attackerName: string;
      defenderName: string;
      reportedAt: string;
    }
  | { kind: 'city'; name: string; ownerName: string; level: number; x: number; y: number };

export interface ChatMessageView {
  id: number;
  channel: ChatChannel;
  sender: ChatPlayerView;
  recipient: ChatPlayerView | null;
  type: 'text' | 'card';
  text: string | null;
  card: ChatCardView | null;
  createdAt: string;
}

export interface ChatHistoryRequestData {
  channel: ChatChannel;
  peerId?: string;
  limit?: number;
  beforeId?: number;
}

export interface ChatHistoryResponseData {
  messages: ChatMessageView[];
  hasMore: boolean;
}

/** 卡片请求：只传 id 或坐标，快照由服务端生成 */
export type ChatCardRequest =
  | { kind: 'coord'; x: number; y: number }
  | { kind: 'hero'; heroId: string }
  | { kind: 'report'; reportId: number }
  | { kind: 'city'; cityId: string };

export interface ChatSendRequestData {
  channel: ChatChannel;
  peerId?: string;
  text?: string;
  card?: ChatCardRequest;
}

export interface ChatSendResponseData {
  message: ChatMessageView;
}

export interface ChatConversationView {
  peer: ChatPlayerView;
  last: ChatMessageView;
  unread: number;
}

export interface ChatConversationsResponseData {
  conversations: ChatConversationView[];
  unreadTotal: number;
  blocked: ChatPlayerView[];
}

export interface ChatReadResponseData {
  unreadTotal: number;
}

export interface ChatBlockResponseData {
  blocked: ChatPlayerView[];
}

export interface ChatReportDetailResponseData {
  report: Omit<BattleReportView, 'comment'>;
}

/** PUSH_CHAT_MESSAGE（op 2019）推送载荷 */
export interface PushChatMessageData {
  message: ChatMessageView;
}
