// 赛季协议的载荷类型（v65，AISLG-134）：GET_SEASON（99）、GET_HALL_OF_FAME（100）与推送 PUSH_SEASON（2023）。
// 规则与存档读写见 season-db.ts；维护态拦截见 api/src/maintenance-gate.ts。

/**
 * 名人堂 / 存档的榜种（GET_HALL_OF_FAME 的 kind；model 走模型榜存档）。
 * v70（AISLG-185）新增 alliance：换季时联盟榜前三的存档，条目带盟主与联盟信息（见 HallEntryView）
 */
export const HALL_KINDS = ['power', 'territory', 'plunder', 'arena', 'starTower', 'model', 'alliance'] as const;
export type HallKind = (typeof HALL_KINDS)[number];

/** 当前赛季视图（GET_SEASON） */
export interface SeasonView {
  id: number;
  name: string;
  /** 开始 / 结束时刻（ISO 8601，现实时间） */
  startAt: string;
  endAt: string;
  /** 距结束的剩余现实秒数（不受 timeScale 影响，≥ 0） */
  remainingSec: number;
  /** 本赛季倍速（换季时写入，季内不改） */
  timeScale: number;
  status: 'active' | 'ended';
}

/** 荣誉称号（GET_SEASON 的 myHonors） */
export interface HonorView {
  seasonId: number;
  kind: string;
  rank: number;
  title: string;
}

export interface GetSeasonResponseData {
  season: SeasonView;
  /** 是否处于换季维护态 */
  maintenance: boolean;
  myHonors: HonorView[];
  /** 本账号是否已加入当前赛季（否则下次登录时惰性加入，见 docs/season-system.md §2.2） */
  joined: boolean;
}

/**
 * 名人堂个人榜条目（season_archives 的一行，展示口径同 LeaderboardEntryView）。
 * kind=alliance（v70）时：accountId / username 为当时的盟主，value 为联盟势力，
 * allianceId / allianceName / memberCount 为联盟信息；其余榜这三项为 null。
 */
export interface HallEntryView {
  rank: number;
  accountId: string | null;
  username: string;
  cityName: string | null;
  value: number;
  agentModel: string | null;
  allianceId: string | null;
  allianceName: string | null;
  memberCount: number | null;
}

/** 名人堂模型榜条目（season_archive_models 的一行，口径同 ModelLeaderboardEntryView） */
export interface HallModelEntryView {
  rank: number;
  modelId: string;
  label: string;
  players: number;
  value: number;
  topPlayer: { username: string; value: number } | null;
}

export interface GetHallOfFameRequestData {
  seasonId?: number;
  kind?: string;
  page?: number;
}

export interface GetHallOfFameResponseData {
  seasons: Array<{ id: number; name: string; endedAt: string | null }>;
  /** 实际查询的赛季（无已结束赛季时为 null） */
  seasonId: number | null;
  kind: string;
  entries: HallEntryView[];
  modelEntries: HallModelEntryView[];
  /** 该榜的总条数（分页用） */
  total: number;
}

/** PUSH_SEASON（2023）载荷：phase 由通知的 reason 决定（warning / resetting / started） */
export interface SeasonPushData {
  phase: 'warning' | 'resetting' | 'started';
  seasonId: number;
  endsAt: string;
  remainingSec: number;
  /** warning 时的预告阶段（如 T-3d / T-1d / T-1h / T-10m） */
  stage?: string;
}
