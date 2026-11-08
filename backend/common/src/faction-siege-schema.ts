// 势力出兵（AISLG-240，v100）的表结构：只加不改。
//
// 1) npc_attacks 打上势力旗号（袭击本身不变，只是有了归属）：
//    - faction：这次袭击属于哪家势力（可空 = 不在任何势力范围内的普通 NPC 袭击，行为与上线前一致）；
//    - from_x / from_y：出发老巢坐标（战报 / 事件里给「南蛮来袭」这类文案补上出处）。
//    均为可空列，老行不受影响；faction_enabled 关闭时不写入。
//
// 2) faction_sieges：势力围攻玩家分城的每次尝试一行。
//    - faction / x / y：哪家、打哪一格（按坐标记，城易主 / 被吞后 city_id 会消失，坐标不会）；
//    - city_id / account_id：被围攻的城与其当时的城主（不设外键：城被吞后行要留着算每周上限；
//      account_id 用来在到达时复核「城已易主」）；
//    - level / army / power：发起时固定的官府等级、围城军编成与参考战力；
//    - warn_at / arrive_at：预警时刻与到达时刻（预警 = arrival − 60 分钟 × 烽火台加成）；
//    - resolved_at / outcome：结算时刻与结果（repelled 打输 / hit 扣城防 / swallowed 吞下 / cancelled 作废）；
//    - durability_before / durability_after：这次结算前后的城防值（hit / swallowed 有值）；
//    - swallowed_at / week_index：吞下时刻与所属围攻周（每周上限在这两列上数，避免按时间窗重算）。
//    随换季清空（season-tables.ts 的 RESET_TABLES）。

export const FACTION_SIEGE_SCHEMA_SQL = `
ALTER TABLE npc_attacks ADD COLUMN IF NOT EXISTS faction text;
ALTER TABLE npc_attacks ADD COLUMN IF NOT EXISTS from_x integer;
ALTER TABLE npc_attacks ADD COLUMN IF NOT EXISTS from_y integer;
CREATE TABLE IF NOT EXISTS faction_sieges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  faction text NOT NULL,
  city_id uuid,
  account_id uuid,
  x integer NOT NULL,
  y integer NOT NULL,
  level integer NOT NULL,
  army jsonb NOT NULL,
  power integer NOT NULL,
  warn_at timestamptz NOT NULL DEFAULT now(),
  arrive_at timestamptz NOT NULL,
  resolved_at timestamptz,
  outcome text,
  durability_before integer,
  durability_after integer,
  swallowed_at timestamptz,
  week_index integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_faction_sieges_due ON faction_sieges (arrive_at) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_faction_sieges_faction ON faction_sieges (faction, resolved_at DESC);
CREATE INDEX IF NOT EXISTS idx_faction_sieges_tile ON faction_sieges (x, y, faction, resolved_at DESC);
`;
