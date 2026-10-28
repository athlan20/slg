// 运维脚本：剧本战场（v75，AISLG-198）的查看与本地验证。
// 正常日程由 Worker 按北京时间每周二 / 三 / 四自动推进；本脚本只改当前这一场的时间，
// 用于本地 / 测试环境手动走完「报名 → 开战 → 结束」。
//
// 运行（在 backend/ 目录）：
//   npx tsx --env-file=.env scripts/battlefield.ts status
//   npx tsx --env-file=.env scripts/battlefield.ts open      # 立即进入报名期（开战 = 现在 + 1 小时）
//   npx tsx --env-file=.env scripts/battlefield.ts start     # 立即开战（下个 Worker tick 生效）
//   npx tsx --env-file=.env scripts/battlefield.ts end       # 立即结束（下个 Worker tick 结算发奖）
//   npx tsx --env-file=.env scripts/battlefield.ts cleanup   # 删除当前战场数据（不删军功余额）

import type pg from 'pg';
import { createPool, ensureSchema } from '../common/src/db';

const USAGE = '用法：battlefield.ts status | open | start | end | cleanup';

async function ensureEvent(pool: pg.Pool): Promise<string> {
  const existing = await pool.query(`SELECT id FROM battlefield_events ORDER BY signup_start DESC LIMIT 1`);
  if (existing.rowCount) {
    return existing.rows[0].id as string;
  }
  const now = Date.now();
  const inserted = await pool.query(
    `INSERT INTO battlefield_events (script, signup_start, start_at, end_at, status)
     VALUES ('guandu', $1, $2, $3, 'signup') RETURNING id`,
    [new Date(now - 60_000), new Date(now + 3_600_000), new Date(now + 24 * 3_600_000)],
  );
  return inserted.rows[0].id as string;
}

async function status(pool: pg.Pool): Promise<void> {
  const res = await pool.query(`SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1`);
  if (!res.rowCount) {
    console.log('还没有任何剧本战场（等周二 20:00，或运行 open）');
    return;
  }
  const row = res.rows[0] as {
    id: string;
    status: string;
    signup_start: Date;
    start_at: Date;
    end_at: Date;
    score_yuan: string;
    score_cao: string;
    winner_camp: string | null;
    finish_reason: string | null;
  };
  console.log(`战场 ${row.id}：${row.status}`);
  console.log(`  报名：${row.signup_start.toISOString()}`);
  console.log(`  开战：${row.start_at.toISOString()}`);
  console.log(`  结束：${row.end_at.toISOString()}`);
  console.log(`  比分：袁绍 ${Number(row.score_yuan).toFixed(1)} : 曹操 ${Number(row.score_cao).toFixed(1)}`);
  if (row.winner_camp) {
    console.log(`  胜方：${row.winner_camp}（${row.finish_reason}）`);
  }
  const counts = await pool.query(
    `SELECT camp, count(*)::int AS signups, count(entered_at)::int AS entered FROM battlefield_participants WHERE event_id = $1 GROUP BY camp`,
    [row.id],
  );
  for (const item of counts.rows as Array<{ camp: string; signups: number; entered: number }>) {
    console.log(`  ${item.camp}：报名 ${item.signups}，入场 ${item.entered}`);
  }
  const squads = await pool.query(
    `SELECT status, count(*)::int AS n FROM battlefield_squads WHERE event_id = $1 GROUP BY status`,
    [row.id],
  );
  console.log(`  队伍：${squads.rows.map((item: { status: string; n: number }) => `${item.status} ${item.n}`).join(' / ') || '无'}`);
  const strongholds = await pool.query(
    `SELECT id, owner_camp FROM battlefield_strongholds WHERE event_id = $1 ORDER BY id`,
    [row.id],
  );
  for (const item of strongholds.rows as Array<{ id: string; owner_camp: string | null }>) {
    console.log(`  据点 ${item.id}：${item.owner_camp ?? '中立'}`);
  }
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || !['status', 'open', 'start', 'end', 'cleanup'].includes(command)) {
    console.log(USAGE);
    process.exitCode = 1;
    return;
  }
  const pool = createPool('slg-script-battlefield', 2, { maintenance: true });
  try {
    await ensureSchema(pool);
    if (command === 'status') {
      await status(pool);
      return;
    }
    if (command === 'cleanup') {
      await pool.query(`DELETE FROM battlefield_events`);
      console.log('已删除全部战场数据（报名 / 队伍 / 据点 / 购买记录随外键级联；军功余额保留）');
      return;
    }
    const id = await ensureEvent(pool);
    const now = Date.now();
    if (command === 'open') {
      await pool.query(
        `UPDATE battlefield_events SET status = 'signup', signup_start = $2, start_at = $3, end_at = $4,
                winner_camp = NULL, finish_reason = NULL, finished_at = NULL,
                signup_announced_at = NULL, start_announced_at = NULL,
                last_score_at = NULL, last_food_at = NULL
         WHERE id = $1`,
        [id, new Date(now - 60_000), new Date(now + 3_600_000), new Date(now + 24 * 3_600_000)],
      );
      await pool.query(`DELETE FROM battlefield_squads WHERE event_id = $1`, [id]);
      await pool.query(`UPDATE battlefield_participants SET entered_at = NULL, merit = 0, rewarded_at = NULL WHERE event_id = $1`, [id]);
      console.log(`已开启报名（战场 ${id}）：1 小时后开战`);
    } else if (command === 'start') {
      await pool.query(
        `UPDATE battlefield_events SET status = 'signup', signup_start = $2, start_at = $3, end_at = $4 WHERE id = $1`,
        [id, new Date(now - 120_000), new Date(now - 1_000), new Date(now + 24 * 3_600_000)],
      );
      console.log(`已设为立即开战（战场 ${id}）：下个 Worker tick 生效`);
    } else if (command === 'end') {
      await pool.query(
        `UPDATE battlefield_events SET end_at = $2 WHERE id = $1`,
        [id, new Date(now - 1_000)],
      );
      console.log(`已设为立即结束（战场 ${id}）：下个 Worker tick 结算发奖`);
    }
    await status(pool);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error('剧本战场脚本失败：', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});