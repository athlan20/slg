// 兵力占比折算战损（AISLG-244 方案 1，数值评审定稿）。纯函数，API 与 Worker 共用。
//
// 问题：战场长 120、近战每回合推进 20，接敌回合数固定约 3 回合；守军输出恒定，我方兵力
// 足够多时守军在第 1 回合内即被歼灭，之后战损只由守军这一回合的输出决定、与我方人数
// 无关——实测 Lv8 野地带 2 倍兵与 10 倍兵战损几乎一样（引擎本身不改）。
//
// 规则：r = armyPower(我方出战部队) / armyPower(守军)（按 TROOP_POWER 计参考战力）
// - 守军参考战力为 0（无守军 / 全是不计战力的兵种）：不折算；
// - r ≤ CRUSH_THRESHOLD（3）：不折算，原样返回（3 倍以内本来就是正常打法区间）；
// - r > 3：我方各兵种 losses 改为 round(losses × 3 / r)（四舍五入，不会多于原值），
//   并同步 survivors = troops − 新 losses。
// 只改攻方（result.attacker）这一侧：守方一侧、attackerWon、endReason、rounds、roundLog、
// damage 等全部保持引擎原值。入参不被修改，需要折算时返回新的 result。
//
// 适用范围：只接玩家进攻「野地原住守军」与「NPC 城池」（含名城外围 / 城守阶段）的结算出口。
// PvP（他人城池 / 野地）、竞技场、将星塔、剧本战场、NPC 袭击、势力老巢 / 围攻、野营等
// 一律不调用本模块。

import { TROOP_KINDS, type ArmyCounts, type TroopKind } from './protocol';
import { armyPower } from './battle';
import type { BattleResult } from './battle-engine';

/**
 * 折算门槛（我方参考战力 ÷ 守军参考战力）：只有 r > 本值才折算战损。
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

/**
 * 按兵力占比折算攻方战损（见文件头规则）。不满足折算条件时原样返回入参（不做任何修改）。
 * @param result 引擎结算结果（攻方 = 玩家）
 * @param defender 守军编成（与传给 resolveBattle 的同一份，用来算参考战力）
 */
export function scaleCrushLosses(
  result: BattleResult,
  defender: Partial<Record<TroopKind, number>>,
): BattleResult {
  const defenderPower = armyPower(defender);
  if (defenderPower <= 0) {
    return result;
  }
  const ratio = armyPower(result.attacker.troops) / defenderPower;
  if (ratio <= CRUSH_THRESHOLD) {
    return result;
  }
  const factor = CRUSH_THRESHOLD / ratio;
  const losses = fullCounts();
  const survivors = fullCounts();
  for (const kind of TROOP_KINDS) {
    const original = result.attacker.losses[kind] ?? 0;
    // round(原损失 × 3 / r)：r > 3 时必不大于原损失（min 为防御性兜底）
    losses[kind] = Math.min(original, Math.round(original * factor));
    survivors[kind] = Math.max(0, (result.attacker.troops[kind] ?? 0) - losses[kind]);
  }
  return { ...result, attacker: { ...result.attacker, losses, survivors } };
}
