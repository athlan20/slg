// 世界地图、野地与 NPC 协议的类型与常量（v12；从 protocol.ts 拆出以控制单文件行数）。
// 地图生成、野地加成、NPC 城池与行军的数值规则见 common/src/world.ts 与 battle.ts。
// 本文件只 import protocol.ts / protocol-army.ts 的类型（类型导入在运行时被擦除，不构成加载环）。

import type { InitiatorRole, Resources } from './protocol';
import type { ArmyCounts, TroopKind } from './protocol-army';
import type { MarchPurpose, MarchTask } from './protocol-battle';
import type { YtTileCampView } from './protocol-yt';

/**
 * 地形清单（v12；v19 新增金矿 gold_mine）：平原 / 草原 / 森林 / 丘陵 / 荒漠 / 沼泽 / 湖泊 / 金矿。
 * 每种地形对应一种占领后的资源加成（见 world.ts 的 TERRAIN_INFO）；金矿加成金币，
 * 定位「占领生息」、奖励池保持空池（v21 拍板）；金币 v21 起进入其余地形的掠夺池
 * 与 NPC 城库存（AISLG-31）。
 */
export const TERRAIN_KINDS = ['plain', 'grass', 'forest', 'hill', 'desert', 'marsh', 'lake', 'gold_mine'] as const;

export type TerrainKind = (typeof TERRAIN_KINDS)[number];

export function isTerrainKind(value: unknown): value is TerrainKind {
  return typeof value === 'string' && (TERRAIN_KINDS as readonly string[]).includes(value);
}

/** 野地加成可作用的资源（v19 起含金币：金矿地形） */
export type TerrainResource = 'food' | 'wood' | 'stone' | 'iron' | 'gold';

/** 地块类别：野地 / NPC 城池 / 玩家城池（主城与分城） */
export const TILE_KINDS = ['wilderness', 'npc_city', 'city'] as const;

export type TileKind = (typeof TILE_KINDS)[number];

/** 地块占领者（占领野地的城，或城池地块的城主） */
export interface TileOwnerView {
  accountId: string;
  username: string;
  cityId: string;
  cityName: string;
}

/** NPC 城池库存档位（v23，AISLG-55）：相对该城初始库存的比例分档——只给大概档位，
 *  不泄露精确数值（精确值仍走 SCOUT 侦察）。非 NPC 城为 null */
export type NpcStockTier = 'rich' | 'normal' | 'low' | 'empty';

/** 名城标识与当前阶段（v24，AISLG-56）：地图上高亮的少数 NPC 名城 */
export interface FamousTileView {
  /** 名城名，如「官渡」 */
  name: string;
  /** outer=外围阶段（须先清外围）；keeper=外围已清、可攻城守并占领 */
  stage: 'outer' | 'keeper';
  /** 占领后的独占加成：该城产量 +N% */
  bonusPercent: number;
  /** 城守阶段：外围恢复满编的时刻（ISO 8601，超时无人攻下城守则恢复）；外围阶段为 null */
  recoversAt: string | null;
}

/** 地图窗口内一格的视图（GET_WORLD_MAP / PUSH_TILE_STATE 共用） */
export interface TileView {
  x: number;
  y: number;
  terrain: TerrainKind;
  kind: TileKind;
  /** 野地 / NPC 城池等级；玩家城池为 0 */
  level: number;
  /** 占领者（占领野地的城或城池城主）；无主为 null */
  owner: TileOwnerView | null;
  /** 地块驻军总数（未占领野地的原住守军不落库，战力按等级推导，此处为 0） */
  garrison: number;
  /** NPC 城池库存档位（v23，AISLG-55；rich >60% / normal 20%–60% / low <20% / empty 已空，
   *  相对该城初始库存）；非 NPC 城为 null */
  npcStockTier: NpcStockTier | null;
  /** 名城信息（v24，AISLG-56）：名称 / 当前阶段 / 独占加成；非名城为 null */
  famous: FamousTileView | null;
  /** 黄巾营地 / 张角老巢（v29，AISLG-76）：地块上有进行中的营地时给出档位 / 守军范围 / 升档倒计时；其余为 null */
  camp: YtTileCampView | null;
  /** 玩家城的保护状态（v38，AISLG-122）：新手保护 / 被动免战 / 主动免战的截止时刻；
   *  非玩家城地块、自己的城为 null */
  protection: import('./protocol-pvp').TileProtectionView | null;
  /** 他人分城的当前城防值（v40，AISLG-124；0..100，非 null 即可被「占领」攻打的分城；
   *  主城 / 野地 / NPC 城 / 自己的城为 null） */
  durability: number | null;
}

