// 剧本战场（v75，AISLG-198 官渡；v80，AISLG-199 讨董 / 赤壁）的 Worker 日程与结算入口：
// - 每周二 20:00 报名、周三 20:00 开战、周四 20:00 结束（北京时间现实时间）；每周一场，剧本按周轮换；
// - 报名期创建战场与据点（NPC 守军），开战时按报名人数加厚守军、算人少补偿、赤壁随机初始风向；
// - 每小时内按据点归属累计阵营积分（人少一方 × 补偿倍率），乌巢让敌方耗粮翻倍；
// - 赤壁每 6 小时切换风向，切换前 30 分钟预告；
// - 到点结束按胜负（讨董按进度）与个人军功发奖，幸存部队回主城。
// 据点战斗与行军到达在 battlefield-move.ts，公共生命周期函数在 battlefield-event.ts。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, TROOP_KINDS } from '../../common/src/protocol';
import { getTimeScale } from '../../common/src/time-scale';
import { TROOP_INFO } from '../../common/src/troops';
import {
  BATTLEFIELD_START_NOTICE_MS,
  battlefieldAdvanceWind,
  battlefieldWindNoticeDue,
  battlefieldFlipWind,
  battlefieldScriptForWindow,
  battlefieldWindow,
  type BattlefieldCamp,
  type BattlefieldWind,
} from '../../common/src/battlefield';
import type { BattlefieldScript } from '../../common/src/protocol-battlefield';
import {
  loadLatestBattlefieldEvent,
  type BattlefieldEventRow,
  type BattlefieldSquadRow,
} from '../../common/src/battlefield-db';
import type { ServerBroadcastCreated } from '../../common/src/server-broadcast';
import type { TileNotify } from './tick-shared';
import {
  BATTLEFIELD_LOCK_ID,
  accrueScores,
  activateEvent,
  battlefieldBroadcast,
  claimAnnouncement,
  finishBattlefield,
  insertStrongholds,
  notifyBattlefield,
  publishBroadcasts,
  publishNotifies,
  sendAnnouncement,
  sendWindNotice,
} from './battlefield-event';
import { processBattlefieldMovements } from './battlefield-move';

