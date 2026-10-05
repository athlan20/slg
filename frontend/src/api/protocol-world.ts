// 世界地图、野地与 NPC 协议的类型镜像（v12 起，v13 更新）：唯一事实来源是
// backend/common/src/protocol-world.ts 与 protocol-battle.ts，对外文档为 docs/agent-api.md；
// protocol.ts 以 `export type { ... } from` 原名再导出，既有 import 路径不变。

import type { ArmyCounts, InitiatorRole, Resources, TroopKind } from './protocol';
import type { YtTileCampView } from './protocol-yt';
import type { BattleHeroView } from './protocol-hero';

/** 地形清单（v19 新增金矿 gold_mine）：平原 / 草原 / 森林 / 丘陵 / 荒漠 / 沼泽 / 湖泊 / 金矿 */
export type TerrainKind = 'plain' | 'grass' | 'forest' | 'hill' | 'desert' | 'marsh' | 'lake' | 'gold_mine';

export const TERRAIN_KINDS = [
  'plain',
  'grass',
  'forest',
  'hill',
  'desert',
  'marsh',
  'lake',
  'gold_mine',
] as const;

/** 野地加成可作用的资源（v19 起含金币：金矿地形） */
export type TerrainResource = 'food' | 'wood' | 'stone' | 'iron' | 'gold';

/** 地块类别：野地 / NPC 城池 / 玩家城池（主城与分城） */
export type TileKind = 'wilderness' | 'npc_city' | 'city';

/** 地块占领者（占领野地的城，或城池地块的城主） */
export interface TileOwnerView {
  accountId: string;
  username: string;
  cityId: string;
  cityName: string;
}

/** NPC 城池库存档位（v23 AISLG-55；相对该城初始库存，不给精确数值） */
export type NpcStockTier = 'rich' | 'normal' | 'low' | 'empty';

/** 名城标识与当前阶段（v24，AISLG-56） */
export interface FamousTileView {
  name: string;
  /** outer=外围阶段（须先清外围）；keeper=外围已清、可攻城守并占领 */
  stage: 'outer' | 'keeper';
  /** 占领后的独占加成：该城产量 +N% */
  bonusPercent: number;
  /** 城守阶段：外围恢复满编的时刻（ISO 8601）；外围阶段为 null */
  recoversAt: string | null;
}

/** 地图窗口内一格的视图 */
export interface TileView {
  x: number;
  y: number;
  terrain: TerrainKind;
  kind: TileKind;
  /** 野地 / NPC 城池等级；玩家城池为 0 */
  level: number;
  owner: TileOwnerView | null;
  /** 地块驻军总数 */
  garrison: number;
  /** NPC 城池库存档位（v23 AISLG-55）；非 NPC 城为 null */
  npcStockTier: NpcStockTier | null;
  /** 名城信息（v24，AISLG-56）；非名城为 null */
  famous: FamousTileView | null;
  /** 黄巾营地 / 张角老巢（v29 AISLG-76）：地块上有进行中的营地时给出；其余为 null */
  camp: YtTileCampView | null;
  /** 玩家城的保护状态（v38 AISLG-122）：新手保护 / 被动免战 / 主动免战的截止时刻；
   *  非玩家城地块、自己的城为 null */
  protection: TileProtectionView | null;
  /** 他人分城的当前城防值（v40，AISLG-124；非 null 即可被「占领」攻打的分城）；
   *  主城 / 野地 / NPC 城 / 自己的城为 null */
  durability: number | null;
}

/** 玩家城地块的保护状态（v38，AISLG-122）；三个截止任一未到即受保护 */
export interface TileProtectionView {
  /** 新手保护截止（账号级；别人不能侦察 / 攻击） */
  newbieUntil: string | null;
  /** 被动免战截止（城级：被攻破 / 被抢后；玩家与 NPC 都不能再打这座城） */
  truceUntil: string | null;
  /** 主动免战截止（账号级：开着时别人打不了他，含抢他的野地） */
  shieldUntil: string | null;
  /** 换主保护截止（v39 AISLG-123：野地刚被抢占后的保护期内谁都不能再抢；城池为 null） */
  ownerChangedUntil: string | null;
}

/** 单格详情（GET_TILE；v13 起 NPC 城池详情需侦察，v16 起下发掠夺冷却时间，
 *  v23 起任意侦察过的地块都带 scoutedAt） */
export interface TileDetailView extends TileView {
  garrisonDetail: ArmyCounts;
  /** 未占领野地的原住守军参考战力；其余为 0 */
  nativePower: number;
  /** 野地收益预览；非野地为 null */
  wilderness: { resource: TerrainResource; bonusRate: number; gatherRate: number } | null;
  /** NPC 城池驻军与库存（侦察快照）；未侦察或非 NPC 城为 null */
  npc: {
    garrison: ArmyCounts;
    stock: Resources;
    /** 侦察详细度（v27 AISLG-77）；缺省视为 exact */
    scoutDetail?: 'rough' | 'kinds' | 'exact';
    garrisonTotal?: { min: number; max: number };
  } | null;
  /** 最近一次侦察该地块的时间；从未侦察为 null */
  scoutedAt: string | null;
  /** 最近一次成功掠夺的时间（v16）；距其 24 小时内处于掠夺冷却，从未被掠为 null */
  plunderedAt: string | null;
}

