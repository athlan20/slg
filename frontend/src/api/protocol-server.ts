// 全服维度协议的类型镜像（v23）：全服战况播报（AISLG-60）与全服排行榜
// （AISLG-61）。唯一事实来源是 backend/common/src/protocol-server.ts；
// protocol.ts 原名再导出，既有 import 路径不变。

/** 排行榜类别（v23 AISLG-61；v50 AISLG-133 新增 model 模型榜） */
import type { TroopKind } from './protocol';

export const LEADERBOARD_KINDS = ['power', 'territory', 'plunder', 'model'] as const;

export type LeaderboardKind = (typeof LEADERBOARD_KINDS)[number];

/** 排行榜单行（agentOnline = 查询时刻该账号是否有在线 Agent 连接） */
export interface LeaderboardEntryView {
  rank: number;
  accountId: string;
  username: string;
  cityName: string;
  value: number;
  agentOnline: boolean;
  /** Agent 自报的模型名原文（v50；null = 从未声明）。自报不验证，展示标注「自报」 */
  agentModel: string | null;
}

/** 模型榜单行（v50，AISLG-133） */
export interface ModelLeaderboardEntryView {
  rank: number;
  /** 归类标识：undeclared 未声明 / other 其他 / 名单内模型 id */
  modelId: string;
  /** 展示名（如 Claude Opus 5.5、未声明、其他） */
  label: string;
  /** 该模型最近 7 天 Agent 上线过、且进了战力统计的账号数 */
  players: number;
  /** 该模型实力前 10 名的平均战力（排名依据） */
  value: number;
  /** 该模型战力第一的玩家（展示用） */
  topPlayer: { username: string; value: number } | null;
}

/** GET_LEADERBOARD 响应载荷 */
export interface GetLeaderboardResponseData {
  kind: LeaderboardKind;
  updatedAt: string;
  /** 前 50 名（玩家三榜）；kind=model 为空数组 */
  entries: LeaderboardEntryView[];
  /** 我的名次与数值；kind=model 恒为 null */
  me: { rank: number; value: number } | null;
  /** 模型榜条目（仅 kind=model） */
  modelEntries?: ModelLeaderboardEntryView[];
}

/** 排行榜弹窗的数据视图（当前榜 + 快照） */
export type LeaderboardView = GetLeaderboardResponseData;

/** 全服播报类型（v23 AISLG-60） */
export const SERVER_BROADCAST_TYPES = [
  'npc_city_emptied',
  'gold_mine_first',
  'city_broken',
  'win_streak',
  // v29 AISLG-76 黄巾之乱：起事 / 坐大 / 老巢出现 / 老巢首杀 / 收场
  'yt_started',
  'yt_grown',
  'yt_boss',
  'yt_boss_first_kill',
  'yt_finished',
  // v36 AISLG-115 名将获得：全服唯一的追求目标
  'hero_granted',
  // v40 AISLG-124 玩家占领玩家分城
  'city_conquered',
] as const;

export type ServerBroadcastType = (typeof SERVER_BROADCAST_TYPES)[number];

/** 全服播报视图（GET_SERVER_BROADCASTS / PUSH_SERVER_BROADCAST 共用） */
export interface ServerBroadcastView {
  id: number;
  type: ServerBroadcastType;
  /** 按类型解释（username/cityName/x/y/level/streak），文案拼装在 mapping */
  detail: Record<string, unknown>;
  createdAt: string;
}

/** GET_SERVER_BROADCASTS 响应载荷 */
export interface GetServerBroadcastsResponseData {
  broadcasts: ServerBroadcastView[];
}

/** PUSH_SERVER_BROADCAST（op 2011）推送载荷 */
export interface ServerBroadcastPushData {
  broadcast: ServerBroadcastView;
}

/** PUSH_NPC_ATTACK_WARNING（op 2010）推送载荷（v23 AISLG-57） */
/** 玩家部队来袭预警（v38 AISLG-122，op 2017）：与 NPC 来袭预警同构，另带 attacker 进攻方；
 *  v39（AISLG-123）起 target 另有 'wilderness'（抢占他人野地） */
export interface PlayerAttackWarningPushData {
  marchId: string;
  x: number;
  y: number;
  target: 'city' | 'wilderness';
  /** 目标地形（仅 wilderness；city 为 null） */
  terrain: string | null;
  /** 目标等级（仅 wilderness；city 为 0） */
  level: number;
  /** 进攻方（发起 MARCH 的账号与出发城） */
  attacker: { username: string; cityId: string; cityName: string };
  armyMin: number;
  armyMax: number;
  /** 敌情详细度（由被袭击城烽火台等级决定）：缺省视为 range */
  intel?: 'range' | 'kinds' | 'exact';
  beaconLevel?: number;
  armyKinds?: Partial<Record<TroopKind, { min: number; max: number }>>;
  army?: Partial<Record<TroopKind, number>>;
  arriveAt: string;
}

export interface NpcAttackWarningPushData {
  attackId: string;
  x: number;
  y: number;
  target: 'wilderness' | 'city';
  terrain: string | null;
  level: number;
  /** 进攻方（v38 AISLG-122 玩家来袭预警，op 2017 归一化进本形态时携带；NPC 预警无） */
  attacker?: { username: string; cityId: string; cityName: string };
  armyMin: number;
  armyMax: number;
  /** 敌情详细度（v31 AISLG-81，由被袭击城烽火台等级决定）：缺省视为 range */
  intel?: 'range' | 'kinds' | 'exact';
  beaconLevel?: number;
  armyKinds?: Partial<Record<TroopKind, { min: number; max: number }>>;
  army?: Partial<Record<TroopKind, number>>;
  arriveAt: string;
}
