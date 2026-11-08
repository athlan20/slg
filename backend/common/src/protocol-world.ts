// 世界地图、野地与 NPC 协议的类型与常量（v12；从 protocol.ts 拆出以控制单文件行数）。
// 地图生成、野地加成、NPC 城池与行军的数值规则见 common/src/world.ts 与 battle.ts。
// 本文件只 import protocol.ts / protocol-army.ts 的类型（类型导入在运行时被擦除，不构成加载环）。

import type { InitiatorRole, Resources } from './protocol';
import type { FamousEffectView } from './famous-effects';
import type { DefenseScoutView } from './protocol-defense';
import type { ArmyCounts, TroopKind } from './protocol-army';
import type { MarchPurpose, MarchTask } from './protocol-battle';
import type { YtTileCampView } from './protocol-yt';
import type { FactionTileView } from './protocol-faction';

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
  /** 占领者爵位（v76，AISLG-197）：序号与名称 */
  nobility: number;
  nobilityName: string;
  /** 占领者与请求账号同属一个联盟（v67，AISLG-182）：盟友的地块不能攻击 / 侦察，地图单独着色；自己的地块与未入盟时为 false */
  ally: boolean;
  /** 与占领者的关系（v77，AISLG-195）：self 自己 / ally 同盟 / friendly 友盟 / hostile 敌对 / neutral 其他 */
  relation: 'self' | 'ally' | 'friendly' | 'hostile' | 'neutral';
  /** 本账号现在能否向这位占领者协防（v95，AISLG-226）：同联盟或友盟为 true；自己、解除友好的 24 小时冷却期、中立、敌对为 false。
   *  与 MARCH task=assist 的校验（canAssist）口径一致；冷却期内 relation 仍为 friendly（只为不能互打），但这里为 false */
  canAssist: boolean;
}

/** NPC 城池库存档位（v23，AISLG-55）：相对该城初始库存的比例分档——只给大概档位，
 *  不泄露精确数值（精确值仍走 SCOUT 侦察）。非 NPC 城为 null */
export type NpcStockTier = 'rich' | 'normal' | 'low' | 'empty';

/** 名城标识与当前阶段（v24，AISLG-56）：地图上高亮的少数 NPC 名城 */
export interface FamousTileView {
  /** 名城名，如「官渡」 */
  name: string;
  /** outer=外围阶段（须先清外围）；keeper=外围已清、可攻城守并占领 */
  /** 探索快照（AISLG-224 复核）：已探索的名城阶段是动态信息，给 null */
  stage: 'outer' | 'keeper' | null;
  /** 占领后的独占加成：该城产量 +N% */
  bonusPercent: number;
  /** 城守阶段：外围恢复满编的时刻（ISO 8601，超时无人攻下城守则恢复）；外围阶段为 null */
  recoversAt: string | null;
  /** 占领后得到的名城独有效果（v62，AISLG-166）：可在名城介绍中查看 */
  effect: FamousEffectView | null;
  /**
   * 名城首探者（v93，AISLG-227）：未探索的格不返回；迷雾开启时已探索 / 视野内的名城给出首探者用户名，
   * 尚无人首探为 null；迷雾关闭时字段缺省（不显示首探信息）
   */
  firstExplorer?: string | null;
}

/** 遗迹的品质（v93，AISLG-227）：普通 / 稀有 / 传说 */
export type RelicTier = 'common' | 'rare' | 'legendary';

/** 遗迹的种类（v93，AISLG-227）：八种，与 common/src/relic.ts 的配置一一对应 */
export const RELIC_KINDS = ['granary', 'lumberyard', 'quarry', 'ironworks', 'caravan', 'battlefield', 'treasury', 'mausoleum'] as const;
export type RelicKind = (typeof RELIC_KINDS)[number];

/** 地块上未领取的遗迹（v93，AISLG-227）：已探索或视野内才给；领取后不再返回 */
export interface RelicTileView {
  tier: RelicTier;
  kind: RelicKind;
}

/**
 * 名将处所（v93，AISLG-227）：8 位一线在野名将的隐居地（所在野地格）。已探索或视野内才给；
 * claimed 为 true 表示名将已被招揽（处所与名字保留，图标变灰，首探只发资源）。
 */
export interface HeroSiteView {
  /** 处所名，如「茅庐」 */
  name: string;
  /** 名将名，如「诸葛亮」 */
  hero: string;
  claimed: boolean;
}

