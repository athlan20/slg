// 一期战斗引擎（v13 结构落地，v15 规则定稿：AISLG-2 战斗数值评审）。
// 旧游戏的多回合推进、移动速度、射程与战斗判定结构，只纳入一期 1–7 号兵种与
// 城墙防御加成；武将、科技、装备、攻城器械、城防设施不参与结算。
// 结构参考旧游戏：一维战场距离轴、按速度推进、
// 进入射程开打、伤害减法公式与互斥判定链。数值经 backend/scripts/battle-calibration.ts
// 固定种子批量模拟评审定稿（评审记录 docs/battle-calibration.md）；API 与 Worker
// 共用本引擎，两侧不得各自另算。
//
// 战场结构：攻方从 0 推进、守方从 FIELD_LENGTH 出发；野地遭遇战双方迎面推进，
// 攻城战（siege）守方贴墙布阵——仍在城墙位（pos = FIELD_LENGTH）的守方兵堆受击
// 减免，出城迎击（离开城墙位）即失去减免；守方不再被射程压制站桩（纯近战守军
// 也能冲出城墙接敌，v15 前的结构问题见评审记录）。每个兵种一个「兵堆」。
//
// 行动顺序（v15 定稿）：全体兵堆按速度降序分档，档内同时行动——移动与攻击按
// 档初状态判定，伤亡在档末统一生效。快兵种先动（速度即主动性）；同速双方同时
// 结算、互无先手差，避免同战力仅因攻守位置出现先手碾压。攻击判定链为整兵堆
// 单次 roll（同堆同命运，波动较大）：评审时接受该方差，未拆分到单兵。
//
// 余伤血池（v15 定稿）：单次攻击不足单兵生命的伤害累计入兵堆 wound 池、跨回合
// 与跨攻击者叠加，达到单兵生命即折算阵亡——小部队的零星输出不再每回合被取整
// 抹掉。伤害数值全程保留浮点，仅在战报统计处取整展示。
//
// 回合上限内未歼灭守方判攻方战败（未能突破）；败方幸存部队的去向（撤回出发城）
// 由调用方按 result 的 survivors 结算，引擎只报告幸存——战报、事件与实际兵力
// 三处以引擎结果为准（v15 前幸存者凭空消失的记账缺口见评审记录）。

import { TROOP_KINDS, type ArmyCounts, type TroopKind } from './protocol';
import { CAVALRY_KINDS, counterMultiplier, ramAdjustedWall } from './troop-counter';
import {
  DEFENSE_INFO,
  INFANTRY_KINDS,
  WALL_MELEE_KINDS,
  type DefenseKind,
  type DefenseStock,
} from './city-defense';
import { specialtyBonus, type HeroSpecialty } from './hero-specialty';

export interface HeroCombatBonus {
  atkPercent: number;
  defPercent: number;
  specialty?: HeroSpecialty | null;
  specialtyScale?: number;
}

// ---- 兵种战斗属性（数值评审定稿，调整需重跑校准并更新评审记录） ----

export interface TroopStats {
  /** 单兵生命（余伤池折算阵亡的分母） */
  hp: number;
  /** 单兵攻击 */
  atk: number;
  /** 单兵防御（伤害减法公式的减免项） */
  def: number;
  /** 每回合推进距离（战场一维坐标） */
  speed: number;
  /** 攻击射程（战场一维坐标） */
  range: number;
  /** 行军速度系数（大地图行军按编队最慢者折算，1 = 基准速度） */
  marchSpeed: number;
}

/** 一期七兵种战斗属性（保持「近战推进—弓箭远程压制」的克制关系：民夫/斥候偏弱、
 * 骑兵最快、弓箭兵射程最远、近战系血厚防高——近战需扛过弓箭的接近窗口后反制；
 * 弓箭兵高攻低血为玻璃输出位，轻骑兵高速接近专职反远程） */