/** GET_TILE 的单格详情 */
export interface TileDetailView extends TileView {
  /** 按兵种统计的地块驻军 */
  garrisonDetail: ArmyCounts;
  /** 未占领野地的原住守军参考战力（v24 = 当前存量的 armyPower：满编 nativeGarrison 含地块浮动，被打残后按小时恢复）；其余为 0 */
  nativePower: number;
  /** 野地收益预览（按当前占领状态计算的小时速率）；非野地为 null */
  wilderness: { resource: TerrainResource; bonusRate: number; gatherRate: number } | null;
  /** NPC 城池驻军与库存（v13：需侦察——未侦察为 null，已侦察返回最近一次快照） */
  npc: {
    garrison: ArmyCounts;
    stock: Resources;
    /** 侦察详细度（v27 AISLG-77）：rough 时 garrison 全 0、kinds 时为近似值；历史情报缺省视为 exact */
    scoutDetail?: 'rough' | 'kinds' | 'exact';
    /** 总兵力范围（v27）：exact 时 min = max */
    garrisonTotal?: { min: number; max: number };
  } | null;
  /** NPC 城池情报快照时间（v13；v23 AISLG-62 起任意侦察过的地块都返回，未侦察为 null） */
  scoutedAt: string | null;
  /**
   * 最近一次成功掠夺（攻方胜利）的时间（v16，ISO 8601）：距其 24 小时内该地块处于
   * 掠夺冷却（MARCH task='plunder' 被拒；在途部队到达仍战斗但资源为零）；从未被掠为 null
   */
  plunderedAt: string | null;
}

/** 本城占领的野地（CityView.territory 元素） */
export interface TerritoryView {
  x: number;
  y: number;
  terrain: TerrainKind;
  level: number;
  /** 加成作用的资源 */
  resource: TerrainResource;
  /** 占领加成（/小时） */
  bonusRate: number;
  /** 驻军采集（/小时，随驻军规模变化） */
  gatherRate: number;
  /** 驻军总数 */
  garrison: number;
  /** 所属连片块数（v23，AISLG-59；同地形 4 向相邻；单块为 1） */
  clusterSize: number;
  /** 连片产量加成（百分数：3–4 块 10 / ≥5 块 20；不足 3 块为 0） */
  clusterBonusPercent: number;
}

/** 行军视图（推送与查询共用同一结构） */
export interface MarchView {
  id: string;
  fromCityId: string;
  /** 涉及地块坐标：plunder/occupy/scout/transfer/attack=目标地块；return=折返涉及的地块 */
  x: number;
  y: number;
  troops: ArmyCounts;
  /** v16 新增 'plunder'（掠夺）、'occupy'（占领）与 'reinforce'（增援）；'attack' 仅存量在途行军 */
  purpose: MarchPurpose;
  /** marching=行军中；arrived=已到达并结算；returned=已回城（return） */
  status: 'marching' | 'arrived' | 'returned';
  initiator: InitiatorRole;
  startedAt: string;
  arriveAt: string;
  resolvedAt: string | null;
  /** 截击的移动目标 id（v28 AISLG-78；purpose='intercept' 及其撤回后的返程行军有值，其余 null） */
  targetId: string | null;
  /** 随行运送的资源（v26，AISLG-79；purpose='transport'，及其被撤回 / 目标失效后的 return）；其余为 null */
  cargo: Resources | null;
  /**
   * 截击埋伏开始的时刻（v35，AISLG-112）：部队提前到达选定格、原地埋伏等目标经过的时刻
   * （ISO 8601）。此时 arriveAt 为预计**接战**时刻 = max(到达时刻, 目标进入相邻范围的时刻)。
   * 到达即接战 / 太晚扑空与其他行军为 null
   */
  ambushAt: string | null;
  /** 随队武将 id（v36，AISLG-114；返程行军沿用同一武将，回城后武将自然释放），其余为 null */
  heroId: string | null;
}

