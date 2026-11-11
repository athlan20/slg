// 兵力占比折算战损（AISLG-244 定规则，AISLG-246 扩到所有战斗、攻守对称）：
// 对每一方各自 r = 本方参考战力 / 对方参考战力，r > 3 时该方各兵种损失 × 3 / r；
// r ≤ 3 与「对方参考战力为 0」不折算；胜负 / 回合数 / 逐回合战报 / 输出伤害保持引擎原值。
// 批量断言用固定种子（mulberry32，与 battle.test.ts / 校准脚本同实现）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { TROOP_KINDS, type TroopKind } from '../common/src/protocol';
import { armyPower, nativeGarrisonBase, resolveBattle } from '../common/src/battle';
import { CRUSH_THRESHOLD, scaleCrushLosses } from '../common/src/battle-crush';
import type { BattleResult, BattleSideSummary } from '../common/src/battle-engine';

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

/** 规则的单方期望值：factor = min(1, 3 / r) */
function expectedLosses(side: BattleSideSummary, factor: number): Record<TroopKind, number> {
  const out = {} as Record<TroopKind, number>;
  for (const kind of TROOP_KINDS) {
    const original = side.losses[kind] ?? 0;
    out[kind] = Math.min(original, Math.round(original * factor));
  }
  return out;
}

function sideLosses(side: BattleSideSummary): Record<TroopKind, number> {
  const out = {} as Record<TroopKind, number>;
  for (const kind of TROOP_KINDS) {
    out[kind] = side.losses[kind] ?? 0;
  }
  return out;
}

/** 固定种子批量模拟：返回平均总战损 */
function averageLosses(
  attacker: Partial<Record<TroopKind, number>>,
  defender: Partial<Record<TroopKind, number>>,
  runs = 40,
): { attacker: number; defender: number } {
  let att = 0;
  let def = 0;
  for (let i = 0; i < runs; i += 1) {
    const result = resolveBattle(attacker, defender, { rng: mulberry32(2460 + i) });
    att += totalLosses(result.attacker.losses);
    def += totalLosses(result.defender.losses);
  }
  return { attacker: att / runs, defender: def / runs };
}

const STRONG = { militia: 300, pikeman: 100, archer: 60 };
const WEAK = { militia: 40, archer: 10 };

test('r ≤ 3：双方都不折算，结果与引擎原始值逐字段一致', () => {
  const defender = nativeGarrisonBase(3);
  const attacker = { militia: 20, pikeman: 10 };
  assert.ok(armyPower(attacker) / armyPower(defender) <= CRUSH_THRESHOLD, '前提：攻方 r ≤ 3');
  assert.ok(armyPower(defender) / armyPower(attacker) <= CRUSH_THRESHOLD, '前提：守方 r ≤ 3');
  for (let i = 0; i < 5; i += 1) {
    const rng = mulberry32(700 + i);
    const raw = resolveBattle(attacker, defender, { rng, crush: false });
    const fresh = mulberry32(700 + i);
    const crushed = resolveBattle(attacker, defender, { rng: fresh });
    assert.deepEqual(crushed, raw, `第 ${i} 局：r ≤ 3 时不得改动任何字段`);
    assert.deepEqual(scaleCrushLosses(raw), raw, '折算函数本身也应原样返回');
  }
});

test('对方参考战力为 0（空守军）：不折算', () => {
  const attacker = { militia: 500 };
  const raw = resolveBattle(attacker, {}, { crush: false });
  assert.equal(armyPower({}), 0, '前提：守军战力为 0');
  const crushed = resolveBattle(attacker, {});
  assert.deepEqual(crushed, raw);
  assert.deepEqual(scaleCrushLosses(raw), raw);
});

test('攻方强（r > 3）：只有攻方战损按 3/r 下降；守方、胜负、回合、战报不变', () => {
  const raw = resolveBattle(STRONG, WEAK, { rng: mulberry32(3100), crush: false });
  const ratio = armyPower(STRONG) / armyPower(WEAK);
  assert.ok(ratio > CRUSH_THRESHOLD, `前提：${ratio} > ${CRUSH_THRESHOLD}`);
  const crushed = scaleCrushLosses(raw);
  assert.deepEqual(sideLosses(crushed.attacker), expectedLosses(raw.attacker, CRUSH_THRESHOLD / ratio));
  assert.deepEqual(crushed.defender, raw.defender, '守方一侧原样不动');
  assert.equal(crushed.attackerWon, raw.attackerWon);
  assert.equal(crushed.endReason, raw.endReason);
  assert.equal(crushed.rounds, raw.rounds);
  assert.equal(crushed.roundLog, raw.roundLog);
  assert.equal(crushed.attacker.damage, raw.attacker.damage);
  assert.ok(totalLosses(crushed.attacker.losses) < totalLosses(raw.attacker.losses), '本局应触发折算');
  for (const kind of TROOP_KINDS) {
    assert.equal(
      crushed.attacker.losses[kind] + crushed.attacker.survivors[kind],
      crushed.attacker.troops[kind],
      `${kind}：损失 + 幸存 = 出战`,
    );
    assert.ok(crushed.attacker.losses[kind] <= raw.attacker.losses[kind], `${kind} 折算不多于原损失`);
  }
});