/** 本城占领的野地（CityView.territory 元素） */
export interface TerritoryView {
  x: number;
  y: number;
  terrain: TerrainKind;
  level: number;
  resource: TerrainResource;
  /** 占领加成（/小时） */
  bonusRate: number;
  /** 驻军采集（/小时） */
  gatherRate: number;
  garrison: number;
  /** 所属连片块数（v23 AISLG-59；同地形 4 向相邻；单块为 1） */
  clusterSize: number;
  /** 连片产量加成（百分数：3–4 块 10 / ≥5 块 20；不足 3 块为 0） */
  clusterBonusPercent: number;
}

/** 出征任务（v16）：plunder 掠夺（缺省）/ occupy 占领；v26 transport 运输（目标限本账号另一座城，须带 cargo） */
export type MarchTask = 'plunder' | 'occupy' | 'transport';

/** 行军视图 */
export interface MarchView {
  id: string;
  fromCityId: string;
  /** plunder/occupy/scout/transfer/attack=目标地块；return=折返涉及的地块 */
  x: number;
  y: number;
  troops: ArmyCounts;
  /** v16 新增 plunder（掠夺）/ occupy（占领）/ reinforce（增援）；attack 仅存量在途行军 */
  purpose: 'plunder' | 'occupy' | 'reinforce' | 'attack' | 'scout' | 'transfer' | 'transport' | 'intercept' | 'return';
  status: 'marching' | 'arrived' | 'returned';
  initiator: InitiatorRole;
  startedAt: string;
  arriveAt: string;
  resolvedAt: string | null;
  /** 随行运送的资源（v26 AISLG-79；运输及其撤回 / 失效返程行军为 Resources，其余 null） */
  cargo: Resources | null;
  /** 截击的移动目标 id（v28 AISLG-78；purpose='intercept' 及其撤回后的返程行军有值，其余 null） */
  targetId: string | null;
  /** 截击埋伏开始时刻（v35 AISLG-112）：提前到达原地埋伏等目标经过；此时 arriveAt = 预计接战时刻。其余 null */
  ambushAt: string | null;
  /** 随队武将 id（v36 AISLG-114；返程沿用同一武将，回城后自然释放），其余 null */
  heroId: string | null;
}

/** 战报中一方的汇总（攻方 / 守方共用；v13） */
export interface BattleSideView {
  name: string;
  troops: ArmyCounts;
  losses: ArmyCounts;
  survivors: ArmyCounts;
  damage: number;
  /** 总单位数 = Σ troops（v21 AISLG-33；服务端按 troops 汇总下发） */
  units: number;
  /** 总血量 = Σ troops × 单兵生命（v21 AISLG-33） */
  totalHp: number;
  /** 编成平均射程（v21 AISLG-30，1 位小数；判断远程威胁用 maxRange / rangedUnits） */
  avgRange: number;
  /** 编成中单兵射程的最大值（v23 AISLG-49；空编成为 0）：对方远超我方即单方面压制信号 */
  maxRange: number;
  /** 远程单位数 = 射程超过近战基准（>10）的单位数（v23 AISLG-49） */
  rangedUnits: number;
  /** 该方武将（v36 AISLG-114/115）：攻方 = 随队武将、守方 = 城守（仅守城战）；未配将 / 历史战报为 null / 缺省 */
  hero?: BattleHeroView | null;
}

/** 战报的逐回合统计（v13） */
export interface BattleRoundLogEntryView {
  round: number;
  attackerDamage: number;
  defenderDamage: number;
  attackerKilled: number;
  defenderKilled: number;
  /** 本回合箭塔伤害（v30 AISLG-82；已含在 defenderDamage 内；缺省 0） */
  towerDamage?: number;
}

/** Agent 写回的战报点评（v23，AISLG-53；一份战报最新一条，重写覆盖） */
export interface BattleReportCommentView {
  text: string;
  updatedAt: string;
}

/** 战报视图（GET_BATTLE_REPORTS / PUSH_BATTLE_REPORT 共用；v13） */
export interface BattleReportView {
  id: number;
  x: number;
  y: number;
  kind: 'wilderness' | 'npc_city' | 'npc_raid' | 'city_raid' | 'intercept' | 'yellow_turban' | 'pvp_raid' | 'pvp_wilderness' | 'pvp_conquest';
  role: 'attacker' | 'defender';
  won: boolean;
  rounds: number;
  endReason: 'defender_wiped' | 'attacker_wiped' | 'round_limit' | 'no_contact';
  /** 未接战结果（v28 AISLG-78，仅 kind='intercept'）：missed 扑空 / gone 目标消失；此时 endReason='no_contact'、rounds=0 */
  contact?: 'missed' | 'gone';
  attacker: BattleSideView;
  defender: BattleSideView;
  wallDefensePercent: number;
  /** 箭塔造成的总伤害（v30 AISLG-82；已含在 defender.damage 内；缺省 0） */
  towerDamage?: number;
  /** 冲车破墙（v33 AISLG-86）：开战时城墙减伤原值 → 破墙后（百分数）；无冲车 / 非攻城战为缺省 */
  wallBreak?: { from: number; to: number };
  roundLog: BattleRoundLogEntryView[];
  /** Agent 点评（v23 AISLG-53）；尚无点评时为 null */
  comment: BattleReportCommentView | null;
  createdAt: string;
}

