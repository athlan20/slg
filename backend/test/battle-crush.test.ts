// 兵力占比折算战损（AISLG-244）：r = 我方参考战力 / 守军参考战力，r > 3 时攻方各兵种
// 损失 × 3 / r；r ≤ 3、守军战力为 0 时一字不动。只改攻方一侧，胜负 / 守方 / 回合数不变。
// 批量断言用固定种子（mulberry32，与 battle.test.ts / 校准脚本同实现）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { TROOP_KINDS, type TroopKind } from '../common/src/protocol';
import { armyPower, nativeGarrisonBase, resolveBattle } from '../common/src/battle';
import { CRUSH_THRESHOLD, scaleCrushLosses } from '../common/src/battle-crush';
import type { BattleResult } from '../common/src/battle-engine';

/** mulberry32：确定性 PRNG（与 battle.test.ts 同实现） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function totalLosses(losses: Partial<Record<TroopKind, number>>): number {
  return TROOP_KINDS.reduce((sum, kind) => sum + (losses[kind] ?? 0), 0);
}

/** 固定种子批量模拟：返回平均攻方总战损 */
function averageLosses(
  attacker: Partial<Record<TroopKind, number>>,
  defender: Partial<Record<TroopKind, number>>,
  runs = 40,
): number {
  let sum = 0;
  for (let i = 0; i < runs; i += 1) {
    const raw = resolveBattle(attacker, defender, { rng: mulberry32(2440 + i) });
    sum += totalLosses(scaleCrushLosses(raw, defender).attacker.losses);
  }
  return sum / runs;
}

test('r ≤ 3：结果与折算前逐字段一致（不折算）', () => {
  const defender = nativeGarrisonBase(3);
  const attacker = { militia: 20, pikeman: 10 };
  assert.ok(armyPower(attacker) / armyPower(defender) <= CRUSH_THRESHOLD, '前提：本组 r ≤ 3');
  for (let i = 0; i < 5; i += 1) {
    const raw = resolveBattle(attacker, defender, { rng: mulberry32(700 + i) });
    const scaled = scaleCrushLosses(raw, defender);
    assert.deepEqual(scaled, raw, `第 ${i} 局：r ≤ 3 时不得改动任何字段`);
  }
});

test('守军参考战力为 0：不折算（原样返回）', () => {
  const attacker = { militia: 500 };
  const raw = resolveBattle(attacker, {});
  assert.equal(armyPower({}), 0, '前提：守军战力为 0');
  const scaled = scaleCrushLosses(raw, {});
  assert.deepEqual(scaled, raw);
  assert.ok(totalLosses(scaled.attacker.losses) >= 0);
});

test('Lv8 野地：1 / 2 / 10 倍兵平均战损单调下降，且 10 倍兵明显少于 2 倍兵', () => {
  const garrison = nativeGarrisonBase(8);
  const headcount = TROOP_KINDS.reduce((sum, kind) => sum + (garrison[kind] ?? 0), 0);
  const avg = [1, 2, 10].map((multiple) => averageLosses({ militia: headcount * multiple }, garrison));
  // 1 / 2 倍兵都在 r ≤ 3 区间（不折算），10 倍兵 r > 3 触发折算
  assert.ok(armyPower({ militia: headcount * 2 }) / armyPower(garrison) <= CRUSH_THRESHOLD, '前提：2 倍兵 r ≤ 3');
  assert.ok(avg[1] < avg[0], `2 倍兵战损 ${avg[1]} 应少于 1 倍兵 ${avg[0]}`);
  assert.ok(avg[2] < avg[1], `10 倍兵战损 ${avg[2]} 应少于 2 倍兵 ${avg[1]}`);
  const r10 = armyPower({ militia: headcount * 10 }) / armyPower(garrison);
  assert.ok(r10 > CRUSH_THRESHOLD, '前提：10 倍兵 r > 3（触发折算）');
  assert.ok(avg[1] - avg[2] >= 1, `2 倍与 10 倍兵的平均战损应拉开差距（${avg[1]} vs ${avg[2]}）`);
});

test('折算后 losses + survivors = troops；attackerWon、守方一侧、回合数、roundLog 不变', () => {
  const garrison = nativeGarrisonBase(8);
  const headcount = TROOP_KINDS.reduce((sum, kind) => sum + (garrison[kind] ?? 0), 0);
  const attacker = { militia: headcount * 10, archer: 40 };
  let scaledCount = 0;
  for (let i = 0; i < 10; i += 1) {
    const raw: BattleResult = resolveBattle(attacker, garrison, { rng: mulberry32(9900 + i) });
    const scaled = scaleCrushLosses(raw, garrison);
    assert.equal(scaled.attackerWon, raw.attackerWon);
    assert.equal(scaled.endReason, raw.endReason);
    assert.equal(scaled.rounds, raw.rounds);
    assert.equal(scaled.roundLog, raw.roundLog);
    assert.deepEqual(scaled.defender, raw.defender, '守方一侧原样不动');
    for (const kind of TROOP_KINDS) {
      const troops = scaled.attacker.troops[kind];
      assert.equal(scaled.attacker.losses[kind] + scaled.attacker.survivors[kind], troops, `${kind} 损失 + 幸存 = 出战`);
      assert.ok(scaled.attacker.losses[kind] <= raw.attacker.losses[kind], `${kind} 折算不多于原损失`);
      assert.ok(scaled.attacker.survivors[kind] >= raw.attacker.survivors[kind], `${kind} 幸存不少于原值`);
    }
    if (totalLosses(scaled.attacker.losses) < totalLosses(raw.attacker.losses)) {
      scaledCount += 1;
    }
  }
  assert.ok(scaledCount > 0, '本组至少若干局应触发折算');
  // 入参未被原地修改（raw 仍是引擎原值：与重新结算一局比对）
  const again = resolveBattle(attacker, garrison, { rng: mulberry32(9900) });
  const first = resolveBattle(attacker, garrison, { rng: mulberry32(9900) });
  scaleCrushLosses(first, garrison);
  assert.deepEqual(first.attacker.losses, again.attacker.losses, '折算函数不得原地修改入参');
});
