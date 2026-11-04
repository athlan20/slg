// 城池迁移的表结构（AISLG-220，v91）：cities.move_lock_until——指定坐标迁城后 12 小时内这座城的出征受限截止时刻。
// 与其他表一起由 db.ts 的 ensureSchema 幂等创建；城池删除（放弃 / 重置 / 被占）时随城一起消失，不另外清理。

export const MOVE_CITY_SCHEMA_SQL = `
ALTER TABLE cities ADD COLUMN IF NOT EXISTS move_lock_until timestamptz;
`;
