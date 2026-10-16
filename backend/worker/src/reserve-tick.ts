// 野地储量到点采空（v61，AISLG-165）：world_tiles.reserve_empty_at 为按当前驻军预计的采空时刻，到点后
// 结算归属方城池。结算会把储量推进到该时刻并产生采空事件与推送；读取路径惰性结算，数值不依赖本 tick，
// 本 tick 只保证采空提醒及时送达（没人打开城池时也能收到）。

import pg from 'pg';
import { settleOwnerCity } from './tick-shared';

/** 单轮最多结算的城池数（防止积压时单个 tick 过长） */
const RESERVE_TICK_BATCH = 50;

export async function processDueReserves(pool: pg.Pool): Promise<number> {
  const due = await pool.query(
    `SELECT DISTINCT owner_city_id FROM world_tiles
     WHERE owner_city_id IS NOT NULL AND reserve_empty_at IS NOT NULL AND reserve_empty_at <= now()
     LIMIT $1`,
    [RESERVE_TICK_BATCH],
  );
  let settled = 0;
  for (const row of due.rows as Array<{ owner_city_id: string }>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await settleOwnerCity(client, row.owner_city_id);
      await client.query('COMMIT');
      settled += 1;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      // 单城失败不影响其余城池；下一轮 tick 会再次尝试
      console.error('reserve settle failed:', row.owner_city_id, err instanceof Error ? err.message : err);
    } finally {
      client.release();
    }
  }
  return settled;
}
