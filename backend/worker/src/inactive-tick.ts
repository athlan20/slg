// 长期不活跃账号的野地收回（v98，AISLG-238）：本人和 Agent 都 7 天没上线（现实时间，不随 time_scale 变化）
// 的账号，名下的野地一次全部收回——地块变无主、驻军直接回到这块地所属的城（不走行军、不损失）、
// 望楼毁掉（不退资源）、当前储量原样保留、不设换主保护（别人可以马上占）。城（主城 / 分城）与城内
// 资源兵力都不动。
//
// 口径与依赖：
// - 活跃判定沿用 COALESCE(accounts.last_active_at, last_online_at, created_at)（与盟主自动转让同口径）；
//   Agent 上线是否刷新 last_active_at 由 AISLG-236 修复，本文件只负责读取判定。
// - 每小时一轮（INACTIVE_TICK_MS，进程内节流，不新增高频空轮询，沿用 AISLG-208 的口径）；
//   每个账号一个事务，事务内复核一次活跃时刻（候选之后账号刚好上线就跳过）。
// - 不用 clearTileOccupation：它会把驻军直接删掉。这里按 pvp-conquer.ts 换主的口径来——先
//   troopsEnterCity 把驻军送回城，再 destroyFacility 毁望楼，最后清 owner_city_id / owner_changed_until。
// - 收完后账号名下再无野地，重复扫描查不到，不会多收、也不会多写事件；玩家回来后新占的地要再连续
//   7 天不活跃才会被收回（已收的地不退还）。
// - 在途部队到达时地块已无主，按现有「目标已失效」路径处理，这里不另写逻辑。

import pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { insertEvent } from '../../common/src/events';
import { EventType } from '../../common/src/protocol';
import { INACTIVE_WILDERNESS_RECLAIM_MS } from '../../common/src/inactive';
import { loadTileArmy } from '../../common/src/world-db';
import { destroyFacility } from '../../common/src/facility-db';
import { troopsEnterCity } from './tick-shared';

/** 扫描节流（毫秒，真实时间）：阈值是天级，每小时扫一轮足够 */
export const INACTIVE_TICK_MS = 60 * 60 * 1000;

// 进程启动后先等一个节流周期再扫第一轮：线上刚发版时 Agent 还在重连、在线心跳要等一小时才刷 last_active_at，
// 立刻扫会把「只靠 Agent 玩」的账号当成不活跃（AISLG-236 之前登录的 Agent 没刷过 last_active_at）。
let lastRunMs = Date.now();

/** 一轮扫描的结果：收回的账号数与野地数（都按本轮真正处理过的算） */
export interface InactiveReclaimResult {
  accounts: number;
  tiles: number;
}

/** 单块待收回的野地（含驻军汇回的那座城） */
interface ReclaimTile {
  x: number;
  y: number;
  terrain: string;
  level: number;
  owner_city_id: string;
}

/**
 * 单轮入口（Worker tick 调用；进程内节流到 INACTIVE_TICK_MS）：
 * nowMs / inactiveMs 只给测试指定时间用，线上取当前时刻与 rules.ts 的 7 天阈值。
 */
export async function processInactiveTerritories(
  pool: pg.Pool,
  nowMs: number = Date.now(),
  inactiveMs: number = INACTIVE_WILDERNESS_RECLAIM_MS,
): Promise<InactiveReclaimResult> {
  if (nowMs - lastRunMs < INACTIVE_TICK_MS) {
    return { accounts: 0, tiles: 0 };
  }
  lastRunMs = nowMs;
  const cutoff = new Date(nowMs - inactiveMs);
  // 候选：不活跃且名下（任一座城）还占着野地的账号。收完就没野地了，下一轮自然查不到。
  const candidates = await pool.query(
    `SELECT DISTINCT c.account_id
       FROM cities c
       JOIN world_tiles wt ON wt.owner_city_id = c.id AND wt.kind = 'wilderness'
       JOIN accounts a ON a.id = c.account_id
      WHERE COALESCE(a.last_active_at, a.last_online_at, a.created_at) < $1
        -- 兜底：AISLG-236 之前 Agent 上线不刷 last_active_at，存量账号的该列可能偏旧；
        -- 7 天内有 Agent 上线 / 断线事件的账号一律算活跃，不收
        AND NOT EXISTS (
          SELECT 1 FROM events e
           WHERE e.account_id = a.id AND e.type IN ('agent_connected', 'agent_disconnected') AND e.created_at >= $1
        )
      ORDER BY c.account_id`,
    [cutoff],
  );
  const result: InactiveReclaimResult = { accounts: 0, tiles: 0 };
  for (const row of candidates.rows as Array<{ account_id: string }>) {
    try {
      const tiles = await reclaimAccount(pool, row.account_id, cutoff);
      if (tiles > 0) {
        result.accounts += 1;
        result.tiles += tiles;
      }
    } catch (err) {
      // 单个账号失败（如与行军结算撞锁）不影响其余账号；下一轮扫描会再次尝试
      console.error('inactive reclaim failed:', row.account_id, err instanceof Error ? err.message : err);
    }
  }
  return result;
}

