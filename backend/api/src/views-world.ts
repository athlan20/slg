// 世界地图与地块的视图映射及查询（v12）。handlers-world 与 notify 共用；
// 野地 / NPC 数值规则见 common/src/world.ts，本文件只做行到视图的映射。

import { campRowFromJson, ytTileCampView } from '../../common/src/yellow-turban-db';
import pg from 'pg';
import {
  TROOP_KINDS,
  type FamousTileView,
  type NpcStockTier,
  type TerrainKind,
  type TileDetailView,
  type TileKind,
  type TileOwnerView,
  type TileProtectionView,
  type TileView,
  type TroopKind,
} from '../../common/src/protocol';
import { armyPower } from '../../common/src/battle';
import { settleDurability } from '../../common/src/protection';
import { loadNativeGarrison } from '../../common/src/native-garrison';
import { FAMOUS_PRODUCTION_BONUS_PERCENT, famousRecoversAt, famousStage } from '../../common/src/famous-city';
import { loadTileArmy, type TileRow } from '../../common/src/world-db';
import {
  TERRAIN_INFO,
  npcStockTierOf,
  wildernessBonusRate,
  wildernessGatherRate,
  type NpcCitySnapshot,
} from '../../common/src/world';

/** 地图查询的联表行：占领者信息、驻军总数与请求账号的侦察快照一并取回 */
interface TileQueryRow extends TileRow {
  owner_account_id: string | null;
  owner_username: string | null;
  owner_city_name: string | null;
  garrison: number | null;
  /** 请求账号对该地块的侦察快照（scout_intel.detail 拆列）；未侦察均为 null */
  intel_garrison: Record<TroopKind, number> | null;
  intel_stock: Partial<Record<'gold' | 'wood' | 'food' | 'stone' | 'iron', number>> | null;
  intel_at: Date | null;
  /** 侦察详细度与总兵力范围（v27 AISLG-77；历史情报缺省 = exact） */
  intel_detail?: 'rough' | 'kinds' | 'exact' | null;
  intel_total?: { min: number; max: number } | null;
  /** 进行中的黄巾营地 / 老巢（v29 AISLG-76；row_to_json，日期为字符串） */
  camp_json?: Record<string, unknown> | null;
  /** 城主的账号级保护截止（v38 AISLG-122；非城池地块为 null） */
  owner_newbie_until?: Date | null;
  owner_shield_until?: Date | null;
  /** 城主的城级被动免战截止（v38 AISLG-122；非城池地块为 null） */
  owner_city_truce_until?: Date | null;
  /** 野地换主保护截止（v39 AISLG-123；非野地为 null） */
  owner_changed_until?: Date | null;
  /** 城防值原始列与结算时刻（v40 AISLG-124；主城 / 非城池为 null） */
  durability?: number | null;
  durability_settled_at?: Date | null;
  /** 城主的最早建城时刻（判定主城：created_at 相等即主城） */
  owner_created_at?: Date | null;
  owner_main_created_at?: Date | null;
}

// $1 恒为请求账号 id（NPC 城池的 garrison 掩蔽按其侦察快照判定，v17；null 匹配不到任何行）
const TILE_SELECT = `
  SELECT wt.x, wt.y, wt.terrain, wt.kind, wt.level, wt.owner_city_id, wt.npc, wt.plundered_at,
         c.account_id AS owner_account_id, a.username AS owner_username, c.name AS owner_city_name,
         c.truce_until AS owner_city_truce_until, a.newbie_until AS owner_newbie_until, a.self_truce_until AS owner_shield_until,
         wt.owner_changed_until, c.durability, c.durability_settled_at,
         c.created_at AS owner_created_at, om.first_created AS owner_main_created_at,
         COALESCE(ta.total, 0)::int AS garrison,
         si.detail->'garrison' AS intel_garrison, si.detail->'npcStock' AS intel_stock, si.scouted_at AS intel_at,
         si.detail->>'detail' AS intel_detail, si.detail->'garrisonTotal' AS intel_total,
         row_to_json(yc) AS camp_json
  FROM world_tiles wt
  LEFT JOIN cities c ON c.id = wt.owner_city_id
  LEFT JOIN accounts a ON a.id = c.account_id
  LEFT JOIN (SELECT account_id, MIN(created_at) AS first_created FROM cities GROUP BY account_id) om
    ON om.account_id = c.account_id
  LEFT JOIN (SELECT x, y, sum(count) AS total FROM tile_army GROUP BY x, y) ta
    ON ta.x = wt.x AND ta.y = wt.y
  LEFT JOIN scout_intel si ON si.account_id = $1 AND si.x = wt.x AND si.y = wt.y
  LEFT JOIN yt_camps yc ON yc.x = wt.x AND yc.y = wt.y AND yc.status = 'active'
`;