export const TROOP_STATS: Record<TroopKind, TroopStats> = {
  porter: { hp: 250, atk: 50, def: 20, speed: 12, range: 10, marchSpeed: 1 },
  militia: { hp: 450, atk: 100, def: 50, speed: 20, range: 10, marchSpeed: 1 },
  scout: { hp: 350, atk: 80, def: 40, speed: 80, range: 10, marchSpeed: 2 },
  pikeman: { hp: 750, atk: 220, def: 180, speed: 20, range: 10, marchSpeed: 1 },
  swordsman: { hp: 1000, atk: 260, def: 280, speed: 16, range: 10, marchSpeed: 1 },
  archer: { hp: 250, atk: 240, def: 60, speed: 20, range: 70, marchSpeed: 1 },
  cavalry: { hp: 1100, atk: 380, def: 150, speed: 110, range: 10, marchSpeed: 1.5 },
  // 二期四兵种（v32）：铁骑兵后期重装主力 / 辎重车纯后勤（攻 0）/ 床弩射程最远（95）脆而慢 / 冲车肉厚攻低、攻城时削弱城墙减伤
  iron_cavalry: { hp: 2400, atk: 620, def: 420, speed: 70, range: 10, marchSpeed: 1.2 },
  supply_wagon: { hp: 600, atk: 0, def: 50, speed: 8, range: 10, marchSpeed: 0.7 },
  ballista: { hp: 300, atk: 260, def: 40, speed: 8, range: 95, marchSpeed: 0.6 },
  siege_ram: { hp: 1500, atk: 60, def: 200, speed: 10, range: 10, marchSpeed: 0.6 },
  // v64 名城专属兵种（AISLG-168，占位）：步兵 4 种按 f≈1.5（白毦 1.55、虎卫 1.6、丹阳 1.45）；西凉铁骑 f=1.35；
  // 虎豹骑 f=1.8（速度 130 全军最快，属性补足）；诸葛连弩射程 80、属性 ×1.05（收益主要来自射程 80 > 70：等兵数 100v100 攻方实测胜率约 99%，参考战力不计射程，故 TROOP_POWER 只比弓箭兵高 40%）；先登死士 f=1.5、射程 60 保留
  yulin_guard: { hp: 2100, atk: 480, def: 585, speed: 16, range: 10, marchSpeed: 1 },
  danyang_soldier: { hp: 1740, atk: 595, def: 493, speed: 16, range: 10, marchSpeed: 1 },
  baimao_soldier: { hp: 1511, atk: 443, def: 363, speed: 20, range: 10, marchSpeed: 1 },
  huwei_guard: { hp: 1760, atk: 384, def: 384, speed: 20, range: 10, marchSpeed: 1 },
  zhuge_crossbow: { hp: 262, atk: 252, def: 63, speed: 20, range: 80, marchSpeed: 1 },
  xiandeng_warrior: { hp: 488, atk: 510, def: 117, speed: 20, range: 60, marchSpeed: 1 },
  hubao_cavalry: { hp: 2574, atk: 889, def: 351, speed: 130, range: 10, marchSpeed: 1.8 },
  xiliang_cavalry: { hp: 2025, atk: 675, def: 257, speed: 100, range: 10, marchSpeed: 1.5 },
};

// ---- 引擎参数（数值评审定稿，调整需重跑校准并更新评审记录） ----

/** 战场长度（一维距离轴）：120 ≈ 慢速近战（速度 20）3 回合接敌——远程先手窗口约
 *  2 回合，骑兵（速度 40）1 回合贴脸即压制远程 */
export const FIELD_LENGTH = 120;
/** 回合上限；超时未歼灭守方 = 攻方战败「未能突破」，幸存者由调用方撤回 */
export const MAX_BATTLE_ROUNDS = 100;

/**
 * 互斥判定链概率（万分位）：随机数 0..9999 依次落入
 * 闪避（免伤）→ 格挡（×0.5）→ 破击（×2）→ 暴击（×1.5）→ 普通命中（×1）。
 * 期望乘数 ≈ 0.95（闪避主导的小幅折减）。
 */
export const JUDGMENT_RATES = { dodge: 500, block: 1000, pierce: 500, crit: 1000 } as const;

/** 世界地图战斗的科技乘数（v72，AISLG-192）：调用方由 tech.combatTechBonus 换算传入；
 *  竞技场 / 将星塔不传（不受科技影响），NPC 一方不传。与武将加成是两层乘法。 */
export interface CombatTechBonus {
  /** 全军攻击 +%（战斗科技，每级 1.5%） */
  atkPercent?: number;
  /** 全军受到伤害 −%（防护科技，每级 1.5%） */
  defPercent?: number;
  /** 骑兵类兵种战斗速度 +%（驾驭科技，每级 2%） */
  cavalrySpeedPercent?: number;
  /** 远程兵种射程 +%（抛射科技，每级 1%） */
  rangedRangePercent?: number;
}

/** 城防器械的单种用量（战报 / 调用方扣库存共用） */
export interface DefenseUseEntry {
  kind: DefenseKind;
  used: number;
  damage: number;
  killed: number;
}

