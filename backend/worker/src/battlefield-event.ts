// 剧本战场·官渡（v75，AISLG-198）的事件生命周期公共函数：
// 据点初始化、开战激活、积分累计、军功入账、结束发奖、公告与播报 / 推送。
// 由 battlefield-tick.ts（日程 / 耗粮 / 积分）与 battlefield-move.ts（据点战斗）共用。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import {
  BATTLEFIELD_START_NOTICE_MS,
  BATTLEFIELD_STRONGHOLDS,
  battlefieldGarrisonPlayerMultiplier,
  battlefieldInitialGarrison,
  battlefieldRewardFor,
  battlefieldUnderdog,
  type BattlefieldCamp,
} from '../../common/src/battlefield';
import {
  battlefieldEventView as buildEventView,
  loadBattlefieldCampCounts,
  loadBattlefieldEvent,
  type BattlefieldEventRow,
  type BattlefieldStrongholdRow,
  type BattlefieldSquadRow,
} from '../../common/src/battlefield-db';
import { insertEvent } from '../../common/src/events';
import { addPrestige } from '../../common/src/nobility-db';
import { insertServerBroadcast, type ServerBroadcastCreated } from '../../common/src/server-broadcast';
import { publishAnnouncement } from '../../common/src/announcement-publish';
import type { TileNotify } from './tick-shared';

/** 战场生命周期与据点结算共用的咨询锁（同一时刻只有一个 Worker 在推进战场） */
export const BATTLEFIELD_LOCK_ID = 7_500_001;

function formatBeijing(date: Date): string {
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

/** 战场状态推送（提交后调用）：全服广播，客户端收到后重查 GET_BATTLEFIELD */
export async function notifyBattlefield(
  pool: pg.Pool,
  reason: 'signup' | 'started' | 'stronghold' | 'finished',
  eventId: string,
  strongholdId?: string,
): Promise<void> {
  const event = await loadBattlefieldEvent(pool, eventId);
  if (!event) {
    return;
  }
  const counts = await loadBattlefieldCampCounts(pool, eventId);
  const payload = {
    reason,
    event: buildEventView(event, counts),
    ...(strongholdId ? { strongholdId } : {}),
  };
  await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify({ reason: 'battlefield_state', data: payload })]);
}

export async function publishBroadcasts(pool: pg.Pool, broadcasts: ServerBroadcastCreated[]): Promise<void> {
  for (const broadcast of broadcasts) {
    await pool.query('SELECT pg_notify($1, $2)', [
      NOTIFY_CHANNEL,
      JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast }),
    ]);
  }
}

export async function publishNotifies(pool: pg.Pool, notifies: TileNotify[]): Promise<void> {
  for (const payload of notifies) {
    await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(payload)]);
  }
}

/** 事务内写一条战场播报（必达，不受全服每分钟限频） */
export async function battlefieldBroadcast(
  client: pg.PoolClient,
  broadcasts: ServerBroadcastCreated[],
  type: 'battlefield_signup' | 'battlefield_started' | 'battlefield_stronghold' | 'battlefield_finished',
  detail: Record<string, unknown>,
): Promise<void> {
  const created = await insertServerBroadcast(client, type, detail, { force: true });
  if (created) {
    broadcasts.push(created);
  }
}

/** 事务内写入初始 9 个据点（守军先按 1 倍人数，开战时再按报名人数加厚） */
export async function insertStrongholds(client: pg.PoolClient, eventId: string): Promise<void> {
  for (const def of BATTLEFIELD_STRONGHOLDS) {
    await client.query(
      `INSERT INTO battlefield_strongholds
         (event_id, id, name, kind, x, y, points_per_hour, garrison, wall_level, tower_level)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
       ON CONFLICT (event_id, id) DO NOTHING`,
      [
        eventId,
        def.id,
        def.name,
        def.kind,
        def.x,
        def.y,
        def.pointsPerHour,
        JSON.stringify(battlefieldInitialGarrison(def, 1)),
        def.wallLevel,
        def.towerLevel,
      ],
    );
  }
}

/** 开战：按报名人数重算守军、算人少补偿、初始化积分 / 耗粮水位 */
export async function activateEvent(client: pg.PoolClient, event: BattlefieldEventRow, now: Date): Promise<void> {
  const counts = await client.query(
    `SELECT camp, count(*)::int AS n FROM battlefield_participants WHERE event_id = $1 GROUP BY camp`,
    [event.id],
  );
  const countOf = (camp: BattlefieldCamp): number =>
    Number((counts.rows as Array<{ camp: string; n: number }>).find((row) => row.camp === camp)?.n ?? 0);
  const yuan = countOf('yuan');
  const cao = countOf('cao');
  const multiplier = battlefieldGarrisonPlayerMultiplier(yuan + cao);
  for (const def of BATTLEFIELD_STRONGHOLDS) {
    await client.query(`UPDATE battlefield_strongholds SET garrison = $3::jsonb WHERE event_id = $1 AND id = $2`, [
      event.id,
      def.id,
      JSON.stringify(battlefieldInitialGarrison(def, multiplier)),
    ]);
  }
  const underdog = battlefieldUnderdog(yuan, cao);
  await client.query(
    `UPDATE battlefield_events
     SET status = 'active', underdog_camp = $2, underdog_multiplier = $3,
         last_score_at = $4, last_food_at = $4
     WHERE id = $1`,
    [event.id, underdog?.camp ?? null, underdog?.multiplier ?? 1, now],
  );
  event.status = 'active';
  event.underdog_camp = underdog?.camp ?? null;
  event.underdog_multiplier = underdog?.multiplier ?? 1;
  event.last_score_at = now;
  event.last_food_at = now;
}

