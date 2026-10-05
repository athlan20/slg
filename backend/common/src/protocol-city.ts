// 城池操作协议的载荷类型（BUILD / UPGRADE / CANCEL_BUILD / RENAME_CITY / RESET_ACCOUNT）。
// 从 protocol.ts 拆出以控制单文件行数；protocol.ts 以 `export type { ... } from` 原名再导出，
// 既有 import 路径不变。建造与升级的数值规则见 common/src/rules.ts。

import type {
  ArmyCounts,
  BuildingCounts,
  BuildingKind,
  InitiatorRole,
  RecruitView,
  Resources,
} from './protocol';
import type { MarchView, TerritoryView } from './protocol-world';
import type { TechLevels } from './tech';

/** BUILD（op 21）请求载荷：kind 缺失或不是已知建筑类型时返回 INVALID_PARAMS */
export interface BuildRequestData {
  kind: BuildingKind;
}

/** UPGRADE（op 22）请求载荷：把该类型建筑升到下一等级 */
export interface UpgradeRequestData {
  kind: BuildingKind;
}

export interface BuildResponseData {
  build: BuildView;
}

/** 兼容入口 BUILD_FARM（op 20）的响应，结构与 BUILD 一致 */
export interface BuildFarmResponseData {
  build: BuildView;
}

export interface BuildStatePushData {
  /** build_started=立即开工或从队列激活；build_queued=进入排队（v4）；build_completed=完成；build_cancelled=排队条目被取消（v7） */
  reason: 'build_started' | 'build_queued' | 'build_completed' | 'build_cancelled';
  build: BuildView;
}

/** CANCEL_BUILD（op 24）请求载荷：取消排队中的建造条目并全额返还其成本（已确认规则） */
export interface CancelBuildRequestData {
  buildId: string;
}

export interface CancelBuildResponseData {
  build: BuildView;
}

/** RENAME_CITY（op 25）请求载荷：为当前城池改名 */
export interface RenameCityRequestData {
  /** 1..24 字符（去首尾空白后） */
  name: string;
}

export interface RenameCityResponseData {
  cityId: string;
  name: string;
}

/** PUSH_CITY_STATE（op 2002）推送载荷：城池级状态变化 */
export interface CityStatePushData {
  /** city_renamed=城池改名；account_reset=账号数据被重置（v8 起无拆除类 reason） */
  reason: 'city_renamed' | 'account_reset';
  cityId: string;
  /** reason=city_renamed 时的新名称 */
  name?: string;
}

/** RESET_ACCOUNT（op 26）请求载荷：重置为不可逆操作，confirm 必须显式为 true */
export interface ResetAccountRequestData {
  confirm: boolean;
}

/** RESET_ACCOUNT 响应载荷：重置完成后的城池现状（即开号初始状态） */
export interface ResetAccountResponseData {
  city: CityView;
}

/** 单一建筑类型的下一步动作成本（v6，随 GET_STATE 的 city.costs 下发） */
export interface KindActionCosts {
  /** 建造成本；已建成时为 null */
  build: Resources | null;
  /** 升到下一等级的成本；未建造或已达上限时为 null */
  upgrade: Resources | null;
  /** 建造时长（秒，v25 AISLG-71；已按当前全局时间缩放折算）；与 build 同 null 语义 */
  buildSeconds: number | null;
  /** 升到下一等级的时长（秒，v25 AISLG-71；已按当前全局时间缩放折算）；与 upgrade 同 null 语义 */
  upgradeSeconds: number | null;
}

/** 每小时产量视图（v7 起含 gold：官府自动产金；其余资源由对应生产建筑产出） */
export interface ProductionRates {
  gold: number;
  food: number;
  wood: number;
  stone: number;
  iron: number;
}

/** 人口现状（v7）：民房提供上限，人口随时间增长，征兵时消耗（征兵协议后续版本引入） */
export interface PopulationView {
  /** 当前人口（懒结算后的整数） */
  current: number;
  /** 人口上限 = 100 × 民房等级 × (民房等级 + 1)，无民房为 0（v8 确认规则） */
  cap: number;
  /** 每小时增长（未达上限时；达上限后停止增长） */
  growthPerHour: number;
}

