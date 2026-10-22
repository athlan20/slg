// 新赛季落库（第 1 季播种与换季共用）。单独成文件，避免 season-seed ↔ season-db ↔ db 的循环引用。

import type pg from 'pg';

type Db = pg.Pool | pg.PoolClient;

/**
 * 插入新赛季并返回其编号与名称（第 1 季播种与换季共用）。编号取 max(id)+1 而不走 serial：
 * 换季失败回滚时 nextval 不会回退，会让下一次成功的换季跳号（如直接变成第 4 季）。
 * 调用方必须已持有串行化手段（ensureSchema 的咨询锁 / 换季的 8721420 事务锁）。
 */
export async function insertSeason(
  db: Db,
  fields: { startAt: Date; endAt: Date; seed: number; timeScale: number },
): Promise<{ id: number; name: string }> {
  const res = await db.query(
    `INSERT INTO seasons (id, name, status, start_at, end_at, seed, time_scale)
     SELECT n, '第 ' || n || ' 赛季', 'active', $1, $2, $3, $4
     FROM (SELECT COALESCE(max(id), 0) + 1 AS n FROM seasons) next
     RETURNING id, name`,
    [fields.startAt, fields.endAt, fields.seed, fields.timeScale],
  );
  // 显式写 id 不会推进 serial 序列：把序列追平到 max(id)，避免别处按默认值插入时撞主键
  await db.query(`SELECT setval(pg_get_serial_sequence('seasons', 'id'), (SELECT max(id) FROM seasons))`);
  return { id: Number(res.rows[0].id), name: String(res.rows[0].name) };
}