/** GET_WORLD_MAP（op 30）请求载荷：窗口左上角与尺寸，缺省以主城为中心取 DEFAULT_MAP_WINDOW */
export interface WorldMapRequestData {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface WorldMapResponseData {
  /** 世界边长（世界为 size×size 的方格） */
  size: number;
  /** 本次窗口左上角坐标与尺寸（已按世界边界钳制） */
  x: number;
  y: number;
  w: number;
  h: number;
  tiles: TileView[];
}

/** GET_TILE（op 31）请求载荷 */
export interface GetTileRequestData {
  x: number;
  y: number;
}

export interface GetTileResponseData {
  tile: TileDetailView;
}

/** MARCH（op 32）请求载荷：troops 为按兵种的派出数量，至少一种 > 0；
 *  task 为出征任务（v16）：'plunder' 掠夺（缺省）或 'occupy' 占领，仅野地 / NPC 城目标接受 */
export interface MarchRequestData {
  x: number;
  y: number;
  troops: Partial<Record<TroopKind, number>>;
  /** v16：掠夺 / 占领；缺省 'plunder'（对 v15 及以前不带 task 的客户端是破坏性语义变更）；
   *  v26：'transport' 运输，目标须为本账号另一座城 */
  task?: MarchTask;
  /** v28（AISLG-78）：截击移动目标——目标 id；此时 (x, y) 须是该目标路线上尚未过去的某一格，task / cargo 忽略 / 不接受 */
  targetId?: string;
  /** v26（AISLG-79）：task='transport' 必填——运送的资源（五项非负整数，总量 ≥ 1 且 ≤ 编队负重） */
  cargo?: Partial<Resources>;
  /** v36（AISLG-114）：可选随队武将 id（GET_HEROES 的 heroes[]；一支部队至多一名，
   *  同一武将同一时间只能在一支部队里，城守不能出征）；缺省不带队 */
  heroId?: string | null;
}

export interface MarchResponseData {
  march: MarchView;
}

/** RECALL_GARRISON（op 33）请求载荷：撤回本账号占领地块的全部驻军（同时放弃占领） */
export interface RecallGarrisonRequestData {
  x: number;
  y: number;
}

export interface RecallGarrisonResponseData {
  march: MarchView;
}

/** PUSH_MARCH_STATE（op 2005）推送载荷 */
export interface MarchStatePushData {
  /** march_started=出征或召回发起；march_arrived=到达并结算；march_returned=返程部队回城 */
  reason: 'march_started' | 'march_arrived' | 'march_returned';
  march: MarchView;
}

/** PUSH_TILE_STATE（op 2006）推送载荷：地块归属 / 驻军变化 */
export interface TileStatePushData {
  reason:
    | 'wilderness_occupied'
    | 'wilderness_lost'
    | 'npc_city_occupied'
    | 'npc_attack_repelled'
    | 'garrison_reinforced'
    /** v40（AISLG-124）：分城被玩家占领易主 */
    | 'city_conquered'
    /** v40（AISLG-124）：分城城防值被打掉一截（守方视角刷新城防 / 免战） */
    | 'city_durability_hit';
  tile: TileView;
}
