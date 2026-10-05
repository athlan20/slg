// 世界地图、野地与 NPC 城池的规则与数据引导（v12 起；v16 新增掠夺奖励池；
// v19 数值校准 AISLG-17/18/20：地形加成 ×10、驻军采集 ×10、掠夺池 ×6、新增金矿地形）。
// API（地图查询 / 出征 / 召回）与 Worker（行军结算 / NPC 袭击）共用，两侧不得各自实现一套数值。
// 校准后仍为占位的数值：野地等级分布、NPC 城池存量与驻防、行军速度。调整入口只在本文件。

import type { FamousCityState } from './famous-city';
import {
  RESOURCE_KEYS,
  TERRAIN_KINDS,
  TILE_KINDS,
  TROOP_KINDS,
  type BuildingKind,
  type Resources,
  type TerrainKind,
  type TerrainResource,
  type TileKind,
  type TroopKind,
} from './protocol';
import { TROOP_STATS } from './battle';
import { getTimeScale } from './time-scale';
import type { ProducedResource } from './production';

// ---- 世界规模与地形（占位决策） ----

/** 世界边长（世界为 size×size 的方格；占位决策，2026-09-27 由 40 扩到 1000 并改为分散落位） */
export const WORLD_SIZE = 1000;
/** 生成种子：固定值保证可复现（数据库是权威状态，种子只影响首次生成） */
export const WORLD_SEED = 20260927;
/** 地图窗口请求的单边上限（占位决策：单次最多 20×20 格） */
export const MAX_MAP_WINDOW = 20;
/** 地图窗口缺省边长（以主城为中心；10×10 一屏，占位决策） */
export const DEFAULT_MAP_WINDOW = 10;

export interface TerrainInfo {
  terrain: TerrainKind;
  /** 中文名（对外文档与前端文案共用） */
  label: string;
  /** 占领后加成的资源（金矿 gold_mine 对应金币，v19 起金币进入野地占领加成） */
  resource: TerrainResource;
  /** 占领加成固定基线（/小时，v21 AISLG-28 加成保底：Lv1 即有保底收益） */
  bonusBase: number;
  /** 每级野地的占领加成增量（/小时，v21 起与基线合并为「基线 + 线性」公式） */
  bonusPerLevel: number;
  /** 生成权重（占位分布） */
  weight: number;
}

/** 地形清单（v21，AISLG-28 加成保底；v19 校准 + AISLG-20 金矿）：每种地形对应一种
 *  占领后加成的资源；占领加成 = 基线 + 等级 × 每级增量，Lv1 合计保持 v19 量级
 *  （60~120/h，让「占住」即有正回报），高等级线性收敛 */
export const TERRAIN_INFO: Record<TerrainKind, TerrainInfo> = {
  // v21 AISLG-28 加成保底：bonusBase + 等级 × bonusPerLevel——Lv1 合计 = 原 v19
  // 每级值（低等级收益不掉档），高等级线性收敛（Lv10 ≈ 原 7~7.3 折）
  plain: { terrain: 'plain', label: '平原', resource: 'food', bonusBase: 25, bonusPerLevel: 55, weight: 30 },
  grass: { terrain: 'grass', label: '草原', resource: 'food', bonusBase: 30, bonusPerLevel: 70, weight: 20 },
  forest: { terrain: 'forest', label: '森林', resource: 'wood', bonusBase: 30, bonusPerLevel: 70, weight: 16 },
  hill: { terrain: 'hill', label: '丘陵', resource: 'iron', bonusBase: 25, bonusPerLevel: 55, weight: 12 },
  desert: { terrain: 'desert', label: '荒漠', resource: 'stone', bonusBase: 25, bonusPerLevel: 55, weight: 8 },
  marsh: { terrain: 'marsh', label: '沼泽', resource: 'food', bonusBase: 20, bonusPerLevel: 40, weight: 8 },
  lake: { terrain: 'lake', label: '湖泊', resource: 'food', bonusBase: 40, bonusPerLevel: 80, weight: 6 },
  gold_mine: { terrain: 'gold_mine', label: '金矿', resource: 'gold', bonusBase: 30, bonusPerLevel: 70, weight: 6 },
};

