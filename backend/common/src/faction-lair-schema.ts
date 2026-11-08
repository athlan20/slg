// 攻破老巢（AISLG-241，v101）的表结构：只加不改。
//
// 1) faction_lairs：每季每家老巢一行的战况（随 faction_enabled 生成，随换季清空）。
//    - camps_total / camps_remaining：20 营总数与剩余营数（含当前营；降到 0 = 本季灭亡）；
//    - remaining / remaining_at：当前营的残血编成与记录时刻（null = 满营；写法与 yt_camps 一致）；
//    - camp_power / power_at：每营战力（全服前 10 名合计 ÷ 15，下限 10,000）与上次刷新时刻；
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
`;
