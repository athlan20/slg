// 协议载荷补齐（v65 镜像）：各 op 的请求 / 响应类型与枚举守卫，原样镜像自 backend/common/src 的
// protocol.ts 与各 protocol-*.ts，供 protocol.ts 再导出。唯一事实来源是后端；协议调整时以后端为准同步。

import type { ErrorCode, InitiatorRole, BuildingKind, BuildView, TroopKind } from './protocol';
import { TROOP_KINDS } from './protocol';
import type { AgentPlanView, EventView } from './protocol-session';
import type { TileDetailView, TerrainKind, BattleReportCommentView, MarchTask } from './protocol-world';
import { TERRAIN_KINDS } from './protocol-world';
import type { AgentDailyReportView } from './protocol-agent';
import type { ServerBroadcastType, LeaderboardKind } from './protocol-server';
import { SERVER_BROADCAST_TYPES, LEADERBOARD_KINDS } from './protocol-server';
import type { YtEventView, YtCampView, YtContributionView, YtRewardTierView, YtTier } from './protocol-yt';
import type { MovingTargetView, MovingKind } from './protocol-moving';
import type { ArenaStateView } from './protocol-arena';
import type { FormationKind } from './protocol-combat';
import type { StarTowerStateView } from './protocol-star-tower';
import type { TechStateView, TechKind, ResearchView } from './protocol-tech';
import { TECH_KINDS } from './protocol-tech';

export function isInitiatorRole(value: unknown): value is InitiatorRole {
  return value === 'player' || value === 'agent';
}

/** Resources 的全部字段（遍历成本 / 校验时使用，勿用 Object.keys 于具体对象） */
export const RESOURCE_KEYS = ['gold', 'wood', 'food', 'stone', 'iron'] as const;

/**
 * 第一期可建造的建筑类型（docs/phase-1-launch-scope.md「城池、建筑与经济」，每种同城限一座）：
 * 四种资源生产建筑 + 民房 / 官府 / 军营 / 仓库 / 城墙；v27（AISLG-77）起加书院（科技研究）；v30（AISLG-80~83）起加校场 / 烽火台 / 驿站 / 箭塔。数值与成本见 common/src/rules.ts 的 BUILDING_INFO。
 */
export const BUILDING_KINDS = [
  'farm',
  'lumber_mill',
  'quarry',
  'iron_mine',
  'house',
  'government',
  'barracks',
  'warehouse',
  'wall',
  'academy',
  'parade_ground',
  'beacon',
  'post_station',
  'arrow_tower',
  'tavern',
] as const;

export function isBuildingKind(value: unknown): value is BuildingKind {
  return typeof value === 'string' && (BUILDING_KINDS as readonly string[]).includes(value);
}

export interface ErrorBody {
  code: ErrorCode;
  message: string;
}

export interface LoginRequestData {
  username: string;
  password: string;
  /** 本次是否以 Agent 身份登录 */
  asAgent: boolean;
  /**
   * 会话令牌登录方式（与 password 互斥）：提供 token 时不校验用户名密码，
   * 账号由服务端从会话解析。用于持久保存令牌后的免密自动登录。
   */
  token?: string;
  /** 可选（v32）：调用方手上 agent-api.md 的协议版本；低于当前版本时 Agent 连接的响应附 docNotice */
  docVersion?: number;
  /**
   * 可选（v50，AISLG-133）：Agent 自报的驱动模型名（如 claude-opus-5-5、gpt-5、自己写的
   * 脚本名），1..64 字符（超长截断）。仅 asAgent=true 时生效并记到账号（以最近一次声明
   * 为准，不填保留上次）；自报不验证，仅用于排行榜展示（标注「自报」）。玩家登录忽略。
   */
  agentModel?: string;
}

export interface LoginResponseData {
  accountId: string;
  username: string;
  role: InitiatorRole;
  /** 会话令牌：密码登录返回新签发的令牌；令牌登录原样返回（已滑动续期） */
  sessionToken: string;
  /** 会话过期时间（ISO 8601）；每次令牌登录成功都会续期 */
  expiresAt: string;
  /** 服务端当前协议版本（v32） */
  protocolVersion: number;
  /** 文档更新提示（v32，仅 Agent 连接；文档已是最新或玩家连接为 null） */
  docNotice: string | null;
  /** 当前赛季（v65，AISLG-134）：id 与本季结束时刻；登录时已惰性加入本赛季 */
  season: { id: number; endsAt: string };
}

export interface GetEventsRequestData {
  /** 返回条数上限，1..200，默认 50 */
  limit?: number;
  /** 与 sinceId 二选一：分页游标，返回 id 小于它的最新事件 */
  beforeId?: number;
  /** 与 beforeId 二选一：增量游标，返回 id 大于它的旧→新事件 */
  sinceId?: number;
}

