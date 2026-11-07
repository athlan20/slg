// 五方势力的表结构（AISLG-239，v99）：只加不改。
// - world_tiles.faction_lair：这一格是哪家的老巢（可空；老巢地块 kind 仍是 wilderness、level = 0，
//   不占名城、不是 NPC 城）。出征 / 侦察到这个格一律拒绝（FACTION_LAIR_TARGET），落位与迁城也避开它周围 5 格。
// - factions：每季生成老巢时写入一行（key = 势力标识，lair_x / lair_y 为老巢坐标），
//   last_swallow_at 为上一次吞城的时刻（每 6 小时随缩放吞一座），last_radius 为上次播报过的半径
//   （半径扩大时播报一次、每周最多一次）。factions 随换季清空（season-tables.ts RESET），
//   下一季按开关重新生成；faction_enabled 本身留在 settings 里跨季保留。
// - 势力城的归属记在 world_tiles.npc 快照的 faction 字段上（不另建表）：玩家占下后地块转城池、
//   快照清空，归属自然消失；按它计数需要一条表达式索引。
// 由 db.ts 的 ensureSchema 幂等创建。

export const FACTION_SCHEMA_SQL = `
ALTER TABLE world_tiles ADD COLUMN IF NOT EXISTS faction_lair text;
CREATE TABLE IF NOT EXISTS factions (
  key text PRIMARY KEY,
  lair_x integer NOT NULL,
  lair_y integer NOT NULL,
  last_swallow_at timestamptz NOT NULL DEFAULT now(),
  last_radius integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_world_tiles_faction ON world_tiles ((npc->>'faction')) WHERE npc IS NOT NULL;
`;