export interface BattleOptions {
  /** 守方城墙防御加成（百分数；攻城战传入，仅城墙位守方兵堆受击减免） */
  wallDefensePercent?: number;
  /** 攻城战：守方贴墙布阵（城墙位享减伤，可出城迎击、离墙失减伤）；野地遭遇战缺省 false（双方迎面推进） */
  siege?: boolean;
  /** 箭塔（v30，AISLG-82）：仅攻城战（siege）生效——守方城墙位上不会被消灭的远程单位，每回合对射程内最近的
   *  敌方兵堆造成固定伤害（不走判定链、不吃防御与城墙减伤）；伤害计入守方输出，战报单独列出 */
  tower?: { damage: number; range: number } | null;
  /** 攻方武将加成（v36，AISLG-114）：atkPercent 全军攻击 +%（武力 × 0.3% 封顶 20%，统率超编按比例摊薄，
   *  摊薄由调用方按部队规模算好传入）；defPercent 全军受到伤害 −%（智力同口径）。缺省无加成 */
  attackerHero?: HeroCombatBonus | null;
  /** 守方武将加成（v36，AISLG-115：城守）；口径同 attackerHero */
  defenderHero?: HeroCombatBonus | null;
  /** 攻方科技乘数（v72，AISLG-192；仅世界地图战斗传入，竞技场 / 将星塔不传） */
  attackerTech?: CombatTechBonus | null;
  /** 守方科技乘数（同上；NPC 一方不传） */
  defenderTech?: CombatTechBonus | null;
  /** 守方武将加成的覆盖比例（v74，AISLG-194）：协防时城守武将只加成城主自己的部队，
   *  按城主兵力占守方总兵力的比例折算（0..1，缺省 1 = 全部守军都吃城守加成） */
  defenderHeroScale?: number;
  /** 守方城防器械库存（v73，AISLG-193；仅守城战 siege 生效）。引擎按需使用、最多用到把
   *  对口敌军全部打掉，返回 defenseUse 由调用方在同一事务内扣库存。缺省 / 空 = 无器械 */
  defenses?: DefenseStock | null;
  /** 回合上限（测试用；缺省 MAX_BATTLE_ROUNDS） */
  maxRounds?: number;
  /** 随机源（测试注入固定序列；缺省 Math.random） */
  rng?: () => number;
}

/** 单回合统计（战报 roundLog 的元素） */
export interface BattleRoundLogEntry {
  round: number;
  attackerDamage: number;
  defenderDamage: number;
  attackerKilled: number;
  defenderKilled: number;
  /** 本回合箭塔造成的伤害（已含在 defenderDamage 内；无箭塔 / 射程外为 0） */
  towerDamage: number;
  /** 本回合城防器械造成的伤害（v73；已含在 defenderDamage 内；未触发为缺省） */
  defenseDamage?: number;
}

/** 一方的战斗汇总（战报与结算共用） */
export interface BattleSideSummary {
  troops: ArmyCounts;
  losses: ArmyCounts;
  survivors: ArmyCounts;
  /** 全场总输出伤害（按次取整求和，统计口径） */
  damage: number;
}

export interface BattleResult {
  /** 攻方是否获胜（歼灭守方） */
  attackerWon: boolean;
  /** 终局原因 */
  endReason: 'defender_wiped' | 'attacker_wiped' | 'round_limit';
  /** 实际进行回合数 */
  rounds: number;
  attacker: BattleSideSummary;
  defender: BattleSideSummary;
  roundLog: BattleRoundLogEntry[];
  /** 全场箭塔造成的总伤害（v30；无箭塔为 0） */
  towerDamage: number;
  /** 冲车破墙（v32，AISLG-86）：攻城战、城墙减伤 > 0 且攻方带冲车时给出开战时（第 1 回合）城墙减伤的
   *  原值与破墙后的值（百分数，保留 1 位小数）；其余为 null */
  wallBreak: { from: number; to: number } | null;
  /** 城防器械用量（v73，AISLG-193；只含实际用掉的器械，未触发的不出现；无器械为空数组） */
  defenseUse: DefenseUseEntry[];
}

/** 战场上的一个兵堆（同兵种聚为一堆；位置为一维坐标） */
interface Stack {
  kind: TroopKind;
  count: number;
  pos: number;
  initial: number;
  /** 余伤血池：累计待折算伤害（浮点；达到单兵生命折算阵亡后保留余数） */
  wound: number;
}

