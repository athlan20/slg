// 剧本战场（v75，AISLG-198 官渡；v80，AISLG-199 讨董 / 赤壁）的事件生命周期公共函数：
// 据点初始化、开战激活（含赤壁风向）、积分累计、军功入账、结束发奖、公告与播报 / 推送。
// 由 battlefield-tick.ts（日程 / 耗粮 / 积分 / 风向）与 battlefield-move.ts（据点战斗）共用。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType, TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import {
  BATTLEFIELD_START_NOTICE_MS,
  BATTLEFIELD_WIND_MS,
  BATTLEFIELD_SCRIPT_NAMES,
  battlefieldDongzhuoProgress,
  battlefieldGarrisonPlayerMultiplier,
  battlefieldInitialGarrison,
  battlefieldInitialWind,
  battlefieldRewardForScript,
  battlefieldScriptForSignupStart,
  battlefieldStrongholds,
  battlefieldUnderdog,
  battlefieldWindLabel,
  type BattlefieldCamp,
  type BattlefieldWind,
} from '../../common/src/battlefield';
import type { BattlefieldScript } from '../../common/src/protocol-battlefield';
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
  reason: 'signup' | 'started' | 'stronghold' | 'finished' | 'wind',
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

/** 事务内写入本剧本的初始据点（守军先按 1 倍人数，开战时再按报名人数加厚） */
export async function insertStrongholds(client: pg.PoolClient, eventId: string, script: BattlefieldScript): Promise<void> {
  for (const def of battlefieldStrongholds(script)) {
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

/** 开战：按报名人数重算守军、算人少补偿、初始化积分 / 耗粮水位；赤壁随机初始风向（6 小时后第一次切换） */
export async function activateEvent(client: pg.PoolClient, event: BattlefieldEventRow, now: Date): Promise<void> {
  const script = asScript(event.script);
  const counts = await client.query(
    `SELECT camp, count(*)::int AS n FROM battlefield_participants WHERE event_id = $1 GROUP BY camp`,
    [event.id],
  );
  const countOf = (camp: BattlefieldCamp): number =>
    Number((counts.rows as Array<{ camp: string; n: number }>).find((row) => row.camp === camp)?.n ?? 0);
  const yuan = countOf('yuan');
  const cao = countOf('cao');
  const multiplier = battlefieldGarrisonPlayerMultiplier(yuan + cao, script);
  for (const def of battlefieldStrongholds(script)) {
    await client.query(`UPDATE battlefield_strongholds SET garrison = $3::jsonb WHERE event_id = $1 AND id = $2`, [
      event.id,
      def.id,
      JSON.stringify(battlefieldInitialGarrison(def, multiplier)),
    ]);
  }
  const underdog = script === 'dongzhuo' ? null : battlefieldUnderdog(yuan, cao);
  const wind = script === 'chibi' ? battlefieldInitialWind() : null;
  const windNextAt = wind ? new Date(now.getTime() + BATTLEFIELD_WIND_MS) : null;
  await client.query(
    `UPDATE battlefield_events
     SET status = 'active', underdog_camp = $2, underdog_multiplier = $3,
         last_score_at = $4, last_food_at = $4, wind = $5, wind_next_at = $6, wind_notice_at = NULL
     WHERE id = $1`,
    [event.id, underdog?.camp ?? null, underdog?.multiplier ?? 1, now, wind, windNextAt],
  );
  event.status = 'active';
  event.underdog_camp = underdog?.camp ?? null;
  event.underdog_multiplier = underdog?.multiplier ?? 1;
  event.last_score_at = now;
  event.last_food_at = now;
  event.wind = wind;
  event.wind_next_at = windNextAt;
  event.wind_notice_at = null;
}

function asScript(value: unknown): BattlefieldScript {
  return value === 'dongzhuo' || value === 'chibi' ? value : 'guandu';
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

/** 各剧本的开场说明（报名公告正文里用） */
const SCRIPT_BLURB: Record<BattlefieldScript, string> = {
  guandu:
    `袁绍军与曹操军在 30×30 独立战场抢渡口、据点和乌巢粮仓积累阵营积分。` +
    `报名要求主城官府 ≥ 5 级，选择袁绍军或曹操军；开战前从主城带一支部队入场（按人口最多 3000），开战后不能追加兵力。` +
    `军功可在战场商店换资源、武将经验与兵。`,
  dongzhuo:
    `讨伐董卓是全服合作：只有讨董联军一方，所有报名玩家一起从汜水关打到虎牢关，再打到洛阳；前一关打下后下一关才开放。` +
    `守军打不完也没关系，伤亡会保留，大家可以分批消耗；吕布守虎牢关。全员按最远进度领一档奖励（军功 > 0 才能领）。`,
  chibi:
    `孙刘联军对曹操军，需要爵位大夫及以上才能报名。开战时随机一个风向，东南风利孙刘、西北风利曹操，每 6 小时切换一次（提前 30 分钟预告）。` +
    `顺风方远程兵种与床弩射程 +10%；东南风期间孙刘方可用军功火攻曹方据点，曹方可用军功为据点连锁战船。`,
};

function scriptOf(event: BattlefieldEventRow): BattlefieldScript {
  return asScript(event.script);
}

export async function sendAnnouncement(pool: pg.Pool, event: BattlefieldEventRow, stage: 'signup' | 'start'): Promise<void> {
  const script = scriptOf(event);
  const name = BATTLEFIELD_SCRIPT_NAMES[script];
  const nextScript = battlefieldScriptForSignupStart(new Date(event.signup_start.getTime() + 7 * 24 * 3_600_000));
  const titleZh =
    stage === 'signup'
      ? `剧本战场「${name}」开始报名（每周二 20:00 — 周三 20:00）`
      : `剧本战场「${name}」将在 1 小时后开战`;
  const bodyZh =
    stage === 'signup'
      ? `剧本战场「${name}」开始报名。开战：北京时间 ${formatBeijing(event.start_at)}；结束：${formatBeijing(event.end_at)}。` +
        `${SCRIPT_BLURB[script]}下一场（${formatBeijing(new Date(event.signup_start.getTime() + 7 * 24 * 3_600_000))} 起）为「${BATTLEFIELD_SCRIPT_NAMES[nextScript]}」。`
      : `剧本战场「${name}」将在北京时间 ${formatBeijing(event.start_at)} 开战，已报名但还没入场的玩家请在开战前带兵入场（开战后不能再入场）。`;
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

/** 赤壁风向预告（切换前 30 分钟）：公告 + 状态推送，客户端重查 GET_BATTLEFIELD 拿新风向 */
export async function sendWindNotice(pool: pg.Pool, event: BattlefieldEventRow, switchAt: Date, next: BattlefieldWind): Promise<void> {
  const titleZh = `赤壁战场：30 分钟后转为${battlefieldWindLabel(next)}`;
  const bodyZh =
    `北京时间 ${formatBeijing(switchAt)} 风向转为${battlefieldWindLabel(next)}。` +
    (next === 'se' ? '东南风利孙刘：孙刘方远程兵种与床弩射程 +10%，可以火攻曹方据点。' : '西北风利曹操：曹操方远程兵种与床弩射程 +10%，火攻暂停。');
  try {
    await publishAnnouncement(pool, {
      category: 'event',
      titleZh,
      bodyZh,
      titleEn: null,
      bodyEn: null,
      pinned: false,
      strongRemind: false,
      host: null,
      startsAt: new Date(Date.now() - 1000),
      endsAt: event.end_at,
      chat: false,
    });
  } catch (err) {
    console.error('battlefield wind notice failed:', err instanceof Error ? err.message : err);
  }
  await notifyBattlefield(pool, 'wind', event.id);
}

/** 讨董：当前已打下的关卡数（进度档用） */
export async function loadDongzhuoProgress(client: pg.PoolClient | pg.Pool, eventId: string): Promise<number> {
  const res = await client.query(`SELECT id, owner_camp FROM battlefield_strongholds WHERE event_id = $1`, [eventId]);
  const owners: Record<string, BattlefieldCamp | null> = {};
  for (const row of res.rows as Array<{ id: string; owner_camp: string | null }>) {
    owners[row.id] = row.owner_camp === 'yuan' || row.owner_camp === 'cao' ? row.owner_camp : null;
  }
  return battlefieldDongzhuoProgress(owners);
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
  const script = scriptOf(event);
  const progress = script === 'dongzhuo' ? await loadDongzhuoProgress(client, event.id) : 0;
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
    const reward = battlefieldRewardForScript(script, Number(row.rank), won, progress);
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
        ...(script === 'dongzhuo' ? { script, progress } : {}),
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
