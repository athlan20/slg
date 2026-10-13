// 竞技场的表结构（v53，AISLG-145）：与其他表一起由 db.ts 的 ensureSchema 幂等创建（不另起迁移工具）。
// arena_entries 一行 = 榜上一个席位：玩家（account_id 非空，阵容存武将 id，对战时读武将当前属性）
// 或系统守擂者（account_id 为空，阵容属性直接存在 npc_lineup）。rank 全表唯一但可延迟校验——
// 互换名次在同一条 UPDATE 里完成。所有改名次的事务先拿 arena 咨询锁串行化（见 arena-db.ts lockArena）。

export const ARENA_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS arena_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid UNIQUE REFERENCES accounts(id) ON DELETE CASCADE,
  rank integer NOT NULL,
  slot1 uuid REFERENCES account_heroes(id) ON DELETE SET NULL,
  slot2 uuid REFERENCES account_heroes(id) ON DELETE SET NULL,
  slot3 uuid REFERENCES account_heroes(id) ON DELETE SET NULL,
  best_rank integer NOT NULL,
  -- 进档基线：入榜时为入榜名次，之后只在奖励真正到账后推进（NULL = 旧数据，按挑战前的 best_rank 作基线）
  milestone_best integer,
  last_reward_day bigint,
  npc_name text,
  npc_lineup jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT arena_entries_rank_key UNIQUE (rank) DEFERRABLE INITIALLY DEFERRED
);

-- 旧库（先建了表、后加列）补列；新库上面的 CREATE 已包含
ALTER TABLE arena_entries ADD COLUMN IF NOT EXISTS milestone_best integer;

-- 每个竞技日的计数：challenges = 我发起的挑战次数，defended = 我被挑战的次数
CREATE TABLE IF NOT EXISTS arena_daily (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  day bigint NOT NULL,
  challenges integer NOT NULL DEFAULT 0,
  defended integer NOT NULL DEFAULT 0,
  PRIMARY KEY (account_id, day)
);

-- 战报：双方名字与名次为发生时的快照；result = { challengerWins, defenderWins, rounds[], challengerLineup[], defenderLineup[] }
CREATE TABLE IF NOT EXISTS arena_matches (
  id bigserial PRIMARY KEY,
  challenger_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  challenger_name text NOT NULL,
  challenger_rank_before integer NOT NULL,
  challenger_rank_after integer NOT NULL,
  defender_entry_id uuid NOT NULL,
  defender_account_id uuid REFERENCES accounts(id) ON DELETE CASCADE,
  defender_name text NOT NULL,
  defender_rank_before integer NOT NULL,
  defender_rank_after integer NOT NULL,
  challenger_won boolean NOT NULL,
  seed bigint NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_arena_matches_challenger ON arena_matches (challenger_account_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_arena_matches_defender ON arena_matches (defender_account_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_arena_matches_created ON arena_matches (created_at);
`;
