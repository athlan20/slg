// 武将历练的到点结算（v54，AISLG-144）：历练结束时间（account_heroes.train_until）到了就把经验
// 到账（可能升级，得自由点数）并清空历练字段。每次 tick 最多处理 SWEEP_LIMIT 名，FOR UPDATE SKIP LOCKED
// 避免与 API 的加点 / 出征等操作互等。事务内结算，提交后 pg_notify 推送 PUSH_HERO_STATE（reason=training_done）。

import pg from 'pg';
import { dueTrainings, settleTraining } from '../../common/src/hero-growth-db';
import { NOTIFY_CHANNEL } from '../../common/src/db';

/** tick 节流（毫秒）：历练按分钟级结束，10 秒扫一次足够 */
export const HERO_TRAINING_TICK_MS = 10_000;
const SWEEP_LIMIT = 100;

let lastRunMs = 0;

/** 单 tick 入口：节流到 HERO_TRAINING_TICK_MS；返回本次结算的武将数 */
export async function processHeroTraining(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < HERO_TRAINING_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  const notices: Array<{ accountId: string; heroId: string; heroName: string; gained: number }> = [];
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const due = await dueTrainings(client, SWEEP_LIMIT);
    for (const hero of due) {
      const gained = await settleTraining(client, hero);
      notices.push({ accountId: hero.account_id, heroId: hero.id, heroName: hero.name, gained });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  for (const notice of notices) {
    await pool.query('SELECT pg_notify($1, $2)', [
      NOTIFY_CHANNEL,
      JSON.stringify({
        reason: 'hero_state',
        accountId: notice.accountId,
        data: { reason: 'training_done', heroId: notice.heroId, heroName: notice.heroName, exp: { gained: notice.gained } },
      }),
    ]);
  }
  return notices.length;
}
