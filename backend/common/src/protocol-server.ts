// 全服维度协议的载荷类型（v23）：全服战况播报（AISLG-60）与全服排行榜
// （AISLG-61）。从 protocol.ts 拆出以控制单文件行数；protocol.ts 原名再导出，
// 既有 import 路径不变。

/**
 * 全服播报类型（v23，AISLG-60）：NPC 城被掠空 / 首个占领金矿 / 主城被 NPC 攻破 /
 * 1 小时内连胜 5 场（此后每再累计 5 场再播）。detail 的字段见各类型文档。
 */
export const SERVER_BROADCAST_TYPES = [
  'npc_city_emptied',
  'gold_mine_first',
  'city_broken',
  'win_streak',
  // v29（AISLG-76）黄巾之乱：起事 / 坐大 / 老巢出现 / 首杀 / 收场（不受每分钟限频，保证必达）
  'yt_started',
  'yt_grown',
  'yt_boss',
  'yt_boss_first_kill',
  'yt_finished',
  // v36（AISLG-115）名将获得：全服唯一的追求目标，必达（不受每分钟限频）
  'hero_granted',
  // v40（AISLG-124）玩家占领玩家分城：大事必达（不受每分钟限频）
  'city_conquered',
] as const;

export type ServerBroadcastType = (typeof SERVER_BROADCAST_TYPES)[number];

export function isServerBroadcastType(value: unknown): value is ServerBroadcastType {
  return typeof value === 'string' && (SERVER_BROADCAST_TYPES as readonly string[]).includes(value);
}

/**
 * 排行榜类别（v23，AISLG-61）：power 综合战力（全部兵力战力之和，城内 + 驻野地 +
 * 行军中）/ territory 领地数量（占领的野地数）/ plunder 累计掠夺量（四资源合计，
 * 记在账号上——玩家与 Agent 打出的成绩算同一账号）。
 */
export const LEADERBOARD_KINDS = ['power', 'territory', 'plunder'] as const;

export type LeaderboardKind = (typeof LEADERBOARD_KINDS)[number];

export function isLeaderboardKind(value: unknown): value is LeaderboardKind {
  return typeof value === 'string' && (LEADERBOARD_KINDS as readonly string[]).includes(value);
}

/** 排行榜单行（前 50 名的条目；agentOnline 是查询时刻该账号是否有在线 Agent 连接） */
export interface LeaderboardEntryView {
  rank: number;
  accountId: string;
  username: string;
  cityName: string;
  value: number;
  agentOnline: boolean;
}

/** GET_LEADERBOARD（op 43）响应载荷 */
export interface GetLeaderboardResponseData {
  kind: LeaderboardKind;
  /** 快照计算时间（ISO 8601；Worker 每 10 分钟重算一次，页面展示用） */
  updatedAt: string;
  /** 前 50 名 */
  entries: LeaderboardEntryView[];
  /** 我的名次与数值；快照里没有本账号（新号未上榜）为 null */
  me: { rank: number; value: number } | null;
}

/** 全服播报视图（GET_SERVER_BROADCASTS / PUSH_SERVER_BROADCAST 共用） */
export interface ServerBroadcastView {
  id: number;
  type: ServerBroadcastType;
  /** 按类型解释：npc_city_emptied = { username, cityName, x, y, level }；
   *  gold_mine_first = { username, cityName, x, y }；city_broken = { username, cityName, x, y }；
   *  win_streak = { username, cityName, streak }；
   *  v29 黄巾之乱：yt_started = { totalCamps, endsAt }；yt_grown = { count, tier }（count 个营地升到 tier 档）；
   *  yt_boss = { x, y }；yt_boss_first_kill = { username, cityName }；
   *  yt_finished = { reason: boss_cleared|timeout, clearedCamps, totalCamps, scatteredCamps } */
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface GetServerBroadcastsRequestData {
  /** 返回条数上限，1..50，默认 20 */
  limit?: number;
}

export interface GetServerBroadcastsResponseData {
  broadcasts: ServerBroadcastView[];
}

/** PUSH_SERVER_BROADCAST（op 2011）推送载荷 */
export interface ServerBroadcastPushData {
  broadcast: ServerBroadcastView;
}
