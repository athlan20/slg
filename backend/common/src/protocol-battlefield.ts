// 剧本战场协议的类型（v75，AISLG-198）：官渡之战。
// 规则与数值见 common/src/battlefield.ts，生命周期与结算在 worker/src/battlefield-tick.ts。
// 本文件只依赖 protocol / protocol-army 的类型（类型导入运行时擦除），不构成加载环。

import type { Resources } from './protocol';
import type { ArmyCounts, TroopKind } from './protocol-army';

/** 阵营：袁绍军 / 曹操军 */
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
export const BATTLEFIELD_SHOP_ITEMS = ['resources', 'hero_exp', 'swordsman', 'cavalry'] as const;
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

/** 一场剧本战场（官渡） */
export interface BattlefieldEventView {
  id: string;
  script: 'guandu';
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

/** GET_BATTLEFIELD（op 120）响应 */
export interface GetBattlefieldResponseData {
  /** 当前（或最近一场）战场；从未开过为 null */
  event: BattlefieldEventView | null;
  /** 下一场报名开始时刻（现实时间，北京时间每周二 20:00） */
  nextSignupAt: string;
  /** 据点（进行中 / 最近一场，按种类与坐标排序）；没有战场为空数组 */
  strongholds: BattlefieldStrongholdView[];
  me: BattlefieldMeView | null;
  /** 军功榜前 10（按军功降序，军功 0 不上榜） */
  top: BattlefieldMeritEntryView[];
  shop: { items: BattlefieldShopItemView[]; cumulativeMerit: number };
  rewards: { winner: BattlefieldRewardTierView; loser: BattlefieldRewardTierView; rankTiers: BattlefieldRewardTierView[] };
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

/** PUSH_BATTLEFIELD_STATE（op 2027）：全服广播 */
export interface BattlefieldPushData {
  reason: 'signup' | 'started' | 'stronghold' | 'finished';
  event: BattlefieldEventView;
  /** reason=stronghold 时易手的据点 id */
  strongholdId?: string;
}