/** 发「报名开始 / 即将开战」公告（事务内先抢占标记，提交后由调用方发送） */
export async function claimAnnouncement(
  client: pg.PoolClient,
  event: BattlefieldEventRow,
  stage: 'signup' | 'start',
): Promise<boolean> {
  const column = stage === 'signup' ? 'signup_announced_at' : 'start_announced_at';
  const res = await client.query(
    `UPDATE battlefield_events SET ${column} = now() WHERE id = $1 AND ${column} IS NULL RETURNING id`,
    [event.id],
  );
  return res.rowCount === 1;
}

export async function sendAnnouncement(pool: pg.Pool, event: BattlefieldEventRow, stage: 'signup' | 'start'): Promise<void> {
  const titleZh =
    stage === 'signup'
      ? '官渡之战开始报名（每周二 20:00 — 周三 20:00）'
      : '官渡之战将在 1 小时后开战';
  const bodyZh =
    stage === 'signup'
      ? `剧本战场「官渡之战」开始报名。报名截止 / 开战：北京时间 ${formatBeijing(event.start_at)}；结束：${formatBeijing(event.end_at)}。` +
        `报名要求主城官府 ≥ 5 级，选择袁绍军或曹操军；开战前从主城带一支部队入场（按人口最多 3000），开战后不能追加兵力。` +
        `战场是 30×30 独立地图，抢下渡口、据点和乌巢粮仓积累阵营积分；军功可在战场商店换资源、武将经验与兵。`
      : `剧本战场「官渡之战」将在北京时间 ${formatBeijing(event.start_at)} 开战，已报名但还没入场的玩家请在开战前带兵入场（开战后不能再入场）。`;
  try {
    await publishAnnouncement(pool, {
      category: 'event',
      titleZh,
      bodyZh,
      titleEn: null,
      bodyEn: null,
      pinned: false,
      strongRemind: stage === 'start',
      host: null,
      startsAt: new Date(Date.now() - 1000),
      endsAt: event.end_at,
      chat: false,
    });
  } catch (err) {
    console.error(`battlefield ${stage} announcement failed:`, err instanceof Error ? err.message : err);
  }
}

/** 事务内累计积分（按上次水位到 now 的时长） */
export async function accrueScores(client: pg.PoolClient, event: BattlefieldEventRow, now: Date): Promise<void> {
  const from = event.last_score_at ?? event.start_at;
  const elapsedHours = Math.max(0, (now.getTime() - from.getTime()) / 3_600_000);
  if (elapsedHours <= 0) {
    return;
  }
  const res = await client.query(`SELECT * FROM battlefield_strongholds WHERE event_id = $1`, [event.id]);
  const strongholds = res.rows as BattlefieldStrongholdRow[];
  let yuan = 0;
  let cao = 0;
  for (const row of strongholds) {
    if (row.owner_camp !== 'yuan' && row.owner_camp !== 'cao') {
      continue;
    }
    const points = Number(row.points_per_hour) * elapsedHours;
    if (row.owner_camp === 'yuan') {
      yuan += points;
    } else {
      cao += points;
    }
  }
  const underdog = event.underdog_camp === 'yuan' || event.underdog_camp === 'cao' ? event.underdog_camp : null;
  const multiplier = Number(event.underdog_multiplier) || 1;
  if (underdog === 'yuan') {
    yuan *= multiplier;
  } else if (underdog === 'cao') {
    cao *= multiplier;
  }
  await client.query(
    `UPDATE battlefield_events SET score_yuan = score_yuan + $2, score_cao = score_cao + $3, last_score_at = $4 WHERE id = $1`,
    [event.id, yuan, cao, now],
  );
  event.score_yuan = Number(event.score_yuan) + yuan;
  event.score_cao = Number(event.score_cao) + cao;
  event.last_score_at = now;
}

