// 兵种克制与冲车破墙规则（v32，AISLG-86/87）：战斗引擎与文档 / 前端兵种说明共用的数值出口。
// 全部为占位数值，模拟记录见 docs/battle-calibration.md「二期兵种」一节。
// - 克制只加两条小幅倍率：长枪兵打骑兵（轻骑 / 铁骑）伤害 ×1.2；刀盾兵受弓箭兵 / 床弩攻击伤害 ×0.8；
// - 倍率表集中在 COUNTER_RULES，新兵种统一查表（引擎 attackTotal 经 counterMultiplier 取值）；
// - 冲车破墙：只在攻城战生效，冲车每占攻方存活总兵数 1%，守方城墙减伤降低 8%（相对值），最多降 80%，
//   每回合按当时存活的冲车重新计算（冲车被打光即失效）。

import type { TroopKind } from './protocol';

export interface CounterRule {
  /** 攻击方兵种（任一） */
  attackers: TroopKind[];
  /** 被攻击方兵种（任一） */
  targets: TroopKind[];
  /** 伤害倍率（> 1 克制，< 1 抗性） */
  multiplier: number;
}

export const COUNTER_RULES: CounterRule[] = [
  { attackers: ['pikeman'], targets: ['cavalry', 'iron_cavalry'], multiplier: 1.2 },
  { attackers: ['archer', 'ballista'], targets: ['swordsman'], multiplier: 0.8 },
];

/** 攻击方对目标的伤害倍率（无匹配规则为 1；多条匹配相乘） */
export function counterMultiplier(attacker: TroopKind, target: TroopKind): number {
  let multiplier = 1;
  for (const rule of COUNTER_RULES) {
    if (rule.attackers.includes(attacker) && rule.targets.includes(target)) {
      multiplier *= rule.multiplier;
    }
  }
  return multiplier;
}

/** 兵种说明用：该兵种克制哪些兵种（伤害 > 1 倍）与抗性（受哪些兵种攻击伤害 < 1 倍） */
export interface TroopCounterInfo {
  /** 克制：[{ targets, percent }]（+20 = 伤害 ×1.2） */
  counters: Array<{ targets: TroopKind[]; percent: number }>;
  /** 抗性：[{ from, percent }]（−20 = 受到伤害 ×0.8） */
  resists: Array<{ from: TroopKind[]; percent: number }>;
}

export function troopCounterInfo(kind: TroopKind): TroopCounterInfo {
  const info: TroopCounterInfo = { counters: [], resists: [] };
  for (const rule of COUNTER_RULES) {
    const percent = Math.round((rule.multiplier - 1) * 100);
    if (rule.multiplier > 1 && rule.attackers.includes(kind)) {
      info.counters.push({ targets: rule.targets, percent });
    }
    if (rule.multiplier < 1 && rule.targets.includes(kind)) {
      info.resists.push({ from: rule.attackers, percent });
    }
  }
  return info;
}

/** 冲车每占攻方存活总兵数 1%，城墙减伤相对降低 8%；最多降 80% */
export const RAM_BREAK_PER_PERCENT = 8;
export const RAM_BREAK_MAX_PERCENT = 80;

/** 冲车占比（%）对应的城墙减伤降低比例（0..0.8） */
export function ramWallReduction(ramShare: number): number {
  const percent = Math.min(RAM_BREAK_MAX_PERCENT, Math.max(0, ramShare * 100 * RAM_BREAK_PER_PERCENT));
  return percent / 100;
}

/** 破墙后的城墙减伤百分数 = 原减伤 ×（1 − 降低比例）；例：70% 墙、冲车占 5% → 70 × (1 − 0.4) = 42 */
export function ramAdjustedWall(wallPercent: number, ramShare: number): number {
  return wallPercent * (1 - ramWallReduction(ramShare));
}
