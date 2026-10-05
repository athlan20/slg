// 侦察报告详细度（v27，AISLG-77 侦察科技）：同一份真实驻军，按侦察科技等级降级呈现。
//   Lv0–2 rough ：只给总兵力的约数范围（±20%），不给兵种构成（garrison 全 0）
//   Lv3–5 kinds ：给兵种明细，各兵种数量为近似值（按坐标与兵种固定 ±20% 浮动，同一地块重复
//                 侦察结果一致，不能靠多侦察几次平均出精确值），总量给约数范围
//   Lv6+  exact ：精确数量
// 降级只发生在侦察情报快照生成时（Worker），战斗结算始终使用真实守军。

import { TROOP_KINDS, type TroopKind } from './protocol';
import { scoutDetailOf, type ScoutDetail, type TechLevels } from './tech';

/** 约数浮动幅度（±20%，与 NPC 袭击预警的兵力范围同口径） */
export const SCOUT_FUZZ_PERCENT = 20;

export type ArmyMap = Record<TroopKind, number>;

function zeroArmy(): ArmyMap {
  const army = {} as ArmyMap;
  for (const kind of TROOP_KINDS) {
    army[kind] = 0;
  }
  return army;
}

/** 坐标 + 兵种 → [0,1) 的固定伪随机（整数哈希，纯函数，保证重复侦察一致） */
function stable01(x: number, y: number, kind: TroopKind): number {
  let h = 2166136261;
  for (const ch of `${x},${y},${kind}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

export interface DegradedGarrison {
  detail: ScoutDetail;
  /** 呈现给玩家的驻军：exact=真实；kinds=逐兵种近似；rough=全 0 */
  garrison: ArmyMap;
  /** 总兵力范围：exact 时 min=max=真实总数；其余为真实总数 ±20%（向外取整） */
  total: { min: number; max: number };
}

export function degradeGarrison(
  real: Partial<Record<TroopKind, number>>,
  x: number,
  y: number,
  techs?: Partial<TechLevels>,
): DegradedGarrison {
  const detail = scoutDetailOf(techs);
  const exact = zeroArmy();
  let total = 0;
  for (const kind of TROOP_KINDS) {
    const count = Math.max(0, Math.floor(real[kind] ?? 0));
    exact[kind] = count;
    total += count;
  }
  if (detail === 'exact') {
    return { detail, garrison: exact, total: { min: total, max: total } };
  }
  const range = {
    min: Math.floor((total * (100 - SCOUT_FUZZ_PERCENT)) / 100),
    max: Math.ceil((total * (100 + SCOUT_FUZZ_PERCENT)) / 100),
  };
  if (detail === 'rough') {
    return { detail, garrison: zeroArmy(), total: range };
  }
  const fuzzed = zeroArmy();
  for (const kind of TROOP_KINDS) {
    if (exact[kind] > 0) {
      const factor = 1 - SCOUT_FUZZ_PERCENT / 100 + (2 * SCOUT_FUZZ_PERCENT / 100) * stable01(x, y, kind);
      fuzzed[kind] = Math.max(1, Math.round(exact[kind] * factor));
    }
  }
  return { detail, garrison: fuzzed, total: range };
}