function emptyArmy(): Record<TroopKind, number> {
  const army = {} as Record<TroopKind, number>;
  for (const kind of TROOP_KINDS) {
    army[kind] = 0;
  }
  return army;
}

function isTerrain(value: unknown): value is TerrainKind {
  return typeof value === 'string' && value in TERRAIN_INFO;
}

function isTileKind(value: unknown): value is TileKind {
  return value === 'wilderness' || value === 'npc_city' || value === 'city';
}

/** 名城标识（v24 AISLG-56）：阶段按当前时刻惰性推导，对全服可见（地图悬浮提示用） */
function famousView(row: TileQueryRow): FamousTileView | null {
  const famous = row.kind === 'npc_city' ? (row.npc as NpcCitySnapshot | null)?.famous : undefined;
  if (!famous) {
    return null;
  }
  const now = new Date();
  const recoversAt = famousRecoversAt(famous, now);
  return {
    name: famous.name,
    stage: famousStage(famous, now),
    bonusPercent: FAMOUS_PRODUCTION_BONUS_PERCENT,
    recoversAt: recoversAt ? recoversAt.toISOString() : null,
  };
}

/** 玩家城与他人占领野地的保护状态视图（v38 城池 / v39 野地）：自己的地与非玩家目标返回 null */
function protectionView(row: TileQueryRow, requesterAccountId?: string): TileProtectionView | null {
  if (!row.owner_account_id || row.owner_account_id === requesterAccountId) {
    return null;
  }
  if (row.kind !== 'city' && row.kind !== 'wilderness') {
    return null;
  }
  return {
    newbieUntil: row.owner_newbie_until ? row.owner_newbie_until.toISOString() : null,
    // 城级被动免战只保护城本身，不保护野地（v39：野地的 truceUntil 恒 null）
    truceUntil: row.kind === 'city' && row.owner_city_truce_until ? row.owner_city_truce_until.toISOString() : null,
    shieldUntil: row.owner_shield_until ? row.owner_shield_until.toISOString() : null,
    // 换主保护只作用于野地（v39）
    ownerChangedUntil: row.kind === 'wilderness' && row.owner_changed_until ? row.owner_changed_until.toISOString() : null,
  };
}

/** 他人分城的当前城防值（v40，AISLG-124）：非 null 即分城（可被「占领」攻打）；
 *  主城 / 野地 / NPC 城 / 自己的城为 null。按免战后回涨惰性结算展示 */
function durabilityView(row: TileQueryRow, requesterAccountId?: string): number | null {
  if (
    row.kind !== 'city' ||
    !row.owner_account_id ||
    row.owner_account_id === requesterAccountId ||
    (row.owner_created_at ?? null) === null ||
    (row.owner_main_created_at ?? null) === null ||
    // 建城时刻 = 账号最早建城时刻 → 主城（永不被占领），无城防值
    (row.owner_created_at as Date).getTime() === (row.owner_main_created_at as Date).getTime()
  ) {
    return null;
  }
  return settleDurability(
    row.durability ?? null,
    row.durability_settled_at ?? null,
    row.owner_city_truce_until ?? null,
    new Date(),
  );
}

export function tileView(row: TileQueryRow, requesterAccountId?: string): TileView {
  // NPC 城池的驻军总数由侦察快照解锁（v17）：未侦察为 0，与 garrisonDetail / npc /
  // scoutedAt 字段一致；野地与玩家城的驻军保持实时可见（玩家对抗阶段的情报规则另行设计）
  let garrison: number;
  if (row.kind === 'npc_city') {
    const intel = row.intel_garrison;
    // v27：rough / kinds 情报的总数取范围中值（rough 的 garrison 全 0，不能直接求和）
    garrison = row.intel_total && row.intel_detail !== 'exact' && row.intel_detail !== null
      ? Math.round((row.intel_total.min + row.intel_total.max) / 2)
      : intel ? Object.values(intel).reduce((sum, count) => sum + Math.max(0, count ?? 0), 0) : 0;
  } else {
    garrison = Math.max(0, row.garrison ?? 0);
  }
  let owner: TileOwnerView | null = null;
  if (row.owner_city_id && row.owner_account_id && row.owner_username && row.owner_city_name) {
    owner = {
      accountId: row.owner_account_id,
      username: row.owner_username,
      cityId: row.owner_city_id,
      cityName: row.owner_city_name,
    };
  }
  // NPC 城池库存档位（v23 AISLG-55）：对全服可见（只给档位不给数值，精确值走侦察）
  let npcStockTier: NpcStockTier | null = null;
  if (row.kind === 'npc_city' && row.npc) {
    npcStockTier = npcStockTierOf(row.level, (row.npc as NpcCitySnapshot).stock ?? null);
  }
  return {
    x: row.x,
    y: row.y,
    terrain: isTerrain(row.terrain) ? row.terrain : 'plain',
    kind: isTileKind(row.kind) ? row.kind : 'wilderness',
    level: row.level,
    owner,
    garrison,
    npcStockTier,
    famous: famousView(row),
    camp: campOf(row),
    protection: protectionView(row, requesterAccountId),
    durability: durabilityView(row, requesterAccountId),
  };
}

