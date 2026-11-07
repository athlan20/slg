// 战争迷雾的地图裁剪（AISLG-224）：GET_WORLD_MAP / GET_TILE / PUSH_TILE_STATE 共用。
// 三种状态（需求第一节）：
// - 实时视野（visible）：与未开迷雾时完全一致的地块视图；
// - 已探索（explored）：显示的内容只由“上次看到的快照”决定（种类、等级、占领者、名将标记），
//   地形与名城静态信息照给；动态字段（驻军、库存 / 储量档位、保护、城防、协防、掠夺冷却、收益、
//   名城阶段与恢复时间）一律为 null 或 0。详情采用白名单：不从真实地块的视图整体展开；
// - 未探索：窗口里不返回，但黄巾营地（camp）未探索也给出最小视图（坐标 / 地形 / camp）。
// fog_enabled 关闭时本文件所有函数直接走原逻辑，不开事务、不写任何迷雾表（零影响）。
import type pg from 'pg';
import { nobilityName } from '../../common/src/nobility';
import {
  TROOP_KINDS,
  type ArmyCounts,
  type FamousTileView,
  type Resources,
  type TerrainKind,
  type TileDetailView,
  type TileKind,
  type TileOwnerView,
  type TileView,
} from '../../common/src/protocol';
import type { DefenseScoutView } from '../../common/src/protocol-defense';
import { FAMOUS_PRODUCTION_BONUS_PERCENT } from '../../common/src/famous-city';
import { famousEffectView } from '../../common/src/famous-effects';
import { TERRAIN_INFO, wildernessBonusRate } from '../../common/src/world';
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
import { applySiteViews } from './fog-site-view';
import { loadTechLevels } from '../../common/src/tech-db';
import { loadTileDetail, loadWorldWindow } from './views-world';

/** 一次迷雾请求的上下文：探索位图、实时视野来源（同一事务内取得，互相一致） */
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
  /** 能否协防（v95，AISLG-226）：同联盟或 relation 行为 friendly（不含冷却期）；自己为 false */
  canAssist: boolean;
}

