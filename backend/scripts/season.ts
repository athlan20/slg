// 运维脚本：赛季查看与换季控制（AISLG-134，docs/season-system.md §6）。
// 换季本身由 Worker 在 end_at 到点时执行（见 worker/src/season-tick.ts）；本脚本只改时间与预设，不直接动世界数据。
//
// 运行（在 backend/ 目录）：
//   npx tsx --env-file=.env scripts/season.ts status
//   npx tsx --env-file=.env scripts/season.ts set-end 2026-10-25T20:00:00+08:00   # 改当前赛季结束时间（如定第 1 季终点）
//   npx tsx --env-file=.env scripts/season.ts end-now                             # 立即换季（下个 Worker tick 执行）
//   npx tsx --env-file=.env scripts/season.ts set-next-scale 50                   # 下一季倍速（换季时写入 settings.time_scale，用后即删）
//   npx tsx --env-file=.env scripts/season.ts set-next-scale none                 # 取消预设，下一季沿用当前倍速
//
// set-end 会按新的结束时间重新布防预告阶段：仍已到达的阶段保留“已发”，结束时间被推后而不再到达的阶段移出，到点重新发。

import type pg from 'pg';
import { createPool, ensureSchema } from '../common/src/db';
import { getCurrentSeason, getMaintenance } from '../common/src/season-db';
import { crossedStages, rearmNotified, SEASON_NOTICE_STAGES } from '../common/src/season-stages';

const USAGE = '用法：season.ts status | set-end <ISO 时间> | end-now | set-next-scale <整数倍速 | none>';

/** 剩余时间的人类可读形式（运维查看用） */
function describeRemaining(ms: number): string {
  if (ms <= 0) {
    return '已到结束时间（等待 Worker 换季）';
  }
  const totalMin = Math.floor(ms / 60_000);
  const days = Math.floor(totalMin / (24 * 60));
  const hours = Math.floor((totalMin % (24 * 60)) / 60);
  const minutes = totalMin % 60;
  return `${days} 天 ${hours} 小时 ${minutes} 分钟`;
}

async function status(pool: pg.Pool): Promise<void> {
  const season = await getCurrentSeason(pool);
  if (!season) {
    console.log('没有进行中的赛季（异常：正常启动后应已播种第 1 季）');
    return;
  }
  const now = Date.now();
  const row = (await pool.query(`SELECT notified_stages FROM seasons WHERE id = $1`, [season.id])).rows[0];
  const notified = (row.notified_stages ?? []) as string[];
  const next = await pool.query(`SELECT value FROM settings WHERE key = 'next_time_scale'`);
  const maintenance = await getMaintenance(pool);
  const endedCount = (await pool.query(`SELECT count(*)::int AS n FROM seasons WHERE status = 'ended'`)).rows[0].n;
  console.log(`当前赛季：${season.name}（id ${season.id}，${season.status}）`);
  console.log(`  开始：${season.startAt.toISOString()}`);
  console.log(`  结束：${season.endAt.toISOString()}（剩余 ${describeRemaining(season.endAt.getTime() - now)}）`);
  console.log(`  倍速：${season.timeScale}（本季种子 ${season.seed}）`);
  console.log(`  下一季倍速预设：${next.rowCount ? (next.rows[0].value as { scale?: unknown }).scale : '未设置（沿用当前）'}`);
  console.log(`  已结束赛季：${endedCount} 个`);
  console.log(`  维护态：${maintenance ? `${maintenance.reason}（自 ${maintenance.since}）` : '无'}`);
  const crossed = crossedStages(season.endAt.getTime(), now);
  console.log('  预告阶段：');
  for (const item of SEASON_NOTICE_STAGES) {
    const sent = notified.includes(item.stage);
    const reached = crossed.includes(item.stage);
    const state = sent ? '已发' : reached ? '已到达，待发' : '未到';
    console.log(`    ${item.stage.padEnd(6)} ${state}`);
  }
}

async function setEnd(pool: pg.Pool, iso: string): Promise<void> {
  const endAt = new Date(iso);
  if (Number.isNaN(endAt.getTime())) {
    throw new Error(`不是合法的 ISO 时间：${iso}`);
  }
  const season = await getCurrentSeason(pool);
  if (!season) {
    throw new Error('没有进行中的赛季');
  }
  const now = Date.now();
  const row = (await pool.query(`SELECT notified_stages FROM seasons WHERE id = $1`, [season.id])).rows[0];
  const rearmed = rearmNotified(endAt.getTime(), now, (row.notified_stages ?? []) as string[]);
  await pool.query(`UPDATE seasons SET end_at = $2, notified_stages = $3::text[] WHERE id = $1`, [season.id, endAt, rearmed]);
  console.log(`${season.name} 结束时间 → ${endAt.toISOString()}（剩余 ${describeRemaining(endAt.getTime() - now)}）`);
  console.log(`预告已发阶段保留：${rearmed.length > 0 ? rearmed.join(', ') : '无'}`);
  if (endAt.getTime() <= now) {
    console.log('注意：新结束时间已过，Worker 下个 tick 将执行换季（需要 Worker 在运行）');
  }
}

async function endNow(pool: pg.Pool): Promise<void> {
  const season = await getCurrentSeason(pool);
  if (!season) {
    throw new Error('没有进行中的赛季');
  }
  const nowDate = new Date();
  await pool.query(`UPDATE seasons SET end_at = $2 WHERE id = $1`, [season.id, nowDate]);
  console.log(`${season.name} 结束时间已设为现在（${nowDate.toISOString()}）；Worker 下个 tick 执行换季（需要 Worker 在运行）`);
}

async function setNextScale(pool: pg.Pool, arg: string): Promise<void> {
  if (arg === 'none') {
    await pool.query(`DELETE FROM settings WHERE key = 'next_time_scale'`);
    console.log('已取消下一季倍速预设，下一季沿用当前倍速');
    return;
  }
  const scale = Number(arg);
  if (!Number.isInteger(scale) || scale < 1) {
    throw new Error('倍速必须是不小于 1 的整数（或 none）');
  }
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('next_time_scale', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify({ scale })],
  );
  console.log(`下一季倍速预设 → ${scale}（换季时写入 time_scale 并清除此预设）`);
}

async function main(): Promise<void> {
  const [command, arg] = process.argv.slice(2);
  if (command === undefined) {
    console.log(USAGE);
    return;
  }
  const pool = createPool('season-ops', 1);
  try {
    // seasons / settings 表由 ensureSchema 幂等创建（与 API / Worker 启动同一套 DDL）
    await ensureSchema(pool);
    if (command === 'status') {
      await status(pool);
    } else if (command === 'set-end') {
      if (!arg) {
        throw new Error('用法：season.ts set-end <ISO 时间>');
      }
      await setEnd(pool, arg);
    } else if (command === 'end-now') {
      await endNow(pool);
    } else if (command === 'set-next-scale') {
      if (!arg) {
        throw new Error('用法：season.ts set-next-scale <整数倍速 | none>');
      }
      await setNextScale(pool, arg);
    } else {
      throw new Error(`未知命令：${command}\n${USAGE}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