/** 行动单位（兵堆 + 阵营；side 0 = 攻方、1 = 守方） */
interface Unit {
  stack: Stack;
  side: 0 | 1;
}

function sideSummary(stacks: Stack[]): BattleSideSummary {
  const troops = {} as ArmyCounts;
  const losses = {} as ArmyCounts;
  const survivors = {} as ArmyCounts;
  for (const kind of TROOP_KINDS) {
    troops[kind] = 0;
    losses[kind] = 0;
    survivors[kind] = 0;
  }
  for (const s of stacks) {
    troops[s.kind] = s.initial;
    survivors[s.kind] = s.count;
    losses[s.kind] = s.initial - s.count;
  }
  return { troops, losses, survivors, damage: 0 };
}

function makeStacks(troops: Partial<Record<TroopKind, number>>, forward: 1 | -1): Stack[] {
  // forward=1 攻方（从 0 向 FIELD_LENGTH 推进）；-1 守方（从 FIELD_LENGTH 向 0 迎击）
  const stacks: Stack[] = [];
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(troops[kind] ?? 0);
    if (count > 0) {
      stacks.push({ kind, count, pos: forward === 1 ? 0 : FIELD_LENGTH, initial: count, wound: 0 });
    }
  }
  return stacks;
}

/**
 * 一次攻击的总伤害（浮点，余伤池口径）：判定链 roll → 伤害公式 → 城墙位减伤。
 * 闪避返回 0；伤害无下限（v15 移除「保底 1 伤」——余伤池已保证小输出跨回合累计）。
 * v36（AISLG-114）：武将加成按「基础伤害 → 兵种克制 → 武将加成 → 城墙减伤」叠加——
 * attBonus 为攻击方全军攻击 +%（含守方还击），defBonus 为受击方全军减伤 −%。
 */
function attackTotal(
  att: Stack,
  target: Stack,
  wallPercent: number,
  rng: () => number,
  attBonusPercent = 0,
  defBonusPercent = 0,
  techAtkPercent = 0,
  techDefPercent = 0,
): number {
  const attStats = TROOP_STATS[att.kind];
  const defStats = TROOP_STATS[target.kind];
  // 伤害公式（旧源码结构）：damage = ATK × (1 − DEF / (DEF + 2000))
  let total = attStats.atk * (1 - defStats.def / (defStats.def + 2000)) * att.count;
  // 兵种克制（v32，AISLG-87）：长枪克骑兵 ×1.2、刀盾受弓箭 / 床弩 ×0.8，倍率表见 troop-counter.ts
  total *= counterMultiplier(att.kind, target.kind);
  // 武将加成（v36）：攻击方全军攻击 +%，受击方全军减伤 −%（各封顶 20% 由调用方钳制）
  if (attBonusPercent > 0) {
    total *= 1 + attBonusPercent / 100;
  }
  if (defBonusPercent > 0) {
    total *= 1 - defBonusPercent / 100;
  }
  // 科技乘数（v72）：在武将加成之后单独一层（武将 20% 封顶不被科技突破）
  if (techAtkPercent > 0) {
    total *= 1 + techAtkPercent / 100;
  }
  if (techDefPercent > 0) {
    total *= 1 - techDefPercent / 100;
  }
  const roll = Math.floor(rng() * 10000);
  if (roll < JUDGMENT_RATES.dodge) {
    return 0;
  }
  if (roll < JUDGMENT_RATES.dodge + JUDGMENT_RATES.block) {
    total = total * 0.5;
  } else if (roll < JUDGMENT_RATES.dodge + JUDGMENT_RATES.block + JUDGMENT_RATES.pierce) {
    total = total * 2;
  } else if (roll < JUDGMENT_RATES.dodge + JUDGMENT_RATES.block + JUDGMENT_RATES.pierce + JUDGMENT_RATES.crit) {
    total = total * 1.5;
  }
  // 城墙位减伤：只在守方兵堆仍据墙（pos = FIELD_LENGTH）时生效（每级 5%、封顶 90%，
  // 调用方按城墙等级传入）——减法公式对低防目标太平坦，城墙单独走乘法保证可感知
  if (wallPercent > 0) {
    total = total * (1 - Math.min(90, wallPercent) / 100);
  }
  return total;
}

