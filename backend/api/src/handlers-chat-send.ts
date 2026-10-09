// CHAT_SEND（v51，AISLG-138）：发送文字 / 表情 / 卡片。
// 顺序：参数 → 事务内锁住发送人账号 → 禁言 → 世界频道官府门槛 / 私聊对象与屏蔽 → 同频道限频 → 卡片快照 →
// 屏蔽词替换 → 落库。提交后才回包并推送（推送失败不影响发送结果）。仅限玩家连接（由 handlers-chat.ts 把关）。

import { Op, type ErrorCode } from '../../common/src/protocol';
import {
  CHAT_RATE_LIMIT_MS,
  CHAT_TEXT_MAX_CHARS,
  CHAT_WORLD_MIN_GOVERNMENT,
  isChatEmoji,
  type ChatCardRequest,
  type ChatCardView,
  type ChatChannel,
  type ChatMessageView,
} from '../../common/src/protocol-chat';
import type { PushFrame } from '../../common/src/protocol';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import * as db from './chat-db';
import { buildChatCard } from './chat-cards';
import { bannedWordFilter, type BannedWordFilter } from './chat-words';
import { chatMessageView } from './chat-view';
import { isUuid, readCardRequest, readChannel } from './chat-validate';

/** 保留期清理的节流周期（毫秒）：发送路径上最多每分钟清一次，不阻塞发言 */
const PRUNE_INTERVAL_MS = 60_000;
let lastPruneAt = 0;

interface SendRequest {
  channel: ChatChannel;
  peerId: string | undefined;
  text: string | null;
  emoji: string | null;
  card: ChatCardRequest | null;
}

type SendOutcome =
  | { ok: true; message: ChatMessageView; recipientId: string | null }
  | { ok: false; code: ErrorCode; data?: Record<string, unknown> };

/** 解析并做形状校验；text 去首尾空白后为空视为未填（卡片可不附文字） */
function parseSendRequest(data: Record<string, unknown> | undefined): SendRequest | null {
  const channel = readChannel(data?.channel);
  if (!channel) {
    return null;
  }
  const rawText = data?.text ?? null;
  if (rawText !== null && typeof rawText !== 'string') {
    return null;
  }
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (Array.from(text).length > CHAT_TEXT_MAX_CHARS) {
    return null;
  }
  const rawEmoji = data?.emoji ?? null;
  if (rawEmoji !== null && !isChatEmoji(rawEmoji)) {
    return null;
  }
  const rawCard = data?.card ?? null;
  const card = rawCard === null ? null : readCardRequest(rawCard);
  if (rawCard !== null && card === null) {
    return null;
  }
  const emoji = rawEmoji as string | null;
  // 表情独占一条消息；文字与卡片至少要有一个
  if (emoji !== null && (text.length > 0 || card !== null)) {
    return null;
  }
  if (emoji === null && text.length === 0 && card === null) {
    return null;
  }
  const peerId = data?.peerId;
  return {
    channel,
    peerId: typeof peerId === 'string' ? peerId : undefined,
    text: text.length > 0 ? text : null,
    emoji,
    card,
  };
}

