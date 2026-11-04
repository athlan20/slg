// Worker 的探索结算（AISLG-224 第二步）：去程结算后把走过的路线写入已探索、生成探索简报。
// 每个 tick 批量处理 resolved_at 已写、fog_recorded_at 为空的行军（最多 200 条，逐条一个事务）。
// 返程（purpose = return）不写入，只把它们的 fog_recorded_at 补齐，免得反复扫描。
// 结算路径分散在多个文件里，这里统一在结算之后补写，不改那些结算代码。
import pg from 'pg';
import { recordMarchExploration, type ExplorationTrip } from '../../common/src/fog-record';
import { walkedFractionOf } from '../../common/src/fog';

const BATCH_LIMIT = 200;

/** 处理一批待记录的行军；返回本批真正写入探索的行军数 */
export async function processFogExploration(pool: pg.Pool): Promise<number> {
  await pool.query(
    `UPDATE marches SET fog_recorded_at = now()
     WHERE purpose = 'return' AND resolved_at IS NOT NULL AND fog_recorded_at IS NULL`,
  );
  const pending = await pool.query(
    `SELECT id FROM marches WHERE resolved_at IS NOT NULL AND fog_recorded_at IS NULL AND purpose <> 'return'
     ORDER BY resolved_at, id LIMIT $1`,
    [BATCH_LIMIT],
  );
  let recorded = 0;
  for (const row of pending.rows as Array<{ id: string }>) {
    try {
      if (await recordOne(pool, row.id)) {
        recorded += 1;
      }
    } catch (err) {
      console.error('worker fog record failed:', row.id, err instanceof Error ? err.message : err);
    }
  }
  return recorded;
}

async function recordOne(pool: pg.Pool, marchId: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT m.id, m.account_id, m.from_city_id, m.x, m.y, m.troops, m.started_at, m.arrive_at, m.resolved_at,
              c.x AS hx, c.y AS hy
       FROM marches m JOIN cities c ON c.id = m.from_city_id
       WHERE m.id = $1 AND m.fog_recorded_at IS NULL AND m.resolved_at IS NOT NULL AND m.purpose <> 'return'
       FOR UPDATE OF m`,
      [marchId],
    );
    const row = res.rows[0] as
      | {
          id: string; account_id: string; from_city_id: string; x: number; y: number;
          troops: Record<string, number>; started_at: Date; arrive_at: Date; resolved_at: Date; hx: number | null; hy: number | null;
        }
      | undefined;
    if (!row) {
      await client.query('ROLLBACK');
      return false;
    }
    if (row.hx !== null && row.hy !== null) {
      const trip: ExplorationTrip = {
        marchId: row.id,
        accountId: row.account_id,
        fromCityId: row.from_city_id,
        homeX: row.hx,
        homeY: row.hy,
        targetX: row.x,
        targetY: row.y,
        troops: row.troops ?? {},
      };
      const fraction = walkedFractionOf(row.started_at.getTime(), row.arrive_at.getTime(), row.resolved_at.getTime());
      await recordMarchExploration(client, trip, fraction, new Date());
    }
    await client.query(`UPDATE marches SET fog_recorded_at = now() WHERE id = $1`, [marchId]);
    await client.query('COMMIT');
    return row.hx !== null && row.hy !== null;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