/** 野地等级上限（占位决策，对齐旧游戏 10 级野地） */
export const WILDERNESS_LEVEL_MAX = 10;
/** 野地等级分布权重（Lv1..Lv10，低级多、高级少；占位） */
const LEVEL_WEIGHTS = [20, 17, 14, 12, 10, 8, 7, 5, 4, 3];

// ---- 野地战斗与收益（战斗编成在 battle.ts；此处为收益侧） ----

/** 驻军采集：每等级每兵每小时采集的地形资源（v19，AISLG-18：0.1 → 1，与占领加成同幅度放大） */
export const GATHER_PER_TROOP_PER_LEVEL = 1;
/** legacy 战利品（v15 前在途 attack 行军专用）：金币 = 等级 × 本系数 */
export const LOOT_GOLD_PER_LEVEL = 150;
/** legacy 战利品资源系数（两用历史值）：legacy attack = 等级 × 本系数的金币 + 地形资源 */
export const LOOT_RESOURCE_PER_LEVEL = 250;
/** 野地掠夺（task='plunder'）奖励池系数（v21，AISLG-31「掠夺含金」）：
 *  地形资源 = 等级 × 750 + 金币 = 等级 × 250（总量维持 1500×等级量级）；
 *  战斗收益与唯一稀缺资源（金）挂钩，「以战养战」闭环成立 */
export const PLUNDER_POOL_RESOURCE_PER_LEVEL = 750;
export const PLUNDER_POOL_GOLD_PER_LEVEL = 250;

/** 单块野地的占领加成（/小时）= 固定基线 + 等级 × 每级加成（v21，AISLG-28：
 *  加成保底——Lv1 即有原 v19 同值的保底收益，高等级线性收敛，低等级野地
 *  不再存在负收益区间）；占领以驻军存在为前提 */
export function wildernessBonusRate(terrain: TerrainKind, level: number): number {
  const lv = Math.max(0, level);
  return TERRAIN_INFO[terrain].bonusBase + lv * TERRAIN_INFO[terrain].bonusPerLevel;
}

/** 单块野地的驻军采集（/小时）= 等级 × 驻军总数 × 每兵系数（向下取整） */
export function wildernessGatherRate(terrain: TerrainKind, level: number, garrisonTotal: number): number {
  void terrain;
  return Math.floor(Math.max(0, level) * Math.max(0, garrisonTotal) * GATHER_PER_TROOP_PER_LEVEL);
}

/**
 * 战胜野地的一次性战利品（v16 起为 legacy 路径：仅处理升级前已发出的在途
 * purpose='attack' 行军；金币 + 地形资源，占位数值）。新出征走 MARCH.task
 * （plunder / occupy），掠夺奖励池见 wildernessPlunderPool。
 */
export function wildernessLoot(terrain: TerrainKind, level: number): Resources {
  const loot: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  loot.gold = Math.max(0, level) * LOOT_GOLD_PER_LEVEL;
  loot[TERRAIN_INFO[terrain].resource] = Math.max(0, level) * LOOT_RESOURCE_PER_LEVEL;
  return loot;
}

/**
 * 野地掠夺（task='plunder'，v16；v21 AISLG-31 掠夺含金）的奖励池：
 * 地形对应资源 750×等级 + 金币 250×等级。**金矿（gold_mine）仍为空池**（v21 拍板）：
 * 金矿定位「占领生息」（占领加成与驻军采集计入城池产金），不做掠夺目标。
 * 实际带走量由幸存部队的负重装填封顶（plunder.ts 的 loadByCarry，装填顺序
 * 金→粮→木→石→铁），胜利后地块进入 24 小时掠夺冷却、不改归属、幸存部队返程。
 */