export interface GetAgentInfoResponseData {
  agentOnline: boolean;
  connections: Array<{ role: InitiatorRole; connectedAt: string }>;
  /** Agent 最近一次上报的计划（v10；从未上报为 null） */
  plan: AgentPlanView | null;
  // directive（玩家设置的作战方针快照，v23）已随 v49 移除：方针改为玩家与自己的 Agent 直接讨论。
  recentEvents: EventView[];
  /** 账号是否已绑定 Google（v44；服务端没配置 Google Client ID 时恒为 false） */
  googleBound: boolean;
  /** 账号是否已绑定 GitHub（v45；服务端没配置 GitHub OAuth App 时恒为 false） */
  githubBound: boolean;
  /** 绑定的 GitHub 用户名（v45；未绑定为 null） */
  githubLogin: string | null;
}

export interface AgentStatusPushData {
  online: boolean;
  at: string;
}

export function isTroopKind(value: unknown): value is TroopKind {
  return typeof value === 'string' && (TROOP_KINDS as readonly string[]).includes(value);
}

/** GET_WORLD_MAP（op 30）请求载荷：窗口左上角与尺寸，缺省以主城为中心取 DEFAULT_MAP_WINDOW */
export interface WorldMapRequestData {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
}

/** GET_TILE（op 31）请求载荷 */
export interface GetTileRequestData {
  x: number;
  y: number;
}

export interface GetTileResponseData {
  tile: TileDetailView;
}

/** RECALL_GARRISON（op 33）请求载荷：撤回本账号占领地块的全部驻军（同时放弃占领） */
export interface RecallGarrisonRequestData {
  x: number;
  y: number;
}

export function isTerrainKind(value: unknown): value is TerrainKind {
  return typeof value === 'string' && (TERRAIN_KINDS as readonly string[]).includes(value);
}

/** 地块类别：野地 / NPC 城池 / 玩家城池（主城与分城） */
export const TILE_KINDS = ['wilderness', 'npc_city', 'city'] as const;

/** GET_BATTLE_REPORTS（op 36）请求载荷 */
export interface GetBattleReportsRequestData {
  /** 返回条数上限，1..50，默认 20 */
  limit?: number;
  /** 分页游标：返回 id 小于它的最新战报（与 limit 组合） */
  beforeId?: number;
}

/** AGENT_COMMENT_REPORT（op 39）请求载荷（v23，AISLG-53；仅 Agent 连接） */
export interface AgentCommentReportRequestData {
  /** 战报 id（须为本账号持有的战报） */
  reportId: number;
  /** 点评正文，trim 后 1..200 字符；建议大白话复盘（为什么输 / 下次带什么兵），不出现字段名 */
  text: string;
}

export interface AgentCommentReportResponseData {
  reportId: number;
  comment: BattleReportCommentView;
}

/** 行军目的（marches.purpose 的合法取值；v16 起 attack 仅存量在途行军使用） */
export const MARCH_PURPOSES = ['attack', 'scout', 'transfer', 'return', 'plunder', 'occupy', 'reinforce', 'transport', 'intercept', 'assist', 'caravan'] as const;

export function isMarchPurpose(value: unknown): value is MarchPurpose {
  return typeof value === 'string' && (MARCH_PURPOSES as readonly string[]).includes(value);
}

/**
 * 出征任务（MARCH.task，v16）：plunder=掠夺（缺省）、occupy=占领。只作用于
 * 出征类目标（野地 / NPC 城）；侦察、调兵、增援、返程不接受 task。
 * v26（AISLG-79）：transport=运输，目标只能是本账号的另一座城，须带 cargo。
 */
export const MARCH_TASKS = ['plunder', 'occupy', 'transport', 'assist'] as const;

export function isMarchTask(value: unknown): value is MarchTask {
  return typeof value === 'string' && (MARCH_TASKS as readonly string[]).includes(value);
}

export type MarchPurpose = (typeof MARCH_PURPOSES)[number];

/** AGENT_DAILY_REPORT（op 40）请求载荷：text trim 后 1..500 字符 */
export interface AgentDailyReportRequestData {
  text: string;
}

export interface AgentDailyReportResponseData {
  report: AgentDailyReportView;
}

export interface GetServerBroadcastsRequestData {
  /** 返回条数上限，1..50，默认 20 */
  limit?: number;
}

export function isServerBroadcastType(value: unknown): value is ServerBroadcastType {
  return typeof value === 'string' && (SERVER_BROADCAST_TYPES as readonly string[]).includes(value);
}

export function isLeaderboardKind(value: unknown): value is LeaderboardKind {
  return typeof value === 'string' && (LEADERBOARD_KINDS as readonly string[]).includes(value);
}

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