export async function relationsOf(q: pg.PoolClient | pg.Pool, accountId: string, ownerIds: readonly string[]): Promise<Map<string, OwnerRelation>> {
  const out = new Map<string, OwnerRelation>();
  if (ownerIds.length === 0) {
    return out;
  }
  const res = await q.query(
    `SELECT o.id AS account_id,
            (am_me.alliance_id IS NOT NULL AND am_me.alliance_id = am_o.alliance_id AND o.id <> $1) AS ally,
            (o.id <> $1 AND ((am_me.alliance_id IS NOT NULL AND am_me.alliance_id = am_o.alliance_id) OR r.relation = 'friendly')) AS can_assist,
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
  for (const row of res.rows as Array<{ account_id: string; ally: boolean; can_assist: boolean; relation: TileOwnerView['relation'] }>) {
    out.set(row.account_id, { relation: row.relation, ally: row.ally === true, canAssist: row.can_assist === true });
  }
  return out;
}

/** 名城登记（静态）：坐标 → 名称；名城的名称、加成、效果是静态信息，探索后照给 */
async function registeredFamous(q: pg.PoolClient | pg.Pool): Promise<Map<string, string>> {
  const res = await q.query(`SELECT name, x, y FROM famous_cities`);
  return new Map((res.rows as Array<{ name: string; x: number; y: number }>).map((row) => [`${row.x},${row.y}`, row.name]));
}

/** 名城的静态视图：阶段（outer / keeper）与恢复时间是动态信息，已探索时为 null */
function famousStaticView(name: string): FamousTileView {
  return {
    name,
    stage: null,
    bonusPercent: FAMOUS_PRODUCTION_BONUS_PERCENT,
    recoversAt: null,
    effect: famousEffectView(name),
  };
}

/** 侦察快照（scout_intel）：请求账号自己的侦察记录 */
interface IntelRow {
  garrison: ArmyCounts | null;
  defenses: DefenseScoutView | null;
  npcStock: Resources | null;
  detail: 'rough' | 'kinds' | 'exact' | null;
  garrisonTotal: { min: number; max: number } | null;
  scoutedAt: Date;
}

async function loadIntel(q: pg.PoolClient | pg.Pool, accountId: string, x: number, y: number, w: number, h: number): Promise<Map<string, IntelRow>> {
  const res = await q.query(
    `SELECT x, y, scouted_at, detail->'garrison' AS garrison, detail->'defenses' AS defenses, detail->'npcStock' AS npc_stock,
            detail->>'detail' AS detail_level, detail->'garrisonTotal' AS garrison_total
     FROM scout_intel WHERE account_id = $1 AND x >= $2 AND x < $2 + $4 AND y >= $3 AND y < $3 + $5`,
    [accountId, x, y, w, h],
  );
  const out = new Map<string, IntelRow>();
  for (const row of res.rows as Array<Record<string, unknown>>) {
    out.set(`${row.x},${row.y}`, {
      garrison: (row.garrison as ArmyCounts | null) ?? null,
      defenses: (row.defenses as DefenseScoutView | null) ?? null,
      npcStock: (row.npc_stock as Resources | null) ?? null,
      detail: (row.detail_level as IntelRow['detail']) ?? null,
      garrisonTotal: (row.garrison_total as IntelRow['garrisonTotal']) ?? null,
      scoutedAt: row.scouted_at as Date,
    });
  }
  return out;
}

/** 侦察快照里 NPC 城的驻军总数（与实时视图口径一致：粗略侦察取范围中值） */
function intelGarrisonTotal(intel: IntelRow | undefined): number {
  if (!intel) {
    return 0;
  }
  if (intel.garrisonTotal && intel.detail !== null && intel.detail !== 'exact') {
    return Math.round((intel.garrisonTotal.min + intel.garrisonTotal.max) / 2);
  }
  return intel.garrison ? Object.values(intel.garrison).reduce((sum, count) => sum + Math.max(0, count ?? 0), 0) : 0;
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
    canAssist: rel?.canAssist ?? false,
  };
}

/** 地块的静态事实（显示只用这些 + 快照；真实的占领 / 等级变化不直接外露） */
export interface TileFacts {
  x: number;
  y: number;
  terrain: TerrainKind;
  /** 真实地块的种类与等级：只用于“快照缺失”时的兜底（NPC 城的种类与等级是静态的） */
  realKind: TileKind;
  realLevel: number;
  camp: TileView['camp'];
}

/** 显示的种类与等级：有快照按快照；没有快照按“NPC 城仍是 NPC 城，否则按野地（城池格等级 0 → 1）”兜底 */
function shownKindOf(facts: TileFacts, seen: SeenRow | undefined): { kind: TileKind; level: number } {
  if (seen) {
    const kind: TileKind = seen.kind === 'city' || seen.kind === 'npc_city' ? seen.kind : 'wilderness';
    return { kind, level: kind === 'city' ? Math.max(1, seen.level) : seen.level };
  }
  if (facts.realKind === 'npc_city') {
    return { kind: 'npc_city', level: facts.realLevel };
  }
  return { kind: 'wilderness', level: facts.realLevel > 0 ? facts.realLevel : 1 };
}

/**
 * 已探索地块的视图（白名单）：每个字段都显式给出，动态字段为 null / 0。
 * garrison：NPC 城仅取侦察快照的驻军总数；其余为 0。
 */
export function exploredTileView(
  facts: TileFacts,
  seen: SeenRow | undefined,
  relations: ReadonlyMap<string, OwnerRelation>,
  famousAt: ReadonlyMap<string, string>,
  intel: IntelRow | undefined,
): TileView {
  const shown = shownKindOf(facts, seen);
  const npc = shown.kind === 'npc_city';
  const famousName = npc ? famousAt.get(`${facts.x},${facts.y}`) : undefined;
  return {
    x: facts.x,
    y: facts.y,
    terrain: facts.terrain,
    kind: shown.kind,
    level: shown.level,
    owner: seen && seen.ownerAccountId ? seenOwnerView(seen, relations.get(seen.ownerAccountId)) : null,
    garrison: npc ? intelGarrisonTotal(intel) : 0,
    npcStockTier: null,
    famous: famousName ? famousStaticView(famousName) : null,
    camp: facts.camp,
    protection: null,
    durability: null,
    wildFamous: seen ? seen.wildFamous : false,
    reserve: null,
    relic: null,
    heroSite: null,
    // 望楼（v97，AISLG-232）：已探索但不在视野内时给上次看到的那座（等级走快照，不含建造进度）
    facility: seen && seen.facilityLevel > 0 ? { kind: 'watchtower', level: seen.facilityLevel } : null,
    fog: 'explored',
    seenAt: seen ? seen.seenAt.toISOString() : null,
  };
}

/** 未探索但有黄巾营地的格：最小视图（坐标、地形、camp；其余字段为空，seenAt 为 null） */
export function campOnlyTileView(facts: TileFacts): TileView {
  return {
    x: facts.x,
    y: facts.y,
    terrain: facts.terrain,
    kind: 'wilderness',
    level: 0,
    owner: null,
    garrison: 0,
    npcStockTier: null,
    famous: null,
    camp: facts.camp,
    protection: null,
    durability: null,
    wildFamous: false,
    reserve: null,
    relic: null,
    heroSite: null,
    facility: null,
    fog: 'explored',
    seenAt: null,
  };
}

function factsOf(tile: TileView): TileFacts {
  return { x: tile.x, y: tile.y, terrain: tile.terrain, realKind: tile.kind, realLevel: tile.level, camp: tile.camp };
}

/**
 * 城池格“实时可见”的关系口径（AISLG-226，全部地方共用）：占领者与请求账号的 relation 为 ally（同盟）或 friendly（友盟，
 * 含解除友好后的 24 小时冷却）。只这一格，不带半径；敌对（含敌对冷却）不算。
 */
export function isFriendlyRelation(relation: string | null | undefined): boolean {
  return relation === 'ally' || relation === 'friendly';
}

/** 实时视野判定：视野来源覆盖，或友盟 / 同盟的城池格（只这一格，不带半径） */
export function isLiveTile(req: FogRequest, tile: { x: number; y: number; kind: string; owner: TileOwnerView | null }): boolean {
  if (!req.enabled) {
    return true;
  }
  if (tile.kind === 'city' && isFriendlyRelation(tile.owner?.relation)) {
    return true;
  }
  return inAnyVision(req.sources, tile.x, tile.y);
}

/** GET_WORLD_MAP / PUSH_TILE_STATE 的地块窗口：实时视野原样；已探索改写；未探索剔除（黄巾营地除外）；实时部分刷新快照 */
export async function loadFogWindow(
  pool: pg.Pool,
  accountId: string,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<TileView[]> {
  if (!getFogEnabled()) {
    // 关闭：原样返回，不开事务、不写快照（零影响）
    return loadWorldWindow(pool, x, y, w, h, accountId);
  }
  return withFogRequest(pool, accountId, async (req) => {
    const tiles = await loadWorldWindow(req.client, x, y, w, h, accountId);
    const seen = await loadSeenWindow(req.client, accountId, x, y, w, h);
    const intel = await loadIntel(req.client, accountId, x, y, w, h);
    const relations = await relationsOf(
      req.client,
      accountId,
      [...seen.values()].map((row) => row.ownerAccountId).filter((id): id is string => id !== null),
    );
    const famousAt = await registeredFamous(req.client);
    const live: Coord[] = [];
    const out: TileView[] = [];
    for (const tile of tiles) {
      const key = `${tile.x},${tile.y}`;
      if (isLiveTile(req, tile)) {
        live.push({ x: tile.x, y: tile.y });
        out.push(tile);
        continue;
      }
      if (!isCellExplored(req.bits, tile.x, tile.y)) {
        if (tile.camp) {
          out.push(campOnlyTileView(factsOf(tile)));
        }
        continue;
      }
      out.push(exploredTileView(factsOf(tile), seen.get(key), relations, famousAt, intel.get(key)));
    }
    await syncSeenTiles(req.client, accountId, live, req.now);
    await applySiteViews(req, out, x, y, w, h);
    return out;
  });
}

export type FogDetailResult =
  | { kind: 'ok'; detail: TileDetailView }
  | { kind: 'unexplored' }
  | { kind: 'missing' };

/** 地块详情的白名单：只带显式列出的字段，其余动态信息一律空 */
function exploredDetail(
  shown: TileView,
  terrain: TerrainKind,
  intel: IntelRow | undefined,
  seen: SeenRow | undefined,
  realWild: TileDetailView['wildFamousIntel'],
): TileDetailView {
  const emptyArmy = Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0])) as ArmyCounts;
  const emptyStock: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  const npc = shown.kind === 'npc_city';
  let wildFamousIntel: TileDetailView['wildFamousIntel'] = null;
  if (seen?.wildFamous) {
    wildFamousIntel = intel
      ? realWild?.scouted && realWild.name
        ? { scouted: true, name: realWild.name, attrs: realWild.attrs }
        : { scouted: true, name: null, attrs: null }
      : { scouted: false, name: null, attrs: null };
  }
  return {
    ...shown,
    garrisonDetail: intel?.garrison ?? emptyArmy,
    nativePower: 0,
    wilderness:
      shown.kind === 'wilderness'
        ? { resource: TERRAIN_INFO[terrain].resource, bonusRate: wildernessBonusRate(terrain, shown.level), gatherRate: 0 }
        : null,
    npc:
      npc && intel
        ? {
            garrison: intel.garrison ?? emptyArmy,
            stock: intel.npcStock ?? emptyStock,
            ...(intel.detail ? { scoutDetail: intel.detail } : {}),
            ...(intel.garrisonTotal ? { garrisonTotal: intel.garrisonTotal } : {}),
          }
        : null,
    scoutedAt: intel ? intel.scoutedAt.toISOString() : null,
    defenses: shown.kind === 'city' ? (intel?.defenses ?? null) : null,
    assists: null,
    // 建造 / 升级进度是实时信息，已探索的格不给（v97，AISLG-232）
    facilityBuilding: null,
    plunderedAt: null,
    wildFamousIntel,
  };
}

/** 详情补遗迹 / 处所 / 名城首探者（开关开启时才会走到这里） */
async function withSites(req: FogRequest, x: number, y: number, detail: TileDetailView): Promise<TileDetailView> {
  const holder = [detail];
  await applySiteViews(req, holder, x, y, 1, 1);
  return holder[0];
}

/** GET_TILE：关闭时原样；实时视野原样；已探索用白名单；未探索（无黄巾营地）返回 unexplored */
export async function loadFogTileDetail(pool: pg.Pool, accountId: string, x: number, y: number): Promise<FogDetailResult> {
  if (!getFogEnabled()) {
    const detail = await loadTileDetail(pool, x, y, accountId);
    return detail ? { kind: 'ok', detail } : { kind: 'missing' };
  }
  return withFogRequest(pool, accountId, async (req): Promise<FogDetailResult> => {
    const detail = await loadTileDetail(req.client, x, y, accountId);
    if (!detail) {
      // 没有地块行：未探索的坐标一律按未探索报（不区分是否真有这一格，免得探出格子存在与否）
      return isCellExplored(req.bits, x, y) || inAnyVision(req.sources, x, y) ? { kind: 'missing' } : { kind: 'unexplored' };
    }
    if (isLiveTile(req, detail)) {
      await syncSeenTiles(req.client, accountId, [{ x, y }], req.now);
      return { kind: 'ok', detail: await withSites(req, x, y, detail) };
    }
    const facts = factsOf(detail);
    if (!isCellExplored(req.bits, x, y)) {
      if (detail.camp) {
        const base = campOnlyTileView(facts);
        return {
          kind: 'ok',
          detail: await withSites(req, x, y, {
            ...base,
            garrisonDetail: Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0])) as ArmyCounts,
            nativePower: 0,
            wilderness: null,
            npc: null,
            scoutedAt: null,
            defenses: null,
            assists: null,
            facilityBuilding: null,
            plunderedAt: null,
            wildFamousIntel: null,
          }),
        };
      }
      return { kind: 'unexplored' };
    }
    const seen = (await loadSeenWindow(req.client, accountId, x, y, 1, 1)).get(`${x},${y}`);
    const relations = await relationsOf(req.client, accountId, seen?.ownerAccountId ? [seen.ownerAccountId] : []);
    const famousAt = await registeredFamous(req.client);
    const intel = (await loadIntel(req.client, accountId, x, y, 1, 1)).get(`${x},${y}`);
    const shown = exploredTileView(facts, seen, relations, famousAt, intel);
    return {
      kind: 'ok',
      detail: await withSites(req, x, y, exploredDetail(shown, facts.terrain, intel, seen, detail.wildFamousIntel)),
    };
  });
}