export function wildernessPlunderPool(
  terrain: TerrainKind,
  level: number,
): Partial<Record<'gold' | 'food' | 'wood' | 'stone' | 'iron', number>> {
  const pool: Partial<Record<'gold' | 'food' | 'wood' | 'stone' | 'iron', number>> = {};
  const resource = TERRAIN_INFO[terrain].resource;
  if (resource !== 'gold') {
    pool[resource] = Math.max(0, level) * PLUNDER_POOL_RESOURCE_PER_LEVEL;
    pool.gold = Math.max(0, level) * PLUNDER_POOL_GOLD_PER_LEVEL;
  }
  return pool;
}

// ---- 行军（占位决策） ----

/** 每格行军秒数（占位，最慢兵种系数 1 的未加速基准）；可用环境变量 MARCH_SECONDS_PER_TILE 覆盖，便于验证 */
export const DEFAULT_MARCH_SECONDS_PER_TILE = 15;

/** 行军时长的计算基准：{ 每格基准秒数, 缩放 }；显式 MARCH_SECONDS_PER_TILE 覆盖时不缩放（scale=1） */
export function marchTimeBasis(): { secondsPerTile: number; scale: number } {
  const raw = Number(process.env.MARCH_SECONDS_PER_TILE);
  if (Number.isFinite(raw) && raw >= 1) {
    return { secondsPerTile: Math.floor(raw), scale: 1 };
  }
  return { secondsPerTile: DEFAULT_MARCH_SECONDS_PER_TILE, scale: getTimeScale() };
}

/**
 * 行军时长（秒）= max(1, ceil(Chebyshev 距离 × 每格基准秒数 ÷ 编队最慢兵种速度系数 ÷ time_scale))
 * （v13：斥候 ×2、轻骑兵 ×1.5、其余 ×1，占位；至少按 1 格计）。
 * 全局缩放作用于**总时长**：不能先把每格钳到 1 秒再乘格数——否则 scale ≥ 8 时每格恒为
 * 1 秒，高倍速行军偏慢、低倍速偏快（AISLG-38 复核修复，与 AISLG-39 征兵同模型）。
 * troops 缺省按基准速度（v12 兼容：距离结算不依赖编队时使用）。
 * v27（AISLG-77）：speedPercent 为行军科技的速度加成百分数，总时长再 ÷ (1 + 百分数 / 100)。
 */
export function marchTravelSeconds(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  troops?: Partial<Record<TroopKind, number>>,
  speedPercent = 0,
): number {
  const distance = Math.max(1, Math.max(Math.abs(toX - fromX), Math.abs(toY - fromY)));
  // 编队最慢兵种 = 行军速度系数最小者；空编队 / 未提供时按基准 1
  let slowest: number | null = null;
  if (troops) {
    for (const kind of TROOP_KINDS) {
      if ((troops[kind] ?? 0) > 0) {
        const multiplier = TROOP_STATS[kind].marchSpeed;
        slowest = slowest === null ? multiplier : Math.min(slowest, multiplier);
      }
    }
  }
  const { secondsPerTile, scale } = marchTimeBasis();
  const techFactor = 1 + Math.max(0, speedPercent) / 100;
  return Math.max(1, Math.ceil((distance * secondsPerTile) / Math.max(0.1, slowest ?? 1) / scale / techFactor));
}

/** 地图窗口参数钳制：边界内、边长 1..MAX_MAP_WINDOW */
export function clampMapWindow(x: number, y: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const width = Math.min(Math.max(1, Math.floor(w)), MAX_MAP_WINDOW);
  const height = Math.min(Math.max(1, Math.floor(h)), MAX_MAP_WINDOW);
  const clampedX = Math.min(Math.max(0, Math.floor(x)), WORLD_SIZE - width);
  const clampedY = Math.min(Math.max(0, Math.floor(y)), WORLD_SIZE - height);
  return { x: clampedX, y: clampedY, w: width, h: height };
}

/** 坐标是否在世界内 */
export function inWorld(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < WORLD_SIZE && y < WORLD_SIZE;
}

