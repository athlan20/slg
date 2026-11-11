// 兑换码的表结构（AISLG-253，v109）。四张表都用 CREATE TABLE IF NOT EXISTS，向后兼容、不改旧数据，
// 与其他表一起由 db.ts 的 ensureSchema 幂等创建。
// - redeem_batches：一个批次一份奖励包（rewards 是 jsonb）+ 类型（single 一次性码 / shared 通用码）
//   + 可选的过期时间 + 停用标记；通用码必填 max_redemptions（最多兑换人数），一次性码为 null。
// - redeem_codes：码（规范化后的 16 位大写字符）→ 批次；码只在运营脚本创建 / 导出时可见。
// - redeem_claims：谁在哪个批次领过。唯一约束 (batch_id, account_id) 保证「同一账号同一批次只领一次」；
//   冗余 kind 后建的部分唯一索引（code WHERE kind = 'single'）保证一次性码只被用一次，
//   通用码同一个 code 允许多行。码只在已领取时写入，所以这里不对 redeem_codes 建外键（码行永不清）。
// - redeem_attempts：兑换尝试（ok = 是否成功），用来统计每账号每小时的失败次数；保留 7 天，由 Worker 清理。
// 四张表都**不进** season-tables.ts 的 RESET_TABLES：兑换记录不随换季清空（见 KEEP_TABLES）。
//
// AISLG-255（淘宝渠道配套）只加两列，都用 ADD COLUMN IF NOT EXISTS，存量行为 null、不改旧数据：
// - redeem_batches.channel：渠道标记（如 taobao），对账时按渠道汇总；
// - redeem_codes.voided_at：作废时刻（买家退款时客服作废未兑换的码），兑换按 CODE_INVALID 处理。

export const REDEEM_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS redeem_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL,
  rewards jsonb NOT NULL,
  max_redemptions integer,
  expires_at timestamptz,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redeem_batches_kind_check CHECK (kind IN ('single', 'shared')),
  CONSTRAINT redeem_batches_max_check CHECK (
    (kind = 'single' AND max_redemptions IS NULL)
    OR (kind = 'shared' AND max_redemptions IS NOT NULL AND max_redemptions > 0)
  )
);
CREATE INDEX IF NOT EXISTS idx_redeem_batches_created ON redeem_batches (created_at DESC);
-- AISLG-255：渠道（淘宝等），可空；只允许字母、数字与连字符，最长 20 个字符（脚本侧校验）。
ALTER TABLE redeem_batches ADD COLUMN IF NOT EXISTS channel text;
CREATE INDEX IF NOT EXISTS idx_redeem_batches_channel ON redeem_batches (channel);

CREATE TABLE IF NOT EXISTS redeem_codes (
  code text PRIMARY KEY,
  batch_id uuid NOT NULL REFERENCES redeem_batches(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_redeem_codes_batch ON redeem_codes (batch_id);
-- AISLG-255：作废时刻（非空 = 已作废，兑换返回 CODE_INVALID，export --unused 与 list 排除）。
ALTER TABLE redeem_codes ADD COLUMN IF NOT EXISTS voided_at timestamptz;

CREATE TABLE IF NOT EXISTS redeem_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES redeem_batches(id) ON DELETE CASCADE,
  code text NOT NULL,
  kind text NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redeem_claims_batch_account_key UNIQUE (batch_id, account_id)
);
-- 一次性码：一个码只能被一个账号兑换一次。通用码同一个 code 可以有多行，所以用部分唯一索引。
CREATE UNIQUE INDEX IF NOT EXISTS uq_redeem_claims_single_code ON redeem_claims (code) WHERE kind = 'single';

CREATE TABLE IF NOT EXISTS redeem_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  ok boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_redeem_attempts_fail ON redeem_attempts (account_id, attempted_at DESC) WHERE ok = false;
`;