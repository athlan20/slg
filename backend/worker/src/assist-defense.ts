// 协防的守城战合并 / 拆分（v74，AISLG-194）：把城主驻军与各协防部队合并成守方参战，
// 战后再按同兵种开战数量比例拆回（取整余数归城主）。规则见 common/src/city-assist.ts。
// 调用方：city-raid（NPC 袭击）、pvp-raid（玩家掠夺）、pvp-conquer（玩家占领分城）。
//
// 科技口径：各方科技只作用于各自部队——引擎只有一个守方乘数，这里按兵力加权平均传入；
// 城守武将只加成城主部队——引擎的 defenderHeroScale 按城主兵力占比折算。

import type pg from 'pg';
import { EventType, TROOP_KINDS, type ArmyCounts, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import {
  armyUnits,
  fullArmy,
  hasTroops,
  mergeDefense,
  splitAssistLosses,
  type AssistParty,
} from '../../common/src/city-assist';
import { loadAssistParties, saveDefenseSurvivors } from '../../common/src/city-assist-db';
import { combatTechBonus, type TechLevels } from '../../common/src/tech';
import type { BattleResult, CombatTechBonus } from '../../common/src/battle';
import type { TileNotify } from './tick-shared';

export interface DefenseSetup {
  hostArmy: ArmyCounts;
  parties: AssistParty[];
  /** 合并后的守方编成（交给引擎） */
  merged: ArmyCounts;
  /** 按各方兵力加权的守方科技乘数；全 0 为 null */
  defenderTech: CombatTechBonus | null;
  /** 城守武将的覆盖比例 = 城主兵力 / 守方总兵力（无协防时为 1） */
  heroScale: number;
  hostUnits: number;
  totalUnits: number;
}

/** 读取城主驻军 + 各协防部队并合并（调用方已锁城池行；协防表只读） */
export async function loadDefenseSetup(
  client: pg.PoolClient,
  cityId: string,
  hostAccountId: string,
  loadTechs: (accountId: string) => Promise<TechLevels>,
): Promise<DefenseSetup> {
  const armyRes = await client.query(`SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`, [cityId]);
  const hostArmy = fullArmy({});
  for (const row of armyRes.rows as Array<{ troop: TroopKind; count: number }>) {
    hostArmy[row.troop] = row.count;
  }
  const parties = await loadAssistParties(client, cityId);
  const merged = mergeDefense(hostArmy, parties);
  const hostUnits = armyUnits(hostArmy);
  const totalUnits = armyUnits(merged);

  const hostBonus = combatTechBonus(await loadTechs(hostAccountId));
  const entries: Array<{ units: number; bonus: CombatTechBonus | null }> = [{ units: hostUnits, bonus: hostBonus }];
  for (const party of parties) {
    entries.push({ units: armyUnits(party.troops), bonus: combatTechBonus(await loadTechs(party.accountId)) });
  }
  const weighted = (key: keyof CombatTechBonus): number => {
    if (totalUnits <= 0) {
      return 0;
    }
    return entries.reduce((sum, entry) => sum + (entry.bonus?.[key] ?? 0) * entry.units, 0) / totalUnits;
  };
  const atkPercent = weighted('atkPercent');
  const defPercent = weighted('defPercent');
  const cavalrySpeedPercent = weighted('cavalrySpeedPercent');
  const rangedRangePercent = weighted('rangedRangePercent');
  const defenderTech =
    atkPercent > 0 || defPercent > 0 || cavalrySpeedPercent > 0 || rangedRangePercent > 0
      ? { atkPercent, defPercent, cavalrySpeedPercent, rangedRangePercent }
      : null;
  return {
    hostArmy,
    parties,
    merged,
    defenderTech,
    heroScale: totalUnits > 0 ? hostUnits / totalUnits : 1,
    hostUnits,
    totalUnits,
  };
}

export interface AssistBattleLosses {
  assistId: string;
  accountId: string;
  losses: ArmyCounts;
  survivors: ArmyCounts;
}

/**
 * 战后拆分伤亡并回写：城主驻军剩多少、每支协防部队剩多少；打光的协防行删除并写事件。
 * 返回各协防方的伤亡（调用方据此给协防方生成战报）。
 */
export async function applyDefenseBattle(
  client: pg.PoolClient,
  cityId: string,
  setup: DefenseSetup,
  result: BattleResult,
  _notifies: TileNotify[],
): Promise<AssistBattleLosses[]> {
  const split = splitAssistLosses(setup.hostArmy, setup.parties, result.defender.losses);
  const hostSurvivors = survivorsOf(setup.hostArmy, split.hostLosses);
  const partySurvivors = new Map<string, ArmyCounts>();
  const out: AssistBattleLosses[] = [];
  for (const party of setup.parties) {
    const losses = split.partyLosses.get(party.id) ?? fullArmy({});
    const survivors = survivorsOf(party.troops, losses);
    partySurvivors.set(party.id, survivors);
    out.push({ assistId: party.id, accountId: party.accountId, losses, survivors });
  }
  await saveDefenseSurvivors(client, cityId, hostSurvivors, partySurvivors);
  // 打光的协防部队：写事件告知派出方（没有返程行军）
  for (const entry of out) {
    if (hasTroops(entry.survivors)) {
      continue;
    }
    await insertEvent(client, {
      accountId: entry.accountId,
      buildId: entry.assistId,
      type: EventType.ASSIST_RETURNED,
      initiator: null,
      detail: { assistId: entry.assistId, hostCityId: cityId, cause: 'wiped', troops: {}, returning: null },
    });
  }
  return out;
}

function survivorsOf(troops: Partial<Record<TroopKind, number>>, losses: Partial<Record<TroopKind, number>>): ArmyCounts {
  const left = fullArmy(troops);
  for (const kind of TROOP_KINDS) {
    left[kind] = Math.max(0, left[kind] - Math.max(0, Math.floor(losses[kind] ?? 0)));
  }
  return left;
}
