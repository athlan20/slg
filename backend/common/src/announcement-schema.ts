// 公告的表结构（v60，AISLG-162）：与其他表一起由 db.ts 的 ensureSchema 幂等创建。
// announcements 一行 = 一条公告；撤回只改 status，不物理删除（保留历史）。
// announcement_reads 一行 = 某账号已读某条公告；未读数 = 生效中的公告里没有对应已读行的条数。

export const ANNOUNCEMENT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS announcements (
  id bigserial PRIMARY KEY,
  category text NOT NULL CHECK (category IN ('system', 'event')),
  title_zh text NOT NULL,
  body_zh text NOT NULL,
  title_en text,
  body_en text,
  pinned boolean NOT NULL DEFAULT false,
  strong_remind boolean NOT NULL DEFAULT false,
  -- 站点定向：NULL = 两个站都可见；否则为连接的 Host（小写去端口，如 slg.yuntianyou.cc）
  host text,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'withdrawn')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements (status, published_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  announcement_id bigint NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, announcement_id)
);
`;
