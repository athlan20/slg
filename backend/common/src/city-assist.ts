// 盟友协防规则（v74，AISLG-194）：派兵进盟友的城帮忙守，打完召回 / 遣返。
// 规则与数值（上限、伤亡分摊口径）由需求拍板；API（发起 / 召回 / 遣返）、Worker（到达入驻、
// 守城战合并与拆分、退盟 / 易主自动遣返）与视图共用本文件。
// - 每座城最多接收 5 支协防部队（洛阳之主的洛阳为 10 支，随洛阳争夺需求接入；当前统一 5）；
// - 同一账号对同一座城最多 1 支；协防占派出城的校场出征名额；
// - 守城战里协防部队与城主驻军合并成守方参战；战后同一兵种的伤亡按开战时各方该兵种数量占比分摊，
//   取整余数归城主（splitAssistLosses）。

import { TROOP_KINDS, type ArmyCounts, type TroopKind } from './protocol';

/** 每座城最多接收的协防部队数（洛阳 10 支留待洛阳争夺需求） */
export const ASSIST_MAX_PER_CITY = 5;

/** 该城可接收的协防上限（当前所有城统一；保留参数位给名城的例外） */
export function assistCap(_famousName?: string | null): number {
  return ASSIST_MAX_PER_CITY;
}

/** 一支协防部队（视图与合并用） */
export interface AssistParty {
  id: string;
  /** 派出账号 */
  accountId: string;
  /** 派出城 */
  fromCityId: string;
  troops: Partial<Record<TroopKind, number>>;
}

/** 完整兵种计数（缺省 0） */
export function fullArmy(counts: Partial<Record<TroopKind, number>>): ArmyCounts {
  const army = {} as ArmyCounts;
  for (const kind of TROOP_KINDS) {
    army[kind] = Math.max(0, Math.floor(counts[kind] ?? 0));
  }
  return army;
}

/** 合并城主驻军与各协防部队（守城战的守方编成） */
export function mergeDefense(host: Partial<Record<TroopKind, number>>, parties: AssistParty[]): ArmyCounts {
  const merged = fullArmy(host);
  for (const party of parties) {
    for (const kind of TROOP_KINDS) {
      merged[kind] += Math.max(0, Math.floor(party.troops[kind] ?? 0));
    }
  }
  return merged;
}

/** 一方总兵力（合并编成的分摊权重） */
export function armyUnits(counts: Partial<Record<TroopKind, number>>): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(counts[kind] ?? 0)), 0);
}

export interface AssistLossSplit {
  /** 城主承担的各兵种伤亡（含取整余数） */
  hostLosses: ArmyCounts;
  /** 各协防部队承担的各兵种伤亡 */
  partyLosses: Map<string, ArmyCounts>;
}

/**
 * 守城战伤亡拆分（纯函数，需求拍板口径）：同一兵种的伤亡按开战时各方该兵种数量占比分摊，
 * 取整（向下）后的余数归城主。分摊不会超过该方该兵种的开战数量。
 * losses 为引擎给出的守方（合并编成）各兵种损失。
 */
export function splitAssistLosses(
  hostTroops: Partial<Record<TroopKind, number>>,
  parties: AssistParty[],
  losses: Partial<Record<TroopKind, number>>,
): AssistLossSplit {
  const hostLosses = fullArmy({});
  const partyLosses = new Map<string, ArmyCounts>();
  for (const party of parties) {
    partyLosses.set(party.id, fullArmy({}));
  }
  for (const kind of TROOP_KINDS) {
    const totalLoss = Math.max(0, Math.floor(losses[kind] ?? 0));
    if (totalLoss <= 0) {
      continue;
    }
    const groups: Array<{ id: string | null; count: number }> = [
      { id: null, count: Math.max(0, Math.floor(hostTroops[kind] ?? 0)) },
      ...parties.map((party) => ({ id: party.id, count: Math.max(0, Math.floor(party.troops[kind] ?? 0)) })),
    ];
    const total = groups.reduce((sum, group) => sum + group.count, 0);
    if (total <= 0) {
      continue;
    }
    let allocated = 0;
    for (const group of groups) {
      if (group.id === null) {
        continue;
      }
      const share = Math.min(group.count, Math.floor((totalLoss * group.count) / total));
      const bucket = partyLosses.get(group.id);
      if (bucket) {
        bucket[kind] = share;
      }
      allocated += share;
    }
    // 取整余数归城主
    hostLosses[kind] = Math.min(groups[0].count, totalLoss - allocated);
  }
  return { hostLosses, partyLosses };
}

/** 剩余兵力（开战 − 伤亡；不小于 0） */
export function survivorsAfter(troops: Partial<Record<TroopKind, number>>, losses: Partial<Record<TroopKind, number>>): ArmyCounts {
  const left = fullArmy(troops);
  for (const kind of TROOP_KINDS) {
    left[kind] = Math.max(0, left[kind] - Math.max(0, Math.floor(losses[kind] ?? 0)));
  }
  return left;
}

/** 是否还有兵 */
export function hasTroops(counts: Partial<Record<TroopKind, number>>): boolean {
  return TROOP_KINDS.some((kind) => Math.max(0, Math.floor(counts[kind] ?? 0)) > 0);
}
