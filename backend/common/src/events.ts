// 事件表存取：账号维度的事件流，供「历史事件」按需查询。
// API（建造发起、Agent 上下线）与 Worker（建造完成）共用同一张表与同一写入函数。

import pg from 'pg';
import { isInitiatorRole, type EventView, type EventType, type InitiatorRole } from './protocol';

type Queryable = pg.Pool | pg.PoolClient;

export interface EventRow {
  id: number;
  account_id: string;
  city_id: string | null;
  build_id: string | null;
  type: string;
  initiator: string | null;
  detail: Record<string, unknown>;
  created_at: Date;
}

export interface NewEvent {
  accountId: string;
  cityId?: string | null;
  buildId?: string | null;
  type: EventType;
  initiator?: InitiatorRole | null;
  detail?: Record<string, unknown>;
}

/** 写入一条事件并返回自增 id。可在事务内传入 PoolClient。 */
export async function insertEvent(q: Queryable, event: NewEvent): Promise<number> {
  const res = await q.query(
    `INSERT INTO events (account_id, city_id, build_id, type, initiator, detail)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING id`,
    [
      event.accountId,
      event.cityId ?? null,
      event.buildId ?? null,
      event.type,
      event.initiator ?? null,
      JSON.stringify(event.detail ?? {}),
    ],
  );
  return res.rows[0].id;
}

export interface ListEventsOptions {
  limit: number;
  /** 与 sinceId 互斥：返回 id 小于它的最新事件（倒序分页） */
  beforeId?: number;
  /** 与 beforeId 互斥：返回 id 大于它的旧→新事件（重连后增量） */
  sinceId?: number;
  /** 只看某个登录类型发起的事件（Agent 信息页用） */
  initiator?: InitiatorRole;
}

/**
 * 查询账号事件。默认按 id 倒序返回最新 limit 条；
 * 给 sinceId 时按 id 升序返回（增量补读）。
 */
export async function listEvents(
  q: Queryable,
  accountId: string,
  opts: ListEventsOptions,
): Promise<EventRow[]> {
  if (opts.beforeId !== undefined && opts.sinceId !== undefined) {
    throw new Error('beforeId 与 sinceId 不能同时提供');
  }
  const params: unknown[] = [accountId];
  let where = 'account_id = $1';
  if (opts.initiator) {
    params.push(opts.initiator);
    where += ` AND initiator = $${params.length}`;
  }
  let order = 'id DESC';
  if (opts.sinceId !== undefined) {
    params.push(opts.sinceId);
    where += ` AND id > $${params.length}`;
    order = 'id ASC';
  } else if (opts.beforeId !== undefined) {
    params.push(opts.beforeId);
    where += ` AND id < $${params.length}`;
  }
  params.push(opts.limit);
  const res = await q.query(
    `SELECT id, account_id, city_id, build_id, type, initiator, detail, created_at
     FROM events WHERE ${where} ORDER BY ${order} LIMIT $${params.length}`,
    params,
  );
  return res.rows as EventRow[];
}

export function toEventView(row: EventRow): EventView {
  return {
    id: Number(row.id),
    type: row.type as EventType,
    initiator: isInitiatorRole(row.initiator) ? row.initiator : null,
    cityId: row.city_id,
    buildId: row.build_id,
    detail: row.detail ?? {},
    createdAt: row.created_at.toISOString(),
  };
}
