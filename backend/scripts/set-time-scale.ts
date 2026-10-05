// 运维脚本：查看 / 设置全局时间缩放（AISLG-38，v20）。
// 配置存 settings 表（key='time_scale'），API 与 Worker 共享，进程内缓存 TTL 10s
// 内自动生效，无需重启。语义：耗时类 ÷ scale、速率类 × scale，只作用于新发起的
// 任务与下一次结算（存量 due_at 不重算）。
//
// 运行：
//   npx tsx --env-file=.env scripts/set-time-scale.ts          # 查看当前值
//   npx tsx --env-file=.env scripts/set-time-scale.ts 50       # 设为 50 倍速
//   npx tsx --env-file=.env scripts/set-time-scale.ts 1        # 恢复正常节奏

import { createPool, ensureSchema } from '../common/src/db';
import { DEFAULT_TIME_SCALE } from '../common/src/time-scale';

async function main(): Promise<void> {
  const arg = process.argv[2];
  const pool = createPool('set-time-scale', 1);
  try {
    // settings 表由 ensureSchema 幂等创建（与 API/Worker 启动同一套 DDL），脚本可独立运行
    await ensureSchema(pool);
    if (arg === undefined) {
      const res = await pool.query(`SELECT value, updated_at FROM settings WHERE key = 'time_scale'`);
      if (res.rowCount === 0) {
        console.log(`time_scale = ${DEFAULT_TIME_SCALE}（库中无记录，用默认值）`);
      } else {
        console.log(`time_scale = ${(res.rows[0].value as { scale?: unknown }).scale}（updated_at ${res.rows[0].updated_at.toISOString()}）`);
      }
      return;
    }
    const scale = Number(arg);
    if (!Number.isInteger(scale) || scale < 1) {
      throw new Error('scale 必须是不小于 1 的整数');
    }
    await pool.query(
      `INSERT INTO settings (key, value, updated_at) VALUES ('time_scale', $1::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ scale })],
    );
    console.log(`time_scale → ${scale}（进程缓存 TTL 10s 内生效，无需重启）`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
