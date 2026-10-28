// 声望与爵位（v76，AISLG-197）的表结构：账号上的累计声望 / 爵位序号，以及每日俸禄领取记录。
// 声望与爵位随赛季重置（accounts 列在换季时清零），领取记录换季清空。

export const NOBILITY_SCHEMA_SQL = `
-- v76（AISLG-197）：累计声望与爵位序号（0 = 平民，索引见 common/src/nobility.ts）
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS prestige bigint NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS nobility smallint NOT NULL DEFAULT 0;

-- 每日俸禄：按北京日（东八区自然日）去重，爵位越高金额越大；换季清空
CREATE TABLE IF NOT EXISTS nobility_claims (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day date NOT NULL,
  gold bigint NOT NULL,
  nobility smallint NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, day)
);
CREATE INDEX IF NOT EXISTS idx_nobility_claims_claimed_at ON nobility_claims (claimed_at);
`;