/**
 * 野地储量视图（v61，AISLG-165）：储量、上限与速率均为基准单位（与占领加成、驻军采集同口径）。
 * 档位对所有人可见；当前储量 / 上限 / 预计时刻只给归属方与侦察过该地块的账号，其余为 null。
 */
export interface ReserveView {
  /** 档位：ample 充足（>60%）/ normal 一般（20%–60%）/ depleted 枯竭（<20%，含已采空） */
  tier: 'ample' | 'normal' | 'depleted';
  /** 当前储量（基准单位，向下取整）；无权查看为 null */
  current: number | null;
  /** 储量上限（基准单位，四舍五入）；无权查看为 null */
  cap: number | null;
  /** 按当前驻军预计采空（kind=empty）或回满（kind=full）的时刻（ISO 8601）；无此类事件或无权查看为 null */
  eta: { kind: 'empty' | 'full'; at: string } | null;
}

/**
 * 野地上的设施（v97，AISLG-232）：地图与地块详情里对**所有人**可见的部分——有望楼、几级。
 * 建造进度与剩余时间只有主人能看到（见 TerritoryView.facility / TileDetailView.facilityBuilding）。
 */
export interface TileFacilityView {
  kind: 'watchtower';
  /** 已建成的等级（1..3）；建造中这一级还没算数，仍显示旧的等级 */
  level: number;
}

/** 进行中的建造 / 升级（v97，AISLG-232；只有主人能看到） */
export interface FacilityBuildingView {
  /** 目标等级（1..3）：新建设施时是 1，升级时是当前等级 + 1 */
  toLevel: number;
  /** 完成时刻（ISO 8601；已按发起时的全局时间缩放折算，由 Worker 到期完成） */
  finishAt: string;
}

/** 本城名下野地的设施（CityView.territory 元素的一部分；含建造进度，主人可见） */
export interface TerritoryFacilityView {
  kind: 'watchtower';
  /** 已建成的最高等级；正在新建（还没有任何一级完成）时是 0 */
  level: number;
  /** 已建成等级的视野半径（切比雪夫距离，格）；level = 0 时为 0。
   *  丘陵上的野地是**加成后的有效半径**（1 / 2 / 3 级 8 / 10 / 12，AISLG-233），与 fog 的实际视野一致 */
  visionRadius: number;
  /** 进行中的建造 / 升级；没有则为 null */
  building: FacilityBuildingView | null;
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
  /** 在野名将标记（v54，AISLG-144）：该野地落有尚未被获得的在野名将（公开；名字与属性需侦察）；其余为 false */
  wildFamous: boolean;
  /** 野地储量（v61，AISLG-165）：仅野地有值（有主或无主），其余地块为 null */
  reserve: ReserveView | null;
  /** 遗迹（v93，AISLG-227）：实时视野或已探索且未领取的遗迹格才有；其余为 null（迷雾关闭时恒为 null） */
  relic: RelicTileView | null;
  /** 名将处所（v93，AISLG-227）：实时视野或已探索的处所格才有；其余为 null（迷雾关闭时恒为 null） */
  heroSite: HeroSiteView | null;
  /** 望楼（v97，AISLG-232）：只要能看到这块地就能看到有望楼与它的等级（不含建造进度）；没盖或还在建 1 级为 null */
  facility: TileFacilityView | null;
  /** 势力归属（v99，AISLG-239）：被某方势力吞并的 NPC 城 / 老巢地块才有；其余为 null。
   *  玩家占下这座城后地块转城池，归属随之消失；faction_enabled 关闭时恒为 null。
   *  已探索但不在实时视野内的格给 null（势力归属是动态信息，与驻军 / 库存档位同口径）。 */
  faction: FactionTileView | null;
  /** 战争迷雾（v92，AISLG-224）：visible = 实时视野（与未开迷雾时一致）；explored = 已探索但不在视野内，
   *  只给上次看到的地形 / 等级 / 占领者，动态字段（驻军、库存 / 储量档位、保护、城防）为 null 或 0；未探索的地块不返回 */
  fog: 'explored' | 'visible';
  /** 已探索时为上次看到的时间（ISO）；实时视野为 null */
  seenAt: string | null;
}

