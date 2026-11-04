// 战争迷雾的地图裁剪（AISLG-224 第三步）：GET_WORLD_MAP / GET_TILE / PUSH_TILE_STATE 共用。
// 三种状态（需求第一节）：
// - 实时视野（visible）：与未开迷雾时完全一致的地块视图；
// - 已探索（explored）：只给地形、野地 / NPC 城等级、上次看到的占领者与名将标记（带 seenAt），
//   动态字段（驻军、库存 / 储量档位、保护、城防、协防、掠夺冷却、收益）为 null 或 0；
// - 未探索：窗口里不返回（GET_TILE 报 TILE_UNEXPLORED）。
// fog_enabled 关闭时不裁剪，所有地块返回 fog = 'visible'，但仍照常记录探索与上次看到的快照。
import type pg from 'pg';
import { nobilityName } from '../../common/src/nobility';
import { TROOP_KINDS, type ArmyCounts, type TileDetailView, type TileOwnerView, type TileView } from '../../common/src/protocol';
import type { DefenseScoutView } from '../../common/src/protocol-defense';
import { getFogEnabled } from '../../common/src/fog-config';
import {
  ensureFogState,
  loadSeenWindow,
  marchVisionSources,
  ownVisionSources,
  syncSeenTiles,
  type Coord,
  type SeenRow,
} from '../../common/src/fog-db';
import { inAnyVision, isCellExplored, type VisionSource } from '../../common/src/fog';
import { loadTechLevels } from '../../common/src/tech-db';
import { loadTileDetail, loadWorldWindow } from './views-world';

/** 一次迷雾请求的上下文：探索位图、实时视野来源与开关（同一事务内取得，互相一致） */
export interface FogRequest {
  client: pg.PoolClient;
  accountId: string;
  bits: Uint8Array;
  sources: VisionSource[];
  enabled: boolean;
  now: Date;
}

