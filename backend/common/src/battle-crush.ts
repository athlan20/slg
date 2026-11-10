// 兵力占比折算战损（AISLG-244 定规则，AISLG-246 扩到所有战斗且攻守对称）。纯函数，API 与 Worker 共用。
//
// 问题：战场长 120、近战每回合推进 20，接敌回合数固定约 3 回合；弱势一方输出恒定，我方兵力
// 足够多时对方在第 1 回合内即被歼灭，之后战损只由对方这一回合的输出决定、与我方人数
// 无关——实测 Lv8 野地带 2 倍兵与 10 倍兵战损几乎一样（引擎本身不改）。这个结构对所有
// 战斗都一样，所以折算对所有用战斗引擎结算的战斗生效，攻守双方各算各的。
//
// 规则（对每一方各算一次）：
// - r = 本方参考战力（armyPower）÷ 对方参考战力；
// - 对方参考战力为 0（空编队 / 全是不计战力的兵种）：该方不折算；
// - r ≤ CRUSH_THRESHOLD（3）：该方战损不变；
// - r > 3：该方各兵种 losses 改为 round(losses × 3 / r)（四舍五入，不会多于原值），
//   并同步 survivors = troops − 新 losses。
// attackerWon / endReason / rounds / roundLog / damage / towerDamage / wallBreak / defenseUse
// 全部保持引擎原值。入参不被修改，需要折算时返回新的 result。
//
// 接入口径（AISLG-246）：由 common/src/battle.ts 的 resolveBattle 统一折算（缺省开启），
// 各战斗出口不再各自包装——同一结果被折算两次会二次缩小，见 test/battle-crush-guard.test.ts。

import { TROOP_KINDS, type ArmyCounts } from './protocol';
import { armyPower } from './battle';
import type { BattleResult, BattleSideSummary } from './battle-engine';

/**
 * 折算门槛（本方参考战力 ÷ 对方参考战力）：只有 r > 本值才折算本方战损。
 * 含义：3 倍兵以内视为正常打法区间（战损本来随兵力下降）；超过 3 倍后战损按「相当于
 * 3 倍兵」的水平折算，避免带 10 倍兵也拿不到额外减损的白打。
 */
export const CRUSH_THRESHOLD = 3;

function fullCounts(): ArmyCounts {
  const counts = {} as ArmyCounts;
  for (const kind of TROOP_KINDS) {
    counts[kind] = 0;
  }
  return counts;
}

/** 单侧折算：enemyPower 为对方参考战力，ownPower 为本方参考战力（均为开战编成口径） */
function scaleSide(side: BattleSideSummary, enemyPower: number, ownPower: number): BattleSideSummary {
  if (enemyPower <= 0 || ownPower <= 0) {
    return side;
  }
  const ratio = ownPower / enemyPower;
  if (ratio <= CRUSH_THRESHOLD) {
    return side;
  }
  const factor = CRUSH_THRESHOLD / ratio;
  const losses = fullCounts();
  const survivors = fullCounts();
  for (const kind of TROOP_KINDS) {
    const original = side.losses[kind] ?? 0;
    // round(原损失 × 3 / r)：r > 3 时必不大于原损失（min 为防御性兜底）
    losses[kind] = Math.min(original, Math.round(original * factor));
    survivors[kind] = Math.max(0, (side.troops[kind] ?? 0) - losses[kind]);
  }
  return { ...side, losses, survivors };
}

/**
 * 按兵力占比对称折算双方战损（见文件头规则）。两侧都不满足条件时原样返回入参（不做任何修改）；
 * 任一侧满足条件时返回新对象，入参不被修改。
 */
export function scaleCrushLosses(result: BattleResult): BattleResult {
  const attackerPower = armyPower(result.attacker.troops);
  const defenderPower = armyPower(result.defender.troops);
  const attacker = scaleSide(result.attacker, defenderPower, attackerPower);
  const defender = scaleSide(result.defender, attackerPower, defenderPower);
  if (attacker === result.attacker && defender === result.defender) {
    return result;
  }
  return { ...result, attacker, defender };
}
