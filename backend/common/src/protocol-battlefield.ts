// 剧本战场协议的类型（v75，AISLG-198：官渡之战；v80，AISLG-199：讨伐董卓、赤壁之战）。
// 规则与数值见 common/src/battlefield.ts，生命周期与结算在 worker/src/battlefield-tick.ts。
// 本文件只依赖 protocol / protocol-army 的类型（类型导入运行时擦除），不构成加载环。

import type { Resources } from './protocol';
import type { ArmyCounts, TroopKind } from './protocol-army';

/** 剧本标识：官渡之战 / 讨伐董卓（全服合作）/ 赤壁之战；每周一场轮换 */
export const BATTLEFIELD_SCRIPTS = ['guandu', 'dongzhuo', 'chibi'] as const;
export type BattlefieldScript = (typeof BATTLEFIELD_SCRIPTS)[number];

export function isBattlefieldScript(value: unknown): value is BattlefieldScript {
  return value === 'guandu' || value === 'dongzhuo' || value === 'chibi';
}

/** 阵营：袁绍军 / 曹操军（讨董只有讨董联军一方在打，赤壁为孙刘联军 yuan 对曹操军 cao） */
export const BATTLEFIELD_CAMPS = ['yuan', 'cao'] as const;
export type BattlefieldCamp = (typeof BATTLEFIELD_CAMPS)[number];

export function isBattlefieldCamp(value: unknown): value is BattlefieldCamp {
  return value === 'yuan' || value === 'cao';
}

/** 战场阶段：报名 / 进行中 / 已结束 */
export const BATTLEFIELD_STATUSES = ['signup', 'active', 'finished'] as const;
export type BattlefieldStatus = (typeof BATTLEFIELD_STATUSES)[number];

/** 据点类型：大营 / 渡口 / 普通据点 / 粮仓 */
export const BATTLEFIELD_STRONGHOLD_KINDS = ['base', 'ford', 'post', 'granary'] as const;
export type BattlefieldStrongholdKind = (typeof BATTLEFIELD_STRONGHOLD_KINDS)[number];

/** 战场商店商品 */
export const BATTLEFIELD_SHOP_ITEMS = ['resources', 'hero_exp', 'swordsman', 'cavalry', 'iron_cavalry'] as const;
export type BattlefieldShopItem = (typeof BATTLEFIELD_SHOP_ITEMS)[number];

export function isBattlefieldShopItem(value: unknown): value is BattlefieldShopItem {
  return typeof value === 'string' && (BATTLEFIELD_SHOP_ITEMS as readonly string[]).includes(value);
}

/** 部队状态：行军中 / 待命 / 据守据点（阵亡的部队直接删除，不出现） */
export const BATTLEFIELD_SQUAD_STATUSES = ['marching', 'idle', 'garrison'] as const;
export type BattlefieldSquadStatus = (typeof BATTLEFIELD_SQUAD_STATUSES)[number];

/** 战场里的一支队伍（每人最多 3 队） */
export interface BattlefieldSquadView {
  id: string;
  x: number;
  y: number;
  status: BattlefieldSquadStatus;
  troops: ArmyCounts;
  /** 行军中：目标坐标与到达时刻；否则为 null */
  targetX: number | null;
  targetY: number | null;
  targetStrongholdId: string | null;
  arriveAt: string | null;
  /** 出发位置（战败后撤回这里） */
  originX: number;
  originY: number;
  /** 据守的据点 id；待命 / 行军为 null */
  strongholdId: string | null;
}

/** 据点视图（GET_BATTLEFIELD 与推送共用） */
export interface BattlefieldStrongholdView {
  id: string;
  name: string;
  kind: BattlefieldStrongholdKind;
  x: number;
  y: number;
  /** 当前归属阵营；开局为 null（NPC 中立） */
  ownerCamp: BattlefieldCamp | null;
  pointsPerHour: number;
  /** 当前守军编成（NPC + 玩家据守部队合计；全兵种计数） */
  garrison: ArmyCounts;
  /** 守军参考战力 = Σ 数量 × 单兵参考战力 */
  garrisonPower: number;
  wallLevel: number;
  towerLevel: number;
  /** 首次被玩家阵营打下 ≥ 200 军功的首占奖励是否还没被拿过 */
  firstCaptureAvailable: boolean;
  capturedAt: string | null;
  /** 讨董：前置关卡是否已打下（false = 尚未解锁，不能攻打） */
  unlocked: boolean;
  /** 赤壁连锁战船截止（Cao 方技能；其他为 null） */
  chainUntil: string | null;
  /** 赤壁火攻冷却截止（每个目标 2 小时；其他为 null） */
  fireNextAt: string | null;
}

/** 阵营简报 */
export interface BattlefieldCampView {
  camp: BattlefieldCamp;
  name: string;
  /** 报名人数（含已入场 / 未入场） */
  signups: number;
  /** 已入场人数 */
  entered: number;
  score: number;
}

