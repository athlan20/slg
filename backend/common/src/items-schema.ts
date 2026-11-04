// 道具背包的表结构（AISLG-222，v90）：每个账号每种道具一行存数量。与其他表一起由 db.ts 的 ensureSchema 幂等创建。
// 换季时整表清空（season-tables.ts 的 RESET_TABLES），与礼金同口径。

export const ITEMS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_items (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  count integer NOT NULL DEFAULT 0 CHECK (count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, item_id)
);
`;
