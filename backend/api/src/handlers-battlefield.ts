// 剧本战场（v75，AISLG-198；v80，AISLG-199）的玩家操作：查询、报名、入场、拆队、行军 / 攻打
// （商店在 handlers-battlefield-shop.ts，赤壁火攻 / 连锁在 handlers-battlefield-skill.ts）。
// 地图与据点状态的查询在 GET_BATTLEFIELD；行军的到达结算与据点战斗在 Worker
// （worker/src/battlefield-tick.ts），API 只校验并写入行军意图。
// 规则与数值见 common/src/battlefield.ts；报名 / 入场 / 行军 / 兑换 Agent 都能做。

import pg from 'pg';
import { Op, EventType, TROOP_KINDS, isBattlefieldCamp, type TroopKind } from '../../common/src/protocol';
import {
  BATTLEFIELD_CHIBI_NOBILITY_INDEX,
  BATTLEFIELD_ENTRY_POPULATION,
  BATTLEFIELD_MAX_SQUADS,
  battlefieldEntryPopulation,
  battlefieldMarchMs,
  battlefieldPassable,
  battlefieldPathSteps,
  battlefieldStrongholds,
  battlefieldUnlocked,
} from '../../common/src/battlefield';
import type { BattlefieldScript } from '../../common/src/protocol-battlefield';
import { loadNobilityIndex } from '../../common/src/nobility-db';
import {
  battlefieldEventView,
  loadBattlefieldCampCounts,
  loadLatestBattlefieldEvent,
  loadBattlefieldState,
} from '../../common/src/battlefield-db';
import { insertEvent } from '../../common/src/events';
import { effectiveLevelSql } from '../../common/src/production';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

type Client = pg.PoolClient;

/** 主城：账号最早创建的城 */
export async function loadMainCity(client: Client, accountId: string): Promise<{ id: string; government: number } | null> {
  const res = await client.query(
    `SELECT c.id, COALESCE(${effectiveLevelSql('g.level', "'government'", 'c.famous_name')}, 0)::int AS government
     FROM cities c LEFT JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government'
     WHERE c.account_id = $1 ORDER BY c.created_at LIMIT 1`,
    [accountId],
  );
  const row = res.rows[0] as { id: string; government: number } | undefined;
  return row ? { id: row.id, government: Number(row.government) } : null;
}

/** 读一支队伍并锁行（不存在 / 不属于本账号返回 null） */
async function lockSquad(client: Client, squadId: string, accountId: string) {
  const res = await client.query(`SELECT * FROM battlefield_squads WHERE id = $1 AND account_id = $2 FOR UPDATE`, [
    squadId,
    accountId,
  ]);
  return (res.rows[0] as
    | {
        id: string;
        event_id: string;
        camp: string;
        x: number;
        y: number;
        origin_x: number;
        origin_y: number;
        troops: Partial<Record<TroopKind, number>>;
        status: string;
        stronghold_id: string | null;
      }
    | undefined) ?? null;
}

/** 读取请求里的部队编成：只接受非负整数，未列出的兵种按 0；未知键忽略 */
function readTroops(value: unknown): Partial<Record<TroopKind, number>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const troops: Partial<Record<TroopKind, number>> = {};
  let units = 0;
  for (const kind of TROOP_KINDS) {
    const raw = source[kind];
    if (raw === undefined || raw === null) {
      continue;
    }
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
      return null;
    }
    if (raw > 0) {
      troops[kind] = raw;
      units += raw;
    }
  }
  return units > 0 ? troops : null;
}

/** 操作成功后统一刷新并返回完整战场状态（客户端无需再查一次） */
export async function respondState(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  accountId: string,
): Promise<void> {
  const event = await loadLatestBattlefieldEvent(ctx.pool);
  const state = await loadBattlefieldState(ctx.pool, accountId, event);
  respondOk(ctx.registry, conn, op, seq, state as unknown as Record<string, unknown>);
}

/** 全服广播战场状态（API 侧操作后直接推，Worker 侧经 pg_notify） */
export async function broadcastState(
  ctx: HandlerContext,
  accountId: string,
  reason: 'signup' | 'started' | 'stronghold' | 'finished' | 'wind',
  strongholdId?: string,
): Promise<void> {
  const event = await loadLatestBattlefieldEvent(ctx.pool);
  if (!event) {
    return;
  }
  const counts = await loadBattlefieldCampCounts(ctx.pool, event.id);
  const data = { reason, event: battlefieldEventView(event, counts), ...(strongholdId ? { strongholdId } : {}) };
  ctx.registry.broadcastAll({ op: Op.PUSH_BATTLEFIELD_STATE, push: true, data });
}