/** 地块上的黄巾营地 / 老巢视图（v29 AISLG-76）；没有为 null */
function campOf(row: TileQueryRow): TileView['camp'] {
  const camp = campRowFromJson(row.camp_json ?? null);
  return camp ? ytTileCampView(camp) : null;
}

/** 窗口式地图查询（坐标已由调用方钳制；按行序返回）。accountId 用于 NPC 城驻军的侦察掩蔽 */
export async function loadWorldWindow(
  q: pg.Pool | pg.PoolClient,
  x: number,
  y: number,
  w: number,
  h: number,
  accountId?: string,
): Promise<TileView[]> {
  const res = await q.query(
    `${TILE_SELECT} WHERE wt.x >= $2 AND wt.x < $2 + $4 AND wt.y >= $3 AND wt.y < $3 + $5 ORDER BY wt.y, wt.x`,
    [accountId ?? null, x, y, w, h],
  );
  return (res.rows as TileQueryRow[]).map((row) => tileView(row, accountId ?? undefined));
}

/** 单格详情：野地收益预览 / NPC 城池驻军与库存（需侦察，v13）/ 驻军按兵种展开 */
export async function loadTileDetail(
  q: pg.Pool | pg.PoolClient,
  x: number,
  y: number,
  accountId?: string,
): Promise<TileDetailView | null> {
  const res = await q.query(`${TILE_SELECT} WHERE wt.x = $2 AND wt.y = $3`, [accountId ?? null, x, y]);
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as TileQueryRow;
  const view = tileView(row, accountId);
  const npc = row.npc as NpcCitySnapshot | null;
  const tileGarrison = row.kind === 'city' ? emptyArmy() : await loadTileArmy(q, x, y);
  const garrisonTotal = Object.values(tileGarrison).reduce((sum, count) => sum + count, 0);
  // NPC 城池详情走侦察门控（v13）：未侦察为 null；已侦察返回最近一次快照（scoutedAt 为快照时间）。
  // 野地 / 玩家城池的驻军构成与野地收益保持 v12 的实时可见（玩家对抗阶段的情报规则另行设计）
  let npcView: TileDetailView['npc'] = null;
  if (row.kind === 'npc_city' && npc && row.intel_garrison) {
    const stock = row.intel_stock ?? {};
    npcView = {
      garrison: row.intel_garrison,
      ...(row.intel_detail ? { scoutDetail: row.intel_detail } : {}),
      ...(row.intel_total ? { garrisonTotal: row.intel_total } : {}),
      stock: {
        gold: stock.gold ?? 0,
        wood: stock.wood ?? 0,
        food: stock.food ?? 0,
        stone: stock.stone ?? 0,
        iron: stock.iron ?? 0,
      },
    };
  }
  // 侦察过的地块一律给出最近一次快照时间（v23，AISLG-62：此前仅 NPC 城池返回；
  // 字段原本就有，只是把 scout_intel 的联表值对非 NPC 地块也透出，无新增字段）
  const scoutedAt = row.intel_at ? row.intel_at.toISOString() : null;
  const detail: TileDetailView = {
    ...view,
    garrisonDetail: row.kind === 'npc_city' ? (npcView ? npcView.garrison : emptyArmy()) : tileGarrison,
    nativePower:
      // 营地格（v29 AISLG-76）的守军是营地的（TileView.camp 给范围），不是野地原住守军
      row.kind === 'wilderness' && !row.owner_city_id && !row.camp_json
        ? armyPower(await loadNativeGarrison(q, row))
        : 0,
    wilderness:
      row.kind === 'wilderness' && isTerrain(row.terrain)
        ? {
            resource: TERRAIN_INFO[row.terrain].resource,
            bonusRate: wildernessBonusRate(row.terrain, row.level),
            gatherRate: row.owner_city_id
              ? wildernessGatherRate(row.terrain, row.level, garrisonTotal)
              : 0,
          }
        : null,
    npc: npcView,
    scoutedAt,
    plunderedAt: row.plundered_at ? row.plundered_at.toISOString() : null,
  };
  return detail;
}
