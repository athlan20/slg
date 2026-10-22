// 赛季系统的表结构（AISLG-134，docs/season-system.md §3.1）：与其他表一起由 db.ts 的 ensureSchema 幂等创建。
// 存档表的列类型镜像 leaderboard_snapshots / leaderboard_model_snapshots（账号 id 为 uuid，不加外键：
// 账号将来可能被删，存档要保留）。accounts.season_id 记录账号所在赛季，NULL = 尚未加入任何赛季。
// 第 1 季的播种（seasons 为空时）见 season-seed.ts，由 ensureSchema 在建表后调用。

export const SEASON_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS seasons (
  id serial PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL,                       -- active | ended
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  seed integer NOT NULL,
  time_scale numeric NOT NULL,
  notified_stages text[] NOT NULL DEFAULT '{}',
  ended_at timestamptz
);

-- 个人榜存档（每季每榜前若干名）
CREATE TABLE IF NOT EXISTS season_archives (
  season_id integer NOT NULL,
  kind text NOT NULL,
  rank integer NOT NULL,
  account_id uuid,
  username text NOT NULL,
  city_name text,
  value bigint NOT NULL,
  agent_model text,
  PRIMARY KEY (season_id, kind, rank)
);

-- 模型榜存档（每季每个模型一行，列同 leaderboard_model_snapshots）
CREATE TABLE IF NOT EXISTS season_archive_models (
  season_id integer NOT NULL,
  rank integer NOT NULL,
  model_id text NOT NULL,
  model_label text NOT NULL,
  players integer NOT NULL,
  top_avg_value bigint NOT NULL,
  top_player_name text,
  top_player_value bigint,
  PRIMARY KEY (season_id, rank)
);

-- 荣誉称号（不带任何数值效果，仅名人堂留名与个人信息展示）
CREATE TABLE IF NOT EXISTS season_honors (
  account_id uuid NOT NULL,
  season_id integer NOT NULL,
  kind text NOT NULL,
  rank integer NOT NULL,
  title text NOT NULL,
  PRIMARY KEY (account_id, season_id, kind)
);

-- 账号所在赛季；存量账号由 season-seed.ts 在播种第 1 季时统一回填
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS season_id integer;
`;
