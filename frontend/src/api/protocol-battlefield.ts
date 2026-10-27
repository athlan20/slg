// 剧本战场（v75，AISLG-198 官渡；v80，AISLG-199 讨伐董卓 / 赤壁之战）的协议类型：镜像 backend/common/src/protocol-battlefield.ts。
// 协议调整以后端生成文档 docs/agent-api.md 为准同步本文件。

import type { Resources } from './protocol';
import type { ArmyCounts, TroopKind } from './protocol';

export const BATTLEFIELD_CAMPS = ['yuan', 'cao'] as const;
export type BattlefieldCamp = (typeof BATTLEFIELD_CAMPS)[number];

export const BATTLEFIELD_SHOP_ITEMS = ['resources', 'hero_exp', 'swordsman', 'cavalry', 'iron_cavalry'] as const;
export type BattlefieldShopItem = (typeof BATTLEFIELD_SHOP_ITEMS)[number];

/** 剧本：官渡之战 / 讨伐董卓（全服合作）/ 赤壁之战；每周一场轮换 */
export type BattlefieldScript = 'guandu' | 'dongzhuo' | 'chibi';

export type BattlefieldSquadStatus = 'marching' | 'idle' | 'garrison';
export type BattlefieldStrongholdKind = 'base' | 'ford' | 'post' | 'granary';

export interface BattlefieldSquadView {
  id: string;
  x: number;
  y: number;
  status: BattlefieldSquadStatus;
  troops: ArmyCounts;
  targetX: number | null;
  targetY: number | null;
  targetStrongholdId: string | null;
  arriveAt: string | null;
  originX: number;
  originY: number;
  strongholdId: string | null;
}

export interface BattlefieldStrongholdView {
  id: string;
  name: string;
  kind: BattlefieldStrongholdKind;
  x: number;
  y: number;
  ownerCamp: BattlefieldCamp | null;
  pointsPerHour: number;
  garrison: ArmyCounts;
  garrisonPower: number;
  wallLevel: number;
  towerLevel: number;
  firstCaptureAvailable: boolean;
  capturedAt: string | null;
  /** 讨董：前一关未打下为 false（不能攻打）；其他剧本恒为 true */
  unlocked: boolean;
  /** 赤壁：曹方连锁战船截止（其他为 null） */
  chainUntil: string | null;
  /** 赤壁：火攻冷却截止（其他为 null） */
  fireNextAt: string | null;
}

export interface BattlefieldCampView {
  camp: BattlefieldCamp;
  name: string;
  signups: number;
  entered: number;
  score: number;
}

export interface BattlefieldEventView {
  id: string;
  script: BattlefieldScript;
  name: string;
  status: 'signup' | 'active' | 'finished';
  signupStartAt: string;
  startAt: string;
  endAt: string;
  camps: { yuan: BattlefieldCampView; cao: BattlefieldCampView };
  winner: BattlefieldCamp | null;
  finishReason: 'score' | 'base_captured' | null;
  underdog: { camp: BattlefieldCamp; multiplier: number } | null;
  /** 赤壁风向（其他剧本为 null）：nextAt 为下次切换，noticeAt 为提前 30 分钟预告 */
  wind: { direction: 'se' | 'nw'; label: string; bonusCamp: BattlefieldCamp; nextAt: string; noticeAt: string } | null;
}

export interface BattlefieldMeritEntryView {
  rank: number;
  accountId: string;
  username: string;
  camp: BattlefieldCamp;
  merit: number;
}

export interface BattlefieldMeView {
  accountId: string;
  username: string;
  camp: BattlefieldCamp;
  merit: number;
  rank: number | null;
  entered: boolean;
  squads: BattlefieldSquadView[];
  cumulativeMerit: number;
}

export interface BattlefieldShopItemView {
  item: BattlefieldShopItem;
  label: string;
  cost: number;
  limit: number;
  bought: number;
  reward: { resources?: Resources; heroExp?: number; troop?: TroopKind; count?: number };
}

export interface BattlefieldRewardTierView {
  label: string;
  rank: number | null;
  maxRank: number | null;
  gold: number;
  resourcesEach: number;
}

/** 讨董合作奖励档（全员按最远进度领一档） */
export interface BattlefieldProgressRewardView {
  label: string;
  progress: number;
  gold: number;
  resourcesEach: number;
}

export interface GetBattlefieldResponseData {
  event: BattlefieldEventView | null;
  nextSignupAt: string;
  nextScript: BattlefieldScript;
  strongholds: BattlefieldStrongholdView[];
  me: BattlefieldMeView | null;
  top: BattlefieldMeritEntryView[];
  shop: { items: BattlefieldShopItemView[]; cumulativeMerit: number };
  rewards: {
    winner: BattlefieldRewardTierView;
    loser: BattlefieldRewardTierView;
    rankTiers: BattlefieldRewardTierView[];
    progressTiers: BattlefieldProgressRewardView[];
  };
}

export interface BattlefieldPushData {
  reason: 'signup' | 'started' | 'stronghold' | 'finished' | 'wind';
  event: BattlefieldEventView;
  strongholdId?: string;
}

export interface EnterBattlefieldRequestData {
  troops: Partial<Record<TroopKind, number>>;
}

export interface BuyBattlefieldItemResponseData {
  item: BattlefieldShopItem;
  cost: number;
  cumulativeMerit: number;
  bought: number;
  reward: Record<string, unknown>;
}