/** 事务内完成全部业务判断与落库；拒绝时回滚并返回错误码 */
async function sendInTransaction(
  ctx: HandlerContext,
  accountId: string,
  req: SendRequest,
  filter: BannedWordFilter,
): Promise<SendOutcome> {
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const reject = async (code: ErrorCode, data?: Record<string, unknown>): Promise<SendOutcome> => {
      await client.query('ROLLBACK');
      return { ok: false, code, data };
    };

    const sender = await db.lockSender(client, accountId);
    if (!sender) {
      return reject('INTERNAL');
    }
    const now = Date.now();
    if (sender.chat_muted_until && sender.chat_muted_until.getTime() > now) {
      return reject('CHAT_MUTED', { until: sender.chat_muted_until.toISOString() });
    }

    let recipientId: string | null = null;
    let recipientName: string | null = null;
    if (req.channel === 'world') {
      if ((await db.mainGovernmentLevel(client, accountId)) < CHAT_WORLD_MIN_GOVERNMENT) {
        return reject('CHAT_GOVERNMENT_TOO_LOW');
      }
    } else {
      if (!isUuid(req.peerId) || req.peerId === accountId) {
        return reject('INVALID_PARAMS');
      }
      const recipient = await db.findAccount(client, req.peerId);
      if (!recipient) {
        return reject('INVALID_PARAMS');
      }
      if (await db.isBlockedBy(client, recipient.id, accountId)) {
        return reject('CHAT_BLOCKED');
      }
      recipientId = recipient.id;
      recipientName = recipient.username;
    }

    const last = await db.lastSentAt(client, req.channel, accountId);
    if (last && now - last.getTime() < CHAT_RATE_LIMIT_MS) {
      const retryAfterSeconds = Math.ceil((CHAT_RATE_LIMIT_MS - (now - last.getTime())) / 1000);
      return reject('CHAT_RATE_LIMITED', { retryAfterSeconds });
    }

    let card: ChatCardView | null = null;
    let reportDetail: unknown | null = null;
    if (req.card) {
      const built = await buildChatCard(client, accountId, req.card, filter);
      if (!built) {
        return reject('INVALID_PARAMS');
      }
      card = built.card;
      reportDetail = built.reportDetail;
    }

    const text = req.text === null ? null : filter.mask(req.text);
    const inserted = await db.insertChatMessage(client, {
      channel: req.channel,
      senderId: accountId,
      recipientId,
      text,
      emoji: req.emoji,
      card,
      reportDetail,
    });
    await client.query('COMMIT');
    const message = chatMessageView(
      {
        id: inserted.id,
        channel: req.channel,
        sender_id: accountId,
        sender_name: sender.username,
        recipient_id: recipientId,
        recipient_name: recipientName,
        text,
        emoji: req.emoji,
        card,
        created_at: inserted.createdAt,
      },
      filter,
    );
    return { ok: true, message, recipientId };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 推送新消息：私聊推给对方与发送人的其他玩家连接；世界频道推给全部在线玩家，跳过屏蔽了发言人的账号 */
async function deliverChatMessage(
  ctx: HandlerContext,
  conn: ConnInfo,
  accountId: string,
  message: ChatMessageView,
  recipientId: string | null,
): Promise<void> {
  const frame: PushFrame = { op: Op.PUSH_CHAT_MESSAGE, push: true, data: { message } };
  if (message.channel === 'private' && recipientId) {
    ctx.registry.broadcastToPlayers(recipientId, frame);
    ctx.registry.broadcastToPlayers(accountId, frame, conn);
    return;
  }
  const blockers = await db.blockersOf(ctx.pool, accountId);
  for (const target of ctx.registry.onlineAccountIds()) {
    if (blockers.has(target)) {
      continue;
    }
    ctx.registry.broadcastToPlayers(target, frame, target === accountId ? conn : undefined);
  }
}

function maybePrune(ctx: HandlerContext): void {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_INTERVAL_MS) {
    return;
  }
  lastPruneAt = now;
  void db.pruneChatMessages(ctx.pool).catch((err) => console.error('chat prune failed:', err));
}

export async function handleChatSend(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const req = parseSendRequest(data);
  if (!req) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const outcome = await sendInTransaction(ctx, accountId, req, bannedWordFilter());
  if (!outcome.ok) {
    respondError(ctx.registry, conn, op, seq, outcome.code, outcome.data);
    return;
  }
  respondOk(ctx.registry, conn, op, seq, { message: outcome.message });
  deliverChatMessage(ctx, conn, accountId, outcome.message, outcome.recipientId).catch((err) =>
    console.error('chat push failed:', err),
  );
  maybePrune(ctx);
}
