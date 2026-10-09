// 聊天的数据库读写（v51，AISLG-138）。表结构见 common/src/chat-schema.ts。
// 查询按「真实时间」的保留期过滤（世界 7 天、私聊 30 天），与清理任务互补：清理按节流周期执行，查询时即刻生效。

import pg from 'pg';
import type { ChatCardView } from '../../common/src/protocol-chat';
import { CHAT_PRIVATE_RETAIN_DAYS, CHAT_WORLD_MAX_MESSAGES, CHAT_WORLD_RETAIN_DAYS } from '../../common/src/protocol-chat';

type Q = pg.Pool | pg.PoolClient;

/** 消息行（已联表取出双方账号名）；id 为 bigint，pg 默认以字符串返回 */
export interface ChatMessageRow {
  id: string | number;
  channel: string;
  sender_id: string;
  sender_name: string;
  recipient_id: string | null;
  recipient_name: string | null;
  text: string | null;
  card: ChatCardView | null;
  created_at: Date;
}

const MESSAGE_SELECT = `SELECT m.id, m.channel, m.sender_id, s.username AS sender_name,
       m.recipient_id, r.username AS recipient_name, m.text, m.card, m.created_at
  FROM chat_messages m
  JOIN accounts s ON s.id = m.sender_id
  LEFT JOIN accounts r ON r.id = m.recipient_id`;

/** 世界频道历史（新→旧）：排除查看者屏蔽的发言人，只取保留期内的消息 */
export async function worldHistory(q: Q, viewerId: string, beforeId: number | undefined, limit: number): Promise<ChatMessageRow[]> {
  const res = await q.query<ChatMessageRow>(
    `${MESSAGE_SELECT}
     WHERE m.channel = 'world'
       AND m.created_at > now() - make_interval(days => $3)
       AND ($2::bigint IS NULL OR m.id < $2::bigint)
       AND NOT EXISTS (SELECT 1 FROM chat_blocks b WHERE b.account_id = $1 AND b.blocked_id = m.sender_id)
     ORDER BY m.id DESC
     LIMIT $4`,
    [viewerId, beforeId ?? null, CHAT_WORLD_RETAIN_DAYS, limit],
  );
  return res.rows;
}

/** 与某玩家的私聊历史（新→旧），双向都取 */
export async function privateHistory(
  q: Q,
  viewerId: string,
  peerId: string,
  beforeId: number | undefined,
  limit: number,
): Promise<ChatMessageRow[]> {
  const res = await q.query<ChatMessageRow>(
    `${MESSAGE_SELECT}
     WHERE m.channel = 'private'
       AND m.created_at > now() - make_interval(days => $4)
       AND ((m.sender_id = $1 AND m.recipient_id = $2) OR (m.sender_id = $2 AND m.recipient_id = $1))
       AND ($3::bigint IS NULL OR m.id < $3::bigint)
     ORDER BY m.id DESC
     LIMIT $5`,
    [viewerId, peerId, beforeId ?? null, CHAT_PRIVATE_RETAIN_DAYS, limit],
  );
  return res.rows;
}

/** 私聊会话：每个对方的最后一条消息 id，最多 50 个，按最近倒序 */
export async function privateLastIds(q: Q, viewerId: string): Promise<Array<{ peer_id: string; last_id: string | number }>> {
  const res = await q.query(
    `WITH mine AS (
       SELECT m.id, CASE WHEN m.sender_id = $1 THEN m.recipient_id ELSE m.sender_id END AS peer_id
       FROM chat_messages m
       WHERE m.channel = 'private' AND (m.sender_id = $1 OR m.recipient_id = $1)
         AND m.created_at > now() - make_interval(days => $2)
     )
     SELECT peer_id, MAX(id) AS last_id FROM mine GROUP BY peer_id ORDER BY last_id DESC LIMIT 50`,
    [viewerId, CHAT_PRIVATE_RETAIN_DAYS],
  );
  return res.rows;
}

