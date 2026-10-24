// 任务与活动（AISLG-200）：静态定义的一致性 + 领奖 / 签到的原子性。
// 数据库用例需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑（用一次性的临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { claimDaily, DAILY_TASKS, loadQuestState, QuestError, SIGNIN_REWARDS, signin, todayInfo } from '../common/src/quest';
import { ACHIEVEMENTS, claimActivity, claimQuest, MAIN_QUESTS, SIDE_QUESTS } from '../common/src/quests';

describe('任务定义', () => {
  test('日常 / 主线 / 支线 id 不重复，签到一轮 7 档', () => {
    const ids = [...DAILY_TASKS, ...MAIN_QUESTS, ...SIDE_QUESTS].map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(SIGNIN_REWARDS.length, 7);
    for (const a of ACHIEVEMENTS) {
      const th = a.tiers.map((t) => t.threshold);
      assert.deepEqual([...th].sort((x, y) => x - y), th, `${a.id} 档位门槛应递增`);
    }
  });
});

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('领奖原子性（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;

  async function gold(): Promise<number> {
    const r = await pool.query(`SELECT gold FROM cities WHERE account_id = $1`, [accountId]);
    return r.rows[0].gold as number;
  }

  /** 并发发起 n 次，返回成功次数；失败必须全是 QuestError('ALREADY') */
  async function race(n: number, fn: () => Promise<unknown>): Promise<number> {
    const results = await Promise.allSettled(Array.from({ length: n }, fn));
    let ok = 0;
    for (const r of results) {
      if (r.status === 'fulfilled') {
        ok += 1;
      } else {
        assert.ok(r.reason instanceof QuestError && r.reason.message === 'ALREADY', String(r.reason));
      }
    }
    return ok;
  }

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'quest');
    pool = new pg.Pool({ connectionString: tmp.url, max: 12 });
    await ensureSchema(pool);
    const acc = await pool.query(
      `INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`,
      [`quest-test-${Date.now()}`],
    );
    accountId = acc.rows[0].id as string;
    await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food) VALUES ($1, '主城', 0, 0, 0)`, [accountId]);
  });

  after(async () => {
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    await pool.end();
    await tmp?.drop();
  });

  test('并发领取同一条日常任务，只发一次奖', async () => {
    const before0 = await gold();
    const ok = await race(8, () => claimDaily(pool, accountId, 'login'));
    assert.equal(ok, 1);
    assert.equal((await gold()) - before0, DAILY_TASKS.find((t) => t.id === 'login')!.reward.gold);
  });

  test('并发签到只成功一次，连续天数与奖励正确', async () => {
    const before0 = await gold();
    const ok = await race(8, () => signin(pool, accountId));
    assert.equal(ok, 1);
    assert.equal((await gold()) - before0, SIGNIN_REWARDS[0].gold);
    const state = await loadQuestState(pool, accountId);
    assert.equal(state.signin.streak, 1);
    assert.equal(state.signin.total, 1);
    assert.equal(state.signin.todaySigned, true);
  });

  test('隔天签到连续 +1，第 7 天后回到第 1 档，断签归 1', async () => {
    const { yesterday } = await todayInfo(pool);
    await pool.query(`UPDATE signin_state SET last_day = $2::date, streak = 6 WHERE account_id = $1`, [accountId, yesterday]);
    assert.equal((await signin(pool, accountId)).tier, 7);
    await pool.query(`UPDATE signin_state SET last_day = $2::date WHERE account_id = $1`, [accountId, yesterday]);
    const next = await signin(pool, accountId);
    assert.equal(next.streak, 8);
    assert.equal(next.tier, 1);
    await pool.query(`UPDATE signin_state SET last_day = ($2::date - 1) WHERE account_id = $1`, [accountId, yesterday]);
    assert.equal((await signin(pool, accountId)).streak, 1);
  });

  test('未完成不能领；主线必须按顺序，且并发只发一次', async () => {
    await assert.rejects(claimDaily(pool, accountId, 'build'), (e: unknown) => e instanceof QuestError && e.message === 'NOT_DONE');
    await assert.rejects(claimDaily(pool, accountId, 'nope'), (e: unknown) => e instanceof QuestError && e.message === 'UNKNOWN_TASK');
    await assert.rejects(claimQuest(pool, accountId, 'main', 'm2'), (e: unknown) => e instanceof QuestError && e.message === 'NOT_DONE');

    await pool.query(`INSERT INTO events (account_id, type) VALUES ($1, 'build_completed')`, [accountId]);
    const before0 = await gold();
    const ok = await race(8, () => claimQuest(pool, accountId, 'main', 'm1'));
    assert.equal(ok, 1);
    assert.equal((await gold()) - before0, MAIN_QUESTS[0].reward.gold);
  });

  test('并发领取每日活跃阶梯只发一次', async () => {
    // 此时今日：登录 + 建造 两条日常完成，加上签到，活跃点 = 3
    const before0 = await gold();
    const ok = await race(8, () => claimActivity(pool, accountId, 'act_daily:3'));
    assert.equal(ok, 1);
    assert.equal((await gold()) - before0, 800);
    await assert.rejects(claimActivity(pool, accountId, 'act_daily:7'), (e: unknown) => e instanceof QuestError && e.message === 'NOT_DONE');
  });
});
