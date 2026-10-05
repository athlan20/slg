// 黄巾之乱的事件生命周期（v29，AISLG-76）：起事 / 老巢出现 / 收场（发奖 + 散成流寇）。
// 营地周期推进（坐大 / 发兵）在 yt-tick.ts，营地与老巢的出征结算在 yt-camp.ts；
// 三处共用本文件的函数与通知收集器（提交后统一 pg_notify）。调用方负责事务。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, type Resources } from '../../common/src/protocol';
import type { YellowTurbanPushData } from '../../common/src/protocol-yt';
import { insertEvent } from '../../common/src/events';
import { insertServerBroadcast, type ServerBroadcastCreated } from '../../common/src/server-broadcast';
import { generateRoute } from '../../common/src/moving-target';
import type { MovingTargetRow } from '../../common/src/moving-target-db';
import {
  YT_SCATTER_LEVEL,
  YT_TIER_INFO,
  ytCampCount,
  ytDurationMs,
  ytGrowMs,
  ytRaidMs,
  ytRewardFor,
  ytTierSplit,
  type YtCampTier,
} from '../../common/src/yellow-turban';
import {
  loadActiveCamps,
  ytEventView,
  type YtCampRow,
  type YtEventRow,
} from '../../common/src/yellow-turban-db';
import { WORLD_SIZE } from '../../common/src/world';
import { insertMovingTarget, notifyMoving } from './moving-tick';
import { creditLoot } from './tick-shared';
import { YT_HERO_RANKS } from '../../common/src/hero';
import { grantFamousHeroWithBroadcast } from './hero-grant';

/** 黄巾之乱的全局事务锁号：营地结算（yt-camp）与事件推进（yt-tick）串行，避免 营地行 / 事件行 的相互等待 */
const YT_LOCK_ID = 7_600_001;

/** 取黄巾之乱的事务级咨询锁（事务结束自动释放）；顺序：出发城 / 地块（如有）→ 本锁 → 营地行 → 事件行 */
export async function lockYt(client: pg.PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [YT_LOCK_ID]);
}

/** 事务内收集的通知：提交后由 publishYtNotifies 统一发出（回滚则不发） */
export interface YtNotifies {
  push: YellowTurbanPushData[];
  broadcasts: ServerBroadcastCreated[];
  warnings: Array<{ accountId: string; data: Record<string, unknown> }>;
  moving: MovingTargetRow[];
  /** v36（AISLG-115）：名将授予的 hero_state 推送 */
  heroStates: Array<{ reason: 'hero_state'; accountId: string; data: Record<string, unknown> }>;
}

export function newYtNotifies(): YtNotifies {
  return { push: [], broadcasts: [], warnings: [], moving: [], heroStates: [] };
}

export async function publishYtNotifies(pool: pg.Pool, n: YtNotifies): Promise<void> {
  const send = (payload: Record<string, unknown>) =>
    pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(payload)]);
  for (const data of n.push) {
    await send({ reason: 'yt_state', data });
  }
  for (const broadcast of n.broadcasts) {
    await send({ reason: 'server_broadcast', accountId: '', broadcast });
  }
  for (const warning of n.warnings) {
    await send({ reason: 'npc_warning', accountId: warning.accountId, data: warning.data });
  }
  for (const row of n.moving) {
    await notifyMoving(pool, 'spawned', row);
  }
  for (const heroState of n.heroStates) {
    await send({ reason: 'hero_state', accountId: heroState.accountId, data: heroState.data });
  }
}

/** 关键节点播报（必达，不受每分钟限频） */
export async function ytBroadcast(
  client: pg.PoolClient,
  n: YtNotifies,
  type: 'yt_started' | 'yt_grown' | 'yt_boss' | 'yt_boss_first_kill' | 'yt_finished',
  detail: Record<string, unknown>,
): Promise<void> {
  const created = await insertServerBroadcast(client, type, detail, { force: true });
  if (created) {
    n.broadcasts.push(created);
  }
}

/** 活跃玩家的主城坐标（最近 24 小时内登录过的账号；起事按其数量定营地数，营地落在他们附近） */
export async function loadYtAnchors(client: pg.PoolClient): Promise<Array<{ x: number; y: number }>> {
  const res = await client.query(
    `SELECT DISTINCT ON (c.account_id) c.x, c.y
     FROM cities c
     WHERE c.x IS NOT NULL AND c.y IS NOT NULL
       AND c.account_id IN (SELECT account_id FROM sessions WHERE last_used_at > now() - interval '24 hours')
     ORDER BY c.account_id, c.created_at`,
  );
  return res.rows as Array<{ x: number; y: number }>;
}

