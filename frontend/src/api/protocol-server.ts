// 全服维度协议的类型镜像（v23）：全服战况播报（AISLG-60）与全服排行榜
// （AISLG-61）。唯一事实来源是 backend/common/src/protocol-server.ts；
// protocol.ts 原名再导出，既有 import 路径不变。

/** 排行榜类别（v23 AISLG-61） */
import type { TroopKind } from './protocol';

export const LEADERBOARD_KINDS = ['power', 'territory', 'plunder'] as const;

export type LeaderboardKind = (typeof LEADERBOARD_KINDS)[number];

/** 排行榜单行（agentOnline = 查询时刻该账号是否有在线 Agent 连接） */
export interface LeaderboardEntryView {
  rank: number;
  accountId: string;
  username: string;
  cityName: string;
  value: number;
  agentOnline: boolean;
}

/** GET_LEADERBOARD 响应载荷 */
export interface GetLeaderboardResponseData {
  kind: LeaderboardKind;
  updatedAt: string;
  entries: LeaderboardEntryView[];
  me: { rank: number; value: number } | null;
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