export async function messagesByIds(q: Q, ids: number[]): Promise<ChatMessageRow[]> {
  if (ids.length === 0) {
    return [];
  }
  const res = await q.query<ChatMessageRow>(`${MESSAGE_SELECT} WHERE m.id = ANY($1::bigint[]) ORDER BY m.id DESC`, [ids]);
  return res.rows;
}

/** 私聊未读：对方发给我、且 id 大于已读位置的条数（按发送人分组，覆盖全部会话） */
export async function privateUnreadCounts(q: Q, viewerId: string): Promise<Array<{ peer_id: string; n: number }>> {
  const res = await q.query(
    `SELECT m.sender_id AS peer_id, COUNT(*)::int AS n
     FROM chat_messages m
     LEFT JOIN chat_reads cr ON cr.account_id = $1 AND cr.peer_id = m.sender_id
     WHERE m.channel = 'private' AND m.recipient_id = $1
       AND m.id > COALESCE(cr.last_read_id, 0)
       AND m.created_at > now() - make_interval(days => $2)
     GROUP BY m.sender_id`,
    [viewerId, CHAT_PRIVATE_RETAIN_DAYS],
  );
  return res.rows;
}

/** 把与某玩家的私聊标记为已读：已读位置推进到当前最大的对方消息 id（只前进不后退） */
export async function markPrivateRead(q: Q, viewerId: string, peerId: string): Promise<void> {
  await q.query(
    `INSERT INTO chat_reads (account_id, peer_id, last_read_id)
     SELECT $1::uuid, $2::uuid, COALESCE(MAX(id), 0)
     FROM chat_messages
     WHERE channel = 'private' AND sender_id = $2 AND recipient_id = $1
     ON CONFLICT (account_id, peer_id)
     DO UPDATE SET last_read_id = GREATEST(chat_reads.last_read_id, EXCLUDED.last_read_id)`,
    [viewerId, peerId],
  );
}

export async function blockedPlayers(q: Q, accountId: string): Promise<Array<{ account_id: string; username: string }>> {
  const res = await q.query(
    `SELECT b.blocked_id AS account_id, a.username
     FROM chat_blocks b JOIN accounts a ON a.id = b.blocked_id
     WHERE b.account_id = $1
     ORDER BY b.created_at DESC`,
    [accountId],
  );
  return res.rows;
}

