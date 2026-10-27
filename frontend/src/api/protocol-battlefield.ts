// 剧本战场·官渡（v75，AISLG-198）的协议类型：镜像 backend/common/src/protocol-battlefield.ts。
// 协议调整以后端生成文档 docs/agent-api.md 为准同步本文件。

import type { Resources } from './protocol';
import type { ArmyCounts, TroopKind } from './protocol';

export const BATTLEFIELD_CAMPS = ['yuan', 'cao'] as const;
export type BattlefieldCamp = (typeof BATTLEFIELD_CAMPS)[number];

export const BATTLEFIELD_SHOP_ITEMS = ['resources', 'hero_exp', 'swordsman', 'cavalry'] as const;
export type BattlefieldShopItem = (typeof BATTLEFIELD_SHOP_ITEMS)[number];

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
  script: 'guandu';
  name: string;
  status: 'signup' | 'active' | 'finished';
  signupStartAt: string;
  startAt: string;
  endAt: string;
  camps: { yuan: BattlefieldCampView; cao: BattlefieldCampView };
  winner: BattlefieldCamp | null;
  finishReason: 'score' | 'base_captured' | null;
  underdog: { camp: BattlefieldCamp; multiplier: number } | null;
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

export interface GetBattlefieldResponseData {
  event: BattlefieldEventView | null;
  nextSignupAt: string;
  strongholds: BattlefieldStrongholdView[];
  me: BattlefieldMeView | null;
  top: BattlefieldMeritEntryView[];
  shop: { items: BattlefieldShopItemView[]; cumulativeMerit: number };
  rewards: { winner: BattlefieldRewardTierView; loser: BattlefieldRewardTierView; rankTiers: BattlefieldRewardTierView[] };
}

export interface BattlefieldPushData {
  reason: 'signup' | 'started' | 'stronghold' | 'finished';
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