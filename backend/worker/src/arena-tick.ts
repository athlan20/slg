// 竞技场每日奖励（v53，AISLG-145）：每个竞技日（基准 24 小时，随全局时间缩放）开始后，
// 按玩家「当时」的名次给账号主城发金币。防重发靠 arena_entries.last_reward_day：
// 一个竞技日只发一次，停机积压的多天只补当天一次（不回头补发）；账号暂时没有城
// （重置窗口）就跳过，下个 tick 再试。守擂者没有 account_id，不领奖励。
// 事务内先拿竞技场咨询锁，保证发奖时读到的名次与挑战结算互斥。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { arenaDayIndex, dailyRewardForRank } from '../../common/src/arena';
import { creditCapitalGold, lockArena } from '../../common/src/arena-db';

/** tick 节流（毫秒）：竞技日最短也有分钟级（缩放 50 倍时约 29 分钟），10 秒扫一次足够 */
export const ARENA_TICK_MS = 10_000;
/** 单 tick 最多发奖的席位数（积压时分批推进） */
const SWEEP_LIMIT = 50;

let lastRunMs = 0;

/** 单 tick 入口：节流到 ARENA_TICK_MS；返回本次发出奖励的账号数 */
export async function processArenaRewards(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < ARENA_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  const day = arenaDayIndex(nowMs);
  // 只挑「有主城」的账号：没有城的账号留在这一天的奖励里不动（不占用批次配额），有城后下个 tick 补发当天
  const due = await pool.query(
    `SELECT e.id FROM arena_entries e
     WHERE e.account_id IS NOT NULL
       AND (e.last_reward_day IS NULL OR e.last_reward_day < $1)
       AND EXISTS (SELECT 1 FROM cities c WHERE c.account_id = e.account_id)
     ORDER BY e.rank LIMIT $2`,
    [day, SWEEP_LIMIT],
  );
  let paid = 0;
  for (const raw of due.rows as Array<{ id: string }>) {
    const client = await pool.connect();
    let notice: { accountId: string; data: Record<string, unknown> } | null = null;
    try {
      await client.query('BEGIN');
      await lockArena(client);
      const res = await client.query(`SELECT * FROM arena_entries WHERE id = $1 FOR UPDATE`, [raw.id]);
      const entry = res.rowCount
        ? (res.rows[0] as { account_id: string | null; rank: number; last_reward_day: string | null })
        : null;
      const stale = entry && entry.account_id && (entry.last_reward_day === null || Number(entry.last_reward_day) < day);
      if (stale && entry.account_id) {
        const gold = dailyRewardForRank(entry.rank);
        if (await creditCapitalGold(client, entry.account_id, gold)) {
          await client.query(`UPDATE arena_entries SET last_reward_day = $2 WHERE id = $1`, [raw.id, day]);
          notice = { accountId: entry.account_id, data: { reason: 'daily_reward', gold, rank: entry.rank } };
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    if (notice) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'arena_state', accountId: notice.accountId, data: notice.data }),
      ]);
      paid += 1;
    }
  }
  return paid;
}
