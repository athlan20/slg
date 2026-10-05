// 征兵协议的处理逻辑：RECRUIT / CANCEL_RECRUIT（v11）。协议分发见 handlers.ts。
// 与建造共用的事务形态：城池行锁内懒结算生产与人口后按最新状态校验（玩家 / Agent
// 同时提交按先后生效）；取消排队先用条件翻转守卫 recruits 行（锁序 recruits → cities，
// 与 Worker 一致），成功后按快照全额返还资源与人口。征募中条目能否取消待定（同建造）。

import pg from 'pg';
import { Op, EventType, RESOURCE_KEYS, isTroopKind, type InitiatorRole, type Resources, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { RECRUIT_COUNT_MAX, recruitBatchSeconds, startRecruit, type RecruitDeniedCode } from '../../common/src/troops';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadCityState, lockCitySnapshot, recruitView, type CitySnapshot, type RecruitRow } from './views';
import { insufficientPopulationDetail, insufficientResourcesDetail } from './handlers-city';

/** 征兵失败响应附当前城池状态（含本次读取触发的结算），客户端据此自行刷新 */
async function respondRecruitDenied(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  code: RecruitDeniedCode,
  accountId: string,
  extra?: { shortfall?: unknown; retryAfterSeconds?: number | null },
): Promise<void> {
  const cityState = await loadCityState(ctx.pool, accountId);
  const data = { ...(cityState ? { city: cityState } : {}), ...extra };
  respondError(ctx.registry, conn, op, seq, code, Object.keys(data).length ? data : undefined);
}

/** 发起征兵（v11）：军营等级解锁兵种；成本与人口在发起时扣减（排队取消全额返还） */
export async function handleRecruit(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  troop: TroopKind,
  count: number,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const counts = await recruitQueueCounts(client, snap.cityId);
    const verdict = startRecruit(troop, count, snap.resources, snap.population, snap.levels.barracks, counts.active, counts.queued);
    if (!verdict.ok) {
      await client.query('ROLLBACK');
      // v22（AISLG-43）：资源 / 人口不足附缺口与 retryAfterSeconds（按当前净产量 / 增速推导）
      const extra =
        verdict.code === 'INSUFFICIENT_RESOURCES' && verdict.cost
          ? insufficientResourcesDetail(verdict.cost, snap)
          : verdict.code === 'INSUFFICIENT_POPULATION'
            ? insufficientPopulationDetail(verdict.population ?? 0, snap)
            : undefined;
      await respondRecruitDenied(ctx, conn, op, seq, verdict.code, accountId, extra);
      return;
    }
    const afterCost: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      afterCost[key] = snap.resources[key] - verdict.cost[key];
    }
    const afterPopulation = snap.population - verdict.population;
    const status = verdict.mode === 'start' ? 'recruiting' : 'queued';
    // v22（AISLG-39）：缩放与 1 秒下限作用于批次总时长（unitSeconds 快照为未缩放基准）
    const durationSeconds = recruitBatchSeconds(troop, count);
    const ins = await client.query(
      `INSERT INTO recruits (account_id, city_id, troop, count, status, initiator, cost, population, unit_seconds, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9,
               CASE WHEN $5 = 'recruiting' THEN now() + make_interval(secs => $10::int) END)
       RETURNING *`,
      [accountId, snap.cityId, troop, count, status, role, JSON.stringify(verdict.cost), verdict.population, verdict.unitSeconds, durationSeconds],
    );
    const recruit = ins.rows[0] as RecruitRow;
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6, population = $7 WHERE id = $1`,
      [snap.cityId, afterCost.gold, afterCost.wood, afterCost.food, afterCost.stone, afterCost.iron, afterPopulation],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: recruit.id,
      type: verdict.mode === 'start' ? EventType.RECRUIT_STARTED : EventType.RECRUIT_QUEUED,
      initiator: role,
      detail: { troop, count, cost: verdict.cost, population: verdict.population },
    });
    await client.query('COMMIT');

    const view = recruitView(recruit);
    respondOk(ctx.registry, conn, op, seq, { recruit: view });
    ctx.registry.broadcast(
      accountId,
      {
        op: Op.PUSH_RECRUIT_STATE,
        push: true,
        data: { reason: verdict.mode === 'start' ? 'recruit_started' : 'recruit_queued', recruit: view },
      },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 取消排队中的征兵条目（v11：仅 queued 可取消；按快照全额返还资源与人口） */
export async function handleCancelRecruit(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  recruitId: string,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 条件翻转即守卫（锁序 recruits → cities，与 Worker 一致）
    const upd = await client.query(
      `UPDATE recruits SET status = 'cancelled', due_at = NULL, completed_at = NULL
       WHERE id = $1 AND account_id = $2 AND status = 'queued'
       RETURNING *`,
      [recruitId, accountId],
    );
    if (!upd.rowCount) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'RECRUIT_NOT_CANCELLABLE', cityState ? { city: cityState } : undefined);
      return;
    }
    const recruit = upd.rows[0] as RecruitRow & { cost: Record<string, unknown> | null; population: number };
    // 按条目所属城池加锁与返还（主城 / 分城的排队条目都可取消，v24）
    const snap = await lockCitySnapshot(client, accountId, recruit.city_id);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    // 全额返还（资源与人口均按条目快照；旧数据无快照按零返还）
    const refunded: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      const value = recruit.cost?.[key];
      refunded[key] = snap.resources[key] + (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);
    }
    const populationBack = snap.population + Math.max(0, recruit.population);
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6, population = $7 WHERE id = $1`,
      [snap.cityId, refunded.gold, refunded.wood, refunded.food, refunded.stone, refunded.iron, populationBack],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: recruit.id,
      type: EventType.RECRUIT_CANCELLED,
      initiator: role,
      detail: { troop: recruit.troop, count: recruit.count, refund: recruit.cost ?? {}, population: Math.max(0, recruit.population) },
    });
    await client.query('COMMIT');

    const view = recruitView(recruit);
    respondOk(ctx.registry, conn, op, seq, { recruit: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_RECRUIT_STATE, push: true, data: { reason: 'recruit_cancelled', recruit: view } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function recruitQueueCounts(client: pg.PoolClient, cityId: string): Promise<{ active: number; queued: number }> {
  const res = await client.query(
    `SELECT count(*) FILTER (WHERE status = 'recruiting')::int AS active,
            count(*) FILTER (WHERE status = 'queued')::int AS queued
     FROM recruits WHERE city_id = $1`,
    [cityId],
  );
  return { active: res.rows[0].active, queued: res.rows[0].queued };
}

/** 征兵请求参数校验（分发层用）：不合法返回 null */
export function readRecruitParams(data: Record<string, unknown> | undefined): { troop: TroopKind; count: number } | null {
  const troop = readString(data, 'troop');
  const count = data?.count;
  if (!isTroopKind(troop)) {
    return null;
  }
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > RECRUIT_COUNT_MAX) {
    return null;
  }
  return { troop, count };
}

// 供其他模块复用的类型导入标记（CitySnapshot 在本文件事务路径中使用）
export type { CitySnapshot };
