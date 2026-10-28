// 城防器械协议的处理（v73，AISLG-193）：CRAFT_DEFENSE / CANCEL_DEFENSE_CRAFT。
// 规则与数值见 common/src/city-defense.ts；视图与库存读取见 common/src/city-defense-db.ts。
// 与征兵同模型：发起即扣资源，打造完成由 Worker 入库；取消全额返还并让排队的下一条立即开工。
// 锁序：队列行（取消时条件翻转）→ 城池行，与 Worker 一致。

import {
  EventType,
  Op,
  RESOURCE_KEYS,
  isDefenseKind,
  type InitiatorRole,
  type Resources,
} from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { defenseCap, startDefenseCraft, type DefenseStock } from '../../common/src/city-defense';
import {
  defenseCraftView,
  defenseStockTotal,
  loadDefenseQueueCounts,
  type DefenseCraftRow,
} from '../../common/src/city-defense-db';
import { activateQueuedDefenseCrafts } from '../../common/src/queue-activate';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadCityState, lockCitySnapshot } from './views';

/** 该城在造 + 排队的件数合计（库存上限校验用） */
function pendingCounts(rows: DefenseCraftRow[]): number {
  return rows.reduce((sum, row) => sum + Math.max(0, Math.floor(row.count)), 0);
}

/** CRAFT_DEFENSE：校验（城墙 → 上限 → 队列 → 资源）、扣成本、写打造条目 */
export async function handleCraftDefense(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const kind = data?.kind;
  const count = data?.count;
  if (!isDefenseKind(kind) || typeof count !== 'number' || !Number.isInteger(count) || count < 1) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
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
    const stock = snap.defenseStock as DefenseStock;
    const cap = defenseCap(snap.levels.wall ?? 0);
    const counts = await loadDefenseQueueCounts(client, snap.cityId);
    const verdict = startDefenseCraft(
      kind,
      count,
      snap.levels.wall ?? 0,
      defenseStockTotal(stock),
      pendingCounts(snap.defenseCrafts),
      snap.resources,
      counts.active,
      counts.queued,
    );
    if (!verdict.ok) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      const extra: Record<string, unknown> = {};
      if (verdict.cap !== undefined) extra.cap = verdict.cap;
      if (verdict.stock !== undefined) extra.stock = verdict.stock;
      if (verdict.pending !== undefined) extra.pending = verdict.pending;
      respondError(ctx.registry, conn, op, seq, verdict.code, {
        ...(cityState ? { city: cityState } : {}),
        ...extra,
      });
      return;
    }
    const afterCost: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      afterCost[key] = snap.resources[key] - verdict.cost[key];
    }
    const status = verdict.mode === 'start' ? 'crafting' : 'queued';
    const ins = await client.query(
      `INSERT INTO defense_crafts (account_id, city_id, kind, count, status, initiator, cost, unit_seconds, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8,
               CASE WHEN $5 = 'crafting' THEN now() + make_interval(secs => $9) END)
       RETURNING *`,
      [accountId, snap.cityId, kind, verdict.count, status, role, JSON.stringify(verdict.cost), verdict.unitSeconds, verdict.seconds],
    );
    const craft = ins.rows[0] as DefenseCraftRow;
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [snap.cityId, afterCost.gold, afterCost.wood, afterCost.food, afterCost.stone, afterCost.iron],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: craft.id,
      type: verdict.mode === 'start' ? EventType.DEFENSE_CRAFT_STARTED : EventType.DEFENSE_CRAFT_QUEUED,
      initiator: role,
      detail: {
        kind,
        count: verdict.count,
        cost: verdict.cost,
        ...(verdict.mode === 'start' ? { dueAt: (craft.due_at as Date).toISOString() } : {}),
      },
    });
    await client.query('COMMIT');

    const view = defenseCraftView(craft);
    respondOk(ctx.registry, conn, op, seq, { craft: view, stock, cap });
    ctx.registry.broadcast(
      accountId,
      {
        op: Op.PUSH_DEFENSE_STATE,
        push: true,
        data: {
          reason: verdict.mode === 'start' ? 'craft_started' : 'craft_queued',
          craft: view,
          stock,
          cap,
        },
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

/** CANCEL_DEFENSE_CRAFT：条件翻转排队 / 打造中的条目，按成本快照全额返还，并激活排队的下一条 */
export async function handleCancelDefenseCraft(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const craftId = data?.craftId;
  if (typeof craftId !== 'string' || !/^[0-9a-f-]{36}$/i.test(craftId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 条件翻转即守卫（锁序 defense_crafts → cities，与 Worker 一致）
    const upd = await client.query(
      `UPDATE defense_crafts SET status = 'cancelled', due_at = NULL, completed_at = NULL
       WHERE id = $1 AND account_id = $2 AND status IN ('queued', 'crafting')
       RETURNING *`,
      [craftId, accountId],
    );
    if (!upd.rowCount) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'DEFENSE_NOT_CANCELLABLE', cityState ? { city: cityState } : undefined);
      return;
    }
    const craft = upd.rows[0] as DefenseCraftRow;
    const snap = await lockCitySnapshot(client, accountId, craft.city_id);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    // 全额返还（不受仓储上限钳制，与建造 / 征兵取消同规则）
    const refund = defenseCraftView(craft).cost;
    const refunded: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      refunded[key] += refund[key];
    }
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [snap.cityId, refunded.gold, refunded.wood, refunded.food, refunded.stone, refunded.iron],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: craft.id,
      type: EventType.DEFENSE_CRAFT_CANCELLED,
      initiator: role,
      detail: { kind: craft.kind, count: craft.count, refund },
    });
    // 让出的打造位立即由该城排队的下一条接上（与 Worker 同一激活写法）
    const activated = await activateQueuedDefenseCrafts<DefenseCraftRow>(client, snap.cityId);
    for (const row of activated) {
      await insertEvent(client, {
        accountId,
        cityId: snap.cityId,
        buildId: row.id,
        type: EventType.DEFENSE_CRAFT_STARTED,
        initiator: row.initiator as InitiatorRole,
        detail: { kind: row.kind, count: row.count, cost: row.cost ?? {}, fromQueue: true, dueAt: row.due_at ? row.due_at.toISOString() : undefined },
      });
    }
    await client.query('COMMIT');

    const view = defenseCraftView(craft);
    const stock = snap.defenseStock as DefenseStock;
    const cap = defenseCap(snap.levels.wall ?? 0);
    respondOk(ctx.registry, conn, op, seq, { craft: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_DEFENSE_STATE, push: true, data: { reason: 'craft_cancelled', craft: view, stock, cap } },
      conn,
    );
    for (const row of activated) {
      ctx.registry.broadcast(accountId, {
        op: Op.PUSH_DEFENSE_STATE,
        push: true,
        data: { reason: 'craft_started', craft: defenseCraftView(row), stock, cap },
      });
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 供 Worker 到期完成后的推送载荷复用（库存 / 上限） */
export function defensePushPayload(
  row: DefenseCraftRow,
  stock: DefenseStock,
  cap: number,
): { reason: 'craft_completed'; craft: ReturnType<typeof defenseCraftView>; stock: Record<string, number>; cap: number } {
  return { reason: 'craft_completed', craft: defenseCraftView(row), stock: stock as Record<string, number>, cap };
}
