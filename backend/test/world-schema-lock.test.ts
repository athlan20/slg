// 世界重建与 ensureSchema 的互斥（AISLG-134 测试反馈：新库上 API 与 Worker 并发首启偶发死锁）：
// ensureWorld 的重建事务先取 ensureSchema 的咨询锁，对方正在做 DDL 时它必须等，而不是拿着表锁与 ALTER TABLE 互等。
// 死锁本身依赖时序、不稳定复现，这里直接断言新的锁规则：schema 锁被占着时，一块地块都不会写入。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema, SCHEMA_LOCK_ID } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('世界重建与建表锁互斥（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;

  before(async () => {
    db = await createTempDatabase(dbUrl as string, 'wslock');
    pool = new pg.Pool({ connectionString: db.url, max: 6 });
    await ensureSchema(pool);
  });

  after(async () => {
    await pool.end();
    await db.drop();
  });

  test('建表锁被占用期间 ensureWorld 不写任何地块，释放后才完成建图', async () => {
    const holder = new pg.Client({ connectionString: db.url });
    await holder.connect();
    await holder.query(`SELECT pg_advisory_lock(${SCHEMA_LOCK_ID})`);
    let finished = false;
    const building = ensureWorld(pool).then(() => {
      finished = true;
    });
    // 等到有后端卡在这把咨询锁上（生成地块是十来秒的纯内存计算，之后才轮到取锁）；没有取锁就会一直等不到
    const deadline = Date.now() + 60_000;
    let waiting = false;
    while (Date.now() < deadline && !waiting) {
      const res = await pool.query(
        `SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted AND objid = $1`,
        [SCHEMA_LOCK_ID],
      );
      waiting = (res.rowCount ?? 0) > 0;
      if (!waiting) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    assert.ok(waiting, 'ensureWorld 的重建事务应当在等建表锁');
    const during = await pool.query(`SELECT count(*)::int AS n FROM world_tiles`);
    assert.equal(during.rows[0].n, 0, '建表锁被占着，不能有任何地块写入');
    assert.equal(finished, false);
    await holder.query(`SELECT pg_advisory_unlock(${SCHEMA_LOCK_ID})`);
    await holder.end();
    await building;
    const after1 = await pool.query(`SELECT count(*)::int AS n FROM world_tiles`);
    assert.ok(after1.rows[0].n > 0, '释放后建图完成');
  });
});