/**
 * 收回一个账号名下（所有城合计）的全部野地：一个事务，事务内复核活跃时刻与地块归属，
 * 提交后按地块推 PUSH_TILE_STATE（与其它 tick 同口径：通知丢失由客户端按需查询兜底）。
 * 返回本次真正收回的地块数。
 */
async function reclaimAccount(pool: pg.Pool, accountId: string, cutoff: Date): Promise<number> {
  const client = await pool.connect();
  const notifies: Array<{ x: number; y: number }> = [];
  try {
    await client.query('BEGIN');
    const still = await client.query(
      `SELECT 1 FROM accounts a WHERE a.id = $1 AND COALESCE(a.last_active_at, a.last_online_at, a.created_at) < $2
          AND NOT EXISTS (
            SELECT 1 FROM events e
             WHERE e.account_id = a.id AND e.type IN ('agent_connected', 'agent_disconnected') AND e.created_at >= $2
          )`,
      [accountId, cutoff],
    );
    if (!still.rowCount) {
      await client.query('ROLLBACK');
      return 0;
    }
    // 锁住要收的地块（确定性顺序；与行军到达 / NPC 袭击的结算串行），并复核归属仍是该账号的城
    const tilesRes = await client.query(
      `SELECT wt.x, wt.y, wt.terrain, wt.level, wt.owner_city_id
         FROM world_tiles wt
         JOIN cities c ON c.id = wt.owner_city_id
        WHERE c.account_id = $1 AND wt.kind = 'wilderness'
        ORDER BY wt.y, wt.x
        FOR UPDATE OF wt`,
      [accountId],
    );
    for (const tile of tilesRes.rows as ReclaimTile[]) {
      await reclaimTile(client, accountId, tile);
      notifies.push({ x: tile.x, y: tile.y });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  for (const item of notifies) {
    await pool
      .query(`SELECT pg_notify($1, $2)`, [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'tile_changed', accountId, x: item.x, y: item.y, tileReason: 'wilderness_lost' }),
      ])
      .catch(() => undefined);
  }
  return notifies.length;
}

/** 单块野地的收回（调用方事务内、已锁地块）：驻军回城 → 毁望楼 → 清归属 → 失地事件 */
async function reclaimTile(client: pg.PoolClient, accountId: string, tile: ReclaimTile): Promise<void> {
  const garrison = await loadTileArmy(client, tile.x, tile.y);
  if (Object.values(garrison).some((count) => (count ?? 0) > 0)) {
    // 驻军直接回到这块地所属的城：不走行军、不损失
    await troopsEnterCity(client, tile.owner_city_id, garrison);
  }
  await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [tile.x, tile.y]);
  // 望楼毁掉，不退资源（原主人另收一条 facility_lost，cause = inactive）
  await destroyFacility(client, tile.x, tile.y, 'inactive');
  // 地块变无主：当前储量（reserve / reserve_at）原样保留，不设换主保护
  await client.query(
    `UPDATE world_tiles SET owner_city_id = NULL, owner_changed_until = NULL
     WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
    [tile.x, tile.y],
  );
  await insertEvent(client, {
    accountId,
    cityId: tile.owner_city_id,
    type: EventType.WILDERNESS_LOST,
    initiator: null,
    detail: { x: tile.x, y: tile.y, cause: 'inactive', terrain: tile.terrain, level: tile.level },
  });
}
