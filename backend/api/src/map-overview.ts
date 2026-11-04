// 世界小地图总览（v58，AISLG-160）：GET_MAP_OVERVIEW 返回全图城池点位 [x, y, side]，不含野地。
// 城池约万级（NPC 城为主），一次全量返回；归属按请求账号区分本方 / 他方。地图数据本就全服公开，
// 不做侦察门控；名城只标「未被占领」的那几座（被占领后归属按玩家城池口径）。

import type { MapOverviewSide } from '../../common/src/protocol';
import { getFogEnabled } from '../../common/src/fog-config';
import { withFogRequest } from './fog-view';
import { fogOverview, type OverviewRow } from './fog-overview';
import { WORLD_SIZE } from '../../common/src/world';
import { respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

export async function handleGetMapOverview(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = (conn.accountId as string | null) ?? null;
  // 条件与 world_tiles 的局部索引（idx_world_tiles_city_kind）保持一致，避免扫描百万野地格
  const res = await ctx.pool.query(
    `SELECT wt.x, wt.y, wt.kind, (wt.npc -> 'famous') IS NOT NULL AS famous, wt.owner_city_id, c.account_id AS owner_account_id,
            (am_me.alliance_id IS NOT NULL AND am_me.alliance_id = am_o.alliance_id AND c.account_id <> $1) AS owner_is_ally,
            CASE
              WHEN c.account_id = $1 THEN 'own'
              WHEN am_me.alliance_id IS NOT NULL AND am_me.alliance_id = am_o.alliance_id THEN 'ally'
              WHEN r.relation = 'friendly' THEN 'friendly'
              WHEN r.relation = 'hostile' THEN 'hostile'
              WHEN r.relation = 'neutral' AND r.no_attack_until > now() THEN 'friendly'
              ELSE 'enemy'
            END AS owner_relation
     FROM world_tiles wt
     LEFT JOIN cities c ON c.id = wt.owner_city_id
     LEFT JOIN alliance_members am_me ON am_me.account_id = $1
     LEFT JOIN alliance_members am_o ON am_o.account_id = c.account_id
     LEFT JOIN alliance_relations r ON r.a_id = LEAST(am_me.alliance_id, am_o.alliance_id)
       AND r.b_id = GREATEST(am_me.alliance_id, am_o.alliance_id)
     WHERE wt.kind <> 'wilderness'
     ORDER BY wt.y, wt.x`,
    [accountId],
  );
  const rows = res.rows as OverviewRow[];
  // v92（AISLG-224）：开启战争迷雾时按探索状态裁剪（同时维护探索位图）；关闭时与原来完全一致
  if (accountId !== null && getFogEnabled()) {
    const fog = await withFogRequest(ctx.pool, accountId, (req) =>
      req.enabled ? fogOverview(req, rows) : Promise.resolve(null),
    );
    if (fog) {
      respondOk(ctx.registry, conn, op, seq, {
        size: WORLD_SIZE,
        at: new Date().toISOString(),
        cities: fog.cities,
        exploredChunks: fog.exploredChunks,
        exploredPercent: fog.exploredPercent,
      });
      return;
    }
  }
  const cities: Array<[number, number, MapOverviewSide]> = [];
  for (const row of rows) {
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
    if (row.owner_account_id === accountId) {
      return 'own';
    }
    // v67（AISLG-182）：盟友（同一联盟）城池单独一类；v77（AISLG-195）再加友盟 / 敌对
    if (row.owner_relation === 'ally' || row.owner_relation === 'friendly' || row.owner_relation === 'hostile') {
      return row.owner_relation;
    }
    return row.owner_is_ally ? 'ally' : 'enemy';
  }
  if (row.kind === 'npc_city') {
    return row.famous ? 'famous' : 'npc';
  }
  return null;
}