/** GET_YELLOW_TURBAN（op 48）响应 */
export interface GetYellowTurbanResponseData {
  /** 当前进行中的事件；没有为 null（nextEventAt 给出下一轮预计起事时刻） */
  event: YtEventView | null;
  /** 没有进行中事件时：下一轮预计起事时刻（上一轮开始后 3 天，随时间缩放）；未知为 null */
  nextEventAt: string | null;
  /** 当前存在的营地与老巢（含坐标，按档位 / 坐标排序） */
  camps: YtCampView[];
  /** 本账号的贡献与名次；本轮没有贡献为 null */
  me: { killed: number; rank: number } | null;
  /** 贡献榜前 10 名 */
  top: YtContributionView[];
  /** 名次奖励档位 */
  rewards: YtRewardTierView[];
}

/** 营地档位：小 / 中 / 大；boss 为张角老巢（同表存储，tier='boss'） */
export const YT_TIERS = ['small', 'medium', 'large', 'boss'] as const;

export function isYtTier(value: unknown): value is YtTier {
  return typeof value === 'string' && (YT_TIERS as readonly string[]).includes(value);
}

/** GET_MOVING_TARGETS（op 47）响应：当前存在的全部移动目标（按截止时刻升序） */
export interface GetMovingTargetsResponseData {
  targets: MovingTargetView[];
}

export const MOVING_KINDS = ['caravan', 'bandit'] as const;

export function isMovingKind(value: unknown): value is MovingKind {
  return typeof value === 'string' && (MOVING_KINDS as readonly string[]).includes(value);
}

export type GetArenaResponseData = ArenaStateView;

/** SET_ARENA_LINEUP（op 74）请求：3 个号位的武将 id，空位用 null；至少 1 名，不能重复 */
export interface SetArenaLineupRequestData {
  /** Omission preserves saved templates for existing clients. */
  formations?: FormationKind[];
  heroIds: Array<string | null>;
}

export type SetArenaLineupResponseData = ArenaStateView;

/** ARENA_CHALLENGE（op 75）请求 */
export interface ArenaChallengeRequestData {
  /** 对手席位 id（GET_ARENA 的 opponents[].entryId） */
  entryId: string;
}

/** GET_ARENA_REPORTS（op 76）请求 */
export interface GetArenaReportsRequestData {
  /** 条数上限，1..50，默认 20 */
  limit?: number;
  /** 只取 id 小于它的更早战报（翻页） */
  beforeId?: number;
}

export type GetStarTowerResponseData = StarTowerStateView;

/** GET_STAR_TOWER_REPORTS（op 85）请求 */
export interface GetStarTowerReportsRequestData {
  /** 条数上限，1..50，默认 20 */
  limit?: number;
  /** 只取 id 小于它的更早战报（翻页） */
  beforeId?: number;
}

/** 正文上限（过滤后按字符计） */
export const ANNOUNCEMENT_BODY_MAX_CHARS = 4000;

/** 标题上限（按字形计，一个表情算 1 个字） */
export const ANNOUNCEMENT_TITLE_MAX_CHARS = 30;

/** TRUCE（op 53）请求载荷：开启主动免战，无参数 */
export interface TruceRequestData {}

/** TRUCE（op 53）响应载荷 */
export interface TruceResponseData {
  /** 免战截止时刻（ISO 8601，本次开启 12 小时基准随缩放） */
  shieldUntil: string;
  /** 下一次可开启时刻（ISO 8601；本周期内再次开启返回 TRUCE_WEEKLY_USED） */
  nextAvailableAt: string;
}

/** GET_TECHS（op 44）请求：可选 cityId（城池类协议通用，缺省主城），指定用哪座城的书院判定 academyOk */
export interface GetTechsRequestData {
  cityId?: string;
}

export type GetTechsResponseData = TechStateView;

/** RESEARCH_TECH（op 45）请求 */
export interface ResearchTechRequestData {
  /** 科技类型 */
  tech: TechKind;
  /** 可选：发起研究 / 扣资源的城（缺省主城）；该城书院等级须 ≥ 目标等级 */
  cityId?: string;
}

export interface ResearchTechResponseData {
  research: ResearchView;
}

/** CANCEL_RESEARCH（op 46）请求：取消账号进行中的研究并全额返还 */
export interface CancelResearchRequestData {
  /** 可选：研究记录 id；缺省取进行中的那一项 */
  researchId?: string;
}

export interface CancelResearchResponseData {
  research: ResearchView;
}

export function isTechKind(value: unknown): value is TechKind {
  return typeof value === 'string' && (TECH_KINDS as readonly string[]).includes(value);
}
