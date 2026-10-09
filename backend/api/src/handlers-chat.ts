// 聊天协议的分发与读取类处理（v51，AISLG-138）。
// 仅限玩家连接：Agent 连接调用任一聊天协议都返回 AGENT_FORBIDDEN（读和发都拒绝）。
// 发送在 handlers-chat-send.ts；这里处理 CHAT_HISTORY / CHAT_CONVERSATIONS / CHAT_READ / CHAT_BLOCK / CHAT_REPORT_DETAIL。

import { Op } from '../../common/src/protocol';
import type { ChatPlayerView } from '../../common/src/protocol-chat';
import type { ConnInfo } from './connections';
import { readIntInRange, readOptionalNonNegativeInt, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import * as db from './chat-db';
import { bannedWordFilter, type BannedWordFilter } from './chat-words';
import { chatMessageView, playerView } from './chat-view';
import { isUuid, readChannel } from './chat-validate';
import { handleChatSend } from './handlers-chat-send';

/** 聊天协议号集合（handlers.ts 的分发表据此路由） */
export const CHAT_OPS: ReadonlySet<number> = new Set<number>([
  Op.CHAT_HISTORY,
  Op.CHAT_SEND,
  Op.CHAT_CONVERSATIONS,
  Op.CHAT_READ,
  Op.CHAT_BLOCK,
  Op.CHAT_REPORT_DETAIL,
]);

export async function handleChatOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  // 角色是连接自报的标记：拦住诚实声明的 Agent，不构成可验证的安全边界（与其他「仅玩家」协议一致）
  if (conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  switch (op) {
    case Op.CHAT_HISTORY:
      await handleHistory(ctx, conn, op, seq, data);
      return;
    case Op.CHAT_SEND:
      await handleChatSend(ctx, conn, op, seq, data);
      return;
    case Op.CHAT_CONVERSATIONS:
      await handleConversations(ctx, conn, op, seq);
      return;
    case Op.CHAT_READ:
      await handleRead(ctx, conn, op, seq, data);
      return;
    case Op.CHAT_BLOCK:
      await handleBlock(ctx, conn, op, seq, data);
      return;
    case Op.CHAT_REPORT_DETAIL:
      await handleReportDetail(ctx, conn, op, seq, data);
      return;
    default:
      respondError(ctx.registry, conn, op, seq, 'UNKNOWN_OP');
  }
}

async function unreadTotalOf(ctx: HandlerContext, accountId: string): Promise<number> {
  const rows = await db.privateUnreadCounts(ctx.pool, accountId);
  return rows.reduce((sum, row) => sum + row.n, 0);
}

/** GET 系列：世界频道或与某玩家的私聊，按时间从旧到新返回一页（limit 缺省 30，最大 50） */
async function handleHistory(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const channel = readChannel(data?.channel);
  if (!channel) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const limit = readIntInRange(data, 'limit', 1, 50, 30);
  const beforeId = readOptionalNonNegativeInt(data, 'beforeId');
  let rows: db.ChatMessageRow[];
  if (channel === 'world') {
    rows = await db.worldHistory(ctx.pool, me, beforeId, limit + 1);
  } else {
    const peerId = data?.peerId;
    if (!isUuid(peerId) || peerId === me) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    rows = await db.privateHistory(ctx.pool, me, peerId, beforeId, limit + 1);
  }
  const filter = bannedWordFilter();
  const hasMore = rows.length > limit;
  const messages = rows.slice(0, limit).reverse().map((row) => chatMessageView(row, filter));
  respondOk(ctx.registry, conn, op, seq, { messages, hasMore });
}

/** 私聊会话列表：每个对方的最后一条消息与未读数，附未读总数与我的屏蔽名单 */
async function handleConversations(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const me = conn.accountId as string;
  const filter: BannedWordFilter = bannedWordFilter();
  const lastIds = await db.privateLastIds(ctx.pool, me);
  const rows = await db.messagesByIds(ctx.pool, lastIds.map((row) => Number(row.last_id)));
  const rowById = new Map(rows.map((row) => [Number(row.id), row]));
  const unreadRows = await db.privateUnreadCounts(ctx.pool, me);
  const unreadByPeer = new Map(unreadRows.map((row) => [row.peer_id, row.n]));
  const unreadTotal = unreadRows.reduce((sum, row) => sum + row.n, 0);

  const conversations = lastIds.flatMap(({ peer_id, last_id }) => {
    const row = rowById.get(Number(last_id));
    if (!row) {
      return [];
    }
    const peerName = row.sender_id === peer_id ? row.sender_name : (row.recipient_name ?? '');
    return [
      {
        peer: playerView(peer_id, peerName, filter),
        last: chatMessageView(row, filter),
        unread: unreadByPeer.get(peer_id) ?? 0,
      },
    ];
  });
  const blocked: ChatPlayerView[] = (await db.blockedPlayers(ctx.pool, me)).map((row) =>
    playerView(row.account_id, row.username, filter),
  );
  respondOk(ctx.registry, conn, op, seq, { conversations, unreadTotal, blocked });
}

/** 把与某玩家的私聊标记为已读（到调用时刻为止），回传最新的私聊未读总数 */
async function handleRead(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const peerId = data?.peerId;
  if (!isUuid(peerId) || peerId === me) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  await db.markPrivateRead(ctx.pool, me, peerId);
  respondOk(ctx.registry, conn, op, seq, { unreadTotal: await unreadTotalOf(ctx, me) });
}

/** 屏蔽 / 取消屏蔽。屏蔽目标须是存在的账号，不能屏蔽自己；回传更新后的屏蔽名单 */
async function handleBlock(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const target = data?.accountId;
  const blocked = data?.blocked;
  if (!isUuid(target) || target === me || typeof blocked !== 'boolean') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (blocked) {
    if (!(await db.findAccount(ctx.pool, target))) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    await db.addBlock(ctx.pool, me, target);
  } else {
    await db.removeBlock(ctx.pool, me, target);
  }
  const filter = bannedWordFilter();
  const list = (await db.blockedPlayers(ctx.pool, me)).map((row) => playerView(row.account_id, row.username, filter));
  respondOk(ctx.registry, conn, op, seq, { blocked: list });
}

/** 打开聊天里的战报卡片：消息须是世界频道或与我相关的私聊；分享者与我互相屏蔽时不可见 */
async function handleReportDetail(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const messageId = data?.messageId;
  if (!Number.isInteger(messageId) || (messageId as number) < 1) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const row = await db.loadCardMessage(ctx.pool, messageId as number);
  if (!row || row.card?.kind !== 'report' || !row.report_detail) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (row.channel === 'private' && row.sender_id !== me && row.recipient_id !== me) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (row.channel === 'world' && (await db.isBlockedBy(ctx.pool, me, row.sender_id))) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  respondOk(ctx.registry, conn, op, seq, { report: row.report_detail });
}
