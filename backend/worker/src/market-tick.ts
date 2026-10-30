// 玩家交易所（v78，AISLG-196）的 Worker 侧：商队到达入账与 48 小时挂单过期退款。
// 商队是 purpose='caravan' 的行军：不会被截击、到达不战斗，只把 cargo 并入目的地城池。

import type pg from 'pg';
import { readCargo } from '../../common/src/transport';
import { expireMarketOrders } from '../../common/src/market-db';
import { creditLoot } from './tick-shared';

/** 商队到达：把货物并入目的地城（不钳储量上限，与掠夺入账同规则），行军标记完成 */
export async function settleCaravanArrival(client: pg.PoolClient, march: { id: string; to_city_id?: string | null; cargo?: unknown }): Promise<boolean> {
  if (!march.to_city_id) {
    await client.query(`UPDATE marches SET status = 'completed', resolved_at = now() WHERE id = $1`, [march.id]);
    return false;
  }
  const city = await client.query(`SELECT id FROM cities WHERE id = $1 FOR UPDATE`, [march.to_city_id]);
  if (!city.rowCount) {
    await client.query(`UPDATE marches SET status = 'completed', resolved_at = now() WHERE id = $1`, [march.id]);
    return false;
  }
  const cargo = readCargo(march.cargo);
  if (cargo) {
    await creditLoot(client, march.to_city_id, cargo);
  }
  await client.query(`UPDATE marches SET status = 'completed', resolved_at = now() WHERE id = $1`, [march.id]);
  return Boolean(cargo);
}

/** 过期挂单检查间隔（毫秒，真实时间）：AISLG-208 起节流，挂单 48 小时才过期，晚 10 秒无感 */
export const MARKET_TICK_MS = 10_000;

let lastRunMs = 0;

/** 过期挂单回收（节流到 MARKET_TICK_MS；事务内锁行、退款、写事件） */
export async function processMarketOrders(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < MARKET_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const count = await expireMarketOrders(client);
    await client.query('COMMIT');
    return count;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
