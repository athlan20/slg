// 聊天的表结构（v51，AISLG-138）：与其他表一起由 db.ts 的 ensureSchema 幂等创建（不另起迁移工具）。
// 世界频道与私聊共用 chat_messages（channel 区分）；保留期与条数上限由 API 在发送时清理（见 api/src/chat-prune.ts）。
// report_detail 只存战报卡片的分享快照，列表查询不读它（CHAT_REPORT_DETAIL 按需取）。

export const CHAT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS chat_messages (
  id bigserial PRIMARY KEY,
  channel text NOT NULL,
  sender_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  text text,
  card jsonb,
  report_detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_id ON chat_messages (channel, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages (channel, sender_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_recipient ON chat_messages (channel, recipient_id, id DESC);

-- 屏蔽名单（单向）：account_id 屏蔽了 blocked_id
CREATE TABLE IF NOT EXISTS chat_blocks (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, blocked_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_blocks_blocked ON chat_blocks (blocked_id);

-- 私聊已读位置：account_id 与 peer_id 的会话里，id ≤ last_read_id 的对方消息已读
CREATE TABLE IF NOT EXISTS chat_reads (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  peer_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  last_read_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, peer_id)
);

-- 运营禁言（v51）：禁言截止时刻；null 或已过期 = 可以发言（脚本 scripts/chat-mute.ts 设置）
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS chat_muted_until timestamptz;
`;
