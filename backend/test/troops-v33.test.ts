// 二期兵种（v33，AISLG-86~90）：属性 / 解锁 / 克制倍率 / 冲车破墙

import assert from 'node:assert/strict';
import test from 'node:test';
import { TROOP_INFO, armyCarryCapacity, startRecruit } from '../common/src/troops';
import { TROOP_STATS, simulateBattle } from '../common/src/battle-engine';
import {
  RAM_BREAK_MAX_PERCENT,
  counterMultiplier,
  ramAdjustedWall,
  ramWallReduction,
  troopCounterInfo,
} from '../common/src/troop-counter';
import { marchTravelSeconds } from '../common/src/world';

const RICH = { gold: 1e7, wood: 1e7, food: 1e7, stone: 1e7, iron: 1e7 };
const steady = () => 0.99;

test('四个新兵种的属性与成本与需求一致', () => {
  assert.deepEqual(TROOP_STATS.siege_ram, { hp: 1500, atk: 60, def: 200, speed: 10, range: 10, marchSpeed: 0.6 });
  assert.deepEqual(TROOP_STATS.supply_wagon, { hp: 600, atk: 0, def: 50, speed: 8, range: 10, marchSpeed: 0.7 });
  assert.deepEqual(TROOP_STATS.ballista, { hp: 300, atk: 260, def: 40, speed: 8, range: 95, marchSpeed: 0.6 });
  assert.deepEqual(TROOP_STATS.iron_cavalry, { hp: 2400, atk: 620, def: 420, speed: 70, range: 10, marchSpeed: 1.2 });
  assert.deepEqual(TROOP_INFO.siege_ram.cost, { gold: 400, wood: 400, food: 80, stone: 100, iron: 100 });
  assert.deepEqual(TROOP_INFO.supply_wagon.cost, { gold: 200, wood: 300, food: 60, stone: 0, iron: 40 });
  assert.deepEqual(TROOP_INFO.ballista.cost, { gold: 350, wood: 300, food: 80, stone: 0, iron: 120 });
  assert.deepEqual(TROOP_INFO.iron_cavalry.cost, { gold: 600, wood: 100, food: 200, stone: 0, iron: 300 });
  assert.deepEqual(
    [TROOP_INFO.siege_ram, TROOP_INFO.supply_wagon, TROOP_INFO.ballista, TROOP_INFO.iron_cavalry].map((t) => [t.population, t.foodUse, t.carry]),
    [[5, 10, 0], [6, 10, 5000], [3, 8, 0], [3, 30, 100]],
  );
  assert.ok(TROOP_INFO.iron_cavalry.cost.gold + TROOP_INFO.iron_cavalry.cost.wood + TROOP_INFO.iron_cavalry.cost.food + TROOP_INFO.iron_cavalry.cost.iron >= 1000);
});

test('军营解锁等级：辎重车 3 / 床弩 7 / 冲车 8 / 铁骑兵 11；不够返回 TROOP_NOT_AVAILABLE，按人口扣减', () => {
  const need: Array<[keyof typeof TROOP_INFO, number]> = [['supply_wagon', 3], ['ballista', 7], ['siege_ram', 8], ['iron_cavalry', 11]];
  for (const [troop, level] of need) {
    const low = startRecruit(troop, 1, RICH, 1000, level - 1, 0, 0);
    assert.ok(!low.ok && low.code === 'TROOP_NOT_AVAILABLE', `${troop} 需要军营 ${level} 级`);
    const ok = startRecruit(troop, 2, RICH, 1000, level, 0, 0);
    assert.ok(ok.ok, `${troop} ${level} 级可征`);
    if (ok.ok) {
      assert.equal(ok.population, TROOP_INFO[troop].population * 2, '人口 = 单兵人口 × 数量');
    }
  }
});

