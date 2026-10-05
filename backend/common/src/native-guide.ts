// 野地进攻口径表（v24，AISLG-48）：「打 Lv N 野地要带多少兵、胜率与期望净收益」。
// 由战斗引擎固定种子批量模拟生成（不手抄）——守军 / 成本 / 负重 / 掠夺池任一数值调整后
// 重新生成文档即自动同步。基准守军（未浮动）口径；每块野地实际守军在基准上 ±20%。
// 净收益以「金当量」计：金 = 1，四资源按集市兑换比（EXCHANGE_INPUT_PER_GOLD = 4:1）折算。

import { TROOP_KINDS, type TroopKind } from './protocol';
import { nativeGarrisonBase, resolveBattle } from './battle';
import { PLUNDERABLE_KEYS, loadByCarry } from './plunder';
import { EXCHANGE_INPUT_PER_GOLD } from './rules';
import { TROOP_INFO, armyCarryCapacity } from './troops';
import { wildernessPlunderPool } from './world';

type Counts = Partial<Record<TroopKind, number>>;

/** 每个场景的模拟局数（固定种子，结果可复现） */
export const GUIDE_RUNS = 300;
/** 指南覆盖的野地等级 */
export const GUIDE_LEVELS = [1, 2, 3, 4, 5] as const;

export interface NativeGuideRow {
  level: number;
  /** 基准守军编成 */
  garrison: Counts;
  /** 推荐兵力倍数（相对守军人数）：2 / 3 */
  multiple: number;
  /** 推荐编成 */
  army: Counts;
  winRate: number;
  /** 单次期望净收益（金当量，已含战损与负重封顶的战利品） */
  expectedNet: number;
}

/** 一个兵的金当量成本（金 + 其余四资源 ÷ 兑换比） */
function goldEquivalentCost(kind: TroopKind): number {
  const cost = TROOP_INFO[kind].cost;
  return cost.gold + (cost.wood + cost.food + cost.stone + cost.iron) / EXCHANGE_INPUT_PER_GOLD;
}

/** 推荐编成：Lv1–2 义兵；Lv3–4 义兵:长枪兵 = 2:1；Lv5 起长枪兵:弓箭兵 = 2:1 */
function recommendedArmy(level: number, total: number): Counts {
  if (level <= 2) {
    return { militia: total };
  }
  const third = Math.round(total / 3);
  return level <= 4 ? { militia: total - third, pikeman: third } : { pikeman: total - third, archer: third };
}

function headcount(troops: Counts): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + (troops[kind] ?? 0), 0);
}

/** mulberry32 确定性随机源（与 battle-calibration 同实现；按种子播种） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let cached: NativeGuideRow[] | null = null;

/** 进攻口径表（进程内缓存；纯推导，无外部依赖） */
export function nativeAttackGuide(): NativeGuideRow[] {
  if (cached) {
    return cached;
  }
  const rows: NativeGuideRow[] = [];
  for (const level of GUIDE_LEVELS) {
    const garrison = nativeGarrisonBase(level);
    // 掠夺池：地形资源 750×等级 + 金 250×等级（以平原为例；非金矿地形池量一致）
    const pool = wildernessPlunderPool('plain', level);
    for (const multiple of [2, 3]) {
      const army = recommendedArmy(level, headcount(garrison) * multiple);
      let wins = 0;
      let netSum = 0;
      for (let i = 0; i < GUIDE_RUNS; i++) {
        const result = resolveBattle(army, garrison, { rng: mulberry32(level * 100003 + multiple * 1009 + i) });
        let net = 0;
        for (const kind of TROOP_KINDS) {
          net -= (result.attacker.losses[kind] ?? 0) * goldEquivalentCost(kind);
        }
        if (result.attackerWon) {
          wins += 1;
          const loot = loadByCarry(armyCarryCapacity(result.attacker.survivors), pool);
          for (const key of PLUNDERABLE_KEYS) {
            net += key === 'gold' ? loot.gold : loot[key] / EXCHANGE_INPUT_PER_GOLD;
          }
        }
        netSum += net;
      }
      rows.push({
        level,
        garrison,
        multiple,
        army,
        winRate: wins / GUIDE_RUNS,
        expectedNet: Math.round(netSum / GUIDE_RUNS),
      });
    }
  }
  cached = rows;
  return rows;
}
