// 连胜计数与播报（AISLG-262）：从首胜起算 1 小时窗口、输一场清零、单账号 10 分钟播报冷却。
// 需要 TEST_DATABASE_URL（一次性临时库，别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import {
  WIN_STREAK_BROADCAST_COOLDOWN_MS,
  WIN_STREAK_BROADCAST_EVERY,
  WIN_STREAK_WINDOW_MS,
  recordWinStreak,
} from '../common/src/server-broadcast';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('连胜窗口与播报冷却（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;

  async function win(): Promise<boolean> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const created = await recordWinStreak(client, accountId, true, { username: 't', cityName: 'c' });
      await client.query('COMMIT');
      return created !== null;
    } finally {
      client.release();
    }
  }
  async function lose(): Promise<void> {
    const client = await pool.connect();
    try {
      await recordWinStreak(client, accountId, false, {});
    } finally {
      client.release();
    }
  }
  async function streak(): Promise<number> {
    return (await pool.query(`SELECT count FROM win_streaks WHERE account_id = $1`, [accountId])).rows[0].count as number;
  }
  /** 把本轮连胜的首胜 / 上次胜利 / 上次播报时间往前拨（模拟时间流逝，避免真实 sleep） */
  async function shift(fields: { started?: number; lastWin?: number; lastBroadcast?: number }): Promise<void> {
    const ms = (v: number | undefined) => (v === undefined ? null : v / 1000);
    await pool.query(
      `UPDATE win_streaks SET
         streak_started_at = CASE WHEN $2::float8 IS NULL THEN streak_started_at ELSE now() - make_interval(secs => $2) END,
         last_win_at = CASE WHEN $3::float8 IS NULL THEN last_win_at ELSE now() - make_interval(secs => $3) END,
         last_broadcast_at = CASE WHEN $4::float8 IS NULL THEN last_broadcast_at ELSE now() - make_interval(secs => $4) END
       WHERE account_id = $1`,
      [accountId, ms(fields.started), ms(fields.lastWin), ms(fields.lastBroadcast)],
    );
  }
  async function resetAccount(): Promise<void> {
    await pool.query(`DELETE FROM win_streaks WHERE account_id = $1`, [accountId]);
    await pool.query(`DELETE FROM server_broadcasts`);
  }

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'winstreak');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    accountId = (
      await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`ws-${Date.now()}`])
    ).rows[0].id as string;
  });

  after(async () => {
    await pool.end();
    await tmp?.drop();
  });

  test('窗口内累加，第 5 场播报一条', async () => {
    await resetAccount();
    for (let i = 1; i < WIN_STREAK_BROADCAST_EVERY; i += 1) assert.equal(await win(), false);
    assert.equal(await win(), true);
    assert.equal(await streak(), WIN_STREAK_BROADCAST_EVERY);
  });

  test('输一场清零，之后重新从 1 计', async () => {
    await resetAccount();
    await win();
    await win();
    await lose();
    assert.equal(await streak(), 0);
    await win();
    assert.equal(await streak(), 1);
  });

  test('本轮连胜从首胜起满 1 小时后，下一场胜利回到 1（不是无限累加）', async () => {
    await resetAccount();
    for (let i = 0; i < 7; i += 1) await win();
    assert.equal(await streak(), 7);
    await shift({ started: WIN_STREAK_WINDOW_MS + 1000 });
    await win();
    assert.equal(await streak(), 1);
    await win();
    assert.equal(await streak(), 2);
  });

  test('两场胜利间隔超过 1 小时也清零', async () => {
    await resetAccount();
    await win();
    await win();
    await shift({ lastWin: WIN_STREAK_WINDOW_MS + 1000 });
    await win();
    assert.equal(await streak(), 1);
  });

  test('旧行没有 streak_started_at（迁移前的数据）：下一场胜利重新从 1 计', async () => {
    await resetAccount();
    await pool.query(`INSERT INTO win_streaks (account_id, count, last_win_at) VALUES ($1, 51370, now())`, [accountId]);
    await win();
    assert.equal(await streak(), 1);
  });

  test('单账号播报冷却：冷却内到达的节点不补播，冷却过后下一个节点恢复', async () => {
    await resetAccount();
    for (let i = 0; i < WIN_STREAK_BROADCAST_EVERY; i += 1) await win();
    const n = async () => (await pool.query(`SELECT count(*)::int AS n FROM server_broadcasts WHERE type = 'win_streak'`)).rows[0].n as number;
    assert.equal(await n(), 1);
    // 全服限频不能干扰本测试：清掉刚写的播报，只看账号冷却
    await pool.query(`DELETE FROM server_broadcasts`);
    for (let i = 0; i < WIN_STREAK_BROADCAST_EVERY; i += 1) await win(); // 第 10 场，仍在冷却内
    assert.equal(await streak(), 2 * WIN_STREAK_BROADCAST_EVERY);
    assert.equal(await n(), 0);
    await shift({ lastBroadcast: WIN_STREAK_BROADCAST_COOLDOWN_MS + 1000 });
    for (let i = 0; i < WIN_STREAK_BROADCAST_EVERY; i += 1) await win(); // 第 15 场，冷却已过
    assert.equal(await n(), 1);
  });
});
