// 野地设施（望楼）的表结构（AISLG-232，v97）：新表 wilderness_facilities，只加不改旧表。
// 由 db.ts 的 ensureSchema 幂等创建；随换季清空（season-tables.ts RESET）。
// 一行 = 一块野地上的设施：level 是**已完成**的等级（建造中为 0），building_to / finish_at 是进行中的那一级
//（同一块地同一时间只有一个进行中的建造 / 升级，由行锁 + 这两个字段表达）。
// city_id 指向占地的那座城：城被删除（放弃分城 / 换季）时设施一并消失（ON DELETE CASCADE）；
// 野地易主走 facility-db.ts 的 destroyFacility 显式删除并写事件。

export const FACILITY_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS wilderness_facilities (
  x integer NOT NULL,
  y integer NOT NULL,
  kind text NOT NULL,
  level integer NOT NULL DEFAULT 0,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  building_to integer,
  finish_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (x, y)
);
CREATE INDEX IF NOT EXISTS idx_wilderness_facilities_city ON wilderness_facilities (city_id);
CREATE INDEX IF NOT EXISTS idx_wilderness_facilities_due ON wilderness_facilities (finish_at) WHERE finish_at IS NOT NULL;
`;