// ---- NPC 城池（占位决策；有限存量，被玩家占领后不补充） ----

/** NPC 城池数量（占位；随世界面积同比例放缩保持密度：40×40 时 24 座 → 1000×1000 时 15000 座） */
export const NPC_CITY_COUNT = 15000;
/** NPC 城池之间的最小 Chebyshev 间距（占位） */
const NPC_CITY_MIN_GAP = 4;
/** NPC 城池离世界中心（玩家出生区）的最小 Chebyshev 距离（占位） */
const NPC_CITY_CENTER_GAP = 5;

export interface NpcCityProfile {
  /** 驻防部队（按兵种；占位数值） */
  garrison: Partial<Record<TroopKind, number>>;
  /** 可掠夺库存（战胜一次性掠夺，占位数值） */
  stockScale: Resources;
  /** 占领后分城继承的建筑（占位数值） */
  buildings: Partial<Record<BuildingKind, number>>;
}

export const NPC_CITY_PROFILE: Record<number, NpcCityProfile> = {
  1: {
    garrison: { militia: 30, archer: 8 },
    stockScale: { gold: 2000, wood: 2000, food: 2000, stone: 1500, iron: 1500 },
    buildings: { government: 2, wall: 1 },
  },
  2: {
    garrison: { militia: 60, pikeman: 20, archer: 24 },
    stockScale: { gold: 4000, wood: 4000, food: 4000, stone: 3000, iron: 3000 },
    buildings: { government: 3, wall: 2, farm: 1, lumber_mill: 1 },
  },
  3: {
    garrison: { militia: 100, swordsman: 30, archer: 40, cavalry: 12 },
    stockScale: { gold: 6000, wood: 6000, food: 6000, stone: 4500, iron: 4500 },
    buildings: { government: 4, wall: 3, farm: 2, lumber_mill: 2, quarry: 1 },
  },
};

/** NPC 城池等级 1..3（占位分布权重） */
const NPC_LEVEL_WEIGHTS = [5, 3, 2];

export interface NpcCitySnapshot {
  level: number;
  /** 驻防部队；名城为城守阶段守军（外围见 famous.outerGarrison） */
  garrison: Partial<Record<TroopKind, number>>;
  /** 名城状态（v24 AISLG-56）；普通 NPC 城无此字段 */
  famous?: FamousCityState;
  stock: Resources;
  buildings: Partial<Record<BuildingKind, number>>;
}

function npcSnapshot(level: number): NpcCitySnapshot {
  const profile = NPC_CITY_PROFILE[level];
  const stock: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const key of RESOURCE_KEYS) {
    stock[key] = profile.stockScale[key];
  }
  return { level, garrison: { ...profile.garrison }, stock, buildings: { ...profile.buildings } };
}

/**
 * NPC 城池库存档位（v23，AISLG-55）：剩余库存合计相对该等级初始库存的比例，
 * 只给大概档位、不给精确数值（精确值仍要走 SCOUT 侦察）——
 * >60% rich 丰厚 / 20%–60% normal 一般 / <20% low 见底 / 0 empty 已空。
 * 非 NPC 城池等级（无初始库存档案）返回 null。
 */
export type NpcStockTier = 'rich' | 'normal' | 'low' | 'empty';

export function npcStockTierOf(level: number, stock: Partial<Resources> | null): NpcStockTier | null {
  const profile = NPC_CITY_PROFILE[level];
  if (!profile) {
    return null;
  }
  let initial = 0;
  let current = 0;
  for (const key of RESOURCE_KEYS) {
    initial += profile.stockScale[key];
    current += Math.max(0, Math.floor(stock?.[key] ?? 0));
  }
  if (initial <= 0) {
    return null;
  }
  const ratio = current / initial;
  if (ratio <= 0) {
    return 'empty';
  }
  if (ratio < 0.2) {
    return 'low';
  }
  if (ratio <= 0.6) {
    return 'normal';
  }
  return 'rich';
}

// ---- 世界生成（纯函数；ensureWorld 落库） ----