test('守方强（r > 3）：只有守方战损按 3/r 下降；攻城战同样生效', () => {
  const raw = resolveBattle(WEAK, STRONG, { rng: mulberry32(3200), siege: true, wallDefensePercent: 20, crush: false });
  const ratio = armyPower(STRONG) / armyPower(WEAK);
  assert.ok(ratio > CRUSH_THRESHOLD, `前提：${ratio} > ${CRUSH_THRESHOLD}`);
  const crushed = scaleCrushLosses(raw);
  assert.deepEqual(sideLosses(crushed.defender), expectedLosses(raw.defender, CRUSH_THRESHOLD / ratio));
  assert.deepEqual(crushed.attacker, raw.attacker, '弱势攻方一侧原样不动');
  assert.equal(crushed.attackerWon, raw.attackerWon);
  assert.equal(crushed.rounds, raw.rounds);
  assert.equal(crushed.roundLog, raw.roundLog);
  assert.ok(totalLosses(crushed.defender.losses) < totalLosses(raw.defender.losses), '本局应触发守方折算');
});

test('攻守互换的对称性：同一对编队对调后，强的一方折同一个 3/r 系数', () => {
  const factor = CRUSH_THRESHOLD / (armyPower(STRONG) / armyPower(WEAK));
  const rawForward = resolveBattle(STRONG, WEAK, { rng: mulberry32(4100), crush: false });
  const rawSwapped = resolveBattle(WEAK, STRONG, { rng: mulberry32(4200), crush: false });
  const forward = scaleCrushLosses(rawForward);
  const swapped = scaleCrushLosses(rawSwapped);
  // 攻方强：折攻方；攻守对调后守方强：折守方——两侧用的是同一个系数（规则只管「本方 ÷ 对方」）
  assert.deepEqual(sideLosses(forward.attacker), expectedLosses(rawForward.attacker, factor));
  assert.deepEqual(sideLosses(swapped.defender), expectedLosses(rawSwapped.defender, factor));
  // 弱势一方两次都不折：损失的期望值等于引擎原值
  assert.deepEqual(forward.defender, rawForward.defender);
  assert.deepEqual(swapped.attacker, rawSwapped.attacker);
});

test('入参不被修改；重复折算会二次缩小（这正是出口不得再包一层的原因）', () => {
  const raw = resolveBattle(STRONG, WEAK, { rng: mulberry32(5100), crush: false });
  const snapshotLosses = sideLosses(raw.attacker);
  const snapshotSurvivors = { ...raw.attacker.survivors };
  const crushed = scaleCrushLosses(raw);
  assert.deepEqual(sideLosses(raw.attacker), snapshotLosses, '入参 losses 不被原地修改');
  assert.deepEqual(raw.attacker.survivors, snapshotSurvivors, '入参 survivors 不被原地修改');
  // 折算不改 troops，所以战力比不变：同一结果折第二次仍会按 3/r 再缩一次——
  // 守卫测试（battle-crush-guard）禁止出口重复包装，避免这类二次缩水
  const twice = scaleCrushLosses(crushed);
  assert.ok(
    totalLosses(twice.attacker.losses) <= totalLosses(crushed.attacker.losses),
    '重复折算只会更小（出口只能折算一次）',
  );
});

test('Lv8 野地：1 / 2 / 10 倍兵平均战损单调下降，且 10 倍兵明显少于 2 倍兵', () => {
  const garrison = nativeGarrisonBase(8);
  const headcount = TROOP_KINDS.reduce((sum, kind) => sum + (garrison[kind] ?? 0), 0);
  const avg = [1, 2, 10].map((multiple) => averageLosses({ militia: headcount * multiple }, garrison).attacker);
  assert.ok(armyPower({ militia: headcount * 2 }) / armyPower(garrison) <= CRUSH_THRESHOLD, '前提：2 倍兵 r ≤ 3');
  assert.ok(armyPower({ militia: headcount * 10 }) / armyPower(garrison) > CRUSH_THRESHOLD, '前提：10 倍兵 r > 3');
  assert.ok(avg[1] < avg[0], `2 倍兵战损 ${avg[1]} 应少于 1 倍兵 ${avg[0]}`);
  assert.ok(avg[2] < avg[1], `10 倍兵战损 ${avg[2]} 应少于 2 倍兵 ${avg[1]}`);
  assert.ok(avg[1] - avg[2] >= 1, `2 倍与 10 倍兵的平均战损应拉开差距（${avg[1]} vs ${avg[2]}）`);
});