/** 敌方最前沿的存活兵堆：攻方视角取守方 pos 最小者，守方视角取攻方 pos 最大者 */
function frontmost(enemies: Stack[], side: 0 | 1): Stack | null {
  let best: Stack | null = null;
  for (const e of enemies) {
    if (e.count <= 0) {
      continue;
    }
    if (best === null) {
      best = e;
      continue;
    }
    const closer = side === 0 ? e.pos < best.pos : e.pos > best.pos;
    if (closer || (e.pos === best.pos && TROOP_KINDS.indexOf(e.kind) < TROOP_KINDS.indexOf(best.kind))) {
      best = e;
    }
  }
  return best;
}

/** 全体兵堆按速度降序分档（同速同档）；档内次序固定（守方在前、同阵营按兵种清单序），只影响 rng 消费序。
 *  v72：速度按科技乘数后的有效值分档（驾驭科技让骑兵更快） */
function speedTiers(attStacks: Stack[], defStacks: Stack[], speedOf: (stack: Stack, side: 0 | 1) => number): Unit[][] {
  const units: Unit[] = [
    ...attStacks.map((stack) => ({ stack, side: 0 as const })),
    ...defStacks.map((stack) => ({ stack, side: 1 as const })),
  ];
  units.sort(
    (a, b) =>
      speedOf(b.stack, b.side) - speedOf(a.stack, a.side) ||
      b.side - a.side ||
      TROOP_KINDS.indexOf(a.stack.kind) - TROOP_KINDS.indexOf(b.stack.kind),
  );
  const tiers: Unit[][] = [];
  for (const unit of units) {
    const speed = speedOf(unit.stack, unit.side);
    if (tiers.length === 0 || speedOf(tiers[tiers.length - 1][0].stack, tiers[tiers.length - 1][0].side) !== speed) {
      tiers.push([]);
    }
    tiers[tiers.length - 1].push(unit);
  }
  return tiers;
}

/**
 * 多回合战斗（纯函数）。攻方歼灭守方获胜（胜方必有幸存，满足占领语义）；守方歼灭
 * 攻方或回合耗尽判攻方战败——败方幸存者由调用方结算去向（出征败退撤回出发城，
 * 见 battle-tick），引擎保证 survivors 即实际存活兵力。
 */
