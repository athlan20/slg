// 换季表分类单测（AISLG-134，docs/season-system.md §2.3）：每一张表都必须且只能归入 KEEP / RESET / ARCHIVE 之一。
// 无数据库的部分（分类互斥）始终执行；与 information_schema 对照的部分需要真实 PostgreSQL：
// 设置 TEST_DATABASE_URL（一次性的临时库，别指向开发库），否则跳过。
// 以后新增表漏归类时，这里会失败——补到 common/src/season-tables.ts 对应的列表里。
import assert from 'node:assert/strict';
import { after, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ARCHIVE_TABLES, KEEP_TABLES, RESET_TABLES } from '../common/src/season-tables';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

test('三类表清单互不重叠（同一张表只能有一个去向）', () => {
  const all = [...KEEP_TABLES, ...RESET_TABLES, ...ARCHIVE_TABLES];
  const duplicated = all.filter((name, index) => all.indexOf(name) !== index);
  assert.deepEqual(duplicated, [], `重复归类：${duplicated.join(', ')}`);
});

describe('换季表分类与 information_schema 一致（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('数据库中每一张表都已归类，且清单中的每个名字都是真实存在的表', async () => {
    tmp = await createTempDatabase(dbUrl as string, 'season_tables');
    pool = new pg.Pool({ connectionString: tmp.url, max: 2 });
    await ensureSchema(pool);
    const res = await pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`,
    );
    const actual = res.rows.map((row) => row.table_name);
    const classified = new Set([...KEEP_TABLES, ...RESET_TABLES, ...ARCHIVE_TABLES]);

    const unclassified = actual.filter((name) => !classified.has(name));
    assert.deepEqual(unclassified, [], `以下表未在 season-tables.ts 归类（请补入 KEEP / RESET / ARCHIVE）：${unclassified.join(', ')}`);

    const missing = [...classified].filter((name) => !actual.includes(name));
    assert.deepEqual(missing, [], `season-tables.ts 中有不存在的表名：${missing.join(', ')}`);
  });
});
