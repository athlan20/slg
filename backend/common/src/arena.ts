// 竞技场规则（v53，AISLG-145）：最多 3 名武将排阵容，挑战榜上名次靠前的对手，三局两胜，
// 赢了互换名次；每天按名次发金币。对战用系统临时配的「标准军队」，不消耗真实兵力、
// 不改武将状态（伤病 / 俸禄 / 外出都不影响参赛）。本文件只放纯规则与数值（占位，
// 校准见 scripts/arena-calibration.ts 与 docs/battle-calibration.md「竞技场」一节），
// 数据库存取在 arena-db.ts，API 与 Worker 共用，两侧不得各自另算。

import type { TroopKind } from './protocol';
import { simulateBattle, type BattleResult } from './battle-engine';
import { heroBattleBonus, rollHeroName, type HeroAttrs } from './hero';
import { getTimeScale } from './time-scale';
import { formationArmy, type FormationKind } from './army-formation';
import type { HeroSpecialty } from './hero-specialty';

// ---- 数值（全部占位，上线前按校准结果与经济核对） ----

/** 阵容号位数 */
export const ARENA_SLOTS = 3;
/** 每个「竞技日」可发起的挑战次数 */
export const ARENA_DAILY_CHALLENGES = 5;
/** 每个「竞技日」每名玩家最多被挑战的次数 */
export const ARENA_DAILY_DEFENDED_MAX = 10;
/** 只能挑战比自己名次靠前、且差距不超过这么多名的对手 */
export const ARENA_MAX_RANK_GAP = 10;
/** 同一人连续挑战同一对手的冷却（基准毫秒；实际 ÷ 全局时间缩放） */
export const ARENA_PAIR_COOLDOWN_MS = 5 * 60 * 1000;
/** 一个竞技日的长度（基准毫秒；实际 ÷ 全局时间缩放，次数与奖励按竞技日结算） */
export const ARENA_DAY_MS = 24 * 60 * 60 * 1000;
/** 竞技日的起点偏移：基准口径下对齐服务器时区（东八区）0 点 */
export const ARENA_DAY_OFFSET_MS = 8 * 60 * 60 * 1000;
/** 战报保留天数（真实时间，不随缩放） */
export const ARENA_REPORT_KEEP_DAYS = 7;
/** 榜单展示的名次数 */
export const ARENA_TOP_COUNT = 100;
/** 系统守擂者数量（开服时放进榜首附近，保证新人总有人可挑；不领奖励） */
export const ARENA_NPC_COUNT = 20;

/** 标准军队的基础兵数（与统率无关，所有人都有）；占位，校准见 arena-calibration（v53 第二轮，原为统率 × 20 线性） */
export const ARENA_ARMY_BASE = 2000;
/** 标准军队每点统率加的兵数（人数 = ARENA_ARMY_BASE + 统率 × ARENA_ARMY_PER_LEAD）；占位 */
export const ARENA_ARMY_PER_LEAD = 2;
/** 标准军队里的兵种（两种各一半）；占位，校准见 arena-calibration */
export const ARENA_ARMY_KINDS: readonly [TroopKind, TroopKind] = ['swordsman', 'archer'];

/** 每日奖励（金币）：按名次档，rank ≤ upTo 的第一档生效；最后一档 upTo=Infinity 兜底 */
export const ARENA_DAILY_REWARDS: ReadonlyArray<{ upTo: number; gold: number }> = [
  { upTo: 1, gold: 50_000 },
  { upTo: 10, gold: 30_000 },
  { upTo: 50, gold: 15_000 },
  { upTo: 200, gold: 5_000 },
  { upTo: Number.POSITIVE_INFINITY, gold: 1_000 },
];

/** 进档一次性奖励（金币）：历史最好名次从基线（入榜名次）升进 ≤ upTo 时发一次；入榜本身不发 */
export const ARENA_MILESTONE_REWARDS: ReadonlyArray<{ upTo: number; gold: number }> = [
  { upTo: 200, gold: 20_000 },
  { upTo: 50, gold: 50_000 },
  { upTo: 10, gold: 100_000 },
  { upTo: 1, gold: 300_000 },
];

// ---- 竞技日 ----

/** 竞技日长度（毫秒，已按全局时间缩放） */
export function arenaDayMs(scale: number = getTimeScale()): number {
  return Math.max(1_000, Math.floor(ARENA_DAY_MS / Math.max(1, scale)));
}

