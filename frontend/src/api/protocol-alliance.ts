// 联盟协议的类型镜像（v66，AISLG-181）。唯一事实来源是 backend/common/src/protocol-alliance.ts；
// protocol.ts 原名再导出。协议调整时以后端为准同步本文件。

/** 联盟名长度（按字形计，含两端） */
export const ALLIANCE_NAME_MIN_CHARS = 2;
export const ALLIANCE_NAME_MAX_CHARS = 8;
/** 创建联盟要求：主城官府等级与金币（从主城扣） */
export const ALLIANCE_CREATE_MIN_GOVERNMENT = 5;
export const ALLIANCE_CREATE_COST_GOLD = 100_000;
/** 成员上限；待处理的邀请也占名额（成员数 + 待处理邀请数 ≤ 上限） */
export const ALLIANCE_MAX_MEMBERS = 30;
/** 副盟主人数上限 */
export const ALLIANCE_MAX_VICES = 2;
/** 退出 / 被踢 / 解散后，多久内不能创建也不能加入任何联盟 */
export const ALLIANCE_COOLDOWN_MS = 24 * 3600 * 1000;
/** 入盟申请 / 邀请的有效期 */
export const ALLIANCE_REQUEST_TTL_MS = 48 * 3600 * 1000;
export const ALLIANCE_INVITE_TTL_MS = 48 * 3600 * 1000;
/** 盟主多久没有活跃就自动转让 */
export const ALLIANCE_LEADER_INACTIVE_MS = 7 * 24 * 3600 * 1000;
/** 公告长度上限（按字形计） */
export const ALLIANCE_NOTICE_MAX_CHARS = 200;
/** LIST_ALLIANCES 每页条数 */
export const ALLIANCE_LIST_PAGE_SIZE = 20;

// ---- 联盟势力与联盟榜（v70，AISLG-185）：权重为占位，按现实时间计 ----

/** 联盟势力 = 全体成员占领的野地数 × 1 + 名城数 × 10 + 成员主城官府等级之和 × 1 */
export const ALLIANCE_POWER_TERRITORY_WEIGHT = 1;
export const ALLIANCE_POWER_FAMOUS_WEIGHT = 10;
export const ALLIANCE_POWER_GOVERNMENT_WEIGHT = 1;
/** 联盟榜有名次的最少成员数；不足的不上榜，名次为 null */
export const ALLIANCE_RANK_MIN_MEMBERS = 5;

export const ALLIANCE_ROLES = ['leader', 'vice', 'member'] as const;
export type AllianceRole = (typeof ALLIANCE_ROLES)[number];

export interface AlliancePlayerView {
  accountId: string;
  username: string;
}

/** 联盟概要（列表、申请 / 邀请里的联盟引用） */
export interface AllianceBriefView {
  id: string;
  name: string;
  leader: AlliancePlayerView;
  memberCount: number;
  maxMembers: number;
  createdAt: string;
}

export interface AllianceMemberView {
  accountId: string;
  username: string;
  role: AllianceRole;
  /** 主城官府等级；没有主城（本赛季还没加入）为 0 */
  governmentLevel: number;
  /** 名下占领的野地数 */
  territoryCount: number;
  joinedAt: string;
  /** 最近活跃时刻（登录、断线、在线心跳刷新）；从未记录为 null */
  lastActiveAt: string | null;
  /** 此刻是否有玩家连接在线 */
  online: boolean;
}

export interface AllianceDetailView extends AllianceBriefView {
  notice: string;
  members: AllianceMemberView[];
  /** 联盟势力（现算，口径与联盟榜相同） */
  power: number;
  /** 联盟榜名次（最近一次快照）；成员不足或未上榜为 null */
  rank: number | null;
  /** 友盟 / 敌对名单（v77，AISLG-195） */
  friends: AllianceDiplomacyEntryView[];
  hostiles: AllianceDiplomacyEntryView[];
}

export const ALLIANCE_MAX_FRIENDS = 2;
export const ALLIANCE_MAX_HOSTILES = 5;
export type AllianceRelationKind = 'friendly' | 'hostile' | 'neutral';

export interface AllianceDiplomacyEntryView {
  alliance: AllianceBriefView;
  relation: AllianceRelationKind;
  since: string;
  noAttackUntil: string | null;
  refriendAfter: string | null;
}

export interface AllianceFriendInviteView {
  id: string;
  alliance: AllianceBriefView;
  inviter: AlliancePlayerView;
  direction: 'sent' | 'received';
  createdAt: string;
  expiresAt: string;
}

export interface GetAllianceDiplomacyResponseData {
  allianceId: string;
  friends: AllianceDiplomacyEntryView[];
  hostiles: AllianceDiplomacyEntryView[];
  invites: AllianceFriendInviteView[];
  limits: { friends: number; hostiles: number };
}

export interface AllianceDiplomacyTargetRequestData {
  allianceId: string;
}

export interface AllianceDiplomacyInviteRequestData {
  allianceId: string;
}

export interface AllianceDiplomacyRespondRequestData {
  inviteId: string;
  accept: boolean;
}

/** 联盟榜单行（GET_LEADERBOARD kind=alliance 时下发，前 50 名） */
export interface AllianceLeaderboardEntryView {
  rank: number;
  allianceId: string;
  name: string;
  /** 盟主（榜单快照时的盟主） */
  leader: AlliancePlayerView;
  memberCount: number;
  /** 联盟势力（排名依据） */
  value: number;
}