export function simulateBattle(
  attacker: Partial<Record<TroopKind, number>>,
  defender: Partial<Record<TroopKind, number>>,
  opts: BattleOptions = {},
): BattleResult {
  const rng = opts.rng ?? Math.random;
  const wall = Math.max(0, Math.min(90, opts.wallDefensePercent ?? 0));
  const siege = opts.siege ?? false;
  const tower = opts.tower && opts.tower.damage > 0 ? opts.tower : null;
  const maxRounds = opts.maxRounds ?? MAX_BATTLE_ROUNDS;
  // 武将加成按阵营取（v36）：攻方打人吃 attackerHero.atkPercent、挨打吃 defenderHero.defPercent，反之亦然
  const attHero = opts.attackerHero ?? null;
  const defHero = opts.defenderHero ?? null;
  // v72（AISLG-192）：科技乘数按阵营取——攻方打人吃 attackerTech.atkPercent、挨打吃 defenderTech.defPercent
  const attTech = opts.attackerTech ?? null;
  const defTech = opts.defenderTech ?? null;
  const defHeroScale = Math.max(0, Math.min(1, opts.defenderHeroScale ?? 1));
  /** 有效速度：驾驭科技只加骑兵类战斗速度（影响分档与每回合推进距离） */
  const speedOf = (stack: Stack, side: 0 | 1): number => {
    const base = TROOP_STATS[stack.kind].speed;
    const percent = Math.max(0, (side === 0 ? attTech : defTech)?.cavalrySpeedPercent ?? 0);
    return CAVALRY_KINDS.includes(stack.kind) ? base * (1 + percent / 100) : base;
  };
  /** 有效射程：抛射科技只加远程兵种（基础射程 > 近战基准 10） */
  const rangeOf = (stack: Stack, side: 0 | 1): number => {
    const base = TROOP_STATS[stack.kind].range;
    if (base <= 10) {
      return base;
    }
    const percent = Math.max(0, (side === 0 ? attTech : defTech)?.rangedRangePercent ?? 0);
    return base * (1 + percent / 100);
  };
  const attStacks = makeStacks(attacker, 1);
  const defStacks = makeStacks(defender, -1);
  const roundLog: BattleRoundLogEntry[] = [];

  if (defStacks.length === 0) {
    // 空守军：不发生战斗，攻方直接获胜（0 回合）
    return {
      attackerWon: true,
      endReason: 'defender_wiped',
      rounds: 0,
      attacker: sideSummary(attStacks),
      defender: sideSummary(defStacks),
      roundLog,
      towerDamage: 0,
      wallBreak: null,
      defenseUse: [],
    };
  }

  let round = 0;
  let endReason: BattleResult['endReason'] = 'round_limit';
  let wallBreak: BattleResult['wallBreak'] = null;
  // v73（AISLG-193）：城防器械库存 / 用量。陷阱、拒马开战时结算；滚木、擂石在攻方
  // 对应兵堆第一次贴到城墙下时各结算一次。用量受库存限制，伤害按对口兵种总生命比例分摊。
  const defenseStock: Record<DefenseKind, number> = {
    trap: Math.max(0, Math.floor(opts.defenses?.trap ?? 0)),
    chevaux: Math.max(0, Math.floor(opts.defenses?.chevaux ?? 0)),
    rolling_log: Math.max(0, Math.floor(opts.defenses?.rolling_log ?? 0)),
    boulder: Math.max(0, Math.floor(opts.defenses?.boulder ?? 0)),
  };
  const defenseUsed: Record<DefenseKind, { used: number; killed: number }> = {
    trap: { used: 0, killed: 0 },
    chevaux: { used: 0, killed: 0 },
    rolling_log: { used: 0, killed: 0 },
    boulder: { used: 0, killed: 0 },
  };
  let boulderFired = false;
  let rollingLogFired = false;
  /**
   * 对一组攻方兵堆使用 kind 器械：件数 = min(库存, ceil(目标总生命 ÷ 单件伤害))——
   * 最多用到把对口敌军全部打掉；伤害不吃防御与城墙减伤，按各兵堆总生命比例分摊进余伤池。
   */
  const useDefense = (kind: DefenseKind, targets: Stack[]): { damage: number; killed: number } => {
    const live = targets.filter((stack) => stack.count > 0);
    if (!siege || defenseStock[kind] <= 0 || live.length === 0) {
      return { damage: 0, killed: 0 };
    }
    const per = DEFENSE_INFO[kind].damage;
    const totalHp = live.reduce((sum, stack) => sum + stack.count * TROOP_STATS[stack.kind].hp, 0);
    if (totalHp <= 0) {
      return { damage: 0, killed: 0 };
    }
    const used = Math.min(defenseStock[kind], Math.ceil(totalHp / per));
    const applied = Math.min(used * per, totalHp);
    let killed = 0;
    for (const stack of live) {
      const hp = TROOP_STATS[stack.kind].hp;
      const share = applied * ((stack.count * hp) / totalHp);
      stack.wound += share;
      const down = Math.min(stack.count, Math.floor(stack.wound / hp));
      stack.count -= down;
      stack.wound -= down * hp;
      if (stack.count <= 0) {
        stack.wound = 0;
      }
      killed += down;
    }
    defenseStock[kind] -= used;
    defenseUsed[kind].used += used;
    defenseUsed[kind].killed += killed;
    return { damage: used * per, killed };
  };
  /** 当前回合有效城墙减伤：冲车（v32）每回合按攻方存活冲车占比重新计算 */
  const currentWall = (): number => {
    if (!siege || wall <= 0) {
      return wall;
    }
    const alive = attStacks.reduce((sum, s) => sum + Math.max(0, s.count), 0);
    const rams = attStacks.filter((s) => s.kind === 'siege_ram').reduce((sum, s) => sum + Math.max(0, s.count), 0);
    return alive > 0 ? ramAdjustedWall(wall, rams / alive) : wall;
  };
  outer: while (round < maxRounds) {
    round += 1;
    let attDmg = 0;
    let defDmg = 0;
    let attKilled = 0;
    let defKilled = 0;
    let towerDmg = 0;
    let defenseDmg = 0;
    const wallNow = currentWall();
    if (round === 1 && siege && wall > 0 && attStacks.some((s) => s.kind === 'siege_ram' && s.count > 0)) {
      wallBreak = { from: wall, to: Math.round(wallNow * 10) / 10 };
    }
    const logRound = (): void => {
      roundLog.push({
        round,
        attackerDamage: attDmg,
        defenderDamage: defDmg,
        attackerKilled: attKilled,
        defenderKilled: defKilled,
        towerDamage: towerDmg,
        ...(defenseDmg > 0 ? { defenseDamage: defenseDmg } : {}),
      });
    };

    // 城防器械（v73，AISLG-193）：陷阱 / 拒马在开战（第 1 回合）行动前结算；两者各按对口兵种分摊伤害
    if (round === 1 && siege) {
      const trapHit = useDefense('trap', attStacks.filter((stack) => INFANTRY_KINDS.includes(stack.kind)));
      const chevauxHit = useDefense('chevaux', attStacks.filter((stack) => CAVALRY_KINDS.includes(stack.kind)));
      defDmg += trapHit.damage + chevauxHit.damage;
      attKilled += trapHit.killed + chevauxHit.killed;
      defenseDmg += trapHit.damage + chevauxHit.damage;
      if (trapHit.damage + chevauxHit.damage > 0 && attStacks.every((a) => a.count <= 0)) {
        endReason = 'attacker_wiped';
        logRound();
        break outer;
      }
    }

    // 箭塔（v30，AISLG-82）：回合开始先射一箭——对射程内最近（最靠近城墙）的敌方兵堆造成固定伤害。
    // 塔不会被消灭，所以不进入兵堆与终局判定；守方兵堆全灭仍判守城失败（塔救不了没有守军的城）
    if (siege && tower && defStacks.some((d) => d.count > 0)) {
      const victim = frontmost(attStacks, 1);
      if (victim && FIELD_LENGTH - victim.pos <= tower.range) {
        const victimStats = TROOP_STATS[victim.kind];
        victim.wound += tower.damage;
        const killed = Math.min(victim.count, Math.floor(victim.wound / victimStats.hp));
        victim.count -= killed;
        victim.wound -= killed * victimStats.hp;
        if (victim.count <= 0) {
          victim.wound = 0;
        }
        towerDmg = tower.damage;
        defDmg += tower.damage;
        attKilled += killed;
        if (attStacks.every((a) => a.count <= 0)) {
          endReason = 'attacker_wiped';
          logRound();
          break outer;
        }
      }
    }

    // 速度降序逐档行动；档内基于档初状态判定移动 / 攻击，伤亡档末统一生效（同速无先手差）
    for (const tier of speedTiers(attStacks, defStacks, speedOf)) {
      const moves: Array<{ stack: Stack; to: number }> = [];
      const attacks: Array<{ att: Stack; target: Stack; total: number; byAttacker: boolean }> = [];
      for (const unit of tier) {
        if (unit.stack.count <= 0) {
          continue;
        }
        const enemies = unit.side === 0 ? defStacks : attStacks;
        const target = frontmost(enemies, unit.side);
        if (!target) {
          continue;
        }
        const inRange =
          unit.side === 0
            ? unit.stack.pos + rangeOf(unit.stack, 0) >= target.pos
            : unit.stack.pos - rangeOf(unit.stack, 1) <= target.pos;
        if (!inRange) {
          if (siege && unit.side === 1) {
            // 据墙待敌：敌方仍有兵堆在向城墙逼近（处于守方前沿射程之外）时原地等待，
            // 保持在城墙位享受减伤；敌方全部驻足射程外输出（典型：纯远程压制）而本兵堆
            // 够不到任何目标时才出城迎击——离墙即失去减伤（v15：解决守军纯近战被
            // 远程白嫖的结构问题，同时守军不再无脑弃墙野战）
            const front = frontmost(defStacks, 0);
            const enemyClosing = attStacks.some(
              (e) => e.count > 0 && e.pos + rangeOf(e, 0) < (front?.pos ?? 0),
            );
            if (enemyClosing) {
              continue;
            }
          }
          // 推进（攻方向 FIELD_LENGTH、守方向 0；守城近战出城迎击同样走这里）
          const to =
            unit.side === 0
              ? Math.min(unit.stack.pos + speedOf(unit.stack, unit.side), FIELD_LENGTH)
              : Math.max(unit.stack.pos - speedOf(unit.stack, unit.side), 0);
          moves.push({ stack: unit.stack, to });
          continue;
        }
        // 攻方命中城墙位的守方才吃守城减伤；守方还击不吃
        const wallPercent = siege && unit.side === 0 && target.pos === FIELD_LENGTH ? wallNow : 0;
        const hero = unit.side === 0 ? attHero : defHero;
        const foe = unit.side === 0 ? defHero : attHero;
        // v74：守方（side=1）的城守加成按覆盖比例折算（协防部队不吃城主武将的加成）
        const heroScale = unit.side === 1 ? defHeroScale : 1;
        const foeHeroScale = unit.side === 0 ? defHeroScale : 1;
        const specialty = specialtyBonus(hero?.specialty, unit.stack.kind, hero?.specialtyScale ?? 1, siege);
        const resistance = specialtyBonus(foe?.specialty, target.kind, foe?.specialtyScale ?? 1, siege);
        const techAtk = Math.max(0, (unit.side === 0 ? attTech : defTech)?.atkPercent ?? 0);
        const techDef = Math.max(0, (unit.side === 0 ? defTech : attTech)?.defPercent ?? 0);
        const total = attackTotal(unit.stack, target, wallPercent, rng,
          ((hero?.atkPercent ?? 0) + specialty.atkPercent) * heroScale,
          ((foe?.defPercent ?? 0) + resistance.defPercent) * foeHeroScale,
          techAtk, techDef);
        if (total > 0) {
          attacks.push({ att: unit.stack, target, total, byAttacker: unit.side === 0 });
        }
      }
      for (const move of moves) {
        move.stack.pos = move.to;
      }
      for (const hit of attacks) {
        // 档末结算：伤害入余伤池并折算阵亡（同档被击毙的兵堆仍完成本次攻击 = 同时行动）
        const targetStats = TROOP_STATS[hit.target.kind];
        hit.target.wound += hit.total;
        const killed = Math.min(hit.target.count, Math.floor(hit.target.wound / targetStats.hp));
        hit.target.count -= killed;
        hit.target.wound -= killed * targetStats.hp;
        if (hit.target.count <= 0) {
          hit.target.wound = 0;
        }
        const damage = Math.round(hit.total);
        if (hit.byAttacker) {
          attDmg += damage;
          defKilled += killed;
        } else {
          defDmg += damage;
          attKilled += killed;
        }
      }
      // 城防器械（v73）：滚木 / 擂石在攻方对应兵堆第一次贴到城墙下时各结算一次。
      // 「贴墙」= 该兵堆按有效射程已够到城墙位（pos + range ≥ FIELD_LENGTH）。擂石先打冲车，
      // 滚木再打剩余的贴墙近战（含未被击毁的冲车）。
      if (siege) {
        const adjacentMelee = (): Stack[] =>
          attStacks.filter(
            (stack) =>
              stack.count > 0 &&
              WALL_MELEE_KINDS.includes(stack.kind) &&
              stack.pos + rangeOf(stack, 0) >= FIELD_LENGTH,
          );
        if (!boulderFired) {
          const rams = adjacentMelee().filter((stack) => stack.kind === 'siege_ram');
          if (rams.length > 0) {
            const hit = useDefense('boulder', rams);
            if (hit.damage > 0) {
              boulderFired = true;
              defDmg += hit.damage;
              attKilled += hit.killed;
              defenseDmg += hit.damage;
            }
          }
        }
        if (!rollingLogFired) {
          const melee = adjacentMelee();
          if (melee.length > 0) {
            const hit = useDefense('rolling_log', melee);
            if (hit.damage > 0) {
              rollingLogFired = true;
              defDmg += hit.damage;
              attKilled += hit.killed;
              defenseDmg += hit.damage;
            }
          }
        }
      }

      // 终局判定：攻方全灭优先（同档同归于尽时攻方不得以零幸存「获胜」——
      // 胜方必有幸存是占领语义的引擎保证；守方零幸存的极端并灭按守方守住处理）。
      // 先记完本回合统计再退出（战报含终局回合）。
      if (attStacks.every((a) => a.count <= 0)) {
        endReason = 'attacker_wiped';
        logRound();
        break outer;
      }
      if (defStacks.every((d) => d.count <= 0)) {
        endReason = 'defender_wiped';
        logRound();
        break outer;
      }
    }
    logRound();
  }

  const attackerWon = endReason === 'defender_wiped';
  const att = sideSummary(attStacks);
  const def = sideSummary(defStacks);
  att.damage = roundLog.reduce((sum, e) => sum + e.attackerDamage, 0);
  def.damage = roundLog.reduce((sum, e) => sum + e.defenderDamage, 0);
  return {
    attackerWon,
    endReason,
    rounds: round,
    attacker: att,
    defender: def,
    roundLog,
    towerDamage: roundLog.reduce((sum, e) => sum + e.towerDamage, 0),
    wallBreak,
    defenseUse: (Object.keys(defenseUsed) as DefenseKind[])
      .filter((kind) => defenseUsed[kind].used > 0)
      .map((kind) => ({
        kind,
        used: defenseUsed[kind].used,
        damage: defenseUsed[kind].used * DEFENSE_INFO[kind].damage,
        killed: defenseUsed[kind].killed,
      })),
  };
}