/** mulberry32：确定性 PRNG（体积小、可复现；只用于地形与 NPC 摆放的首次生成） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function weightedPick<T>(weights: T[]): T {
  return weights[Math.floor(rand() * weights.length)];
}

// 生成期共用的 PRNG（只在 generateWorldTiles 调用链内使用，避免到处传参）
let rand: () => number = Math.random;

export interface WorldTileSeed {
  x: number;
  y: number;
  terrain: TerrainKind;
  kind: 'wilderness' | 'npc_city';
  level: number;
  /** NPC 城池快照；wilderness 为 null */
  npc: NpcCitySnapshot | null;
}

/**
 * 生成整张世界（纯函数、按 WORLD_SEED 可复现）：每格先定地形，再按间距与出生区
 * 保护放置 NPC 城池（平原/草原上），其余为带等级的野地。城池地块（kind='city'）
 * 不在生成产物里——玩家主城与分城在注册 / 占领时逐格转换（见 claimCityTile）。
 */
export function generateWorldTiles(): WorldTileSeed[] {
  rand = mulberry32(WORLD_SEED);
  const terrainPool: TerrainKind[] = [];
  for (const terrain of TERRAIN_KINDS) {
    const weight = TERRAIN_INFO[terrain].weight;
    for (let i = 0; i < weight; i += 1) {
      terrainPool.push(terrain);
    }
  }
  const levelPool: number[] = [];
  LEVEL_WEIGHTS.forEach((weight, index) => {
    for (let i = 0; i < weight; i += 1) {
      levelPool.push(index + 1);
    }
  });
  const npcLevelPool: number[] = [];
  NPC_LEVEL_WEIGHTS.forEach((weight, index) => {
    for (let i = 0; i < weight; i += 1) {
      npcLevelPool.push(index + 1);
    }
  });

  const terrains: TerrainKind[][] = [];
  for (let y = 0; y < WORLD_SIZE; y += 1) {
    const row: TerrainKind[] = [];
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      row.push(weightedPick(terrainPool));
    }
    terrains.push(row);
  }

  // NPC 城池摆放：随机尝试，满足与既有 NPC 城池的间距和出生区保护才落位
  const center = Math.floor(WORLD_SIZE / 2);
  const npcAt: Array<{ x: number; y: number; level: number }> = [];
  let attempts = 0;
  while (npcAt.length < NPC_CITY_COUNT && attempts < WORLD_SIZE * WORLD_SIZE * 8) {
    attempts += 1;
    const x = Math.floor(rand() * WORLD_SIZE);
    const y = Math.floor(rand() * WORLD_SIZE);
    const terrain = terrains[y][x];
    if (terrain !== 'plain' && terrain !== 'grass') {
      continue;
    }
    if (Math.max(Math.abs(x - center), Math.abs(y - center)) < NPC_CITY_CENTER_GAP) {
      continue;
    }
    if (npcAt.some((npc) => Math.max(Math.abs(npc.x - x), Math.abs(npc.y - y)) < NPC_CITY_MIN_GAP)) {
      continue;
    }
    npcAt.push({ x, y, level: weightedPick(npcLevelPool) });
  }

  const npcByPos = new Map(npcAt.map((npc) => [`${npc.x},${npc.y}`, npc]));
  const tiles: WorldTileSeed[] = [];
  for (let y = 0; y < WORLD_SIZE; y += 1) {
    for (let x = 0; x < WORLD_SIZE; x += 1) {
      const npc = npcByPos.get(`${x},${y}`);
      if (npc) {
        tiles.push({ x, y, terrain: terrains[y][x], kind: 'npc_city', level: npc.level, npc: npcSnapshot(npc.level) });
        continue;
      }
      tiles.push({ x, y, terrain: terrains[y][x], kind: 'wilderness', level: weightedPick(levelPool), npc: null });
    }
  }
  return tiles;
}

// ---- 数据库引导与查询 ----
// PostgreSQL 读写（ensureWorld / claimCityTile / loadTerritory 等）在 world-db.ts，
// 从本文件拆出以控制单文件行数；本文件保持纯规则、可在无数据库环境使用。