/** 某时刻所在的竞技日序号（缩放为 1 时即东八区自然日） */
export function arenaDayIndex(at: Date | number, scale: number = getTimeScale()): number {
  const ms = typeof at === 'number' ? at : at.getTime();
  const offset = scale <= 1 ? ARENA_DAY_OFFSET_MS : 0;
  return Math.floor((ms + offset) / arenaDayMs(scale));
}

/** 下一个竞技日的开始时刻（次数重置、奖励发放的时刻） */
export function arenaNextDayAt(at: Date | number, scale: number = getTimeScale()): Date {
  const day = arenaDayIndex(at, scale);
  const offset = scale <= 1 ? ARENA_DAY_OFFSET_MS : 0;
  return new Date((day + 1) * arenaDayMs(scale) - offset);
}

/** 同一对手的挑战冷却（毫秒，已按缩放，下限 1 秒） */
export function arenaPairCooldownMs(scale: number = getTimeScale()): number {
  return Math.max(1_000, Math.floor(ARENA_PAIR_COOLDOWN_MS / Math.max(1, scale)));
}

// ---- 名次与奖励 ----

/** 能否挑战：对手必须比自己靠前，且差距不超过 ARENA_MAX_RANK_GAP */
export function canChallengeRank(myRank: number, targetRank: number): boolean {
  return targetRank < myRank && myRank - targetRank <= ARENA_MAX_RANK_GAP;
}

/** 某名次的每日奖励（金币） */
export function dailyRewardForRank(rank: number): number {
  for (const tier of ARENA_DAILY_REWARDS) {
    if (rank <= tier.upTo) {
      return tier.gold;
    }
  }
  return 0;
}

/** 历史最好名次从 prevBest 提到 newBest 时，新跨过的档位奖励（升序档，金币合计与档位列表） */
export function milestoneRewards(prevBest: number, newBest: number): { gold: number; tiers: number[] } {
  const tiers: number[] = [];
  let gold = 0;
  for (const tier of ARENA_MILESTONE_REWARDS) {
    if (prevBest > tier.upTo && newBest <= tier.upTo) {
      tiers.push(tier.upTo);
      gold += tier.gold;
    }
  }
  return { gold, tiers };
}

// ---- 对战 ----

/** 参赛武将的快照（对战只看属性；名字用于战报展示） */
export interface ArenaFighter {
  specialty?: HeroSpecialty | null;
  formation?: FormationKind;
  name: string;
  lead: number;
  force: number;
  wit: number;
  level: number;
}

/** 一局的战报摘要 */
export interface ArenaRoundReport {
  slot: number;
  /** 本局结果：challenger 胜 / defender 胜 */
  winner: 'challenger' | 'defender';
  /** 原因：fought 实际交战；bye_challenger 挑战方缺人；bye_defender 守擂方缺人；none 双方都缺 */
  reason: 'fought' | 'bye_challenger' | 'bye_defender' | 'none';
  challenger: ArenaFighter | null;
  defender: ArenaFighter | null;
  /** 实际交战时才有 */
  battle?: {
    rounds: number;
    challengerTroops: number;
    defenderTroops: number;
    challengerSurvivors: number;
    defenderSurvivors: number;
    endReason: BattleResult['endReason'];
  };
}

export interface ArenaMatchResult {
  /** 挑战方是否获胜（先赢两局） */
  challengerWon: boolean;
  /** 实际进行的局（决出胜负后不再打第三局） */
  rounds: ArenaRoundReport[];
  challengerWins: number;
  defenderWins: number;
}

/**
 * 标准军队人数 = 基础兵数 + 统率 × 每点统率兵数。
 * 竞技场内的加成不摊薄（见 fightRound）：标准军队是系统配的，基础兵数大，若照 PvE 摊薄会把统率低的武将压得过狠。
 */
export function standardArmySize(lead: number): number {
  return ARENA_ARMY_BASE + Math.max(0, Math.floor(lead)) * ARENA_ARMY_PER_LEAD;
}

/** 标准军队构成：刀盾兵、弓箭兵各一半（奇数多的一个给刀盾） */
export function standardArmy(lead: number): Partial<Record<TroopKind, number>> {
  const total = standardArmySize(lead);
  const archers = Math.floor(total / 2);
  const out: Partial<Record<TroopKind, number>> = {};
  out[ARENA_ARMY_KINDS[0]] = total - archers;
  out[ARENA_ARMY_KINDS[1]] = archers;
  return out;
}

function attrsOf(fighter: ArenaFighter): HeroAttrs {
  return { lead: fighter.lead, force: fighter.force, wit: fighter.wit };
}

