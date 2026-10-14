// 将星塔协议的类型镜像（v55，AISLG-146）。唯一事实来源是 backend/common/src/protocol-star-tower.ts
// 与 backend/common/src/star-tower.ts；协议调整时以后端生成文档（docs/agent-api.md）为准同步本文件。

import type { ArenaFighterView, ArenaRoundView } from './protocol-arena';
import type { FormationKind, FormationPreviewRules } from './protocol-combat';

/** 首通奖励：金币进主城，经验给阵容里每名武将 */
export interface StarTowerRewardView {
  gold: number;
  exp: number;
}

export interface StarTowerRulesView extends FormationPreviewRules {
  floors: number;
  bossEvery: number;
  slots: number;
  winRounds: number;
}

/** GET_STAR_TOWER（op 83）响应 */
export interface StarTowerStateView {
  formations: FormationKind[];
  /** 已通过的最高层（0 = 还没通过任何一层） */
  bestFloor: number;
  cleared: boolean;
  /** 下一层（可挑战的层）；全部通关为 null */
  nextFloor: number | null;
  nextBoss: boolean;
  /** 下一层敌方阵容（匿名） */
  nextEnemies: ArenaFighterView[];
  nextReward: StarTowerRewardView | null;
  /** 我的阵容（与竞技场共用，保存走 SET_ARENA_LINEUP） */
  lineup: Array<ArenaFighterView | null>;
  lineupReady: boolean;
  hasCity: boolean;
  rules: StarTowerRulesView;
}

/** 一场将星塔挑战的战报（只有自己的视角） */
export interface StarTowerMatchView {
  id: number;
  createdAt: string;
  floor: number;
  boss: boolean;
  won: boolean;
  challengerWins: number;
  defenderWins: number;
  rounds: ArenaRoundView[];
  lineup: Array<ArenaFighterView | null>;
  enemies: ArenaFighterView[];
}

/** STAR_TOWER_CHALLENGE（op 84）响应 */
export interface StarTowerChallengeResponseData {
  match: StarTowerMatchView;
  floor: number;
  won: boolean;
  bestFloor: number;
  reward: StarTowerRewardView | null;
  levelUps: Array<{ heroId: string; name: string; leveledTo: number }>;
}

/** GET_STAR_TOWER_REPORTS（op 85）响应 */
export interface GetStarTowerReportsResponseData {
  reports: StarTowerMatchView[];
  hasMore: boolean;
}
