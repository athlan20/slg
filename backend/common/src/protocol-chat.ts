// 聊天协议的载荷类型与常量（v51）：世界频道、私聊、卡片分享与屏蔽。
// 仅限玩家连接（Agent 连接调用返回 AGENT_FORBIDDEN；对外文档不收录聊天接口，见 protocol-doc-ops-chat.ts）。
// 从 protocol.ts 拆出以控制单文件行数；protocol.ts 再导出，前端镜像文件 frontend/src/api/protocol-chat.ts 与之同构。

import type { BattleReportView } from './protocol-battle';
import type { TerrainKind, TileKind } from './protocol-world';

/** 频道：world 世界（国内 / 国际站玩家共用一个频道）；private 私聊（一对一） */
export const CHAT_CHANNELS = ['world', 'private'] as const;
export type ChatChannel = (typeof CHAT_CHANNELS)[number];

/** 卡片类型：coord 地图坐标 / hero 武将 / report 战报 / city 城池 */
export const CHAT_CARD_KINDS = ['coord', 'hero', 'report', 'city'] as const;
export type ChatCardKind = (typeof CHAT_CARD_KINDS)[number];

/** 单条文字上限（去首尾空白后，按字形计：一个表情算 1 个字）；超出返回 INVALID_PARAMS */
export const CHAT_TEXT_MAX_CHARS = 100;
/** 世界频道发言所需的主城官府等级（v51，防刷小号；私聊不设门槛） */
export const CHAT_WORLD_MIN_GOVERNMENT = 3;
/** 同一账号、同一频道两次发言的最小间隔（毫秒）；世界与私聊各自计算 */
export const CHAT_RATE_LIMIT_MS = 10_000;
/** 保留期与条数上限（真实时间，不随 timeScale 缩放）：世界频道保留最近 7 天、最多 1000 条；私聊保留 30 天 */
export const CHAT_WORLD_RETAIN_DAYS = 7;
export const CHAT_WORLD_MAX_MESSAGES = 1000;
export const CHAT_PRIVATE_RETAIN_DAYS = 30;

/** 聊天里出现的玩家（展示用；username 为账号名，已过屏蔽词过滤） */
export interface ChatPlayerView {
  accountId: string;
  username: string;
}

/**
 * 卡片快照：发送那一刻由服务端生成，之后源数据变化（如武将升级、城池改名）不影响已发出的卡片。
 * 客户端只传 id / 坐标，快照字段一律服务端填充。
 */
export type ChatCardView =
  | { kind: 'coord'; x: number; y: number; terrain: TerrainKind; tileKind: TileKind; level: number }
  | { kind: 'hero'; name: string; famous: boolean; level: number; lead: number; force: number; wit: number }
  | {
      kind: 'report';
      /** 战斗类别（同战报视图的 kind） */
      battleKind: BattleReportView['kind'];
      /** 分享者在本场战斗中的角色与胜负（卡片从分享者视角展示） */
      role: 'attacker' | 'defender';
      won: boolean;
      attackerName: string;
      defenderName: string;
      reportedAt: string;
    }
  | { kind: 'city'; name: string; ownerName: string; level: number; x: number; y: number };

/** 一条聊天消息（CHAT_HISTORY、CHAT_SEND 响应与 PUSH_CHAT_MESSAGE 共用） */
export interface ChatMessageView {
  id: number;
  channel: ChatChannel;
  sender: ChatPlayerView;
  /** 私聊的对方；世界频道为 null */
  recipient: ChatPlayerView | null;
  /** text 纯文字（表情直接写在文字里，不单独成类型）；card 卡片（卡片可附一句文字，放在 text 里） */
  type: 'text' | 'card';
  text: string | null;
  card: ChatCardView | null;
  createdAt: string;
}

/** CHAT_HISTORY 请求：世界频道不传 peerId；私聊必须传 peerId */
export interface ChatHistoryRequestData {
  channel: ChatChannel;
  peerId?: string;
  /** 1..50，缺省 30 */
  limit?: number;
  /** 只取比它更早的消息（翻页用） */
  beforeId?: number;
}

/** CHAT_HISTORY 响应：messages 按时间从旧到新；hasMore 表示还有更早的消息 */
export interface ChatHistoryResponseData {
  messages: ChatMessageView[];
  hasMore: boolean;
}

/** CHAT_SEND 的卡片请求：只传 id 或坐标，快照由服务端生成；id 必须属于本账号 */
export type ChatCardRequest =
  | { kind: 'coord'; x: number; y: number }
  | { kind: 'hero'; heroId: string }
  | { kind: 'report'; reportId: number }
  | { kind: 'city'; cityId: string };

/**
 * CHAT_SEND 请求：text 与 card 至少给一个；card 可附一句 text。表情直接写在 text 里（不单独成类型）。
 * text 去首尾空白后不超过 100 字（按字形计，一个表情算 1 个字）；屏蔽词在服务端替换成 *。
 */
export interface ChatSendRequestData {
  channel: ChatChannel;
  peerId?: string;
  text?: string;
  card?: ChatCardRequest;
}

export interface ChatSendResponseData {
  message: ChatMessageView;
}

/** 私聊会话（CHAT_CONVERSATIONS）：last 为最后一条消息，unread 为对方发来且未读的条数 */
export interface ChatConversationView {
  peer: ChatPlayerView;
  last: ChatMessageView;
  unread: number;
}

/** CHAT_CONVERSATIONS 响应：最多 50 个会话，按最后一条消息时间倒序；unreadTotal 为私聊未读总数 */
export interface ChatConversationsResponseData {
  conversations: ChatConversationView[];
  unreadTotal: number;
  /** 我屏蔽的玩家（可在此取消屏蔽） */
  blocked: ChatPlayerView[];
}

/** CHAT_READ 请求：把与对方的私聊标记为已读（到当前为止） */
export interface ChatReadRequestData {
  peerId: string;
}

export interface ChatReadResponseData {
  unreadTotal: number;
}

/** CHAT_BLOCK 请求：屏蔽或取消屏蔽某个玩家（屏蔽后看不到对方的世界频道发言，对方不能给我发私聊） */
export interface ChatBlockRequestData {
  accountId: string;
  blocked: boolean;
}

export interface ChatBlockResponseData {
  blocked: ChatPlayerView[];
}

/** CHAT_REPORT_DETAIL 请求：打开一条战报卡片的详情（消息须是可见的战报卡片） */
export interface ChatReportDetailRequestData {
  messageId: number;
}

/** CHAT_REPORT_DETAIL 响应：分享时刻的战报快照（不含 Agent 点评） */
export interface ChatReportDetailResponseData {
  report: Omit<BattleReportView, 'comment'>;
}

/** PUSH_CHAT_MESSAGE（op 2019）推送载荷：新消息（世界频道按屏蔽关系过滤；私聊推给双方的玩家连接） */
export interface PushChatMessageData {
  message: ChatMessageView;
}