/** 在野名将的地块详情（v54，AISLG-144）：标记公开，名字与属性只对侦察过该地块的账号给出 */
export interface WildFamousDetailView {
  /** 本账号是否侦察过此地（侦察后才给出名字与属性） */
  scouted: boolean;
  name: string | null;
  attrs: { lead: number; force: number; wit: number } | null;
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
  /** 在野名将情报（v54，AISLG-144）：未被获得的在野名将所在野地才有，其余为 null */
  wildFamousIntel: WildFamousDetailView | null;
  /** 城防器械（v73，AISLG-193）：自己的城给精确库存；他人的城只在侦察过时给最近一次
   *  侦察快照（按侦察科技三档）；野地 / NPC 城 / 未侦察为 null */
  defenses: DefenseScoutView | null;
  /** 协防部队（v74，AISLG-194）：自己的城或盟友的城给出 "谁在协防、带了多少兵"；
   *  其他人 / 野地 / NPC 城为 null（外人侦察只能看到计入守军总数的兵力） */
  assists: import('./protocol-assist').AssistView[] | null;
  /** 望楼的建造 / 升级进度（v97，AISLG-232）：**只有占着这块地的城的主人能看到**，其余为 null */
  facilityBuilding: FacilityBuildingView | null;
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
  /** 驻军采集（/小时，随驻军规模变化；v61 起受储量约束：储量空时只按恢复速度采集） */
  gatherRate: number;
  /** 驻军总数 */
  garrison: number;
  /** 所属连片块数（v23，AISLG-59；同地形 4 向相邻；单块为 1） */
  clusterSize: number;
  /** 连片产量加成（百分数：3–4 块 10 / ≥5 块 20；不足 3 块为 0） */
  clusterBonusPercent: number;
  /** 野地储量（v61，AISLG-165）；本城占领的地块恒有权查看数值 */
  reserve: ReserveView;
  /** 这块地上的望楼（v97，AISLG-232）：等级、视野半径与进行中的建造 / 升级；没盖为 null */
  facility: TerritoryFacilityView | null;
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
  /** 金蝉脱壳已用过（v86，AISLG-211）：同一支返程部队只能用一次，已用的不能再施 */
  stratagemUsed: boolean;
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
  /** 战争迷雾开关 fog_enabled 的当前值（v97，AISLG-232）：关闭时望楼照建但不产生视野效果，界面据此注明「迷雾未开启」 */
  fogEnabled?: boolean;
  tiles: TileView[];
}

/** 规模档位分界（v96，AISLG-230）：中军下限 500、大军下限 5 000（小股 1–499） */
export const VISIBLE_MARCH_MEDIUM_MIN = 500;
export const VISIBLE_MARCH_LARGE_MIN = 5_000;
/** GET_VISIBLE_MARCHES 单窗口最多返回的部队数（离窗口中心最近的 50 支） */
export const VISIBLE_MARCH_LIMIT = 50;

/**
 * 视野内他人部队的规模档位（v96，AISLG-230）：按编队总人数分三档，只给档位、不给兵力。
 * small 1–499 / medium 500–4 999 / large 5 000 及以上。
 */
export type VisibleMarchScale = 'small' | 'medium' | 'large';

/** 他人部队的主人关系（v96，AISLG-230）：与地块 owner.relation 同一口径（解除友好冷却期内算 friendly） */
export type VisibleMarchRelation = 'ally' | 'friendly' | 'hostile' | 'neutral';

/** 他人部队的主人（v96，AISLG-230）：只有玩家名与联盟名，没有城池 */
export interface VisibleMarchOwnerView {
  username: string;
  /** 没有联盟为 null */
  allianceName: string | null;
  relation: VisibleMarchRelation;
}

/**
 * 视野内的一支他人部队（v96，AISLG-230）。信息边界：**没有**出发城、目标格、出发 / 到达时间、
 * 精确兵力、兵种、将领与任务类型——只有当前位置、速度（仅供图标平滑移动）、去 / 返程、规模档位与主人。
 */
export interface VisibleMarchView {
  /** 行军 id：与来袭预警（PUSH_ATTACK_WARNING 的 marchId）匹配用 */
  id: string;
  /** 当前位置（格坐标，保留 1 位小数） */
  x: number;
  y: number;
  /** 速度（格/秒，只表明方向与快慢；方向用平移两次采样也能算出，不算泄露） */
  vx: number;
  vy: number;
  /** 是否返程 */
  returning: boolean;
  /** 规模档位（编队总人数） */
  scale: VisibleMarchScale;
  owner: VisibleMarchOwnerView;
}

