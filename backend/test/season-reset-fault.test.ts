// 换季故障注入（AISLG-134，docs/season-system.md §9 验收 6）：换季事务中途抛错 → 旧世界逐表原样保留、旧赛季仍为
// 进行中、维护态被清除且推送了 maintenance_off、没有发 season_started；连续失败 5 次后停止自动重试；
// 故障消除后再跑一次 tick 能正常换季。需要真实 PostgreSQL：设置 TEST_DATABASE_URL，否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema, NOTIFY_CHANNEL } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { seedArenaNpcs } from '../common/src/arena-db';
import { RESET_TABLES } from '../common/src/season-tables';
import { getCurrentSeason, getMaintenance } from '../common/src/season-db';
import { insertAccountWithCity } from '../api/src/auth';
import { runSeasonReset, type ResetStep } from '../worker/src/season-reset';
import { processSeasonTick, resetSeasonTickStateForTest, seasonResetHalted, SEASON_RESET_MAX_FAILURES, SEASON_RESET_RETRY_MS } from '../worker/src/season-tick';
import { isSeasonResetting } from '../worker/src/season-busy';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

/** 榜单快照是派生缓存：换季前的强制刷新已提交（不在换季事务内），不计入“旧世界原样”的比较 */
const DERIVED_CACHE_TABLES = new Set(['leaderboard_snapshots', 'leaderboard_model_snapshots']);

async function resetTableCounts(pool: pg.Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of RESET_TABLES) {
    if (DERIVED_CACHE_TABLES.has(table)) {
      continue;
    }
    counts[table] = (await pool.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n as number;
  }
  return counts;
}

async function npcFingerprint(pool: pg.Pool): Promise<string> {
  const res = await pool.query(
    `SELECT md5(string_agg(x || ',' || y, ';' ORDER BY x, y)) AS h FROM world_tiles WHERE kind = 'npc_city'`,
  );
  return res.rows[0].h as string;
}

describe('换季故障注入（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let db: TempDatabase;
  let pool: pg.Pool;
  let listener: pg.Client;
  const reasons: string[] = [];
  let before0: Record<string, number>;
  let seasonBefore: { id: number; seed: number };
  let fingerprintBefore: string;
  let accountBefore: { season_id: number; plunder_total: string };

  before(async () => {
    db = await createTempDatabase(dbUrl as string, 'fault');
    pool = new pg.Pool({ connectionString: db.url, max: 6 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    await seedArenaNpcs(pool);
    listener = new pg.Client({ connectionString: db.url });
    await listener.connect();
    listener.on('notification', (msg) => {
      if (msg.channel === NOTIFY_CHANNEL && msg.payload) {
        reasons.push((JSON.parse(msg.payload) as { reason: string }).reason);
      }
    });
    await listener.query(`LISTEN ${NOTIFY_CHANNEL}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await insertAccountWithCity(client, { username: `fault-${Date.now()}`, passwordHash: 'x', signupIp: null });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    await pool.query(`UPDATE accounts SET plunder_total = 77`);
    before0 = await resetTableCounts(pool);
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    seasonBefore = { id: season.id, seed: season.seed };
    fingerprintBefore = await npcFingerprint(pool);
    accountBefore = (await pool.query(`SELECT season_id, plunder_total FROM accounts LIMIT 1`)).rows[0];
    await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
  });

  after(async () => {
    resetSeasonTickStateForTest();
    await listener?.end().catch(() => undefined);
    await pool?.end();
    await db?.drop();
  });

  /** 断言旧世界原样：各重置表行数、NPC 指纹、赛季行、账号赛季字段、维护态 */
  async function assertOldWorldIntact(): Promise<void> {
    assert.deepEqual(await resetTableCounts(pool), before0, '各重置表（榜单快照除外）行数与换季前一致');
    assert.equal(await npcFingerprint(pool), fingerprintBefore, '地图未变');
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    assert.equal(season.id, seasonBefore.id, '仍是原赛季');
    assert.equal(season.seed, seasonBefore.seed, '种子未变');
    const acc = (await pool.query(`SELECT season_id, plunder_total FROM accounts LIMIT 1`)).rows[0];
    assert.equal(acc.season_id, accountBefore.season_id);
    assert.equal(String(acc.plunder_total), String(accountBefore.plunder_total));
    assert.equal(await getMaintenance(pool), null, '维护态已清除');
    assert.equal(isSeasonResetting(), false, '进程内换季标记已清除');
  }

  test('事务中途（世界重建阶段）抛错：整体回滚，旧世界原样，维护态被清除，推送 maintenance_off 且没有 season_started', async () => {
    const seen: ResetStep[] = [];
    await assert.rejects(
      runSeasonReset(pool, {
        beforeStep: (step) => {
          seen.push(step);
          if (step === 'world') {
            throw new Error('注入的故障：世界重建');
          }
        },
      }),
      /注入的故障：世界重建/,
    );
    assert.deepEqual(seen, ['maintenance', 'leaderboard', 'archive', 'clear', 'world']);
    await assertOldWorldIntact();
    // 名人堂存档也在同一事务里，回滚后不应留下
    const archived = (await pool.query(`SELECT count(*)::int AS n FROM season_archives WHERE season_id = $1`, [seasonBefore.id])).rows[0].n;
    assert.equal(archived, 0, '存档随事务回滚');
    for (let i = 0; i < 50 && !reasons.includes('maintenance_off'); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(reasons.includes('maintenance_on') && reasons.includes('season_resetting'));
    assert.equal(reasons.filter((r) => r === 'maintenance_off').length, 1);
    assert.ok(!reasons.includes('season_started'), '未提交不发 season_started');
  });

  test('连续失败 5 次后停止自动重试（旧世界保持，每次失败都清维护态）；之后不再尝试', async () => {
    reasons.length = 0;
    let attempts = 0;
    resetSeasonTickStateForTest({
      beforeStep: (step) => {
        if (step === 'clear') {
          attempts += 1;
          throw new Error(`注入的故障 #${attempts}`);
        }
      },
    });
    const base = Date.now();
    // 失败后 30 秒内不重试：同一时刻再 tick 不会增加尝试次数
    await processSeasonTick(pool, base);
    assert.equal(attempts, 1);
    await processSeasonTick(pool, base + 1000);
    assert.equal(attempts, 1, '退避期内不重试');
    await assertOldWorldIntact();
    // 逐次推进到退避期之后
    for (let i = 1; i < SEASON_RESET_MAX_FAILURES; i += 1) {
      await processSeasonTick(pool, base + (i + 1) * (SEASON_RESET_RETRY_MS + 1000));
      await assertOldWorldIntact();
    }
    assert.equal(attempts, SEASON_RESET_MAX_FAILURES);
    assert.equal(seasonResetHalted(), true, '连续失败达到上限后停止');
    await processSeasonTick(pool, base + 100 * SEASON_RESET_RETRY_MS);
    assert.equal(attempts, SEASON_RESET_MAX_FAILURES, '停止后不再尝试');
    await assertOldWorldIntact();
  });

  test('故障消除（人工处理后重启 Worker 的效果）：再跑一次 tick 即可正常换季', async () => {
    resetSeasonTickStateForTest();
    const outcome = await processSeasonTick(pool);
    assert.equal(outcome, 'reset');
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    assert.notEqual(season.id, seasonBefore.id);
    assert.notEqual(season.seed, seasonBefore.seed);
    assert.equal(await getMaintenance(pool), null);
    const acc = (await pool.query(`SELECT season_id FROM accounts LIMIT 1`)).rows[0];
    assert.equal(acc.season_id, null, '账号待惰性加入');
  });
});
