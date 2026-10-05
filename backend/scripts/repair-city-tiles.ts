// 一次性运维脚本：修复「坐标仍在但城池地块缺失」的存量城池。
// 背景（2026-09-29 事故）：world_tiles 被代码路径之外清空并按 v19 规则重建，
// 419 座存量城的地块关联全部丢失（城市 x/y 保留），世界地图上不再显示这些城池。
// 修复逻辑复用 world-db.ts 的 restoreOrphanedCityTiles（ensureWorld 引导时同样调用）：
// 旧坐标仍是空闲野地则就地复位；已被 NPC 城 / 其他城占用的重新择址。
// 另清理指向「非占领野地」的幽灵地块驻军（tile_army，重建后归属已无从考证）。
// 运行：npx tsx --env-file=.env scripts/repair-city-tiles.ts

import { createPool } from '../common/src/db';
import { restoreOrphanedCityTiles, WORLD_LOCK_ID } from '../common/src/world-db';

async function main(): Promise<void> {
  const pool = createPool('repair-city-tiles', 1);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // 事务级咨询锁：与 ensureWorld 的引导锁互斥，锁到事务提交自动释放
    await client.query(`SELECT pg_advisory_xact_lock($1)`, [WORLD_LOCK_ID]);

    const before = await client.query(
      `SELECT count(*)::int AS n FROM cities c
       WHERE x IS NOT NULL AND y IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM world_tiles wt
           WHERE wt.owner_city_id = c.id AND wt.kind = 'city'
         )`,
    );
    console.log(`orphaned cities before repair: ${before.rows[0].n}`);

    const repaired = await restoreOrphanedCityTiles(client);
    console.log(
      `repaired: restored in place = ${repaired.restored}, relocated = ${repaired.relocated}`,
    );

    // 幽灵驻军：tile_army 只允许指向「已占领的野地」；重建后归属丢失的行直接清除
    // （部队无法考证归属城池，等同随重建遗失）
    const ghosts = await client.query(
      `DELETE FROM tile_army ta
       WHERE NOT EXISTS (
         SELECT 1 FROM world_tiles wt
         WHERE wt.x = ta.x AND wt.y = ta.y
           AND wt.kind = 'wilderness' AND wt.owner_city_id IS NOT NULL
       )
       RETURNING ta.count`,
    );
    const ghostTroops = ghosts.rows.reduce((sum, r) => sum + Number(r.count), 0);
    console.log(`ghost tile_army rows deleted: ${ghosts.rowCount} (troops ${ghostTroops})`);

    await client.query('COMMIT');

    // 复核：孤儿城应为 0，城池地块数应等于城市数
    const check = await client.query(
      `SELECT (SELECT count(*)::int FROM cities) AS cities,
              (SELECT count(*)::int FROM world_tiles WHERE kind = 'city') AS city_tiles,
              (SELECT count(*)::int FROM cities c
               WHERE x IS NOT NULL AND y IS NOT NULL
                 AND NOT EXISTS (
                   SELECT 1 FROM world_tiles wt
                   WHERE wt.owner_city_id = c.id AND wt.kind = 'city'
                 )) AS still_orphaned`,
    );
    const row = check.rows[0] as { cities: number; city_tiles: number; still_orphaned: number };
    console.log(`verify: cities = ${row.cities}, city tiles = ${row.city_tiles}, orphaned = ${row.still_orphaned}`);
    if (row.still_orphaned !== 0) {
      console.error('仍有孤儿城池，请人工核查');
      process.exitCode = 1;
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('repair failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