/** 一场剧本战场（官渡 / 讨董 / 赤壁） */
export interface BattlefieldEventView {
  id: string;
  script: BattlefieldScript;
  name: string;
  status: BattlefieldStatus;
  signupStartAt: string;
  startAt: string;
  endAt: string;
  /** 报名截止 = 开战时刻 */
  camps: { yuan: BattlefieldCampView; cao: BattlefieldCampView };
  winner: BattlefieldCamp | null;
  /** score = 结束时积分高；base_captured = 大营被攻破提前结束；timeout 保留给后续剧本 */
  finishReason: 'score' | 'base_captured' | null;
  /** 人少补偿：开战时人数少的一方与积分产出倍率；人数差距不足 70% 为 null */
  underdog: { camp: BattlefieldCamp; multiplier: number } | null;
  /** 赤壁风向（其他剧本为 null）：se 东南风利孙刘 / nw 西北风利曹操；nextAt 为下次切换，noticeAt 为提前 30 分钟预告 */
  wind: { direction: 'se' | 'nw'; label: string; bonusCamp: BattlefieldCamp; nextAt: string; noticeAt: string } | null;
}

/** 军功榜一行 */
export interface BattlefieldMeritEntryView {
  rank: number;
  accountId: string;
  username: string;
  camp: BattlefieldCamp;
  merit: number;
}

/** 我的战场状态（未报名为 null） */
export interface BattlefieldMeView {
  accountId: string;
  username: string;
  camp: BattlefieldCamp;
  /** 本场军功 */
  merit: number;
  /** 本场军功名次（同分并列；未入场为 null） */
  rank: number | null;
  /** 是否已把部队带进战场（入场后不能再追加） */
  entered: boolean;
  squads: BattlefieldSquadView[];
  /** 战场商店可用军功（跨场累积，换季清零） */
  cumulativeMerit: number;
}

/** 商店商品视图（bought = 本场已买数量） */
export interface BattlefieldShopItemView {
  item: BattlefieldShopItem;
  label: string;
  cost: number;
  /** 每场限购 */
  limit: number;
  bought: number;
  /** 商品说明（前端中英文案自行拼接，字段只给结构化数值） */
  reward: { resources?: Resources; heroExp?: number; troop?: TroopKind; count?: number };
}

/** 奖励档位（文档与前端展示用） */
export interface BattlefieldRewardTierView {
  label: string;
  rank: number | null;
  maxRank: number | null;
  gold: number;
  /** 粮 / 木 / 石 / 铁各多少 */
  resourcesEach: number;
}

/** 讨董合作奖励档（全员按最远进度领一档） */
export interface BattlefieldProgressRewardView {
  label: string;
  /** 打下的关卡数（1 = 汜水关，2 = 虎牢关，3 = 洛阳） */
  progress: number;
  gold: number;
  resourcesEach: number;
}

/** GET_BATTLEFIELD（op 120）响应 */
export interface GetBattlefieldResponseData {
  /** 当前（或最近一场）战场；从未开过为 null */
  event: BattlefieldEventView | null;
  /** 下一场报名开始时刻（现实时间，北京时间每周二 20:00） */
  nextSignupAt: string;
  /** 下一场的剧本（报名公告里预告；讨董 / 赤壁 / 官渡轮换） */
  nextScript: BattlefieldScript;
  /** 据点（进行中 / 最近一场，按种类与坐标排序）；没有战场为空数组 */
  strongholds: BattlefieldStrongholdView[];
  me: BattlefieldMeView | null;
  /** 军功榜前 10（按军功降序，军功 0 不上榜） */
  top: BattlefieldMeritEntryView[];
  shop: { items: BattlefieldShopItemView[]; cumulativeMerit: number };
  /** 官渡 / 赤壁的胜败奖励与名次额外奖励；讨董的 winner / loser 不适用，以 progressTiers 为准 */
  rewards: {
    winner: BattlefieldRewardTierView;
    loser: BattlefieldRewardTierView;
    rankTiers: BattlefieldRewardTierView[];
    progressTiers: BattlefieldProgressRewardView[];
  };
}

/** 报名请求（op 121）：选阵营 */
export interface SignupBattlefieldRequestData {
  camp: BattlefieldCamp;
}

/** 入场请求（op 122）：从主城带一支部队进战场，按人口最多 3000 */
export interface EnterBattlefieldRequestData {
  troops: Partial<Record<TroopKind, number>>;
}

/** 拆队请求（op 123）：从某支队伍里分出一支，每人最多 3 队 */
export interface SplitBattlefieldSquadRequestData {
  squadId: string;
  troops: Partial<Record<TroopKind, number>>;
}

/** 战场行军 / 攻打请求（op 124）：目标坐标或据点 id 二选一 */
export interface MarchBattlefieldSquadRequestData {
  squadId: string;
  x?: number;
  y?: number;
  strongholdId?: string;
}

/** 商店兑换请求（op 125）：hero_exp 必须带 heroId */
export interface BuyBattlefieldItemRequestData {
  item: BattlefieldShopItem;
  heroId?: string;
}

/** 商店兑换响应 */
export interface BuyBattlefieldItemResponseData {
  item: BattlefieldShopItem;
  cost: number;
  cumulativeMerit: number;
  /** 本场该商品已购数量（含本次） */
  bought: number;
}

/** 火攻请求（op 139，v80）：孙刘方、东南风期间，对与己方据点相邻的曹方据点发动 */
export interface FireBattlefieldRequestData {
  strongholdId: string;
}

/** 连锁战船请求（op 140，v80）：曹方给己方据点连锁 6 小时 */
export interface ChainBattlefieldRequestData {
  strongholdId: string;
}

/** PUSH_BATTLEFIELD_STATE（op 2027）：全服广播 */
export interface BattlefieldPushData {
  reason: 'signup' | 'started' | 'stronghold' | 'finished' | 'wind';
  event: BattlefieldEventView;
  /** reason=stronghold 时易手的据点 id */
  strongholdId?: string;
}