/** 单局交战：挑战方当「攻方」。回合耗尽未分胜负（引擎判攻方战败）按守擂方胜处理 */
export function fightRound(
  challenger: ArenaFighter,
  defender: ArenaFighter,
  rng: () => number,
): { challengerWon: boolean; result: BattleResult } {
  const armyC = formationArmy(standardArmySize(challenger.lead), challenger.formation);
  const armyD = formationArmy(standardArmySize(defender.lead), defender.formation);
  // 不传兵数：加成按 scale = 1 计算，不摊薄（竞技场专用，PvE 仍走 heroBattleBonus 的摊薄口径）
  const bonusC = heroBattleBonus(attrsOf(challenger));
  const bonusD = heroBattleBonus(attrsOf(defender));
  const result = simulateBattle(armyC, armyD, {
    attackerHero: { atkPercent: bonusC.atkPercent, defPercent: bonusC.defPercent, specialty: challenger.specialty },
    defenderHero: { atkPercent: bonusD.atkPercent, defPercent: bonusD.defPercent, specialty: defender.specialty },
    rng,
  });
  return { challengerWon: result.attackerWon, result };
}

function sumTroops(counts: Partial<Record<TroopKind, number>>): number {
  return Object.values(counts).reduce((s, n) => s + (n ?? 0), 0);
}

/**
 * 三局两胜：号位 1 对 1、2 对 2、3 对 3，先赢两局的一方获胜，决出胜负后不再打余下的局。
 * 某一方缺人的号位直接判对方胜（双方都缺判守擂方胜）。rng 注入便于复算（战报存种子）。
 */
export function playArenaMatch(
  challengers: ReadonlyArray<ArenaFighter | null>,
  defenders: ReadonlyArray<ArenaFighter | null>,
  rng: () => number,
): ArenaMatchResult {
  const rounds: ArenaRoundReport[] = [];
  let challengerWins = 0;
  let defenderWins = 0;
  for (let slot = 0; slot < ARENA_SLOTS; slot += 1) {
    if (challengerWins >= 2 || defenderWins >= 2) {
      break;
    }
    const c = challengers[slot] ?? null;
    const d = defenders[slot] ?? null;
    const report: ArenaRoundReport = { slot: slot + 1, winner: 'defender', reason: 'none', challenger: c, defender: d };
    if (c && d) {
      const fought = fightRound(c, d, rng);
      report.reason = 'fought';
      report.winner = fought.challengerWon ? 'challenger' : 'defender';
      report.battle = {
        rounds: fought.result.rounds,
        challengerTroops: sumTroops(fought.result.attacker.troops),
        defenderTroops: sumTroops(fought.result.defender.troops),
        challengerSurvivors: sumTroops(fought.result.attacker.survivors),
        defenderSurvivors: sumTroops(fought.result.defender.survivors),
        endReason: fought.result.endReason,
      };
    } else if (c) {
      report.reason = 'bye_defender';
      report.winner = 'challenger';
    } else if (d) {
      report.reason = 'bye_challenger';
      report.winner = 'defender';
    }
    if (report.winner === 'challenger') {
      challengerWins += 1;
    } else {
      defenderWins += 1;
    }
    rounds.push(report);
  }
  return { challengerWon: challengerWins >= 2, rounds, challengerWins, defenderWins };
}

/** 可复算的随机源（mulberry32）；战报存种子，同一场对战可原样重放 */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 系统守擂者 ----

/** 守擂者阵容的基础属性：名次 1 最强（≈名将水平），名次 ARENA_NPC_COUNT 最弱（≈普通将均值） */
export function npcBaseAttr(npcIndex: number): number {
  const i = Math.max(1, Math.min(ARENA_NPC_COUNT, Math.floor(npcIndex)));
  const strongest = 60;
  const weakest = 22;
  return Math.round(strongest - ((strongest - weakest) * (i - 1)) / (ARENA_NPC_COUNT - 1));
}

/** 第 npcIndex 个守擂者（1 = 最强）的三名武将：1 号位统率型、2 号位武力型、3 号位智力型 */
export function npcLineup(npcIndex: number, rng: () => number): ArenaFighter[] {
  const base = npcBaseAttr(npcIndex);
  const level = Math.max(1, Math.round(base / 3));
  const make = (lead: number, force: number, wit: number): ArenaFighter => ({
    name: rollHeroName(rng),
    lead: Math.max(1, base + lead),
    force: Math.max(1, base + force),
    wit: Math.max(1, base + wit),
    level,
  });
  return [make(6, -3, -3), make(-3, 6, -3), make(-3, -3, 6)];
}
