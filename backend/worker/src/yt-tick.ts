// Worker 的黄巾之乱周期推进（v29，AISLG-76）：节流到 YT_TICK_MS，依次
// 1) 事件推进事务（持黄巾全局锁）：到时限收场；否则营地坐大（小 → 中 → 大，每过 YT_GROW_HOURS 升一档，
//    全服播报）；没有进行中事件时按间隔（上一轮开始后 YT_CYCLE_DAYS 天，随时间缩放）且有活跃玩家则起事；
// 2) 大营发兵：每座到期的大营向半径内最近的玩家野地 / 主城发一次 NPC 来袭（走既有预警流程，独立事务，
//    不持黄巾锁——来袭的外键共享锁与出征结算的城池行锁不能和黄巾锁交叉等待）。
// 营地出征结算在 yt-camp.ts，生命周期函数在 yt-event.ts。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { YT_RAID_LEVEL, YT_RAID_RADIUS, YT_TIER_INFO, ytCycleMs, ytGrowMs, ytNextTier, ytRaidMs, type YtCampTier } from '../../common/src/yellow-turban';
import { loadActiveYtEvent, loadLatestYtEvent, type YtCampRow } from '../../common/src/yellow-turban-db';
import { createNearbyNpcAttack } from './npc-attack';
import { finishYtEvent, lockYt, newYtNotifies, publishYtNotifies, startYtEvent, ytBroadcast } from './yt-event';

/** 推进检查的最小间隔（毫秒，真实时间） */
export const YT_TICK_MS = 5_000;

let lastRunMs = 0;

/** 营地坐大：到期的小 / 中营升一档；同一 tick 升到同一档的合并成一条播报 */
async function growCamps(client: pg.PoolClient, n: ReturnType<typeof newYtNotifies>, eventId: string): Promise<number> {
  const due = await client.query(
    `SELECT * FROM yt_camps
     WHERE event_id = $1 AND status = 'active' AND tier IN ('small', 'medium') AND next_grow_at <= now()
     ORDER BY id`,
    [eventId],
  );
  const grown: Record<string, number> = {};
  for (const camp of due.rows as YtCampRow[]) {
    const next = ytNextTier(camp.tier as YtCampTier);
    if (!next) {
      continue;
    }
    await client.query(
      `UPDATE yt_camps SET tier = $2, remaining = NULL, remaining_at = NULL,
              next_grow_at = CASE WHEN $2 = 'large' THEN NULL ELSE now() + make_interval(secs => $3) END,
              next_raid_at = CASE WHEN $2 = 'large' THEN now() + make_interval(secs => $4) ELSE NULL END
       WHERE id = $1`,
      [camp.id, next, ytGrowMs() / 1000, ytRaidMs() / 1000],
    );
    grown[next] = (grown[next] ?? 0) + 1;
  }
  for (const [tier, count] of Object.entries(grown)) {
    await ytBroadcast(client, n, 'yt_grown', { count, tier, label: YT_TIER_INFO[tier as YtCampTier].label });
  }
  return Object.values(grown).reduce((sum, count) => sum + count, 0);
}

/** 事件推进事务；返回本 tick 的变化数 */
async function advanceEvent(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  const n = newYtNotifies();
  let changed = 0;
  try {
    await client.query('BEGIN');
    await lockYt(client);
    const event = await loadActiveYtEvent(client);
    if (event) {
      if (event.ends_at.getTime() <= Date.now()) {
        await finishYtEvent(client, n, event, 'timeout');
        changed = 1;
      } else {
        changed = await growCamps(client, n, event.id);
      }
    } else {
      const latest = await loadLatestYtEvent(client);
      if (!latest || latest.started_at.getTime() + ytCycleMs() <= Date.now()) {
        changed = (await startYtEvent(client, n)) ? 1 : 0;
      }
    }
    await client.query('COMMIT');
    await publishYtNotifies(pool, n);
    return changed;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 大营发兵：到期的大营各发一次就近来袭（半径内无目标则只顺延下次时间） */
async function launchRaids(pool: pg.Pool): Promise<number> {
  const event = await loadActiveYtEvent(pool);
  if (!event) {
    return 0;
  }
  const due = await pool.query(
    `SELECT * FROM yt_camps WHERE event_id = $1 AND status = 'active' AND tier = 'large' AND next_raid_at <= now() ORDER BY id`,
    [event.id],
  );
  let launched = 0;
  for (const camp of due.rows as YtCampRow[]) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const warning = await createNearbyNpcAttack(client, camp.x, camp.y, YT_RAID_RADIUS, YT_RAID_LEVEL);
      await client.query(`UPDATE yt_camps SET next_raid_at = now() + make_interval(secs => $2) WHERE id = $1`, [camp.id, ytRaidMs() / 1000]);
      await client.query('COMMIT');
      if (warning) {
        launched += 1;
        await pool.query('SELECT pg_notify($1, $2)', [
          NOTIFY_CHANNEL,
          JSON.stringify({ reason: 'npc_warning', accountId: warning.accountId, data: warning.data }),
        ]);
      }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  return launched;
}

/** 单 tick 入口 */
export async function processYellowTurban(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < YT_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  const changed = await advanceEvent(pool);
  return changed + (await launchRaids(pool));
}
