// 未占领野地原住守军的「当前存量」（v24，AISLG-48 第二步）：
// 满编 = nativeGarrison(level, 坐标)（基准 × 地块固定浮动）；被打残后不再每次回满，
// 而是把战后幸存守军落在 native_garrison_state，之后按「每小时恢复基准的 25%」惰性回补
// （随全局时间倍速缩放）——无后台任务，读取时按流逝时间现算，回满即视为无状态。
// API（地块详情战力展示）与 Worker（出征战斗、侦察）共用，两侧不得各自另算。

import type pg from 'pg';
import { TROOP_KINDS, type TroopKind } from './protocol';
import { NATIVE_RECOVERY_PER_HOUR, nativeGarrison } from './battle';
import { getTimeScale } from './time-scale';

export type TroopCounts = Partial<Record<TroopKind, number>>;

const HOUR_MS = 60 * 60 * 1000;

/**
 * 纯函数：在满编 full 上叠加战后存量 remaining，经 elapsedMs 恢复后的当前守军。
 * 每兵种恢复量 = floor(满编 × 25% × 流逝小时 × 时间倍速)，上限满编；remaining 缺省视为 0。
 */
export function recoveredGarrison(full: TroopCounts, remaining: TroopCounts, elapsedMs: number, scale = getTimeScale()): TroopCounts {
  const hours = Math.max(0, elapsedMs) / HOUR_MS;
  const current: TroopCounts = {};
  for (const kind of TROOP_KINDS) {
    const max = full[kind] ?? 0;
    if (max <= 0) {
      continue;
    }
    const regained = Math.floor(max * NATIVE_RECOVERY_PER_HOUR * hours * scale);
    const count = Math.min(max, Math.max(0, Math.floor(remaining[kind] ?? 0)) + regained);
    if (count > 0) {
      current[kind] = count;
    }
  }
  return current;
}

export interface NativeStateRow {
  remaining: TroopCounts | null;
  updatedAt: Date | null;
}

/** 当前原住守军：无状态 = 满编；有状态 = 按流逝时间恢复（now 缺省取本机时间） */
export function currentNativeGarrison(
  level: number,
  at: { x: number; y: number },
  state: NativeStateRow,
  now: Date = new Date(),
): TroopCounts {
  const full = nativeGarrison(level, at);
  if (!state.remaining || !state.updatedAt) {
    return full;
  }
  return recoveredGarrison(full, state.remaining, now.getTime() - state.updatedAt.getTime());
}

/** 读某地块的原住守军当前存量（Worker 战斗 / 侦察用；调用方已持有目标地块行锁） */
export async function loadNativeGarrison(
  client: pg.PoolClient | pg.Pool,
  tile: { x: number; y: number; level: number },
): Promise<TroopCounts> {
  const res = await client.query(
    `SELECT remaining, now() AS now, updated_at FROM native_garrison_state WHERE x = $1 AND y = $2`,
    [tile.x, tile.y],
  );
  if (res.rowCount === 0) {
    return nativeGarrison(tile.level, tile);
  }
  const row = res.rows[0] as { remaining: TroopCounts; now: Date; updated_at: Date };
  return currentNativeGarrison(tile.level, tile, { remaining: row.remaining, updatedAt: row.updated_at }, row.now);
}

/**
 * 战后落库幸存守军（含全灭）。幸存已等于满编时不留状态；占领 / 玩家驻军接管时用
 * clearNativeGarrison 清掉——失守回到野地后重新满编。
 */
export async function saveNativeGarrison(
  client: pg.PoolClient,
  tile: { x: number; y: number; level: number },
  survivors: TroopCounts,
): Promise<void> {
  const full = nativeGarrison(tile.level, tile);
  const intact = TROOP_KINDS.every((kind) => (survivors[kind] ?? 0) >= (full[kind] ?? 0));
  if (intact) {
    await clearNativeGarrison(client, tile);
    return;
  }
  const remaining: TroopCounts = {};
  for (const kind of TROOP_KINDS) {
    if ((survivors[kind] ?? 0) > 0) {
      remaining[kind] = Math.floor(survivors[kind] ?? 0);
    }
  }
  await client.query(
    `INSERT INTO native_garrison_state (x, y, remaining, updated_at) VALUES ($1, $2, $3::jsonb, now())
     ON CONFLICT (x, y) DO UPDATE SET remaining = EXCLUDED.remaining, updated_at = EXCLUDED.updated_at`,
    [tile.x, tile.y, JSON.stringify(remaining)],
  );
}

export async function clearNativeGarrison(client: pg.PoolClient, tile: { x: number; y: number }): Promise<void> {
  await client.query(`DELETE FROM native_garrison_state WHERE x = $1 AND y = $2`, [tile.x, tile.y]);
}