/** GET_BATTLEFIELD（op 120）：当前 / 最近一场 + 据点 + 我的队伍与军功 + 榜 + 商店 */
export async function handleGetBattlefield(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  await respondState(ctx, conn, op, seq, accountId);
}

/** 本场剧本（读行时未知值按官渡） */
export function scriptOfRow(value: unknown): BattlefieldScript {
  return value === 'dongzhuo' || value === 'chibi' ? value : 'guandu';
}

/** SIGNUP_BATTLEFIELD（op 121）：报名选阵营，官府 ≥ 5，阵营人数失衡时暂停；讨董只有讨董联军，统一记 yuan；赤壁需爵位大夫 */
export async function handleSignupBattlefield(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const camp = data?.camp;
  if (!isBattlefieldCamp(camp)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const eventRes = await client.query(`SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1 FOR UPDATE`);
    const event = eventRes.rows[0] as
      | { id: string; script: string; status: string; signup_start: Date; start_at: Date; end_at: Date }
      | undefined;
    const now = Date.now();
    if (!event || event.status !== 'signup' || now < event.signup_start.getTime() || now >= event.start_at.getTime()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SIGNUP_CLOSED');
      return;
    }
    const script = scriptOfRow(event.script);
    // 讨董是单阵营合作本：所有报名玩家都在讨董联军（yuan）一边，不做阵营人数失衡判断
    const joinCamp = script === 'dongzhuo' ? 'yuan' : camp;
    const main = await loadMainCity(client, accountId);
    if (!main) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    if (main.government < 5) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_GOVERNMENT_TOO_LOW', { required: 5, current: main.government });
      return;
    }
    if (script === 'chibi') {
      // 赤壁：爵位大夫及以上才能报名（v76 爵位已上线）
      const nobility = await loadNobilityIndex(client, accountId);
      if (nobility < BATTLEFIELD_CHIBI_NOBILITY_INDEX) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'NOBILITY_TOO_LOW', { required: BATTLEFIELD_CHIBI_NOBILITY_INDEX, current: nobility });
        return;
      }
    }
    const exists = await client.query(
      `SELECT 1 FROM battlefield_participants WHERE event_id = $1 AND account_id = $2`,
      [event.id, accountId],
    );
    if (exists.rowCount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_ALREADY_JOINED');
      return;
    }
    const counts = await client.query(
      `SELECT camp, count(*)::int AS n FROM battlefield_participants WHERE event_id = $1 GROUP BY camp`,
      [event.id],
    );
    const countOf = (value: string): number =>
      Number((counts.rows as Array<{ camp: string; n: number }>).find((row) => row.camp === value)?.n ?? 0);
    const other = joinCamp === 'yuan' ? 'cao' : 'yuan';
    const mine = countOf(joinCamp);
    const theirs = countOf(other);
    const limit = Math.floor(theirs * 1.5);
    if (script !== 'dongzhuo' && theirs > 0 && mine >= limit && mine - theirs >= 5) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_CAMP_FULL', { count: mine, otherCount: theirs, limit });
      return;
    }
    const inserted = await client.query(
      `INSERT INTO battlefield_participants (event_id, account_id, camp, main_city_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING 1`,
      [event.id, accountId, joinCamp, main.id],
    );
    if (!inserted.rowCount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_ALREADY_JOINED');
      return;
    }
    await insertEvent(client, {
      accountId,
      cityId: main.id,
      type: EventType.BATTLEFIELD_SIGNED_UP,
      initiator: conn.role,
      detail: { eventId: event.id, camp: joinCamp },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await broadcastState(ctx, accountId, 'signup');
  await respondState(ctx, conn, op, seq, accountId);
}

/** ENTER_BATTLEFIELD（op 122）：开战前从主城带一支部队入场（人口 ≤ 3000，每人一次） */
export async function handleEnterBattlefield(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const troops = readTroops(data?.troops);
  if (!troops) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const population = battlefieldEntryPopulation(troops);
  if (population > BATTLEFIELD_ENTRY_POPULATION) {
    respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_POPULATION_LIMIT', {
      limit: BATTLEFIELD_ENTRY_POPULATION,
      current: population,
    });
    return;
  }
  const client = await ctx.pool.connect();
  let camp: 'yuan' | 'cao' = 'yuan';
  try {
    await client.query('BEGIN');
    const eventRes = await client.query(`SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1`);
    const event = eventRes.rows[0] as { id: string; status: string; start_at: Date } | undefined;
    if (!event || event.status !== 'signup' || Date.now() >= event.start_at.getTime()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_ENTRY_CLOSED');
      return;
    }
    const partRes = await client.query(
      `SELECT * FROM battlefield_participants WHERE event_id = $1 AND account_id = $2 FOR UPDATE`,
      [event.id, accountId],
    );
    const participant = partRes.rows[0] as
      | { camp: string; main_city_id: string; entered_at: Date | null }
      | undefined;
    if (!participant) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_NOT_JOINED');
      return;
    }
    if (participant.entered_at) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_ALREADY_ENTERED');
      return;
    }
    camp = participant.camp === 'cao' ? 'cao' : 'yuan';
    // 锁城内驻军并校验兵够不够
    const armyRes = await client.query(`SELECT troop, count FROM city_army WHERE city_id = $1 FOR UPDATE`, [
      participant.main_city_id,
    ]);
    const available = new Map<string, number>();
    for (const row of armyRes.rows as Array<{ troop: string; count: number }>) {
      available.set(row.troop, Number(row.count));
    }
    for (const kind of TROOP_KINDS) {
      const want = troops[kind] ?? 0;
      if (want > (available.get(kind) ?? 0)) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_TROOPS', { troop: kind, need: want, have: available.get(kind) ?? 0 });
        return;
      }
    }
    for (const kind of TROOP_KINDS) {
      const want = troops[kind] ?? 0;
      if (want <= 0) {
        continue;
      }
      await client.query(`UPDATE city_army SET count = count - $3, updated_at = now() WHERE city_id = $1 AND troop = $2`, [
        participant.main_city_id,
        kind,
        want,
      ]);
      await client.query(`DELETE FROM city_army WHERE city_id = $1 AND troop = $2 AND count <= 0`, [
        participant.main_city_id,
        kind,
      ]);
    }
    // 出生点在自己大营旁边（大营格留给据点守军）
    const spawn = camp === 'yuan' ? { x: 3, y: 15 } : { x: 26, y: 15 };
    const squad = await client.query(
      `INSERT INTO battlefield_squads
         (event_id, account_id, camp, x, y, origin_x, origin_y, troops, status)
       VALUES ($1, $2, $3, $4, $5, $4, $5, $6::jsonb, 'idle') RETURNING id`,
      [event.id, accountId, camp, spawn.x, spawn.y, JSON.stringify(troops)],
    );
    await client.query(`UPDATE battlefield_participants SET entered_at = now() WHERE event_id = $1 AND account_id = $2`, [
      event.id,
      accountId,
    ]);
    await insertEvent(client, {
      accountId,
      cityId: participant.main_city_id,
      type: EventType.BATTLEFIELD_ENTERED,
      initiator: conn.role,
      detail: { eventId: event.id, camp, troops, population, squadId: squad.rows[0].id },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await broadcastState(ctx, accountId, 'signup');
  await respondState(ctx, conn, op, seq, accountId);
}

/** SPLIT_BATTLEFIELD_SQUAD（op 123）：从一支队伍拆出一支（每人最多 3 队） */
export async function handleSplitBattlefieldSquad(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const squadId = typeof data?.squadId === 'string' ? data.squadId : null;
  const split = readTroops(data?.troops);
  if (!squadId || !split) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const eventRes = await client.query(`SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1`);
    const event = eventRes.rows[0] as { id: string; status: string } | undefined;
    if (!event) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_NOT_ACTIVE');
      return;
    }
    const squad = await lockSquad(client, squadId, accountId);
    if (!squad || squad.event_id !== event.id) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SQUAD_NOT_FOUND');
      return;
    }
    if (squad.status === 'marching') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SQUAD_BUSY');
      return;
    }
    const countRes = await client.query(
      `SELECT count(*)::int AS n FROM battlefield_squads WHERE event_id = $1 AND account_id = $2`,
      [event.id, accountId],
    );
    if (Number((countRes.rows[0] as { n: number }).n) >= BATTLEFIELD_MAX_SQUADS) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SQUAD_LIMIT');
      return;
    }
    const source = squad.troops as Partial<Record<TroopKind, number>>;
    for (const kind of TROOP_KINDS) {
      const want = split[kind] ?? 0;
      if (want > Math.max(0, Math.floor(source[kind] ?? 0))) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_TROOPS', { troop: kind, need: want, have: source[kind] ?? 0 });
        return;
      }
    }
    const remain: Partial<Record<TroopKind, number>> = {};
    let remainUnits = 0;
    for (const kind of TROOP_KINDS) {
      const left = Math.max(0, Math.floor(source[kind] ?? 0)) - (split[kind] ?? 0);
      if (left > 0) {
        remain[kind] = left;
        remainUnits += left;
      }
    }
    if (remainUnits === 0) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    await client.query(`UPDATE battlefield_squads SET troops = $2::jsonb WHERE id = $1`, [squadId, JSON.stringify(remain)]);
    await client.query(
      `INSERT INTO battlefield_squads
         (event_id, account_id, camp, x, y, origin_x, origin_y, troops, status)
       VALUES ($1, $2, $3, $4, $5, $4, $5, $6::jsonb, 'idle')`,
      [event.id, accountId, squad.camp, squad.x, squad.y, JSON.stringify(split)],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await respondState(ctx, conn, op, seq, accountId);
}

