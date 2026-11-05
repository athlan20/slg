// 小地图总览的迷雾裁剪（AISLG-224 第四步）：只在 fog_enabled 开启时调用，关闭时 map-overview.ts 原样输出。
// 显示规则（需求第四节）：
// - 实时视野内的城（含自己、盟友）按现有归属着色；
// - 战力榜前 20 名的主城始终显示一个点（分城不公开）；
// - 已探索的城按上次看到的归属显示（NPC 城照给）；未探索的城不显示；
// - 8 座名城未探索时在锚点上显示 famous_rumor（锚点不是真实坐标），探索后显示真实位置与归属。
import { FAMOUS_CITY_NAMES, famousAnchors } from '../../common/src/famous-city';
import { WORLD_SIZE } from '../../common/src/world';
import type { MapOverviewSide } from '../../common/src/protocol';
import { exploredPercentOf, inAnyVision, isCellExplored, FOG_POWER_TOP_N } from '../../common/src/fog';
import { loadSeenWindow } from '../../common/src/fog-db';
import type { FogRequest } from './fog-view';
import { relationsOf } from './fog-view';

/** 小地图查询的一行（map-overview.ts 的 SQL 输出） */
export interface OverviewRow {
  x: number;
  y: number;
  kind: string;
  famous: boolean;
  owner_city_id: string | null;
  owner_account_id: string | null;
  owner_is_ally: boolean;
  owner_relation: string | null;
}

export interface FogOverview {
  cities: Array<[number, number, MapOverviewSide]>;
  exploredChunks: string;
  exploredPercent: number;
}

/** 战力榜前 N 名的主城（最新一份榜单快照；分城不算） */
async function powerTopCityIds(req: FogRequest): Promise<Set<string>> {
  const res = await req.client.query(
    `SELECT c.id FROM leaderboard_snapshots s
     JOIN cities c ON c.account_id = s.account_id
     WHERE s.kind = 'power' AND s.rank <= $1
       AND s.computed_at = (SELECT max(computed_at) FROM leaderboard_snapshots WHERE kind = 'power')
       AND c.created_at = (SELECT min(c2.created_at) FROM cities c2 WHERE c2.account_id = c.account_id)`,
    [FOG_POWER_TOP_N],
  );
  return new Set((res.rows as Array<{ id: string }>).map((row) => row.id));
}

/** 实时 / 公开归属的 side（与未开迷雾时 overviewSide 同口径） */
function liveSide(row: OverviewRow, accountId: string): MapOverviewSide | null {
  if (row.kind === 'city') {
    if (!row.owner_account_id) {
      return null;
    }
    if (row.owner_account_id === accountId) {
      return 'own';
    }
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

const RELATION_SIDE: Record<string, MapOverviewSide> = {
  self: 'own',
  ally: 'ally',
  friendly: 'friendly',
  hostile: 'hostile',
  neutral: 'enemy',
};

export async function fogOverview(req: FogRequest, rows: readonly OverviewRow[]): Promise<FogOverview> {
  const seen = await loadSeenWindow(req.client, req.accountId, 0, 0, WORLD_SIZE, WORLD_SIZE);
  const seenOwners = [...seen.values()]
    .filter((row) => row.kind === 'city' && row.ownerAccountId !== null)
    .map((row) => row.ownerAccountId as string);
  const relations = await relationsOf(req.client, req.accountId, seenOwners);
  const hqCityIds = await powerTopCityIds(req);
  const famousRegistered = new Set<string>();
  const registered = await req.client.query(`SELECT x, y FROM famous_cities`);
  for (const famous of registered.rows as Array<{ x: number; y: number }>) {
    famousRegistered.add(`${famous.x},${famous.y}`);
  }
  const live = (x: number, y: number, row?: OverviewRow): boolean =>
    inAnyVision(req.sources, x, y) || (row !== undefined && row.kind === 'city' && row.owner_is_ally === true);
  const points: Array<[number, number, MapOverviewSide]> = [];
  const emitted = new Set<string>();
  // 1. 实时视野内的城、战力榜前 20 的主城：按当前状态（它们始终可见）
  for (const row of rows) {
    if (live(row.x, row.y, row) || (row.owner_city_id !== null && hqCityIds.has(row.owner_city_id))) {
      const side = liveSide(row, req.accountId);
      if (side) {
        points.push([row.x, row.y, side]);
        emitted.add(`${row.x},${row.y}`);
      }
    }
  }
  // 2. 其余已探索的城：以上次看到的快照为准（迁走、易主、变成城池都不外露，直到再次进入视野）
  for (const snapshot of seen.values()) {
    const key = `${snapshot.x},${snapshot.y}`;
    if (emitted.has(key) || live(snapshot.x, snapshot.y)) {
      continue;
    }
    if (snapshot.kind === 'npc_city') {
      points.push([snapshot.x, snapshot.y, famousRegistered.has(key) ? 'famous' : 'npc']);
    } else if (snapshot.kind === 'city' && snapshot.ownerAccountId) {
      const rel = relations.get(snapshot.ownerAccountId);
      points.push([snapshot.x, snapshot.y, RELATION_SIDE[rel?.relation ?? 'neutral'] ?? 'enemy']);
    }
  }
  // 3. 名城锚点：未探索（真实位置不知道）时显示大致方位；探索后由第 2 步的快照显示真实位置
  const anchors = famousAnchors(WORLD_SIZE);
  const names = await req.client.query(`SELECT name, x, y FROM famous_cities`);
  for (const famous of names.rows as Array<{ name: string; x: number; y: number }>) {
    const index = (FAMOUS_CITY_NAMES as readonly string[]).indexOf(famous.name);
    const anchor = index >= 0 ? anchors[index] : undefined;
    if (!anchor) {
      continue;
    }
    if (!isCellExplored(req.bits, famous.x, famous.y) && !live(famous.x, famous.y)) {
      points.push([anchor.x, anchor.y, 'famous_rumor']);
    }
  }
  points.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  return {
    cities: points,
    exploredChunks: Buffer.from(req.bits).toString('base64'),
    exploredPercent: exploredPercentOf(req.bits),
  };
}