/** GET_VISIBLE_MARCHES（op 152，v96，AISLG-230）请求载荷：窗口含义与限制同 GET_WORLD_MAP（最大 20×20） */
export interface GetVisibleMarchesRequestData {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

export interface GetVisibleMarchesResponseData {
  /** 快照时刻（ISO 8601）：客户端以收到的本地时刻为基准外推，不必依赖两端时钟一致 */
  serverTime: string;
  /** 视野内的他人部队，离窗口中心由近到远，最多 50 支；迷雾关闭时为空数组 */
  marches: VisibleMarchView[];
}

/** 小地图城池点位的归属：本方（主城 / 分城）、他方玩家城池、NPC 城池、名城（未被占领的名城） */
/** famous_rumor（v92，AISLG-224）：未探索的名城在锚点上的大致方位（锚点不是真实坐标） */
/** relic（v93，AISLG-227）：已探索且未领取的遗迹；hero_site / hero_site_claimed：已探索的名将处所（未招揽 / 已出山） */
export type MapOverviewSide =
  | 'own' | 'ally' | 'friendly' | 'hostile' | 'enemy' | 'npc' | 'famous' | 'famous_rumor'
  | 'relic' | 'hero_site' | 'hero_site_claimed';

/** GET_MAP_OVERVIEW（op 95）响应载荷（v58）：全图城池点位，野地不返回 */
export interface MapOverviewResponseData {
  /** 世界边长（世界为 size×size 的方格） */
  size: number;
  /** 统计时刻（ISO 8601） */
  at: string;
  /** 城池点位 [x, y, side]，按 y 行 x 列排序 */
  cities: Array<[number, number, MapOverviewSide]>;
  /** 战争迷雾开启时才有（v92，AISLG-224）：已探索区块位图（10000 位，base64，1250 字节；区块下标 floor(y/10)*100+floor(x/10)，第 i 位在字节 i>>3、掩码 1<<(i&7)）与探索进度（%，1 位小数） */
  exploredChunks?: string;
  exploredPercent?: number;
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

/** RECALL_GARRISON（op 33）请求载荷：缺省 troops 时撤回本账号占领地块的全部驻军（同时放弃占领）；
 *  带 troops（v83，AISLG-207）时只撤指定兵种与数量，保留占领，地块至少留 1 兵 */
export interface RecallGarrisonRequestData {
  x: number;
  y: number;
  /** v83：按兵种的撤回数量（键为已知兵种、值为正整数；空对象 / 未知兵种 / 非正整数返回 INVALID_PARAMS） */
  troops?: Partial<Record<TroopKind, number>>;
}

export interface RecallGarrisonResponseData {
  march: MarchView;
}

/** PUSH_MARCH_STATE（op 2005）推送载荷 */
export interface MarchStatePushData {
  /** march_started=出征或召回发起；march_arrived=到达并结算；march_returned=返程部队回城；
   *  march_time_changed=行军到达时刻被计谋改写（v86，AISLG-211 金蝉脱壳 / 八门金锁；march 为改后的最新行军） */
  reason: 'march_started' | 'march_arrived' | 'march_returned' | 'march_time_changed';
  march: MarchView;
}

/** PUSH_TILE_STATE（op 2006）推送载荷：地块归属 / 驻军变化 */
export interface TileStatePushData {
  reason:
    /** relic_claimed（v93，AISLG-227）：遗迹被领取，推给仍能看到该格的账号（tile 为领取后的视图，遗迹已不在） */
    | 'relic_claimed'
    | 'wilderness_occupied'
    | 'wilderness_lost'
    /** v61（AISLG-165）：野地储量采空（归属方视角，推送地块最新视图） */
    | 'reserve_depleted'
    | 'npc_city_occupied'
    | 'npc_attack_repelled'
    | 'garrison_reinforced'
    /** v40（AISLG-124）：分城被玩家占领易主 */
    | 'city_conquered'
    /** v40（AISLG-124）：分城城防值被打掉一截（守方视角刷新城防 / 免战） */
    | 'city_durability_hit'
    /** v91（AISLG-220）：城池迁移，新旧两格各推一次（归属方视角） */
    | 'city_moved'
    /** v97（AISLG-232）：望楼建成 / 升级完成（归属方视角，tile.facility 为新等级）。
     *  望楼随野地毁掉不单独推：那一格本来就有一条 wilderness_lost（tile.facility 随之变 null） */
    | 'facility_completed';
  tile: TileView;
}