export async function processBattlefieldLifecycle(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  const broadcasts: ServerBroadcastCreated[] = [];
  const notifies: TileNotify[] = [];
  const announcements: Array<{ event: BattlefieldEventRow; stage: 'signup' | 'start' }> = [];
  let started = false;
  let finished = false;
  let created = false;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BATTLEFIELD_LOCK_ID]);
    const now = new Date();
    const latest = (await client.query(
      `SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1 FOR UPDATE`,
    )) as { rows: BattlefieldEventRow[] };
    let event: BattlefieldEventRow | null = latest.rows[0] ?? null;
    // 本轮（或即将到来的一轮）时间窗
    const window = battlefieldWindow(now);
    if (!event || event.signup_start.getTime() < window.signupStart.getTime() - 1000) {
      if (now >= window.signupStart) {
        const status = now >= window.startAt ? 'active' : 'signup';
        const script = battlefieldScriptForWindow(window);
        const inserted = await client.query(
          `INSERT INTO battlefield_events (script, signup_start, start_at, end_at, status)
           VALUES ($5, $1, $2, $3, $4)
           ON CONFLICT (script, signup_start) DO NOTHING
           RETURNING *`,
          [window.signupStart, window.startAt, window.endAt, status, script],
        );
        event = (inserted.rows[0] as BattlefieldEventRow | undefined) ?? null;
        if (event) {
          created = true;
          await insertStrongholds(client, event.id, script);
          if (status === 'signup') {
            await battlefieldBroadcast(client, broadcasts, 'battlefield_signup', {
              eventId: event.id,
              signupStartAt: event.signup_start.toISOString(),
              startAt: event.start_at.toISOString(),
              endAt: event.end_at.toISOString(),
            });
          } else {
            await activateEvent(client, event, now);
            started = true;
            await battlefieldBroadcast(client, broadcasts, 'battlefield_started', {
              eventId: event.id,
              startAt: event.start_at.toISOString(),
              endAt: event.end_at.toISOString(),
            });
          }
        }
      }
    }
    // 兼容运维脚本 / 人工插入的战场：据点行缺失时补建（幂等）
    if (event && (event.status === 'signup' || event.status === 'active')) {
      await insertStrongholds(client, event.id, asScript(event.script));
    }
    if (event && event.status === 'signup') {
      if (event.signup_announced_at === null) {
        const claim = await claimAnnouncement(client, event, 'signup');
        if (claim) {
          event.signup_announced_at = now;
          announcements.push({ event, stage: 'signup' });
        }
      }
      if (now >= event.start_at) {
        await activateEvent(client, event, now);
        started = true;
        await battlefieldBroadcast(client, broadcasts, 'battlefield_started', {
          eventId: event.id,
          startAt: event.start_at.toISOString(),
          endAt: event.end_at.toISOString(),
        });
      } else if (now.getTime() >= event.start_at.getTime() - BATTLEFIELD_START_NOTICE_MS) {
        const claim = await claimAnnouncement(client, event, 'start');
        if (claim) {
          announcements.push({ event, stage: 'start' });
        }
      }
    }
    if (event && event.status === 'active' && now >= event.end_at) {
      await accrueScores(client, event, now);
      const yuan = Number(event.score_yuan);
      const cao = Number(event.score_cao);
      const winner: BattlefieldCamp | null = yuan === cao ? null : yuan > cao ? 'yuan' : 'cao';
      await finishBattlefield(client, event, winner, 'score', broadcasts, notifies);
      finished = true;
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  for (const item of announcements) {
    await sendAnnouncement(pool, item.event, item.stage);
  }
  await publishBroadcasts(pool, broadcasts);
  await publishNotifies(pool, notifies);
  if (started || finished || created) {
    const latest = await loadLatestBattlefieldEvent(pool);
    if (latest) {
      await notifyBattlefield(pool, finished ? 'finished' : started ? 'started' : 'signup', latest.id);
    }
  }
}

