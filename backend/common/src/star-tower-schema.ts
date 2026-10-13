// 将星塔的表结构（v55，AISLG-146）：与其他表一起由 db.ts 的 ensureSchema 幂等创建。
// star_tower_progress 一行 = 账号的爬塔进度（best_floor 即已通过的最高层，0 = 还没通过任何一层）；
// star_tower_matches 是每次挑战的战报（每人只保留最近 STAR_TOWER_REPORT_KEEP 条，写入时删旧）。

export const STAR_TOWER_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS star_tower_progress (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  best_floor integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- result = { floor, boss, challengerWins, defenderWins, rounds[], lineup[], enemies[] }
CREATE TABLE IF NOT EXISTS star_tower_matches (
  id bigserial PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  floor integer NOT NULL,
  won boolean NOT NULL,
  seed bigint NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_star_tower_matches_account ON star_tower_matches (account_id, id DESC);
`;
