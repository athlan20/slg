// 伤兵 / 俘虏 / 逃兵的战斗拆分规则（AISLG-212，协议 v85）。纯函数，API 与 Worker 共用：
// 所有世界地图战斗的结算出口统一先经 splitBattleCasualties 把双方 losses 拆成
// 「伤兵（20% 可半价治好）/ 被俘（10% 被胜方抓走）/ 阵亡」，再由 troop-pools-db 入账。
// 数值（AISLG-212 评审定稿，不得自行更改）：
// - 伤兵率 20%（老游戏 19% 取整）：玩家一方各兵种损失 floor(20%) 进伤兵营，NPC 无伤兵；
// - 俘虏率 10%：胜方从败方各兵种损失抓 floor(10%)，只抓 1~7 号基础兵种
//   （运输 / 民兵 / 斥候 / 枪兵 / 剑兵 / 弓兵 / 骑兵）；二期兵种与名城专属兵不抓；
// - 平局（回合耗尽、双方都没被全歼）不抓；NPC 打赢玩家时不抓；
// - 败方是玩家时被俘部分从阵亡里扣：基础兵种 = 20% 伤兵 + 10% 被俘 + 70% 阵亡，
//   二期 / 专属兵种 = 20% 伤兵 + 80% 阵亡。
// 不适用的战斗（剧本战场 / 竞技场 / 将星塔）不调用本模块。
// 治疗与劝回 50%、招降 60% 的费用计算也在本文件（复用遣散「先累加再取整一次」口径）。

import { RESOURCE_KEYS, TROOP_KINDS, type ArmyCounts, type Resources, type TroopKind } from './protocol';
import { TROOP_INFO } from './troops';
import type { BattleResult } from './battle-engine';

/** 玩家一方各兵种损失进入伤兵营的比例（百分数，向下取整，按兵种分别算） */
export const WOUNDED_PERCENT = 20;
/** 胜方从败方各兵种损失抓俘虏的比例（百分数，向下取整；只抓基础七兵种） */
export const CAPTURED_PERCENT = 10;
/** 治疗伤兵的花费 = 征兵资源 × 本比例（百分数；与遣散返还持平——治好再遣散不赚不亏） */
export const HEAL_COST_PERCENT = 50;
/** 招降俘虏的花费 = 征兵资源 × 本比例（比治疗贵一档；另扣人口） */
export const CAPTIVE_RECRUIT_COST_PERCENT = 60;
/** 劝回逃兵的花费 = 征兵资源 × 本比例（百分数） */
export const DESERTER_RECALL_COST_PERCENT = 50;
/** 伤兵 / 俘虏 / 逃兵的过期时长（小时基准，随全局时间缩放换算，入账时按缩放后的 wall-clock 写死） */
export const WOUNDED_TTL_HOURS = 72;
export const CAPTIVE_TTL_HOURS = 72;
export const DESERTER_TTL_HOURS = 24;
/** 快过期提示阈值（小时）：剩不足该时长时前端给红点 */
export const POOL_EXPIRE_WARN_HOURS = 6;

/** 可被俘虏的基础七兵种（旧游戏 1–7 号）；二期兵种与名城专属兵不抓 */
export const CAPTURABLE_KINDS: readonly TroopKind[] = [
  'porter',
  'militia',
  'scout',
  'pikeman',
  'swordsman',
  'archer',
  'cavalry',
];

function emptyCounts(): ArmyCounts {
  const out = {} as ArmyCounts;
  for (const kind of TROOP_KINDS) {
    out[kind] = 0;
  }
  return out;
}

/** floor(n × percent%)，负数按 0 */
function percentOf(n: number, percent: number): number {
  return n > 0 ? Math.floor((n * percent) / 100) : 0;
}

/** 一方损失的伤兵拆分（玩家一方才调用；按兵种分别向下取整） */
export function woundedOf(losses: Partial<Record<TroopKind, number>>): ArmyCounts {
  const out = emptyCounts();
  for (const kind of TROOP_KINDS) {
    out[kind] = percentOf(Math.floor(losses[kind] ?? 0), WOUNDED_PERCENT);
  }
  return out;
}

/** 败方损失中会被胜方抓走的部分（只抓基础七兵种，按兵种分别向下取整） */
export function capturedOf(losses: Partial<Record<TroopKind, number>>): ArmyCounts {
  const out = emptyCounts();
  for (const kind of CAPTURABLE_KINDS) {
    out[kind] = percentOf(Math.floor(losses[kind] ?? 0), CAPTURED_PERCENT);
  }
  return out;
}

