// 探索简报的直推（AISLG-224 第二步，v92）：Worker / 撤回事务写入 exploration_report 事件后，
// API 收到 pg_notify 按事件 id 取 detail 广播 PUSH_EXPLORATION_REPORT。漏收由 GET_EVENTS 覆盖。
import type pg from 'pg';
import { Op } from '../../common/src/protocol';
import type { ConnectionRegistry } from './connections';

export async function pushExplorationReport(
  pool: pg.Pool,
  registry: ConnectionRegistry,
  stopped: boolean,
  accountId: string,
  eventId: number,
): Promise<void> {
  if (stopped) {
    return;
  }
  try {
    const res = await pool.query(
      `SELECT id, detail FROM events WHERE id = $1 AND account_id = $2 AND type = 'exploration_report'`,
      [eventId, accountId],
    );
    const row = res.rows[0] as { id: string | number; detail: Record<string, unknown> } | undefined;
    if (row) {
      registry.broadcast(accountId, {
        op: Op.PUSH_EXPLORATION_REPORT,
        push: true,
        data: { report: { eventId: Number(row.id), ...row.detail } },
      });
    }
  } catch (err) {
    console.error('push exploration report failed:', err instanceof Error ? err.message : err);
  }
}