/** 事务内给一个账号记军功（同时累计到跨场余额，战场商店用） */
export async function grantMerit(
  client: pg.PoolClient,
  eventId: string,
  accountId: string,
  amount: number,
  broadcasts: ServerBroadcastCreated[],
): Promise<void> {
  const gained = Math.max(0, Math.floor(amount));
  if (gained === 0) {
    return;
  }
  // v76（AISLG-197）：剧本战场的军功按 1:1 再计一次声望
  const prestige = await addPrestige(client, accountId, gained, 'battlefield');
  if (prestige.broadcast) {
    broadcasts.push(prestige.broadcast);
  }
  await client.query(
    `UPDATE battlefield_participants SET merit = merit + $3 WHERE event_id = $1 AND account_id = $2`,
    [eventId, accountId, gained],
  );
  await client.query(
    `INSERT INTO battlefield_merit (account_id, merit, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (account_id) DO UPDATE SET merit = battlefield_merit.merit + $2, updated_at = now()`,
    [accountId, gained],
  );
}

/** 结束战场：发奖、幸存部队回主城、清空队伍、写胜方与播报 */
export async function finishBattlefield(
  client: pg.PoolClient,
  event: BattlefieldEventRow,
  winner: BattlefieldCamp | null,
  reason: 'score' | 'base_captured',
  broadcasts: ServerBroadcastCreated[],
  notifies: TileNotify[],
): Promise<void> {
  if (event.status === 'finished') {
    return;
  }
  const ranks = await client.query(
    `SELECT p.account_id, p.camp, p.main_city_id, p.merit,
            RANK() OVER (ORDER BY p.merit DESC) AS rank
     FROM battlefield_participants p
     WHERE p.event_id = $1 AND p.merit > 0
     ORDER BY p.merit DESC, p.joined_at`,
    [event.id],
  );
  const rows = ranks.rows as Array<{
    account_id: string;
    camp: string;
    main_city_id: string;
    merit: string | number;
    rank: string | number;
  }>;
  for (const row of rows) {
    const won = winner !== null && row.camp === winner;
    const reward = battlefieldRewardFor(Number(row.rank), won);
    await client.query(
      `UPDATE cities SET gold = gold + $2, wood = wood + $3, food = food + $4,
              stone = stone + $5, iron = iron + $6 WHERE id = $1`,
      [row.main_city_id, reward.gold, reward.wood, reward.food, reward.stone, reward.iron],
    );
    await insertEvent(client, {
      accountId: row.account_id,
      cityId: row.main_city_id,
      type: EventType.BATTLEFIELD_REWARD,
      initiator: null,
      detail: {
        eventId: event.id,
        camp: row.camp,
        outcome: won ? 'win' : 'lose',
        merit: Number(row.merit),
        rank: Number(row.rank),
        reward,
      },
    });
  }
  await client.query(`UPDATE battlefield_participants SET rewarded_at = now() WHERE event_id = $1`, [event.id]);
  // 幸存部队回主城（按账号汇总；城内驻军不设上限）
  const squads = await client.query(`SELECT * FROM battlefield_squads WHERE event_id = $1`, [event.id]);
  const byAccount = new Map<string, Partial<Record<TroopKind, number>>>();
  for (const squad of squads.rows as BattlefieldSquadRow[]) {
    const target = byAccount.get(squad.account_id) ?? {};
    for (const kind of TROOP_KINDS) {
      const count = Math.max(0, Math.floor(squad.troops[kind] ?? 0));
      if (count > 0) {
        target[kind] = (target[kind] ?? 0) + count;
      }
    }
    byAccount.set(squad.account_id, target);
  }
  for (const [accountId, troops] of byAccount) {
    const participant = await client.query(
      `SELECT main_city_id FROM battlefield_participants WHERE event_id = $1 AND account_id = $2`,
      [event.id, accountId],
    );
    const cityId = (participant.rows[0] as { main_city_id: string } | undefined)?.main_city_id;
    if (!cityId) {
      continue;
    }
    for (const kind of TROOP_KINDS) {
      const count = troops[kind] ?? 0;
      if (count <= 0) {
        continue;
      }
      await client.query(
        `INSERT INTO city_army (city_id, troop, count, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (city_id, troop) DO UPDATE SET count = city_army.count + $3, updated_at = now()`,
        [cityId, kind, count],
      );
    }
  }
  await client.query(`DELETE FROM battlefield_squads WHERE event_id = $1`, [event.id]);
  const scoreYuan = Math.floor(Number(event.score_yuan));
  const scoreCao = Math.floor(Number(event.score_cao));
  await client.query(
    `UPDATE battlefield_events
     SET status = 'finished', winner_camp = $2, finish_reason = $3, finished_at = now(),
         score_yuan = $4, score_cao = $5
     WHERE id = $1`,
    [event.id, winner, reason, scoreYuan, scoreCao],
  );
  await battlefieldBroadcast(client, broadcasts, 'battlefield_finished', {
    eventId: event.id,
    winner,
    reason,
    scoreYuan,
    scoreCao,
  });
}

/** 第一步：日程推进（创建 / 开战 / 到点结束）与两条公告 */
