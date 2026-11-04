// 战争迷雾的表结构（AISLG-224，v92）：fog_explored（每账号探索位图）、fog_seen（上次看到的地块快照）、
// marches.fog_recorded_at（行军探索是否已写入）。由 db.ts 的 ensureSchema 幂等创建；
// 两张新表随换季清空（season-tables.ts RESET），marches 列随行军表一起清空。
// 回填（把迁移前已结束的行军标记为已记录）在 db.ts 的 migrateDataOnce 里做一次。

export const FOG_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS fog_explored (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  bits bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fog_seen (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  kind text NOT NULL,
  level integer NOT NULL DEFAULT 0,
  owner_account_id uuid,
  owner_username text,
  owner_city_id uuid,
  owner_city_name text,
  wild_famous boolean NOT NULL DEFAULT false,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, x, y)
);
ALTER TABLE marches ADD COLUMN IF NOT EXISTS fog_recorded_at timestamptz;
-- 复核修复（AISLG-224）：盲打的校验曾被拒绝（到达一律原路返回）；撤回时部队所在的实际位置与时刻（撤回后的视野按它算）
ALTER TABLE marches ADD COLUMN IF NOT EXISTS fog_denied boolean NOT NULL DEFAULT false;
ALTER TABLE marches ADD COLUMN IF NOT EXISTS fog_turn_x double precision;
ALTER TABLE marches ADD COLUMN IF NOT EXISTS fog_turn_y double precision;
ALTER TABLE marches ADD COLUMN IF NOT EXISTS fog_turn_at timestamptz;
CREATE INDEX IF NOT EXISTS idx_marches_fog_pending ON marches (resolved_at) WHERE resolved_at IS NOT NULL AND fog_recorded_at IS NULL;
`;
