// TRUCE（op 53，v38 AISLG-122）：开启主动免战——每周一次免费、持续 12 小时（随缩放）。
// 开着时别人打不了他（MARCH 打他返回 TARGET_IN_TRUCE）、他也不能出兵打玩家
//（SELF_TRUCE_ACTIVE；打野地 / NPC 不受影响）。规则与数值在 common/src/protection.ts。

import pg from 'pg';
import { EventType, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { scaledMs } from '../../common/src/time-scale';
import { SELF_TRUCE_MS, SELF_TRUCE_WEEK_MS, activeAt, selfTruceNextAvailableAt } from '../../common/src/protection';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** TRUCE：开启主动免战（玩家与 Agent 连接都可调用；账号级状态，每周一次） */
export async function handleTruce(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `SELECT self_truce_until, self_truce_used_at FROM accounts WHERE id = $1 FOR UPDATE`,
      [accountId],
    );
    if (!res.rowCount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const row = res.rows[0] as { self_truce_until: Date | null; self_truce_used_at: Date | null };
    const nowRes = await client.query(`SELECT now() AS now`);
    const dbNow = nowRes.rows[0].now as Date;
    const active = activeAt(row.self_truce_until, dbNow);
    if (active) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'TRUCE_ALREADY_ACTIVE', {
        until: active.toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((active.getTime() - dbNow.getTime()) / 1000)),
      });
      return;
    }
    const nextAt = selfTruceNextAvailableAt(row.self_truce_used_at);
    if (nextAt && nextAt.getTime() > dbNow.getTime()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'TRUCE_WEEKLY_USED', {
        nextAvailableAt: nextAt.toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((nextAt.getTime() - dbNow.getTime()) / 1000)),
      });
      return;
    }
    const until = new Date(dbNow.getTime() + scaledMs(SELF_TRUCE_MS));
    const nextAvailableAt = new Date(dbNow.getTime() + scaledMs(SELF_TRUCE_WEEK_MS));
    await client.query(
      `UPDATE accounts SET self_truce_until = $2, self_truce_used_at = $3 WHERE id = $1`,
      [accountId, until, dbNow],
    );
    await insertEvent(client, {
      accountId,
      type: EventType.TRUCE_STARTED,
      initiator: role,
      detail: { until: until.toISOString(), nextAvailableAt: nextAvailableAt.toISOString() },
    });
    await client.query('COMMIT');
    respondOk(ctx.registry, conn, op, seq, {
      shieldUntil: until.toISOString(),
      nextAvailableAt: nextAvailableAt.toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
