// 将星塔协议的类型与视图（v55，AISLG-146）。规则与数值见 common/src/star-tower.ts，存取见 star-tower-db.ts。
// 阵容与竞技场共用（arena_entries），保存阵容走 SET_ARENA_LINEUP。

import type { ArenaRoundReport } from './arena';
import type { ArenaFighterView } from './protocol-arena';
import type { FormationKind, FormationCatalog } from './army-formation';

/** 下一层的首通奖励预览 / 实际发放 */
export interface StarTowerRewardView {
  gold: number;
  /** 每名阵容武将获得的经验 */
  exp: number;
}

/** 规则常量（对外下发，客户端 / Agent 不必硬编码） */
export interface StarTowerRulesView extends FormationCatalog {
  armyBase: number;
  armyPerLead: number;
  floors: number;
  bossEvery: number;
  slots: number;
  /** 三局两胜，号位 1 对 1、2 对 2、3 对 3（同竞技场） */
  winRounds: number;
}

/** GET_STAR_TOWER（op 83）响应：我的爬塔进度与下一层 */
export interface StarTowerStateView {
  formations: FormationKind[];
  /** 已通过的最高层（0 = 还没通过任何一层） */
  bestFloor: number;
  /** 是否已全部通关（bestFloor === floors） */
  cleared: boolean;
  /** 下一层（可挑战的层）；全部通关为 null */
  nextFloor: number | null;
  /** 下一层是否 Boss 层 */
  nextBoss: boolean;
  /** 下一层的敌方阵容（匿名，heroId 恒为 null）；全部通关为空数组 */
  nextEnemies: ArenaFighterView[];
  /** 下一层首通奖励预览；全部通关为 null */
  nextReward: StarTowerRewardView | null;
  /** 我的阵容（与竞技场共用，3 个号位，空位为 null）；未保存过阵容则全为 null */
  lineup: Array<ArenaFighterView | null>;
  /** 阵容里至少有 1 名武将（能否挑战的条件之一） */
  lineupReady: boolean;
  /** 账号是否有城（首通奖励金币进主城，没有城不能挑战） */
  hasCity: boolean;
  rules: StarTowerRulesView;
}

export type GetStarTowerResponseData = StarTowerStateView;

/** 一场将星塔挑战的战报（只有自己的视角；敌方是系统预设武将，没有 heroId） */
export interface StarTowerMatchView {
  id: number;
  createdAt: string;
  floor: number;
  boss: boolean;
  won: boolean;
  challengerWins: number;
  defenderWins: number;
  /** 实际进行的局（决出胜负后不再打余下的局） */
  rounds: ArenaRoundReport[];
  /** 我的阵容快照（匿名，heroId 为 null） */
  lineup: Array<ArenaFighterView | null>;
  /** 敌方阵容快照 */
  enemies: ArenaFighterView[];
}

/** STAR_TOWER_CHALLENGE（op 84）响应 */
export interface StarTowerChallengeResponseData {
  match: StarTowerMatchView;
  /** 本次挑战的层 */
  floor: number;
  won: boolean;
  /** 挑战后已通过的最高层 */
  bestFloor: number;
  /** 首通发放的奖励（输了或重打已通过的层为 null） */
  reward: StarTowerRewardView | null;
  /** 首通后升级的武将（没有为空数组） */
  levelUps: Array<{ heroId: string; name: string; leveledTo: number }>;
}

/** GET_STAR_TOWER_REPORTS（op 85）请求 */
export interface GetStarTowerReportsRequestData {
  /** 条数上限，1..50，默认 20 */
  limit?: number;
  /** 只取 id 小于它的更早战报（翻页） */
  beforeId?: number;
}

export interface GetStarTowerReportsResponseData {
  reports: StarTowerMatchView[];
  hasMore: boolean;
}
