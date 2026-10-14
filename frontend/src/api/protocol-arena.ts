// 竞技场协议的类型镜像（v53，AISLG-145）。唯一事实来源是 backend/common/src/protocol-arena.ts
// 与 backend/common/src/arena.ts；协议调整时以后端生成文档（docs/agent-api.md）为准同步本文件。

import type { HeroSpecialty, FormationKind, FormationCatalog } from './protocol-combat';

/** 阵容里（或榜上对手阵容里）一名武将的展示快照 */
export interface ArenaFighterView {
  specialty?: HeroSpecialty | null;
  formation?: FormationKind;
  /** 本账号武将 id（仅「我的阵容」给出；对手阵容为 null） */
  heroId: string | null;
  name: string;
  lead: number;
  force: number;
  wit: number;
  level: number;
}

/** 可挑战的对手（名次比我靠前且差距不超过上限） */
export interface ArenaOpponentView {
  /** 席位 id（ARENA_CHALLENGE 用） */
  entryId: string;
  rank: number;
  username: string;
  /** 系统守擂者（不领奖励） */
  npc: boolean;
  lineup: Array<ArenaFighterView | null>;
  /** 本竞技日已被挑战的次数（守擂者恒为 0） */
  defendedToday: number;
}

export interface ArenaTopEntryView {
  rank: number;
  username: string;
  npc: boolean;
}

export interface ArenaRulesView extends FormationCatalog {
  slots: number;
  dailyChallenges: number;
  dailyDefendedMax: number;
  maxRankGap: number;
  pairCooldownSeconds: number;
  dailyRewards: Array<{ upTo: number | null; gold: number }>;
  milestoneRewards: Array<{ upTo: number; gold: number }>;
  armyBase: number;
  armyPerLead: number;
  armyKinds: string[];
}

/** GET_ARENA（op 73）/ SET_ARENA_LINEUP（op 74）响应：我在竞技场的完整状态 */
export interface ArenaStateView {
  formations: FormationKind[];
  joined: boolean;
  rank: number | null;
  bestRank: number | null;
  totalEntries: number;
  lineup: Array<ArenaFighterView | null>;
  challengesLeft: number;
  challengesMax: number;
  defendedToday: number;
  defendedMax: number;
  /** 下一个竞技日开始的时刻（ISO） */
  nextDayAt: string;
  /** 按当前名次，下一次发放的每日奖励（金币） */
  dailyReward: number;
  opponents: ArenaOpponentView[];
  top: ArenaTopEntryView[];
  rules: ArenaRulesView;
}

/** 一局的战报摘要（与后端 ArenaRoundReport 同构） */
export interface ArenaRoundView {
  slot: number;
  winner: 'challenger' | 'defender';
  reason: 'fought' | 'bye_challenger' | 'bye_defender' | 'none';
  challenger: ArenaFighterView | null;
  defender: ArenaFighterView | null;
  battle?: {
    rounds: number;
    challengerTroops: number;
    defenderTroops: number;
    challengerSurvivors: number;
    defenderSurvivors: number;
    endReason: string;
  };
}

/** 一场竞技对战的战报（role 指明「我」是哪一方） */
export interface ArenaMatchView {
  id: number;
  createdAt: string;
  role: 'challenger' | 'defender';
  challenger: { username: string; rankBefore: number; rankAfter: number };
  defender: { username: string; npc: boolean; rankBefore: number; rankAfter: number };
  challengerWon: boolean;
  challengerWins: number;
  defenderWins: number;
  rounds: ArenaRoundView[];
  challengerLineup: Array<ArenaFighterView | null>;
  defenderLineup: Array<ArenaFighterView | null>;
}

export interface ArenaChallengeResponseData {
  match: ArenaMatchView;
  rank: number;
  bestRank: number;
  challengesLeft: number;
  milestoneGold: number;
  milestoneTiers: number[];
}

export interface GetArenaReportsResponseData {
  reports: ArenaMatchView[];
  hasMore: boolean;
}

/** PUSH_ARENA_STATE（op 2021）推送载荷 */
export interface ArenaStatePushData {
  reason: 'challenged' | 'daily_reward' | 'milestone';
  challenger?: string;
  defeated?: boolean;
  rank?: number;
  matchId?: number;
  gold?: number;
  tiers?: number[];
}