/** 在一个事务内维护探索状态并取得视野来源（锁行，同账号的请求串行） */
export async function withFogRequest<T>(
  pool: pg.Pool,
  accountId: string,
  fn: (req: FogRequest) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const now = new Date();
    const state = await ensureFogState(client, accountId, now);
    const enabled = getFogEnabled();
    let sources: VisionSource[] = [];
    if (enabled) {
      const scouting = (await loadTechLevels(client, accountId)).scouting ?? 0;
      sources = [
        ...(await ownVisionSources(client, accountId)),
        ...(await marchVisionSources(client, accountId, now, scouting)),
      ];
    }
    const out = await fn({ client, accountId, bits: state.bits, sources, enabled, now });
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 请求账号对某个占领者的关系（与 TILE_SELECT 的 CASE 同口径；盟友 = 同一联盟） */
export interface OwnerRelation {
  relation: TileOwnerView['relation'];
  ally: boolean;
}

export async function relationsOf(q: pg.PoolClient | pg.Pool, accountId: string, ownerIds: readonly string[]): Promise<Map<string, OwnerRelation>> {
  const out = new Map<string, OwnerRelation>();
  if (ownerIds.length === 0) {
    return out;
  }
  const res = await q.query(
    `SELECT o.id AS account_id,
            (am_me.alliance_id IS NOT NULL AND am_me.alliance_id = am_o.alliance_id AND o.id <> $1) AS ally,
            CASE
              WHEN o.id = $1 THEN 'self'
              WHEN am_me.alliance_id IS NOT NULL AND am_me.alliance_id = am_o.alliance_id THEN 'ally'
              WHEN r.relation = 'friendly' THEN 'friendly'
              WHEN r.relation = 'hostile' THEN 'hostile'
              WHEN r.relation = 'neutral' AND r.no_attack_until > now() THEN 'friendly'
              ELSE 'neutral'
            END AS relation
     FROM unnest($2::uuid[]) AS o(id)
     LEFT JOIN alliance_members am_me ON am_me.account_id = $1
     LEFT JOIN alliance_members am_o ON am_o.account_id = o.id
     LEFT JOIN alliance_relations r ON r.a_id = LEAST(am_me.alliance_id, am_o.alliance_id)
       AND r.b_id = GREATEST(am_me.alliance_id, am_o.alliance_id)`,
    [accountId, [...new Set(ownerIds)]],
  );
  for (const row of res.rows as Array<{ account_id: string; ally: boolean; relation: TileOwnerView['relation'] }>) {
    out.set(row.account_id, { relation: row.relation, ally: row.ally === true });
  }
  return out;
}

/** 上次看到的占领者视图：等级 / 爵位不在快照里，已探索时给 0（动态字段） */
function seenOwnerView(seen: SeenRow, rel: OwnerRelation | undefined): TileOwnerView | null {
  if (!seen.ownerCityId || !seen.ownerAccountId || !seen.ownerUsername || !seen.ownerCityName) {
    return null;
  }
  return {
    accountId: seen.ownerAccountId,
    username: seen.ownerUsername,
    cityId: seen.ownerCityId,
    cityName: seen.ownerCityName,
    nobility: 0,
    nobilityName: nobilityName(0),
    ally: rel?.ally ?? false,
    relation: rel?.relation ?? 'neutral',
  };
}

/**
 * 已探索地块的视图：种类 / 等级 / 占领者取上次看到的快照；没有快照时按野地显示（城池格等级显示 1）。
 * NPC 城的名称与效果是静态信息照给；驻军只保留 NPC 城的侦察快照（garrison 本就来自快照）。
 */
export function exploredTileView(
  tile: TileView,
  seen: SeenRow | undefined,
  relations: ReadonlyMap<string, OwnerRelation>,
): TileView {
  let kind: TileView['kind'];
  let level: number;
  let owner: TileOwnerView | null = null;
  if (seen) {
    kind = seen.kind === 'city' || seen.kind === 'npc_city' ? (seen.kind as TileView['kind']) : 'wilderness';
    level = kind === 'city' ? Math.max(1, seen.level) : seen.level;
    owner = seenOwnerView(seen, seen.ownerAccountId ? relations.get(seen.ownerAccountId) : undefined);
  } else if (tile.kind === 'npc_city') {
    kind = 'npc_city';
    level = tile.level;
  } else {
    kind = 'wilderness';
    level = tile.level > 0 ? tile.level : 1;
  }
  const npc = kind === 'npc_city';
  return {
    x: tile.x,
    y: tile.y,
    terrain: tile.terrain,
    kind,
    level,
    owner,
    garrison: npc ? tile.garrison : 0,
    npcStockTier: null,
    famous: npc ? tile.famous : null,
    camp: tile.camp,
    protection: null,
    durability: null,
    wildFamous: seen ? seen.wildFamous : false,
    reserve: null,
    fog: 'explored',
    seenAt: seen ? seen.seenAt.toISOString() : null,
  };
}

/** 实时视野判定：视野来源覆盖，或盟友的城池格（只这一格，不带半径） */
export function isLiveTile(req: FogRequest, tile: { x: number; y: number; kind: string; owner: TileOwnerView | null }): boolean {
  if (!req.enabled) {
    return true;
  }
  if (tile.kind === 'city' && tile.owner?.ally === true) {
    return true;
  }
  return inAnyVision(req.sources, tile.x, tile.y);
}

/** GET_WORLD_MAP / PUSH_TILE_STATE 的地块窗口：实时视野原样，已探索改写，未探索剔除，实时部分刷新快照 */
export async function loadFogWindow(
  pool: pg.Pool,
  accountId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<TileView[]> {
  return withFogRequest(pool, accountId, async (req) => {
    const tiles = await loadWorldWindow(req.client, x, y, w, h, accountId);
    const live: Coord[] = [];
    if (!req.enabled) {
      for (const tile of tiles) {
        live.push({ x: tile.x, y: tile.y });
      }
      await syncSeenTiles(req.client, accountId, live, req.now);
      return tiles;
    }
    const seen = await loadSeenWindow(req.client, accountId, x, y, w, h);
    const relations = await relationsOf(
      req.client,
      accountId,
      [...seen.values()].map((row) => row.ownerAccountId).filter((id): id is string => id !== null),
    );
    const out: TileView[] = [];
    for (const tile of tiles) {
      if (isLiveTile(req, tile)) {
        live.push({ x: tile.x, y: tile.y });
        out.push(tile);
        continue;
      }
      if (!isCellExplored(req.bits, tile.x, tile.y)) {
        continue;
      }
      out.push(exploredTileView(tile, seen.get(`${tile.x},${tile.y}`), relations));
    }
    await syncSeenTiles(req.client, accountId, live, req.now);
    return out;
  });
}

export type FogDetailResult =
  | { kind: 'ok'; detail: TileDetailView }
  | { kind: 'unexplored' }
  | { kind: 'missing' };

/** GET_TILE：实时视野原样；已探索只给快照可见的内容（动态字段清空，侦察快照的 NPC 驻军 / 扫描时间照旧）；未探索返回 unexplored */
export async function loadFogTileDetail(pool: pg.Pool, accountId: string, x: number, y: number): Promise<FogDetailResult> {
  return withFogRequest(pool, accountId, async (req): Promise<FogDetailResult> => {
    const detail = await loadTileDetail(req.client, x, y, accountId);
    if (!detail) {
      // 没有地块行：未探索的坐标一律按未探索报（不区分是否真有这一格，免得探出格子存在与否）
      return isCellExplored(req.bits, x, y) || inAnyVision(req.sources, x, y) ? { kind: 'missing' } : { kind: 'unexplored' };
    }
    if (isLiveTile(req, detail)) {
      await syncSeenTiles(req.client, accountId, [{ x, y }], req.now);
      return { kind: 'ok', detail };
    }
    if (!isCellExplored(req.bits, x, y)) {
      return { kind: 'unexplored' };
    }
    const seen = (await loadSeenWindow(req.client, accountId, x, y, 1, 1)).get(`${x},${y}`);
    const relations = await relationsOf(req.client, accountId, seen?.ownerAccountId ? [seen.ownerAccountId] : []);
    const base = exploredTileView(detail, seen, relations);
    const emptyArmy = Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0])) as ArmyCounts;
    // 侦察快照照旧可看（需求第三节）：驻军与城防只取账号自己的侦察快照，不取实时数值
    const intelRes = await req.client.query(`SELECT detail FROM scout_intel WHERE account_id = $1 AND x = $2 AND y = $3`, [accountId, x, y]);
    const intel = (intelRes.rows[0]?.detail ?? null) as { garrison?: ArmyCounts; defenses?: DefenseScoutView | null } | null;
    return {
      kind: 'ok',
      detail: {
        ...detail,
        ...base,
        garrisonDetail: detail.kind === 'npc_city' ? detail.garrisonDetail : (intel?.garrison ?? emptyArmy),
        nativePower: 0,
        wilderness: detail.wilderness ? { ...detail.wilderness, gatherRate: 0 } : null,
        defenses: intel?.defenses ?? null,
        assists: null,
        plunderedAt: null,
        wildFamousIntel: seen?.wildFamous ? detail.wildFamousIntel : null,
      },
    };
  });
}