/** 储量上限（v8 确认规则）：四资源各自 = 10000 + 基础小时产量 × 100，金币固定 100 万；仓库不改变上限 */
export interface StorageCaps {
  gold: number;
  food: number;
  wood: number;
  stone: number;
  iron: number;
}

export const EventType = {
  BUILD_STARTED: 'build_started',
  /** v4：建造进入排队（未立即开工） */
  BUILD_QUEUED: 'build_queued',
  BUILD_COMPLETED: 'build_completed',
  /** v7：排队条目被取消（成本全额返还，已确认规则） */
  BUILD_CANCELLED: 'build_cancelled',
  /** v7：城池改名 */
  CITY_RENAMED: 'city_renamed',
  /** v9：账号数据被一键重置（游戏数据回到开号初始状态） */
  ACCOUNT_RESET: 'account_reset',
  /** v11：征兵开始（立即征募或队首激活） */
  RECRUIT_STARTED: 'recruit_started',
  /** v11：征兵进入排队 */
  RECRUIT_QUEUED: 'recruit_queued',
  /** v11：征兵完成（兵力入城） */
  RECRUIT_COMPLETED: 'recruit_completed',
  /** v11：排队征兵条目被取消（资源与人口全额返还） */
  RECRUIT_CANCELLED: 'recruit_cancelled',
  /** v12：行军出发（出征或召回返程） */
  MARCH_STARTED: 'march_started',
  /** v12：行军到达并结算（含战斗胜负、掠夺与占领结果，见 detail.outcome） */
  MARCH_COMPLETED: 'march_completed',
  /** v12：野地被占领（detail.terrain / level / 加成） */
  WILDERNESS_OCCUPIED: 'wilderness_occupied',
  /** v12：野地占领失效（detail.cause = npc_attack / recall / conquest） */
  WILDERNESS_LOST: 'wilderness_lost',
  /** v12：NPC 城池被占领为分城（NPC 城池有限存量，被占后不补充） */
  NPC_CITY_OCCUPIED: 'npc_city_occupied',
  /** v12：NPC 袭击玩家占领的野地（detail.outcome = garrison_lost / repelled） */
  NPC_RAID: 'npc_raid',
  /** v23：NPC 袭击预警（AISLG-57，detail = { x, y, target, terrain, level, armyMin, armyMax, arriveAt, attackId }） */
  NPC_ATTACK_WARNING: 'npc_attack_warning',
  /** v22：集市兑换成交（detail.resource / amount / gold / rate） */
  RESOURCE_EXCHANGED: 'resource_exchanged',
  /** v27：科技研究开始（AISLG-77，detail = { tech, level, cost, cityId, dueAt }） */
  RESEARCH_STARTED: 'research_started',
  /** v27：科技研究完成（detail = { tech, level }；等级账号共享、全城生效） */
  RESEARCH_COMPLETED: 'research_completed',
  /** v27：研究被取消（detail = { tech, level, refund }，成本全额返还） */
  RESEARCH_CANCELLED: 'research_cancelled',
  /** v28：流寇路过玩家野地顺手掠夺（AISLG-78，detail = { x, y, resource, amount, targetId }） */
  BANDIT_PLUNDERED: 'bandit_plundered',
  /** v34：断粮预警（AISLG-107，detail = { cityId, cityName, starveAt, foodNetPerHour }） */
  STARVATION_WARNING: 'starvation_warning',
  /** v34：断粮哗变（AISLG-107，detail = { cityId, cityName, losses, total, nextAt }；城内驻军每兵种减 10%） */
  MUTINY: 'mutiny',
  // v36（AISLG-114/115/116）：武将
  HERO_RECRUITED: 'hero_recruited',
  HERO_DISMISSED: 'hero_dismissed',
  HERO_ARREARS: 'hero_arrears',
  HERO_WOUNDED: 'hero_wounded',
  HERO_LEVEL_UP: 'hero_level_up',
  HERO_GRANTED: 'hero_granted',
  GUARD_CHANGED: 'guard_changed',
  /** v29：黄巾之乱结算奖励（AISLG-76，detail = { rank, killed, tier, reward, reason }） */
  YT_REWARD: 'yt_reward',
  /** v38：玩家部队来袭预警（AISLG-122，detail = { x, y, target, 敌情（烽火台分档）, attacker, arriveAt, marchId }） */
  PLAYER_ATTACK_WARNING: 'player_attack_warning',
  /** v38：玩家攻城结算（AISLG-122，守方视角，detail = { attacker, outcome = repelled / garrison_lost, loot, truceUntil, reportId, ... }） */
  PVP_RAID: 'pvp_raid',
  /** v38：主动免战开启（AISLG-122，detail = { until, nextAvailableAt }） */
  TRUCE_STARTED: 'truce_started',
  /** v38：新手保护提前结束（AISLG-122，detail = { cause = government / aggression, ... }） */
  NEWBIE_PROTECTION_ENDED: 'newbie_protection_ended',
  /** v40：分城易主（AISLG-124；原主人 outcome=lost / 新主人 outcome=gained，detail 含城池、对方、坐标） */
  CITY_CONQUERED: 'city_conquered',
  AGENT_CONNECTED: 'agent_connected',
  AGENT_DISCONNECTED: 'agent_disconnected',
} as const;

