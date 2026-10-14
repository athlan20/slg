// 世界小地图总览（v58，AISLG-160）：GET_MAP_OVERVIEW 返回全图城池点位 [x, y, side]，不含野地。
// 城池约万级（NPC 城为主），一次全量返回；归属按请求账号区分本方 / 他方。地图数据本就全服公开，
// 不做侦察门控；名城只标「未被占领」的那几座（被占领后归属按玩家城池口径）。

import type { MapOverviewSide } from '../../common/src/protocol';
import { WORLD_SIZE } from '../../common/src/world';
import { respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

interface OverviewRow {
  x: number;
  y: number;
  kind: string;
  famous: boolean;
  owner_account_id: string | null;
}

export async function handleGetMapOverview(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  // 条件与 world_tiles 的局部索引（idx_world_tiles_city_kind）保持一致，避免扫描百万野地格
  const res = await ctx.pool.query(
    `SELECT wt.x, wt.y, wt.kind, (wt.npc -> 'famous') IS NOT NULL AS famous, c.account_id AS owner_account_id
     FROM world_tiles wt
     LEFT JOIN cities c ON c.id = wt.owner_city_id
     WHERE wt.kind <> 'wilderness'
     ORDER BY wt.y, wt.x`,
  );
  const accountId = (conn.accountId as string | null) ?? null;
  const cities: Array<[number, number, MapOverviewSide]> = [];
  for (const row of res.rows as OverviewRow[]) {
    const side = overviewSide(row, accountId);
    if (side) {
      cities.push([row.x, row.y, side]);
    }
  }
  respondOk(ctx.registry, conn, op, seq, { size: WORLD_SIZE, at: new Date().toISOString(), cities });
}

/** 点位归属：玩家城池按城主区分本方 / 他方；NPC 城池区分普通与未被占领的名城 */
function overviewSide(row: OverviewRow, accountId: string | null): MapOverviewSide | null {
  if (row.kind === 'city') {
    if (!row.owner_account_id) {
      return null;
    }
    return row.owner_account_id === accountId ? 'own' : 'enemy';
  }
  if (row.kind === 'npc_city') {
    return row.famous ? 'famous' : 'npc';
  }
  return null;
}