/** 第二步：战场内耗粮（野外 2 倍；敌方占乌巢再翻倍），从各自主城扣 */
export async function processBattlefieldFood(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BATTLEFIELD_LOCK_ID]);
    const eventRes = await client.query(
      `SELECT * FROM battlefield_events WHERE status = 'active' ORDER BY signup_start DESC LIMIT 1 FOR UPDATE`,
    );
    const event = eventRes.rows[0] as BattlefieldEventRow | undefined;
    if (!event) {
      await client.query('ROLLBACK');
      return;
    }
    const now = new Date();
    const from = event.last_food_at ?? event.start_at;
    const elapsedHours = Math.max(0, (now.getTime() - from.getTime()) / 3_600_000);
    if (elapsedHours < 1 / 60) {
      await client.query('ROLLBACK');
      return;
    }
    // 乌巢归属：敌方阵营的部队耗粮翻倍
    const granary = await client.query(
      `SELECT owner_camp FROM battlefield_strongholds WHERE event_id = $1 AND id = 'granary_wuchao'`,
      [event.id],
    );
    const granaryOwner = (granary.rows[0] as { owner_camp: string | null } | undefined)?.owner_camp ?? null;
    const scale = getTimeScale();
    const squads = await client.query(
      `SELECT s.*, p.main_city_id FROM battlefield_squads s
       JOIN battlefield_participants p ON p.event_id = s.event_id AND p.account_id = s.account_id
       WHERE s.event_id = $1`,
      [event.id],
    );
    const byAccount = new Map<string, { cityId: string; camp: string; foodUse: number }>();
    for (const row of squads.rows as Array<BattlefieldSquadRow & { main_city_id: string }>) {
      let foodUse = 0;
      for (const kind of TROOP_KINDS) {
        foodUse += Math.max(0, Math.floor(row.troops[kind] ?? 0)) * TROOP_INFO[kind].foodUse;
      }
      const entry = byAccount.get(row.account_id) ?? { cityId: row.main_city_id, camp: row.camp, foodUse: 0 };
      entry.foodUse += foodUse;
      byAccount.set(row.account_id, entry);
    }
    for (const entry of byAccount.values()) {
      const doubled = granaryOwner !== null && granaryOwner !== entry.camp ? 2 : 1;
      const amount = Math.floor(entry.foodUse * 2 * doubled * scale * elapsedHours);
      if (amount <= 0) {
        continue;
      }
      await client.query(`UPDATE cities SET food = GREATEST(0, food - $2) WHERE id = $1`, [entry.cityId, amount]);
    }
    await client.query(`UPDATE battlefield_events SET last_food_at = $2 WHERE id = $1`, [event.id, now]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 第三步：按据点归属累计阵营积分 */
export async function processBattlefieldScores(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BATTLEFIELD_LOCK_ID]);
    const eventRes = await client.query(
      `SELECT * FROM battlefield_events WHERE status = 'active' ORDER BY signup_start DESC LIMIT 1 FOR UPDATE`,
    );
    const event = eventRes.rows[0] as BattlefieldEventRow | undefined;
    if (!event) {
      await client.query('ROLLBACK');
      return;
    }
    await accrueScores(client, event, new Date());
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 第四步：赤壁风向到点切换（每 6 小时交替），切换前 30 分钟预告一次 */
export async function processBattlefieldWind(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  let notice: { event: BattlefieldEventRow; switchAt: Date; next: BattlefieldWind } | null = null;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BATTLEFIELD_LOCK_ID]);
    const eventRes = await client.query(
      `SELECT * FROM battlefield_events WHERE status = 'active' AND script = 'chibi' ORDER BY signup_start DESC LIMIT 1 FOR UPDATE`,
    );
    const event = eventRes.rows[0] as BattlefieldEventRow | undefined;
    if (!event || event.wind === null || event.wind_next_at === null) {
      await client.query('ROLLBACK');
      return;
    }
    const now = new Date();
    const wind = event.wind === 'nw' ? 'nw' : 'se';
    const advanced = battlefieldAdvanceWind(wind, event.wind_next_at, now);
    if (advanced.switched) {
      await client.query(
        `UPDATE battlefield_events SET wind = $2, wind_next_at = $3, wind_notice_at = NULL WHERE id = $1`,
        [event.id, advanced.wind, advanced.nextAt],
      );
      await client.query('COMMIT');
      await notifyBattlefield(pool, 'wind', event.id);
      return;
    }
    // 预告：距离下次切换不足 30 分钟且还没预告过，抢占标记后发公告
    if (battlefieldWindNoticeDue(event.wind_next_at, now, event.wind_notice_at !== null)) {
      const claimed = await client.query(
        `UPDATE battlefield_events SET wind_notice_at = now() WHERE id = $1 AND wind_notice_at IS NULL RETURNING id`,
        [event.id],
      );
      if (claimed.rowCount === 1) {
        notice = { event, switchAt: event.wind_next_at, next: battlefieldFlipWind(wind) };
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
    await sendWindNotice(pool, notice.event, notice.switchAt, notice.next);
  }
}

function asScript(value: unknown): BattlefieldScript {
  return value === 'dongzhuo' || value === 'chibi' ? value : 'guandu';
}

/** 第五步：到点的战场行军 / 攻打据点结算 */
export async function processBattlefield(pool: pg.Pool): Promise<void> {
  await processBattlefieldLifecycle(pool);
  await processBattlefieldFood(pool);
  await processBattlefieldScores(pool);
  await processBattlefieldWind(pool);
  const resolved = await processBattlefieldMovements(pool);
  if (resolved > 0) {
    console.log(`resolved ${resolved} battlefield movement(s)`);
  }
}