export type EventType = (typeof EventType)[keyof typeof EventType];

/** 建造状态视图（推送与查询共用同一结构） */
export interface BuildView {
  id: string;
  /** 所属城池（v24，AISLG-58）：主城或分城；多城时客户端据此区分推送属于哪座城 */
  cityId: string;
  kind: BuildingKind;
  /** v4 起含 'queued'：排队中（排在在建之后，dueAt 为 null）；v7 起含 'cancelled'：被取消（退出队列，保留为历史） */
  status: 'building' | 'queued' | 'completed' | 'cancelled';
  /** 目标等级（v5）：建造恒为 1，升级为当前等级 + 1；连续升级（v22）为「当前推进中的目标等级」 */
  level: number;
  /** 连续升级的目标等级（v22，AISLG-43）：UPGRADE toLevel 生效时为整链终点（level .. toLevel 逐级推进）；
   *  单级升级与建造为 null */
  toLevel: number | null;
  /** 发起原始指令的连接声明的登录类型 */
  initiator: InitiatorRole;
  startedAt: string;
  /** 预计到期时间；排队中（queued）为 null */
  dueAt: string | null;
  completedAt: string | null;
}


export interface CityView {
  id: string;
  name: string;
  /** 城池数字等级（v7；提升条件与作用待设计，当前恒为 1） */
  level: number;
  resources: Resources;
  /** 按建筑类型统计的已建数量（v3 新增；v5 单实例规则下为 0 或 1） */
  buildings: BuildingCounts;
  /** 各建筑类型的当前等级（v5 新增；0 = 未建造，产量按等级 × 每级速率计算） */
  levels: BuildingCounts;
  /** 各建筑「下一步动作」成本（v6 新增）：build=建造（未建时），upgrade=升级（已建未满级时），null=不可用 */
  costs: Record<BuildingKind, KindActionCosts>;
  /** 兼容字段：已建成的农场数量（= buildings.farm；v2 及以前的客户端使用） */
  farms: number;
  /** 当前小时产量，按资源归集（v3 新增；v7 起含官府产金；离线期间照常累积，读取时结算） */
  production: ProductionRates;
  /** 人口现状（v7 新增）：上限来自民房，随时间增长，征兵时消耗 */
  population: PopulationView;
  /** 储量上限（v7 新增，v8 规则确认）：四资源各自 = 10000 + 基础小时产量 × 100，金币固定 100 万；达到上限后停止产出增长 */
  storage: StorageCaps;
  /** 城内驻军，按兵种统计（v11 新增；征兵完成时入城） */
  army: ArmyCounts;
  /** 全军小时耗粮（v14 新增）：城内驻军 1 倍 + 行军/野地驻军 2 倍；production.food 为毛产量，净粮 = production.food − 本值；粮食扣到 0 为止（断粮仅停止增长） */
  armyFoodUsePerHour: number;
  /** 全局时间缩放（v20 新增，AISLG-38）：当前部署 time_scale——文档时长基准 ÷ 本值 = 实际耗时
   *  （钳 1 秒），速率基准 × 本值；客户端本地折算时长（如掠夺冷却剩余）时用本值，勿按文档数值硬算 */
  timeScale: number;
  /** 主城免战截止（v22 新增，AISLG-40 方案 A）：主城被 NPC 攻破后 2×袭击间隔内不再入袭击
   *  目标池（随 timeScale 缩放）；从未被攻破为 null。到期自动回到目标池，无事件。
   *  v38（AISLG-122）起被玩家攻破 / 被抢后同样写入本字段（4 小时基准随缩放），玩家与 NPC 共用 */
  truceUntil: string | null;
  /** 新手保护截止（v38，AISLG-122，账号级）：注册后 3 天或任一城官府到 5 级先到为准；期内别人
   *  不能侦察 / 攻击他，他自己侦察 / 攻击其他玩家即失效（打野地 / NPC 不失效）。已出保为 null */
  newbieUntil: string | null;
  /** 主动免战截止（v38，AISLG-122，账号级）：TRUCE 开启后 12 小时基准随缩放；开着时别人打不了
   *  他、他也不能出兵打玩家（打野地 / NPC 不受影响）。未开启为 null */
  shieldUntil: string | null;
  /** 下一次可开启主动免战的时刻（v38，AISLG-122；每周一次，ISO 8601）；当前可开启为 null */
  shieldNextAt: string | null;
  /** 分城城防值（v40，AISLG-124；0..100，随免战后回涨惰性结算；主城为 null——永不被占领） */
  durability: number | null;
  /** 名城名（v24 AISLG-56）：占领名城得到的分城带名；普通城为 null */
  famousName: string | null;
  /** 该城的独占产量加成百分数（v24 AISLG-56：名城分城 +20%，已计入 production）；普通城为 0 */
  productionBonusPercent: number;
  /** 城守（v36，AISLG-115）：该城任命的武将（ASSIGN_HERO 任命 / 撤任）；未任为 null。
   *  产量加成已计入 production（四资源非金，智力 × 0.1% 封顶 5%）；守城战另享攻防加成 */
  guard: {
    heroId: string;
    name: string;
    famous: boolean;
    lead: number;
    force: number;
    wit: number;
    level: number;
    /** 产量加成（百分数） */
    bonusPercent: number;
  } | null;
  /** 征兵队列（v11 新增）：第 1 项为征募中（dueAt 非空），其余为排队（dueAt 为 null）；已取消条目不在其中 */
  recruitQueue: RecruitView[];
  /** 城墙守城防御加成（v11 新增，占位 = 城墙等级 × 5，百分数数值；战斗结算上线后由其消费） */
  defenseBonus: number;
  /** 预计断粮时间（v34 AISLG-107；ISO 8601）：按当前粮食与净产量（粮毛产量 − 全军耗粮）推算；已断粮 = 当前时刻；
   *  净产量不为负（不会断粮）为 null。距断粮不足 1 小时（缩放后）会推送一次 PUSH_STARVATION_STATE 预警 */
  starveAt: string | null;
  /** 下一次断粮哗变的时刻（v34）：已断粮（粮食 0 且净产量为负）时有值——到点本城城内驻军每兵种减 10%；否则 null */
  mutinyNextAt: string | null;
  /** 在外部队数与上限（v30，AISLG-80）：count = 本城行军中 + 返程中 + 驻守野地的部队数（不计城内驻军），
   *  limit = 校场等级（未建按 1）；count ≥ limit 时新出征 / 侦察被拒（DEPLOY_LIMIT），已在外的部队不受影响 */
  deploy: { count: number; limit: number };
  /** 箭塔数值（v30，AISLG-82）：本城守城战中每回合固定伤害与射程；未建箭塔为 null */
  tower: { damage: number; range: number } | null;
  /** 账号科技等级（v27 AISLG-77；全账号共享，已计入 production / storage / defenseBonus，客户端据此折算负重与行军预估） */
  techs: TechLevels;
  /** 本城进行中的行军（v12 新增；到达与返程由服务端结算并推送 / 事件记录） */
  marches: MarchView[];
  /** 本城占领的野地（v12 新增；含占领加成与驻军采集速率，production 已计入两者） */
  territory: TerritoryView[];
  /** 建造队列（v4 新增）：第 1 项为在建（无在建时为空数组），其余为排队，按入队顺序 */
  queue: BuildView[];
  /** 兼容字段：当前在建建筑（= queue[0]，仅当其 status 为 building；无在建为 null） */
  building: BuildView | null;
}

export interface EventView {
  id: number;
  type: EventType;
  initiator: InitiatorRole | null;
  cityId: string | null;
  buildId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}