/** MARCH_BATTLEFIELD_SQUAD（op 124）：战场内行军；目标为敌方据点时到达后自动开战（讨董关卡按顺序解锁） */
export async function handleMarchBattlefieldSquad(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const squadId = typeof data?.squadId === 'string' ? data.squadId : null;
  if (!squadId) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const strongholdId = typeof data?.strongholdId === 'string' ? data.strongholdId : null;
  const rawX = data?.x;
  const rawY = data?.y;
  // 据点 id 要到读出本场剧本后才能解析（不同剧本的据点表不同）；坐标在这里先做基本校验
  let x: number | null = null;
  let y: number | null = null;
  if (!strongholdId && typeof rawX === 'number' && typeof rawY === 'number' && Number.isInteger(rawX) && Number.isInteger(rawY)) {
    x = rawX;
    y = rawY;
  }
  if (!strongholdId && (x === null || y === null || !battlefieldPassable(x, y))) {
    respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_UNREACHABLE');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const eventRes = await client.query(`SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1`);
    const event = eventRes.rows[0] as { id: string; script: string; status: string; start_at: Date } | undefined;
    if (!event || event.status !== 'active' || Date.now() < event.start_at.getTime()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_NOT_ACTIVE');
      return;
    }
    const script = scriptOfRow(event.script);
    const defs = battlefieldStrongholds(script);
    let def: (typeof defs)[number] | undefined;
    if (strongholdId) {
      const index = defs.findIndex((item) => item.id === strongholdId);
      def = index >= 0 ? defs[index] : undefined;
      if (!def) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_TARGET_INVALID');
        return;
      }
      if (rawX !== undefined || rawY !== undefined) {
        if (rawX !== def.x || rawY !== def.y) {
          await client.query('ROLLBACK');
          respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_TARGET_INVALID');
          return;
        }
      }
      x = def.x;
      y = def.y;
      // 讨董：前一关没被讨董联军打下时，本关不能攻打
      if (script === 'dongzhuo' && index > 0) {
        const previous = await client.query(
          `SELECT owner_camp FROM battlefield_strongholds WHERE event_id = $1 AND id = $2`,
          [event.id, defs[index - 1].id],
        );
        const previousOwner = (previous.rows[0] as { owner_camp: string | null } | undefined)?.owner_camp ?? null;
        if (!battlefieldUnlocked(script, index, previousOwner === 'yuan' || previousOwner === 'cao' ? previousOwner : null)) {
          await client.query('ROLLBACK');
          respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_STRONGHOLD_LOCKED', { unlockAfter: defs[index - 1].id });
          return;
        }
      }
    }
    if (x === null || y === null || !battlefieldPassable(x, y)) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, strongholdId ? 'BATTLEFIELD_TARGET_INVALID' : 'BATTLEFIELD_UNREACHABLE');
      return;
    }
    const squad = await lockSquad(client, squadId, accountId);
    if (!squad || squad.event_id !== event.id) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SQUAD_NOT_FOUND');
      return;
    }
    if (squad.status === 'marching') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SQUAD_BUSY');
      return;
    }
    const steps = battlefieldPathSteps(squad.x, squad.y, x, y);
    if (steps === null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_UNREACHABLE');
      return;
    }
    const arriveAt = new Date(Date.now() + battlefieldMarchMs(steps));
    await client.query(
      `UPDATE battlefield_squads
       SET status = 'marching', stronghold_id = NULL, target_x = $2, target_y = $3,
           target_stronghold_id = $4, arrive_at = $5, origin_x = x, origin_y = y
       WHERE id = $1`,
      [squadId, x, y, def?.id ?? null, arriveAt],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await respondState(ctx, conn, op, seq, accountId);
}
