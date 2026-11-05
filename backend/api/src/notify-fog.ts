// 探索简报的直推（AISLG-224 第二步，v92）：Worker / 撤回事务写入 exploration_report 事件后，
// API 收到 pg_notify 按事件 id 取 detail 广播 PUSH_EXPLORATION_REPORT。漏收由 GET_EVENTS 覆盖。
import type pg from 'pg';
import { Op } from '../../common/src/protocol';
import { getFogEnabled } from '../../common/src/fog-config';
import type { ConnectionRegistry } from './connections';
import { loadFogWindow } from './fog-view';

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

/** 遗迹被领取（v93，AISLG-227）：每个在线账号按自己的探索状态取这一格的视图，能看到的才推 PUSH_TILE_STATE */
export async function pushRelicClaimed(
  pool: pg.Pool,
  registry: ConnectionRegistry,
  stopped: boolean,
  x: number,
  y: number,
): Promise<void> {
  if (stopped || !getFogEnabled()) {
    return;
  }
  for (const accountId of registry.onlineAccountIds()) {
    try {
      const tiles = await loadFogWindow(pool, accountId, x, y, 1, 1);
      if (tiles.length > 0) {
        registry.broadcast(accountId, {
          op: Op.PUSH_TILE_STATE,
          push: true,
          data: { reason: 'relic_claimed', tile: tiles[0] },
        });
      }
    } catch (err) {
      console.error('push relic claimed failed:', err instanceof Error ? err.message : err);
    }
  }
}

/** 首探 / 遗迹奖励到账（v93，AISLG-227）：主城资源已变，推 PUSH_CITY_STATE（reason = fog_reward），客户端重新 GET_STATE */
export async function pushFogReward(pool: pg.Pool, registry: ConnectionRegistry, stopped: boolean, accountId: string): Promise<void> {
  if (stopped) {
    return;
  }
  try {
    const res = await pool.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at, id LIMIT 1`, [accountId]);
    const cityId = (res.rows[0] as { id: string } | undefined)?.id;
    if (cityId) {
      registry.broadcast(accountId, {
        op: Op.PUSH_CITY_STATE,
        push: true,
        data: { reason: 'fog_reward', cityId },
      });
    }
  } catch (err) {
    console.error('push fog reward failed:', err instanceof Error ? err.message : err);
  }
}

/** 战争迷雾的两类推送分发（AISLG-227，v93）：relic_claimed 推给所有在线账号；fog_reward 推给奖励账号 */
export async function handleFogPush(
  pool: pg.Pool,
  registry: ConnectionRegistry,
  stopped: boolean,
  payload: { reason?: string; accountId?: string; x?: unknown; y?: unknown; [key: string]: unknown },
): Promise<void> {
  if (payload.reason === 'relic_claimed' && Number.isInteger(payload.x) && Number.isInteger(payload.y)) {
    await pushRelicClaimed(pool, registry, stopped, payload.x as number, payload.y as number);
  } else if (payload.reason === 'fog_reward' && payload.accountId) {
    await pushFogReward(pool, registry, stopped, payload.accountId);
  }
}