export async function addBlock(q: Q, accountId: string, blockedId: string): Promise<void> {
  await q.query(
    `INSERT INTO chat_blocks (account_id, blocked_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [accountId, blockedId],
  );
}

export async function removeBlock(q: Q, accountId: string, blockedId: string): Promise<void> {
  await q.query(`DELETE FROM chat_blocks WHERE account_id = $1 AND blocked_id = $2`, [accountId, blockedId]);
}

/** blockerId 是否屏蔽了 targetId */
export async function isBlockedBy(q: Q, blockerId: string, targetId: string): Promise<boolean> {
  const res = await q.query(`SELECT 1 FROM chat_blocks WHERE account_id = $1 AND blocked_id = $2`, [blockerId, targetId]);
  return (res.rowCount ?? 0) > 0;
}

/** 屏蔽了 targetId 的账号集合（世界频道推送时据此跳过） */
export async function blockersOf(q: Q, targetId: string): Promise<Set<string>> {
  const res = await q.query(`SELECT account_id FROM chat_blocks WHERE blocked_id = $1`, [targetId]);
  return new Set((res.rows as Array<{ account_id: string }>).map((row) => row.account_id));
}

export async function findAccount(q: Q, accountId: string): Promise<{ id: string; username: string } | null> {
  const res = await q.query(`SELECT id, username FROM accounts WHERE id = $1`, [accountId]);
  return res.rowCount ? (res.rows[0] as { id: string; username: string }) : null;
}

/** 发言前锁住发送人的账号行：同一账号的发送串行化，限频与禁言判断不会被并发绕过 */
export async function lockSender(q: Q, accountId: string): Promise<{ id: string; username: string; chat_muted_until: Date | null } | null> {
  const res = await q.query(
    `SELECT id, username, chat_muted_until FROM accounts WHERE id = $1 FOR UPDATE`,
    [accountId],
  );
  return res.rowCount ? (res.rows[0] as { id: string; username: string; chat_muted_until: Date | null }) : null;
}

/** 主城官府等级（按城池创建顺序取第一座城；没有官府按 0）：世界频道发言门槛依据 */
export async function mainGovernmentLevel(q: Q, accountId: string): Promise<number> {
  const res = await q.query(
    `SELECT COALESCE(cb.level, 0)::int AS level
     FROM cities c
     LEFT JOIN city_buildings cb ON cb.city_id = c.id AND cb.kind = 'government'
     WHERE c.account_id = $1
     ORDER BY c.created_at
     LIMIT 1`,
    [accountId],
  );
  return res.rowCount ? (res.rows[0] as { level: number }).level : 0;
}

/** 该账号在同一频道最近一条发言的时间（限频判断用） */
export async function lastSentAt(q: Q, channel: string, senderId: string): Promise<Date | null> {
  const res = await q.query(
    `SELECT created_at FROM chat_messages WHERE channel = $1 AND sender_id = $2 ORDER BY id DESC LIMIT 1`,
    [channel, senderId],
  );
  return res.rowCount ? (res.rows[0] as { created_at: Date }).created_at : null;
}

export interface NewChatMessage {
  channel: string;
  senderId: string;
  recipientId: string | null;
  text: string | null;
  card: ChatCardView | null;
  /** 战报卡片的分享快照（仅 report 卡片；列表查询不读它） */
  reportDetail: unknown | null;
}

export async function insertChatMessage(q: Q, msg: NewChatMessage): Promise<{ id: number; createdAt: Date }> {
  const res = await q.query(
    `INSERT INTO chat_messages (channel, sender_id, recipient_id, text, card, report_detail)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
     RETURNING id, created_at`,
    [
      msg.channel,
      msg.senderId,
      msg.recipientId,
      msg.text,
      msg.card === null ? null : JSON.stringify(msg.card),
      msg.reportDetail === null ? null : JSON.stringify(msg.reportDetail),
    ],
  );
  const row = res.rows[0] as { id: string | number; created_at: Date };
  return { id: Number(row.id), createdAt: row.created_at };
}

/** 读战报卡片的分享快照：只回 channel / 收发双方 / 卡片与快照，由调用方判断可见性 */
export async function loadCardMessage(
  q: Q,
  messageId: number,
): Promise<{ channel: string; sender_id: string; recipient_id: string | null; card: ChatCardView | null; report_detail: unknown | null } | null> {
  const res = await q.query(
    `SELECT channel, sender_id, recipient_id, card, report_detail FROM chat_messages WHERE id = $1`,
    [messageId],
  );
  return res.rowCount ? (res.rows[0] as never) : null;
}

/**
 * 清理过期与超量的消息：世界频道超过 7 天的删除、只保留最近 1000 条；私聊超过 30 天的删除。
 * 由发送路径按节流周期调用（不阻塞发言），不影响查询的即时过滤。
 */
export async function pruneChatMessages(q: Q): Promise<void> {
  await q.query(
    `DELETE FROM chat_messages WHERE channel = 'world' AND created_at < now() - make_interval(days => $1)`,
    [CHAT_WORLD_RETAIN_DAYS],
  );
  await q.query(
    `DELETE FROM chat_messages
     WHERE channel = 'world'
       AND id < (SELECT id FROM chat_messages WHERE channel = 'world' ORDER BY id DESC OFFSET $1 LIMIT 1)`,
    [CHAT_WORLD_MAX_MESSAGES - 1],
  );
  await q.query(
    `DELETE FROM chat_messages WHERE channel = 'private' AND created_at < now() - make_interval(days => $1)`,
    [CHAT_PRIVATE_RETAIN_DAYS],
  );
}
