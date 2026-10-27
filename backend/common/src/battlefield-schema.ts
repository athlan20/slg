// 剧本战场（v75，AISLG-198）的表结构：战场事件、报名 / 入场、队伍、据点、军功与商店购买记录。
// 全部归入换季清空（season-tables.ts RESET_TABLES），军功与商店额度不跨季。

export const BATTLEFIELD_SCHEMA_SQL = `
-- v75（AISLG-198）：剧本战场·官渡。一场战场一行；同一剧本的报名开始时刻唯一（Worker 幂等创建）。
CREATE TABLE IF NOT EXISTS battlefield_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  script text NOT NULL DEFAULT 'guandu',
  signup_start timestamptz NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'signup',
  winner_camp text,
  finish_reason text,
  score_yuan numeric NOT NULL DEFAULT 0,
  score_cao numeric NOT NULL DEFAULT 0,
  -- 人少补偿：开战时算一次，之后不变（少方积分产出 × 倍率）
  underdog_camp text,
  underdog_multiplier numeric NOT NULL DEFAULT 1,
  -- 积分 / 耗粮的惰性结算水位（Worker 按经过时长增量结算）
  last_score_at timestamptz,
  last_food_at timestamptz,
  signup_announced_at timestamptz,
  start_announced_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (script, signup_start)
);
CREATE INDEX IF NOT EXISTS idx_battlefield_events_status ON battlefield_events (status, signup_start DESC);

-- 报名 / 入场：报名时写一行，入场后 entered_at 非空并从主城扣兵；merit 为本场军功。
CREATE TABLE IF NOT EXISTS battlefield_participants (
  event_id uuid NOT NULL REFERENCES battlefield_events(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  camp text NOT NULL,
  main_city_id uuid NOT NULL,
  merit bigint NOT NULL DEFAULT 0,
  joined_at timestamptz NOT NULL DEFAULT now(),
  entered_at timestamptz,
  rewarded_at timestamptz,
  PRIMARY KEY (event_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_battlefield_participants_camp ON battlefield_participants (event_id, camp);

-- 战场队伍：每人最多 3 支；troops 为按兵种的 jsonb 快照。阵亡队伍直接删除。
CREATE TABLE IF NOT EXISTS battlefield_squads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES battlefield_events(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  camp text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  origin_x integer NOT NULL,
  origin_y integer NOT NULL,
  troops jsonb NOT NULL,
  status text NOT NULL DEFAULT 'idle',
  stronghold_id text,
  target_x integer,
  target_y integer,
  target_stronghold_id text,
  arrive_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battlefield_squads_event ON battlefield_squads (event_id, account_id);
CREATE INDEX IF NOT EXISTS idx_battlefield_squads_arrive ON battlefield_squads (arrive_at) WHERE status = 'marching';
CREATE INDEX IF NOT EXISTS idx_battlefield_squads_hold ON battlefield_squads (event_id, stronghold_id) WHERE status = 'garrison';

-- 据点：开局由 Worker 按报名人数生成守军；归属 null = 中立 NPC。
CREATE TABLE IF NOT EXISTS battlefield_strongholds (
  event_id uuid NOT NULL REFERENCES battlefield_events(id) ON DELETE CASCADE,
  id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  owner_camp text,
  points_per_hour integer NOT NULL,
  garrison jsonb NOT NULL DEFAULT '{}'::jsonb,
  wall_level integer NOT NULL DEFAULT 0,
  tower_level integer NOT NULL DEFAULT 0,
  first_captured_at timestamptz,
  captured_at timestamptz,
  PRIMARY KEY (event_id, id)
);

-- 战场商店的军功余额：跨场累积、换季清空（不在 accounts 上，避免换季账号列的特殊处理）。
CREATE TABLE IF NOT EXISTS battlefield_merit (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  merit bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 商店购买记录：按场限购。
CREATE TABLE IF NOT EXISTS battlefield_purchases (
  event_id uuid NOT NULL REFERENCES battlefield_events(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  item text NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (event_id, account_id, item)
);
`;