/** SCOUT 请求载荷（v13） */
export interface ScoutRequestData {
  x: number;
  y: number;
  count: number;
  /** v36（AISLG-114）：可选随队武将 id */
  heroId?: string | null;
}

export interface ScoutResponseData {
  march: MarchView;
}

/** RECALL_MARCH 请求载荷（v13） */
export interface RecallMarchRequestData {
  marchId: string;
}

export interface RecallMarchResponseData {
  march: MarchView;
}

/** GET_BATTLE_REPORTS 响应（v13） */
export interface GetBattleReportsResponseData {
  reports: BattleReportView[];
}

/** PUSH_BATTLE_REPORT（op 2007）推送载荷（v13） */
export interface BattleReportPushData {
  report: BattleReportView;
}

/** PUSH_BATTLE_REPORT_COMMENT（op 2009）推送载荷（v23 AISLG-53） */
export interface BattleReportCommentPushData {
  reportId: number;
  comment: BattleReportCommentView;
}

/** 侦察情报快照（march_completed 事件 detail.intel 与 scout_intel 表共用形态；v13，
 *  v23 AISLG-62 起前端用于渲染侦察报告） */
export interface ScoutIntel {
  x: number;
  y: number;
  kind: TileKind;
  terrain: TerrainKind;
  level: number;
  /** 地块占领者；无主为 null */
  owner: { username: string; cityName: string } | null;
  /** 地块驻军（侦察时刻的快照） */
  garrison: ArmyCounts;
  /** 守方城墙防御加成（百分数；其余 0） */
  wallDefensePercent: number;
  /** 侦察详细度（v27 AISLG-77）：rough 时 garrison 全 0、kinds 时各兵种为近似值；缺省视为 exact（历史情报） */
  detail?: 'rough' | 'kinds' | 'exact';
  /** 总兵力范围（v27）：exact 时 min = max */
  garrisonTotal?: { min: number; max: number };
  /** NPC 城池可掠夺库存快照；非 NPC 城为 null */
  npcStock: Partial<Record<'gold' | 'wood' | 'food' | 'stone' | 'iron', number>> | null;
  /** 情报获取时间（ISO 8601） */
  scoutedAt: string;
}

/** GET_STATE 响应的 cities 元素：账号全部城池（主城在前） */
export interface CityRefView {
  id: string;
  name: string;
  level: number;
  x: number | null;
  y: number | null;
  isMain: boolean;
}

/** GET_STATE 响应的 branch：分城名额（v24，AISLG-58） */
export interface BranchInfoView {
  /** 现有分城数（不含主城） */
  count: number;
  /** 分城上限 = floor(主城官府等级 ÷ 3) */
  limit: number;
  /** 占领 NPC 城所需的主城官府最低等级 */
  minGovernment: number;
}

/** GET_WORLD_MAP 响应 */
export interface WorldMapResponseData {
  size: number;
  x: number;
  y: number;
  w: number;
  h: number;
  tiles: TileView[];
}

/** MARCH 请求载荷：troops 至少一种 > 0；task 为 v16 出征任务（缺省 plunder） */
export interface MarchRequestData {
  x: number;
  y: number;
  troops: Partial<Record<TroopKind, number>>;
  task?: MarchTask;
  /** v28（AISLG-78）：截击移动目标——目标 id；此时 (x, y) 须是该目标路线上尚未过去的格 */
  targetId?: string;
  /** v26：task='transport' 必填，五项非负整数、总量 ≥ 1 且 ≤ 编队负重 */
  cargo?: Partial<Resources>;
  /** v36（AISLG-114）：可选随队武将 id（一支部队至多一名；城守 / 重伤 / 欠饷 / 已随行的不可选） */
  heroId?: string | null;
}

export interface MarchResponseData {
  march: MarchView;
}

/** RECALL_GARRISON 响应：地块无驻军时 march 为 null（占领同时清除） */
export interface RecallGarrisonResponseData {
  march: MarchView | null;
}

/** PUSH_MARCH_STATE（op 2005）推送载荷 */
export interface MarchStatePushData {
  reason: 'march_started' | 'march_arrived' | 'march_returned';
  march: MarchView;
}

/** PUSH_TILE_STATE（op 2006）推送载荷 */
export interface TileStatePushData {
  reason:
    | 'wilderness_occupied'
    | 'wilderness_lost'
    | 'npc_city_occupied'
    | 'npc_attack_repelled'
    | 'garrison_reinforced'
    /** v40（AISLG-124）：分城被玩家占领易主 / 城防值被打掉一截 */
    | 'city_conquered'
    | 'city_durability_hit';
  tile: TileView;
}