export interface TerritoryRow {
  x: number;
  y: number;
  terrain: TerrainKind;
  level: number;
  /** 驻军总数 */
  garrison: number;
}

// ---- 野地连片加成（v23，AISLG-59） ----

/** 连片 3–4 块的产量加成（+10%） */
export const CLUSTER_BONUS_SMALL = 0.1;
/** 连片 5 块及以上的产量加成（+20%） */
export const CLUSTER_BONUS_LARGE = 0.2;

/** 连片块数 → 产量乘数：3–4 块 ×1.1、≥5 块 ×1.2、其余 ×1（相邻 = 上下左右 4 向、
 *  且必须同地形；占位值随需求「已定」标注可调） */
export function clusterBonusMultiplier(size: number): number {
  if (size >= 5) {
    return 1 + CLUSTER_BONUS_LARGE;
  }
  if (size >= 3) {
    return 1 + CLUSTER_BONUS_SMALL;
  }
  return 1;
}

/**
 * 每块野地所属连通块的大小（键 "x,y"）：同地形 + 上下左右 4 向相邻才算连片。
 * 城池产量加成（territoryRates）与视图（CityView.territory 的连片标注）共用同一计算，
 * 保证两处口径一致；占领 / 失守后按最新领地重算，无需存储。
 */
export function territoryClusterSizes(tiles: TerritoryRow[]): Map<string, number> {
  const byPos = new Map(tiles.map((tile) => [`${tile.x},${tile.y}`, tile]));
  const sizes = new Map<string, number>();
  const visited = new Set<string>();
  for (const tile of tiles) {
    const key = `${tile.x},${tile.y}`;
    if (visited.has(key)) {
      continue;
    }
    // 同地形连通块 DFS（栈式，规模小无递归风险）
    const stack = [tile];
    visited.add(key);
    const members: TerritoryRow[] = [];
    while (stack.length > 0) {
      const cur = stack.pop() as TerritoryRow;
      members.push(cur);
      const neighbours: Array<[number, number]> = [
        [cur.x + 1, cur.y],
        [cur.x - 1, cur.y],
        [cur.x, cur.y + 1],
        [cur.x, cur.y - 1],
      ];
      for (const [nx, ny] of neighbours) {
        const nextKey = `${nx},${ny}`;
        const next = byPos.get(nextKey);
        if (next && !visited.has(nextKey) && next.terrain === tile.terrain) {
          visited.add(nextKey);
          stack.push(next);
        }
      }
    }
    for (const member of members) {
      sizes.set(`${member.x},${member.y}`, members.length);
    }
  }
  return sizes;
}

/** 本城野地的合计加成产量（占领加成 + 驻军采集，按资源归集；production 的加成入口）。
 *  v23（AISLG-59）连片加成：同地形 4 向相邻成片时该地形资源产量乘 (1 + 加成)，
 *  逐块取整保持产量为整数；失去任一块按新的连通块重算（本函数即算即得，无状态）。 */
export function territoryRates(tiles: TerritoryRow[]): Partial<Record<ProducedResource, number>> {
  const sizes = territoryClusterSizes(tiles);
  const rates: Partial<Record<ProducedResource, number>> = {};
  for (const tile of tiles) {
    const resource = TERRAIN_INFO[tile.terrain].resource;
    const base = wildernessBonusRate(tile.terrain, tile.level) + wildernessGatherRate(tile.terrain, tile.level, tile.garrison);
    const multiplier = clusterBonusMultiplier(sizes.get(`${tile.x},${tile.y}`) ?? 1);
    rates[resource] = (rates[resource] ?? 0) + Math.round(base * multiplier);
  }
  return rates;
}

/** tile kind 的合法性校验（视图层容错用） */
export function isTileKind(value: unknown): value is TileKind {
  return typeof value === 'string' && (TILE_KINDS as readonly string[]).includes(value);
}