/** 在 (cx, cy) 附近找一块未被占领、没有营地的野地（半径 reach 内取最近的随机一块）；找不到返回 null */
async function pickFreeWilderness(
  client: pg.PoolClient,
  cx: number,
  cy: number,
  reach: number,
): Promise<{ x: number; y: number } | null> {
  const res = await client.query(
    `SELECT wt.x, wt.y FROM world_tiles wt
     WHERE wt.kind = 'wilderness' AND wt.owner_city_id IS NULL AND wt.terrain <> 'lake'
       AND wt.x BETWEEN $1 AND $2 AND wt.y BETWEEN $3 AND $4
       AND NOT EXISTS (SELECT 1 FROM yt_camps yc WHERE yc.x = wt.x AND yc.y = wt.y AND yc.status = 'active')
     ORDER BY GREATEST(ABS(wt.x - $5), ABS(wt.y - $6)) + random() * 3
     LIMIT 1`,
    [cx - reach, cx + reach, cy - reach, cy + reach, cx, cy].map((v, i) => (i < 4 ? Math.max(0, v) : v)),
  );
  return res.rowCount ? (res.rows[0] as { x: number; y: number }) : null;
}

/**
 * 起事：按活跃玩家数定营地数、三档分配、落在随机活跃玩家主城周围 8–50 格；落库事件与营地，
 * 全服播报。没有活跃玩家 / 一块营地都放不下返回 null。
 */
export async function startYtEvent(
  client: pg.PoolClient,
  n: YtNotifies,
  rng: () => number = Math.random,
): Promise<YtEventRow | null> {
  const anchors = await loadYtAnchors(client);
  const total = ytCampCount(anchors.length);
  if (total === 0) {
    return null;
  }
  const split = ytTierSplit(total);
  const ev = await client.query(
    `INSERT INTO yt_events (ends_at, total_camps) VALUES (now() + make_interval(secs => $1), $2) RETURNING *`,
    [ytDurationMs() / 1000, total],
  );
  const event = ev.rows[0] as YtEventRow;
  let placed = 0;
  for (const tier of ['small', 'medium', 'large'] as const) {
    for (let i = 0; i < split[tier]; i += 1) {
      const anchor = anchors[Math.floor(rng() * anchors.length)];
      const angle = rng() * Math.PI * 2;
      const dist = 8 + rng() * 42;
      const cx = Math.min(WORLD_SIZE - 1, Math.max(0, Math.round(anchor.x + Math.cos(angle) * dist)));
      const cy = Math.min(WORLD_SIZE - 1, Math.max(0, Math.round(anchor.y + Math.sin(angle) * dist)));
      const spot = await pickFreeWilderness(client, cx, cy, 6);
      if (!spot) {
        continue;
      }
      await client.query(
        `INSERT INTO yt_camps (event_id, x, y, tier, next_grow_at, next_raid_at)
         VALUES ($1, $2, $3, $4,
                 CASE WHEN $4 = 'large' THEN NULL ELSE now() + make_interval(secs => $5) END,
                 CASE WHEN $4 = 'large' THEN now() + make_interval(secs => $6) ELSE NULL END)`,
        [event.id, spot.x, spot.y, tier, ytGrowMs() / 1000, ytRaidMs() / 1000],
      );
      placed += 1;
    }
  }
  if (placed === 0) {
    throw new Error('yellow turban: no free wilderness to place camps');
  }
  const upd = await client.query(`UPDATE yt_events SET total_camps = $2 WHERE id = $1 RETURNING *`, [event.id, placed]);
  const started = upd.rows[0] as YtEventRow;
  await ytBroadcast(client, n, 'yt_started', { totalCamps: placed, endsAt: started.ends_at.toISOString() });
  n.push.push({ reason: 'started', event: ytEventView(started) });
  return started;
}

