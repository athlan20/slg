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
-- 遗迹与首探（AISLG-227，v93）：新表，全部 IF NOT EXISTS，向后兼容。fog_relics 每季由世界种子生成，领取即写 claimed_by；
-- fog_first_explores 以 target_key（名城 famous:<名> / 名将处所 site:<名将>）为主键，INSERT ... ON CONFLICT DO NOTHING 保证只发一次奖。
CREATE TABLE IF NOT EXISTS fog_relics (
  id bigserial PRIMARY KEY,
  x integer NOT NULL,
  y integer NOT NULL,
  tier text NOT NULL,
  kind text NOT NULL,
  claimed_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  claimed_at timestamptz,
  UNIQUE (x, y)
);
CREATE INDEX IF NOT EXISTS idx_fog_relics_claimed ON fog_relics (claimed_by, claimed_at);
-- v97（AISLG-232）：上次看到的地块上有没有望楼、几级（0 = 没有）——已探索但不在视野内的格按快照显示望楼
ALTER TABLE fog_seen ADD COLUMN IF NOT EXISTS facility_level integer NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS fog_first_explores (
  target_key text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  username text NOT NULL,
  explored_at timestamptz NOT NULL DEFAULT now()
);
`;