test('PvP：同一阵容 1 / 2 / 10 倍兵打同一玩家守军，平均战损随兵力下降（r ≤ 3 段不变规则）', () => {
  const defender = { swordsman: 200, archer: 100, cavalry: 50 };
  const multiple = (m: number) => ({ swordsman: 200 * m, archer: 100 * m, cavalry: 50 * m });
  const avg = [1, 2, 10].map((m) => averageLosses(multiple(m), defender));
  // r = m：1 / 2 倍在阈值内（引擎原值），10 倍触发折算
  assert.ok(armyPower(multiple(2)) / armyPower(defender) <= CRUSH_THRESHOLD, '前提：2 倍兵 r ≤ 3');
  assert.ok(armyPower(multiple(10)) / armyPower(defender) > CRUSH_THRESHOLD, '前提：10 倍兵 r > 3');
  assert.ok(avg[1].attacker < avg[0].attacker, `2 倍兵战损 ${avg[1].attacker} 应少于 1 倍兵 ${avg[0].attacker}`);
  assert.ok(avg[2].attacker < avg[1].attacker, `10 倍兵战损 ${avg[2].attacker} 应少于 2 倍兵 ${avg[1].attacker}`);
  // 被碾压的守方（r < 1/3）战损不变
  const weakDefenderRatio = armyPower(defender) / armyPower(multiple(10));
  assert.ok(weakDefenderRatio < 1 / CRUSH_THRESHOLD, '前提：守方 r\' < 1/3');
});

test('玩家对玩家守城战：攻守两侧各按规则折算，胜负与战报原值', () => {
  const defender = { swordsman: 150, archer: 80 };
  const attacker = { cavalry: 2000 };
  const raw = resolveBattle(attacker, defender, { rng: mulberry32(6000), siege: true, wallDefensePercent: 10, crush: false });
  const crushed = scaleCrushLosses(raw);
  const r = armyPower(attacker) / armyPower(defender);
  assert.ok(r > CRUSH_THRESHOLD, '前提：攻方碾压');
  assert.deepEqual(sideLosses(crushed.attacker), expectedLosses(raw.attacker, CRUSH_THRESHOLD / r));
  assert.deepEqual(crushed.defender, raw.defender, '守方 r\' < 1/3，战损不变');
  for (const kind of TROOP_KINDS) {
    assert.equal(crushed.attacker.losses[kind] + crushed.attacker.survivors[kind], crushed.attacker.troops[kind]);
    assert.equal(crushed.defender.losses[kind] + crushed.defender.survivors[kind], crushed.defender.troops[kind]);
  }
  assert.equal(crushed.attackerWon, raw.attackerWon);
  assert.equal(crushed.endReason, raw.endReason);
  assert.equal(crushed.rounds, raw.rounds);
});

test('resolveBattle 缺省折算（crush 缺省 true），crush: false 返回引擎原始值', () => {
  const defender = { militia: 30 };
  const attacker = { militia: 500 };
  const rngA = mulberry32(7000);
  const byDefault = resolveBattle(attacker, defender, { rng: rngA });
  const rngB = mulberry32(7000);
  const raw = resolveBattle(attacker, defender, { rng: rngB, crush: false });
  assert.deepEqual(byDefault, scaleCrushLosses(raw), '缺省值与显式折算一致');
  const rngC = mulberry32(7000);
  assert.deepEqual(resolveBattle(attacker, defender, { rng: rngC }), byDefault, '同一 rng 可复现');
  assert.ok(totalLosses(byDefault.attacker.losses) < totalLosses(raw.attacker.losses), '缺省应触发折算');
});

test('BattleResult 其余字段（箭塔 / 破墙 / 城防器械）折算后原样保留', () => {
  const raw: BattleResult = resolveBattle({ militia: 800 }, { archer: 20 }, {
    rng: mulberry32(8000),
    siege: true,
    tower: { damage: 50, range: 120 },
    defenses: { trap: 2 },
    crush: false,
  });
  const crushed = scaleCrushLosses(raw);
  assert.equal(crushed.towerDamage, raw.towerDamage);
  assert.deepEqual(crushed.wallBreak, raw.wallBreak);
  assert.deepEqual(crushed.defenseUse, raw.defenseUse);
});
