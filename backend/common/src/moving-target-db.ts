// 移动目标的数据库存取（v28，AISLG-78）：API（查询 / 截击发起校验）与 Worker（刷新 / 结算）共用。

import pg from 'pg';
import { RESOURCE_KEYS, type Resources, type TroopKind } from './protocol';
import type { MovingTargetView } from './protocol-moving';
import {
  MOVING_KIND_INFO,
  isMovingKind,
  movingStepMs,
  routeIndexAt,
  scheduleOf,
  type MovingKind,
  type RouteCell,
} from './moving-target';
import { armyPower } from './battle';

type Queryable = pg.Pool | pg.PoolClient;

/** moving_targets 行（route / garrison / stock 为 jsonb） */
export interface MovingTargetRow {
  id: string;
  kind: string;
  level: number;
  status: string;
  route: RouteCell[];
  started_at: Date;
  ends_at: Date;
  garrison: Partial<Record<TroopKind, number>>;
  stock: Partial<Resources>;
  passed_index: number;
  defeated_by: string | null;
  resolved_at: Date | null;
}

/** 行的单步时长（毫秒）：取自该目标自己的存在时长（不随之后的时间缩放切换而漂移） */
export function rowStepMs(row: MovingTargetRow): number {
  return movingStepMs(row.ends_at.getTime() - row.started_at.getTime());
}

/** 行在 nowMs 时的路线下标（未出发 / 已超出存在期 / 已被击败返回 null）。
 *  expired 只是过期清理的标记：到达时刻仍在存在期内的行军（Worker 处理晚于清理）照样按时刻判定 */
export function rowIndexAt(row: MovingTargetRow, nowMs: number): number | null {
  if (row.status === 'defeated') {
    return null;
  }
  return routeIndexAt(row.started_at.getTime(), row.ends_at.getTime(), nowMs, rowStepMs(row));
}

/** 库存合计 */
export function stockTotal(stock: Partial<Resources>): number {
  return RESOURCE_KEYS.reduce((sum, key) => sum + Math.max(0, Math.floor(stock[key] ?? 0)), 0);
}

function approxRange(total: number): { min: number; max: number } {
  return { min: Math.floor(total * 0.8), max: Math.ceil(total * 1.2) };
}

/** 行 → 公开视图（只给大致范围，不给精确守军 / 库存） */
export function movingTargetView(row: MovingTargetRow, nowMs: number = Date.now()): MovingTargetView {
  const kind: MovingKind = isMovingKind(row.kind) ? row.kind : 'caravan';
  const step = rowStepMs(row);
  const index = rowIndexAt(row, nowMs);
  const garrisonTotal = Object.values(row.garrison ?? {}).reduce((sum, count) => sum + Math.max(0, count ?? 0), 0);
  return {
    id: row.id,
    kind,
    label: MOVING_KIND_INFO[kind].label,
    level: row.level,
    status: row.status === 'defeated' ? 'defeated' : row.status === 'expired' ? 'expired' : 'active',
    startedAt: row.started_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    stepSeconds: Math.max(1, Math.round(step / 1000)),
    position: index === null ? null : { x: row.route[index][0], y: row.route[index][1], index },
    route: scheduleOf(row.route, row.started_at.getTime(), step),
    garrisonTotal: approxRange(garrisonTotal),
    stockTotal: approxRange(stockTotal(row.stock ?? {})),
  };
}

/** 当前存在（active 且未过截止）的目标，按截止时刻升序 */
export async function loadActiveMovingTargets(q: Queryable): Promise<MovingTargetRow[]> {
  const res = await q.query(
    `SELECT * FROM moving_targets WHERE status = 'active' AND ends_at > now() ORDER BY ends_at, id`,
  );
  return res.rows as MovingTargetRow[];
}

/** 按 id 取目标（forUpdate=true 加行锁，Worker 结算用）；不存在返回 null */
export async function loadMovingTarget(q: Queryable, id: string, forUpdate = false): Promise<MovingTargetRow | null> {
  const res = await q.query(`SELECT * FROM moving_targets WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id]);
  return res.rowCount ? (res.rows[0] as MovingTargetRow) : null;
}

/** 守军参考战力（精确值，Worker / 校准用；视图只给范围） */
export function rowPower(row: MovingTargetRow): number {
  return armyPower(row.garrison ?? {});
}