/** 老巢出现：落在本轮营地的重心附近（60 格内最近的空野地），外围阶段起步；全服播报 */
export async function spawnYtBoss(client: pg.PoolClient, n: YtNotifies, event: YtEventRow): Promise<YtEventRow> {
  const centroid = await client.query(`SELECT avg(x)::int AS cx, avg(y)::int AS cy FROM yt_camps WHERE event_id = $1`, [event.id]);
  const { cx, cy } = centroid.rows[0] as { cx: number; cy: number };
  const spot = (await pickFreeWilderness(client, cx, cy, 60)) ?? (await pickFreeWilderness(client, cx, cy, 200));
  if (!spot) {
    throw new Error('yellow turban: no free wilderness for the boss lair');
  }
  await client.query(`INSERT INTO yt_camps (event_id, x, y, tier) VALUES ($1, $2, $3, 'boss')`, [event.id, spot.x, spot.y]);
  const upd = await client.query(`UPDATE yt_events SET boss_appeared_at = now() WHERE id = $1 RETURNING *`, [event.id]);
  const next = upd.rows[0] as YtEventRow;
  await ytBroadcast(client, n, 'yt_boss', { x: spot.x, y: spot.y });
  n.push.push({ reason: 'boss_appeared', event: ytEventView(next) });
  return next;
}

/**
 * 收场：老巢被打掉（boss_cleared）或到时限（timeout）。按贡献名次发资源 / 金币到各人主城并写
 * yt_reward 事件；没清完的营地散成流寇（接 AISLG-78），老巢撤销；事件置 finished，全服播报。
 */
export async function finishYtEvent(
  client: pg.PoolClient,
  n: YtNotifies,
  event: YtEventRow,
  reason: 'boss_cleared' | 'timeout',
  rng: () => number = Math.random,
): Promise<YtEventRow> {
  const ranked = await client.query(
    `SELECT account_id, killed FROM yt_contrib WHERE event_id = $1 AND killed > 0 ORDER BY killed DESC, account_id`,
    [event.id],
  );
  let rank = 0;
  for (const row of ranked.rows as Array<{ account_id: string; killed: number }>) {
    rank += 1;
    // v36（AISLG-115）：贡献榜第 1、2 名获得名将张宝 / 张梁（全服唯一；已被他人获得则跳过）
    const famousDef = rank === 1 ? YT_HERO_RANKS[0] : rank === 2 ? YT_HERO_RANKS[1] : null;
    if (famousDef) {
      await grantFamousHeroWithBroadcast(client, row.account_id, famousDef, n.heroStates, n.broadcasts);
    }
    const tier = ytRewardFor(rank);
    const reward: Resources = { ...tier.reward };
    const city = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [row.account_id]);
    if (!city.rowCount) {
      continue;
    }
    const cityId = (city.rows[0] as { id: string }).id;
    await creditLoot(client, cityId, reward);
    await insertEvent(client, {
      accountId: row.account_id,
      cityId,
      type: EventType.YT_REWARD,
      initiator: null,
      detail: { rank, killed: row.killed, tier: tier.label, reward, reason, eventId: event.id },
    });
  }

  // 没清完的营地散成流寇；老巢撤销
  let scattered = 0;
  for (const camp of (await loadActiveCamps(client, event.id)) as YtCampRow[]) {
    if (camp.tier === 'boss') {
      await client.query(`UPDATE yt_camps SET status = 'expired' WHERE id = $1`, [camp.id]);
      continue;
    }
    const tier = camp.tier as YtCampTier;
    const route = generateRoute(rng, camp.x, camp.y);
    n.moving.push(await insertMovingTarget(client, 'bandit', YT_SCATTER_LEVEL[tier] ?? 2, route));
    await client.query(`UPDATE yt_camps SET status = 'scattered' WHERE id = $1`, [camp.id]);
    scattered += 1;
  }

  const upd = await client.query(
    `UPDATE yt_events SET status = 'finished', finished_at = now(), finish_reason = $2, scattered_camps = $3
     WHERE id = $1 RETURNING *`,
    [event.id, reason, scattered],
  );
  const finished = upd.rows[0] as YtEventRow;
  await ytBroadcast(client, n, 'yt_finished', {
    reason,
    clearedCamps: finished.cleared_camps,
    totalCamps: finished.total_camps,
    scatteredCamps: scattered,
  });
  n.push.push({ reason: 'finished', event: ytEventView(finished) });
  return finished;
}

/** 玩家可读的档位名（事件 / 播报文案复用） */
export function ytTierLabel(tier: string): string {
  return (YT_TIER_INFO as Record<string, { label: string }>)[tier]?.label ?? tier;
}


