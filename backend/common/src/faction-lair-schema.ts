// 攻破老巢（AISLG-241，v101）的表结构：只加不改。
//
// 1) faction_lairs：每季每家老巢一行的战况（随 faction_enabled 生成，随换季清空）。
//    - camps_total / camps_remaining：20 营总数与剩余营数（含当前营；降到 0 = 本季灭亡）；
//    - remaining / remaining_at：当前营的残血编成与记录时刻（null = 满营；写法与 yt_camps 一致）；
//    - camp_power_g1 / camp_power_g20：20 营由弱到强的两个锚点（AISLG-247，v106）——第 1 营战力 G1 与
//      第 20 营战力 G20，每天刷新、各自只升不降、下限 10,000；当前营的战力按营序号
//      Gk = G1 × (G20 / G1)^((k − 1) / 19) 现算（faction-lair.ts 的 factionLairCampPowerAt）；
//    - camp_power：v101 的单一「每营战力」（全服前 10 名合计 ÷ 15）。AISLG-247 起不再写入、也不再用，
//      只留给迁移回填两个锚点与旧数据排查（旧行回填 G1 = G20 = camp_power，旧库行为不变）；
//    - power_at：上次刷新锚点的时刻（24 小时刷新一次）；
//    - last_battle_at：最后一次被玩家进攻的时刻（24 小时没人进攻恢复 1 营，从没被打过为 null）；
//    - destroyed_at / destroyed_by：本季灭亡时刻与最后一击的玩家（换季重建）。
// 2) faction_contrib：每人打这家老巢累计歼灭的守军战力（贡献榜；灭亡时按名次发奖，换季清零）。
// 老巢地块仍是 world_tiles 上 kind='wilderness'、level=0、带 faction_lair 标记的格：
// 灭亡后标记保留（地图上显示废墟），state 在 faction_lairs.destroyed_at 上。
// 由 db.ts 的 ensureSchema 幂等创建。

export const FACTION_LAIR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS faction_lairs (
  key text PRIMARY KEY,
  camps_total integer NOT NULL DEFAULT 20,
  camps_remaining integer NOT NULL DEFAULT 20,
  remaining jsonb,
  remaining_at timestamptz,
  camp_power integer NOT NULL DEFAULT 10000,
  power_at timestamptz,
  last_battle_at timestamptz,
  destroyed_at timestamptz,
  destroyed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS faction_contrib (
  key text NOT NULL,
  account_id uuid NOT NULL,
  power bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (key, account_id)
);
-- AISLG-247（v106）：20 营由弱到强，用两个锚点存（G1 = 第 1 营、G20 = 第 20 营）。
-- 迁移向后兼容、可重复执行：先加可空列，旧行用旧的单一 camp_power 回填（G1 = G20 = camp_power，
-- 旧库行为与升级前一致；power_at 置空让 Worker 下一轮立刻刷新成梯度，该次刷新不受“只升不降”限制），再补默认值与 NOT NULL。
ALTER TABLE faction_lairs ADD COLUMN IF NOT EXISTS camp_power_g1 integer;
ALTER TABLE faction_lairs ADD COLUMN IF NOT EXISTS camp_power_g20 integer;
UPDATE faction_lairs SET camp_power_g1 = camp_power, camp_power_g20 = camp_power, power_at = NULL
 WHERE camp_power_g1 IS NULL OR camp_power_g20 IS NULL;
ALTER TABLE faction_lairs ALTER COLUMN camp_power_g1 SET DEFAULT 10000;
ALTER TABLE faction_lairs ALTER COLUMN camp_power_g20 SET DEFAULT 10000;
ALTER TABLE faction_lairs ALTER COLUMN camp_power_g1 SET NOT NULL;
ALTER TABLE faction_lairs ALTER COLUMN camp_power_g20 SET NOT NULL;
`;
