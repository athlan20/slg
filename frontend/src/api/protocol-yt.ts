// 黄巾之乱协议的类型镜像（v29 AISLG-76）。唯一事实来源是 backend/common/src/protocol-yt.ts
// 与 backend/common/src/yellow-turban.ts；协议调整时以后端生成文档（docs/agent-api.md）为准同步本文件。

import type { Resources } from './protocol';

export type YtTier = 'small' | 'medium' | 'large' | 'boss';

/** 地块上的营地信息（TileView.camp；老巢同结构，tier='boss'） */
export interface YtTileCampView {
  tier: YtTier;
  label: string;
  /** 守军强度对应的野地等级口径 */
  level: number;
  /** 守军总兵力大概范围（当前存量 ±20%） */
  garrisonTotal: { min: number; max: number };
  /** 下次升档时刻；大营 / 老巢为 null */
  nextGrowAt: string | null;
  boss?: { stage: 'outer' | 'keeper'; recoversAt: string | null };
}

export interface YtCampView extends YtTileCampView {
  id: string;
  x: number;
  y: number;
}

export interface YtEventView {
  id: string;
  status: 'active' | 'finished';
  startedAt: string;
  endsAt: string;
  totalCamps: number;
  clearedCamps: number;
  bossUnlockCount: number;
  bossAppearedAt: string | null;
  bossClearedAt: string | null;
  finishReason: 'boss_cleared' | 'timeout' | null;
  finishedAt: string | null;
  scatteredCamps: number;
}

export interface YtContributionView {
  rank: number;
  username: string;
  killed: number;
}

export interface YtRewardTierView {
  label: string;
  maxRank: number;
  reward: Resources;
}

/** GET_YELLOW_TURBAN 响应 */
export interface YellowTurbanState {
  event: YtEventView | null;
  nextEventAt: string | null;
  camps: YtCampView[];
  me: { killed: number; rank: number } | null;
  top: YtContributionView[];
  rewards: YtRewardTierView[];
}

export interface YellowTurbanPushData {
  reason: 'started' | 'progress' | 'boss_appeared' | 'finished';
  event: YtEventView;
}