/** 入盟申请（盟主 / 副盟主视角看到的是别人发来的；玩家自己看到的是自己发出的） */
export interface AllianceRequestView {
  accountId: string;
  username: string;
  governmentLevel: number;
  createdAt: string;
  expiresAt: string;
}

/** 发出的邀请（盟主 / 副盟主视角） */
export interface AllianceSentInviteView {
  accountId: string;
  username: string;
  inviter: AlliancePlayerView;
  createdAt: string;
  expiresAt: string;
}

/** 收到的邀请 */
export interface AllianceReceivedInviteView {
  alliance: AllianceBriefView;
  inviter: AlliancePlayerView;
  createdAt: string;
  expiresAt: string;
}

export interface GetAllianceRequestData {
  /** 缺省 = 我的联盟；给了 = 查看某个联盟的公开信息（成员与公告，不含申请 / 邀请） */
  allianceId?: string;
}

export interface GetAllianceResponseData {
  alliance: AllianceDetailView | null;
  /** 我在该联盟的职位；只有查看自己的联盟时有值 */
  myRole: AllianceRole | null;
  /** 冷却截止（ISO）；不在冷却中为 null */
  cooldownUntil: string | null;
  /** 我发出的待处理申请（同一时间只有 1 条）；只在查看自己时给 */
  myRequest: { alliance: AllianceBriefView; createdAt: string; expiresAt: string } | null;
  /** 发给我的待处理邀请；只在查看自己时给 */
  myInvites: AllianceReceivedInviteView[];
  /** 待审批的申请 / 已发出的邀请：只有盟主 / 副盟主查看自己的联盟时给，其余为空数组 */
  requests: AllianceRequestView[];
  sentInvites: AllianceSentInviteView[];
}

export interface ListAlliancesRequestData {
  /** 页码，从 1 起；缺省 1 */
  page?: number;
}

export interface ListAlliancesResponseData {
  alliances: AllianceBriefView[];
  page: number;
  total: number;
}

export interface CreateAllianceRequestData {
  name: string;
}

export interface AllianceApplyRequestData {
  allianceId: string;
  /** true = 撤回我对该联盟的申请 */
  cancel?: boolean;
}

export interface AllianceInviteRequestData {
  /** 被邀请玩家的昵称（账号 username） */
  username: string;
  /** true = 撤回对该玩家的邀请 */
  cancel?: boolean;
}

export interface AllianceRespondRequestData {
  /** request = 盟主 / 副盟主答复别人的申请（给 accountId）；invite = 我答复收到的邀请（给 allianceId） */
  kind: 'request' | 'invite';
  accountId?: string;
  allianceId?: string;
  accept: boolean;
}

export interface AllianceKickRequestData {
  accountId: string;
}

export interface AllianceSetRoleRequestData {
  accountId: string;
  /** vice = 任命副盟主；member = 撤销副盟主；leader = 把盟主转让给该成员（原盟主降为普通成员） */
  role: AllianceRole;
}

export interface AllianceSetNoticeRequestData {
  notice: string;
}

/** 联盟状态变化推送的原因 */
export const ALLIANCE_PUSH_REASONS = [
  'joined',
  'left',
  'kicked',
  'role_changed',
  'disbanded',
  'notice',
  'request_received',
  'request_resolved',
  'invited',
] as const;
export type AlliancePushReason = (typeof ALLIANCE_PUSH_REASONS)[number];

export interface PushAllianceStateData {
  reason: AlliancePushReason;
  allianceId: string | null;
  allianceName: string | null;
}

// ---- 联盟地图标记（v69，AISLG-184）----

/** 同一联盟同时存在的标记上限（过期的不计） */
export const ALLIANCE_MARK_MAX = 20;
/** 标记保留时长（到期后不再返回） */
export const ALLIANCE_MARK_TTL_MS = 24 * 3600 * 1000;
/** 标记附言长度上限（按字形计） */
export const ALLIANCE_MARK_TEXT_MAX_CHARS = 20;

/** 标记类型：集结 / 敌人 / 资源 / 危险 */
export const ALLIANCE_MARK_KINDS = ['rally', 'enemy', 'resource', 'danger'] as const;
export type AllianceMarkKind = (typeof ALLIANCE_MARK_KINDS)[number];

/** 一个标记（查询、放置响应与推送共用） */
export interface AllianceMarkView {
  id: number;
  x: number;
  y: number;
  kind: AllianceMarkKind;
  /** 附言；没有附言为空串 */
  text: string;
  creator: AlliancePlayerView;
  createdAt: string;
  expiresAt: string;
}

export interface AllianceMarkAddRequestData {
  x: number;
  y: number;
  kind: AllianceMarkKind;
  text?: string;
}

export interface AllianceMarkAddResponseData {
  mark: AllianceMarkView;
}

export interface AllianceMarkRemoveRequestData {
  id: number;
}

export interface AllianceMarkRemoveResponseData {
  id: number;
}

export interface GetAllianceMarksResponseData {
  marks: AllianceMarkView[];
  /** 我能否删除别人打的标记（玩家连接且为盟主 / 副盟主） */
  canRemoveAny: boolean;
}

/** 标记变化推送的原因：added 新增；removed 删除（mark 为 null） */
export const ALLIANCE_MARK_PUSH_REASONS = ['added', 'removed'] as const;
export type AllianceMarkPushReason = (typeof ALLIANCE_MARK_PUSH_REASONS)[number];

export interface PushAllianceMarkData {
  reason: AllianceMarkPushReason;
  allianceId: string;
  markId: number;
  mark: AllianceMarkView | null;
}