test('辎重车负重 5000 计入编队负重；行军速度按全编队最慢兵种', () => {
  assert.equal(armyCarryCapacity({ supply_wagon: 3, militia: 10 }), 3 * 5000 + 10 * 60);
  const normal = marchTravelSeconds(0, 0, 40, 0, { militia: 10 }, 0);
  const withRam = marchTravelSeconds(0, 0, 40, 0, { militia: 10, siege_ram: 1 }, 0);
  assert.ok(withRam > normal * 1.5, `带冲车（0.6）显著变慢：${normal} → ${withRam}`);
});

test('克制倍率表：长枪打骑兵 ×1.2（含铁骑）、刀盾受弓箭 / 床弩 ×0.8，其余为 1', () => {
  assert.equal(counterMultiplier('pikeman', 'cavalry'), 1.2);
  assert.equal(counterMultiplier('pikeman', 'iron_cavalry'), 1.2);
  assert.equal(counterMultiplier('archer', 'swordsman'), 0.8);
  assert.equal(counterMultiplier('ballista', 'swordsman'), 0.8);
  assert.equal(counterMultiplier('militia', 'swordsman'), 1);
  assert.equal(counterMultiplier('swordsman', 'archer'), 1, '克制不对称');
  assert.equal(counterMultiplier('pikeman', 'swordsman'), 1);
  const pike = troopCounterInfo('pikeman');
  assert.deepEqual(pike.counters, [{ targets: ['cavalry', 'iron_cavalry'], percent: 20 }]);
  const sword = troopCounterInfo('swordsman');
  assert.deepEqual(sword.resists, [{ from: ['archer', 'ballista'], percent: -20 }]);
});

test('克制按倍率结算：弓箭打刀盾单轮齐射伤害 = 同样攻击打义兵的 0.72 倍（×0.8 抗性 + 防御差）', () => {
  // 攻城站桩：弓箭兵第 4 回合首次进入射程齐射一次（rng 固定无暴击 / 格挡），守方站墙不动
  const volley = (target: 'swordsman' | 'militia') =>
    simulateBattle({ archer: 40 }, { [target]: 10 }, { siege: true, wallDefensePercent: 0, rng: steady, maxRounds: 4 }).attacker.damage;
  const ratio = volley('swordsman') / volley('militia');
  const expected = ((1 - 280 / 2280) * 0.8) / (1 - 50 / 2050);
  assert.ok(Math.abs(ratio - expected) < 0.02, `${ratio.toFixed(3)} ≈ ${expected.toFixed(3)}`);
});

test('冲车破墙：每占攻方存活总兵数 1% 使城墙减伤相对降 8%，最多降 80%', () => {
  assert.equal(ramWallReduction(0), 0);
  assert.equal(ramWallReduction(0.05), 0.4);
  assert.equal(ramWallReduction(0.5), RAM_BREAK_MAX_PERCENT / 100, '封顶 80%');
  assert.equal(ramAdjustedWall(70, 0.05), 42, '需求示例：70% 墙、冲车占 5% → 42%');
  assert.equal(ramAdjustedWall(50, 0), 50);
});

test('冲车只在攻城战生效；战报给出开战时的破墙数值', () => {
  const attacker = { militia: 95, siege_ram: 5 };
  const defender = { swordsman: 40 };
  const siege = simulateBattle(attacker, defender, { siege: true, wallDefensePercent: 70, rng: steady });
  assert.deepEqual(siege.wallBreak, { from: 70, to: 42 });
  const field = simulateBattle(attacker, defender, { siege: false, wallDefensePercent: 70, rng: steady });
  assert.equal(field.wallBreak, null, '野地战斗冲车只是肉厚攻低的单位');
  const noRam = simulateBattle({ militia: 100 }, defender, { siege: true, wallDefensePercent: 70, rng: steady });
  assert.equal(noRam.wallBreak, null);
  // 破墙让攻方损失更小 / 守方损失更大
  const lost = (r: typeof siege) => Object.values(r.defender.losses).reduce((a, b) => a + b, 0);
  const withoutRam = simulateBattle({ militia: 100 }, defender, { siege: true, wallDefensePercent: 70, rng: steady });
  assert.ok(lost(siege) >= lost(withoutRam), '带冲车守方损失不少于不带');
});