/** 一方的拆分结果：wounded 进伤兵营、captured 被胜方抓走、dead 为最终阵亡 */
export interface SideCasualties {
  wounded: ArmyCounts;
  captured: ArmyCounts;
  dead: ArmyCounts;
}

/** 一场战斗的双方拆分与胜方战果 */
export interface BattleCasualtiesSplit {
  attacker: SideCasualties;
  defender: SideCasualties;
  /** 胜方抓到的俘虏（败方损失 × 10%，只含基础兵种）；平局或胜方是 NPC 时为全 0 */
  captives: ArmyCounts;
  /** 胜方（'attacker' | 'defender'）；回合耗尽 = 双方都没被全歼 = 平局，为 null */
  winner: 'attacker' | 'defender' | null;
}

function splitSide(losses: ArmyCounts, isPlayerSide: boolean, captured: ArmyCounts): SideCasualties {
  const wounded = isPlayerSide ? woundedOf(losses) : emptyCounts();
  const dead = emptyCounts();
  for (const kind of TROOP_KINDS) {
    dead[kind] = Math.max(0, Math.floor(losses[kind] ?? 0) - wounded[kind] - captured[kind]);
  }
  return { wounded, captured, dead };
}

/**
 * 把一场战斗的双方 losses 拆成伤兵 / 被俘 / 阵亡（AISLG-212 规则层统一入口）。
 * - attackerIsNpc / defenderIsNpc：NPC 一方无伤兵，也不产生「被玩家抓走」之外的拆分；
 * - 胜负判定：attackerWon（守方全灭）→ 攻方胜；attacker_wiped → 守方胜；round_limit →
 *   平局（双方都没被全歼、没有胜方）不抓俘虏；NPC 打赢玩家时不抓（captives 全 0）；
 * - 败方是玩家时，被俘部分从他的阵亡里扣（dead = losses − wounded − captured）；
 *   败方是 NPC 时同样给出 captured（战报展示「被对方抓走」），NPC 不需要入账。
 */
export function splitBattleCasualties(
  result: Pick<BattleResult, 'attackerWon' | 'endReason' | 'attacker' | 'defender'>,
  attackerIsNpc: boolean,
  defenderIsNpc: boolean,
): BattleCasualtiesSplit {
  const winner: 'attacker' | 'defender' | null = result.attackerWon
    ? 'attacker'
    : result.endReason === 'attacker_wiped'
      ? 'defender'
      : null;
  const winnerIsPlayer = winner === null ? false : (winner === 'attacker' ? !attackerIsNpc : !defenderIsNpc);
  const loserLosses = winner === 'attacker' ? result.defender.losses : result.attacker.losses;
  const captives = winnerIsPlayer ? capturedOf(loserLosses) : emptyCounts();
  return {
    attacker: splitSide(result.attacker.losses, !attackerIsNpc, winner === 'defender' && winnerIsPlayer ? captives : emptyCounts()),
    defender: splitSide(result.defender.losses, !defenderIsNpc, winner === 'attacker' && winnerIsPlayer ? captives : emptyCounts()),
    captives,
    winner,
  };
}

/**
 * 治疗 / 招降 / 劝回的花费 = floor(Σ 单兵成本 × 数量 × percent%)，五种资源分别累加后
 * 各取整一次（与遣散 AISLG-209 的 disbandRefund 同一口径：多兵种先累加再取整，不按兵种逐个取整）。
 */
export function restoreCost(troops: Partial<Record<TroopKind, number>>, percent: number): Resources {
  const totals: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(troops[kind] ?? 0);
    if (count <= 0) {
      continue;
    }
    for (const key of RESOURCE_KEYS) {
      totals[key] += TROOP_INFO[kind].cost[key] * count;
    }
  }
  for (const key of RESOURCE_KEYS) {
    totals[key] = Math.floor((totals[key] * percent) / 100);
  }
  return totals;
}

/** 招降俘虏要扣的人口 = Σ 单兵人口 × 数量（与征兵同口径；治疗 / 劝回不扣） */
export function restorePopulationCost(troops: Partial<Record<TroopKind, number>>): number {
  let total = 0;
  for (const kind of TROOP_KINDS) {
    const count = Math.floor(troops[kind] ?? 0);
    if (count > 0) {
      total += TROOP_INFO[kind].population * count;
    }
  }
  return total;
}
