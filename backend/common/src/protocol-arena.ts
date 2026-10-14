// 竞技场协议的类型与视图（v53，AISLG-145；从 protocol.ts 拆出以控制单文件行数）。
// 规则与数值见 common/src/arena.ts，数据库存取见 common/src/arena-db.ts。

import type { ArenaRoundReport } from './arena';
import type { FormationKind, FormationCatalog } from './army-formation';
import type { HeroSpecialty } from './hero-specialty';

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
  /** 席位 id（ARENA_CHALLENGE 用；名次互换后仍指同一席位） */
  entryId: string;
  rank: number;
  username: string;
  /** 系统守擂者（不领奖励） */
  npc: boolean;
  /** 1/2/3 号位，缺人的号位为 null */
  lineup: Array<ArenaFighterView | null>;
  /** 本竞技日已被挑战的次数（玩家；守擂者恒为 0） */
  defendedToday: number;
}

/** 榜单一行 */
export interface ArenaTopEntryView {
  rank: number;
  username: string;
  npc: boolean;
}

/** 竞技场规则常量（对外下发，客户端 / Agent 不必硬编码） */
export interface ArenaRulesView extends FormationCatalog {
  slots: number;
  dailyChallenges: number;
  dailyDefendedMax: number;
  maxRankGap: number;
  /** 同一对手连续挑战的冷却（秒，已按全局时间缩放） */
  pairCooldownSeconds: number;
  /** 每日奖励档位 [{ upTo 名次上限, gold }] */
  dailyRewards: Array<{ upTo: number | null; gold: number }>;
  /** 历史最好名次首次升进名次档的一次性奖励（入榜时不发） */
  milestoneRewards: Array<{ upTo: number; gold: number }>;
  /** 标准军队：人数 = armyBase + 统率 × armyPerLead，兵种各一半 */
  armyBase: number;
  armyPerLead: number;
  armyKinds: string[];
}

/** GET_ARENA（op 73）/ SET_ARENA_LINEUP（op 74）响应：我在竞技场的完整状态 */
export interface ArenaStateView {
  formations: FormationKind[];
  /** 是否已入榜（第一次保存阵容时入榜） */
  joined: boolean;
  /** 当前名次；未入榜为 null */
  rank: number | null;
  /** 历史最好名次；未入榜为 null */
  bestRank: number | null;
  /** 榜上席位总数（含守擂者） */
  totalEntries: number;
  /** 我的阵容（3 个号位，空位为 null） */
  lineup: Array<ArenaFighterView | null>;
  challengesLeft: number;
  challengesMax: number;
  defendedToday: number;
  defendedMax: number;
  /** 下一个竞技日开始的时刻（次数重置、每日奖励发放） */
  nextDayAt: string;
  /** 按当前名次，下一次发放的每日奖励（金币）；未入榜为 0 */
  dailyReward: number;
  /** 可挑战的对手（按名次从近到远） */
  opponents: ArenaOpponentView[];
  /** 榜单前 N 名 */
  top: ArenaTopEntryView[];
  rules: ArenaRulesView;
}

export type GetArenaResponseData = ArenaStateView;

/** SET_ARENA_LINEUP（op 74）请求：3 个号位的武将 id，空位用 null；至少 1 名，不能重复 */
export interface SetArenaLineupRequestData {
  /** Omission preserves saved templates for existing clients. */
  formations?: FormationKind[];
  heroIds: Array<string | null>;
}

export type SetArenaLineupResponseData = ArenaStateView;

/** ARENA_CHALLENGE（op 75）请求 */
export interface ArenaChallengeRequestData {
  /** 对手席位 id（GET_ARENA 的 opponents[].entryId） */
  entryId: string;
}

/** 一场竞技对战的战报（挑战方 / 守擂方视角相同，role 指明「我」是哪一方） */
export interface ArenaMatchView {
  id: number;
  createdAt: string;
  /** 我在这场里的身份 */
  role: 'challenger' | 'defender';
  challenger: { username: string; rankBefore: number; rankAfter: number };
  defender: { username: string; npc: boolean; rankBefore: number; rankAfter: number };
  challengerWon: boolean;
  challengerWins: number;
  defenderWins: number;
  /** 实际进行的局（决出胜负后不再打余下的局） */
  rounds: ArenaRoundReport[];
  /** 双方 3 个号位的阵容快照（空位为 null） */
  challengerLineup: Array<ArenaFighterView | null>;
  defenderLineup: Array<ArenaFighterView | null>;
}

export interface ArenaChallengeResponseData {
  match: ArenaMatchView;
  /** 挑战后我的名次 */
  rank: number;
  bestRank: number;
  challengesLeft: number;
  /** 本次历史最好名次升进新名次档拿到的一次性奖励（金币；没有为 0，入榜时不发）与档位 */
  milestoneGold: number;
  milestoneTiers: number[];
}

/** GET_ARENA_REPORTS（op 76）请求 */
export interface GetArenaReportsRequestData {
  /** 条数上限，1..50，默认 20 */
  limit?: number;
  /** 只取 id 小于它的更早战报（翻页） */
  beforeId?: number;
}

export interface GetArenaReportsResponseData {
  reports: ArenaMatchView[];
  hasMore: boolean;
}

/** PUSH_ARENA_STATE（op 2021）推送载荷：账号全部在线连接收到（含 Agent） */
export interface ArenaStatePushData {
  reason:
    | 'challenged'  // 被人挑战（名次可能变化）
    | 'daily_reward' // 每日奖励到账
    | 'milestone';  // 首次进入新名次档
  /** challenged：挑战方昵称、是否被打败、我新的名次、对战报 id */
  challenger?: string;
  defeated?: boolean;
  rank?: number;
  matchId?: number;
  /** daily_reward / milestone：到账金币 */
  gold?: number;
  tiers?: number[];
}
