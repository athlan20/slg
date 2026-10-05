// 二期新建筑效果（v30，AISLG-80~83）：校场 / 烽火台 / 驿站 / 箭塔

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOWER_DAMAGE_PER_LEVEL,
  beaconIntelOf,
  beaconLeadMultiplier,
  canDeployMore,
  deployLimit,
  stationPercent,
  towerStats,
  warningIntel,
} from '../common/src/building-effects';
import { simulateBattle } from '../common/src/battle-engine';
import { marchTravelSeconds } from '../common/src/world';

/** 固定序列 rng：全部落在普通命中区间，战斗确定 */
const steady = () => 0.99;

test('校场：上限 = 校场等级，未建按 1；达到上限不能再派', () => {
  assert.equal(deployLimit(0), 1);
  assert.equal(deployLimit(1), 1);
  assert.equal(deployLimit(5), 5);
  assert.equal(canDeployMore(0, 0), true);
  assert.equal(canDeployMore(1, 0), false, '没建校场只能同时 1 支');
  assert.equal(canDeployMore(4, 5), true);
  assert.equal(canDeployMore(5, 5), false);
  assert.equal(canDeployMore(9, 5), false, '上线前已超限的存量不受影响，但新的一律被拒');
});

test('烽火台：每级预警提前量 +10%（10 级翻倍），敌情 0–2 范围 / 3–5 兵种 / 6+ 精确', () => {
  assert.equal(beaconLeadMultiplier(0), 1);
  assert.equal(beaconLeadMultiplier(3), 1.3);
  assert.equal(beaconLeadMultiplier(10), 2);
  assert.deepEqual([0, 2, 3, 5, 6, 10].map(beaconIntelOf), ['range', 'range', 'kinds', 'kinds', 'exact', 'exact']);
  const army = { militia: 50, archer: 10 };
  const range = warningIntel(army, 1);
  assert.deepEqual([range.armyMin, range.armyMax], [48, 72]);
  assert.equal(range.armyKinds, undefined);
  assert.equal(range.army, undefined);
  const kinds = warningIntel(army, 4);
  assert.deepEqual(kinds.armyKinds?.militia, { min: 40, max: 60 });
  assert.deepEqual(kinds.armyKinds?.archer, { min: 8, max: 12 });
  assert.equal(kinds.army, undefined);
  const exact = warningIntel(army, 7);
  assert.deepEqual(exact.army, army);
  assert.equal(exact.armyKinds, undefined);
  assert.deepEqual([exact.armyMin, exact.armyMax], [48, 72], '总范围恒有');
});

test('驿站：每级 +10% 行军速度，只缩短行军时长', () => {
  assert.equal(stationPercent(0), 0);
  assert.equal(stationPercent(10), 100);
  const base = marchTravelSeconds(0, 0, 100, 100, { porter: 1 }, 0);
  const fast = marchTravelSeconds(0, 0, 100, 100, { porter: 1 }, stationPercent(10));
  assert.ok(fast <= Math.ceil(base / 2) && fast >= Math.floor(base / 2) - 1, `10 级翻倍（${base} → ${fast}）`);
});

test('箭塔数值：伤害 150 × 等级，射程随等级；未建为 null', () => {
  assert.equal(towerStats(0), null);
  assert.deepEqual(towerStats(1), { damage: TOWER_DAMAGE_PER_LEVEL, range: 50 });
  assert.deepEqual(towerStats(10), { damage: 1500, range: 95 });
});

test('箭塔只在守城战生效：野地战斗（非 siege）无视箭塔', () => {
  const attacker = { militia: 30 };
  const defender = { swordsman: 20 };
  const plain = simulateBattle(attacker, defender, { siege: false, rng: steady, tower: towerStats(10) });
  assert.equal(plain.towerDamage, 0);
  assert.ok(plain.roundLog.every((entry) => entry.towerDamage === 0));
});

test('箭塔守城：每回合对射程内最近敌兵堆固定伤害，战报逐回合与总计都有，减少守方损失', () => {
  const attacker = { militia: 60 };
  const defender = { swordsman: 30 };
  const without = simulateBattle(attacker, defender, { siege: true, wallDefensePercent: 10, rng: steady });
  const withTower = simulateBattle(attacker, defender, { siege: true, wallDefensePercent: 10, rng: steady, tower: towerStats(10) });
  assert.equal(without.towerDamage, 0);
  assert.ok(withTower.towerDamage > 0, '箭塔造成了伤害');
  assert.equal(withTower.towerDamage, withTower.roundLog.reduce((sum, e) => sum + e.towerDamage, 0));
  assert.ok(withTower.roundLog.every((e) => e.towerDamage === 0 || e.towerDamage === 1500), '每回合伤害固定');
  assert.ok(withTower.roundLog.every((e) => e.defenderDamage >= e.towerDamage), '塔伤害计入守方输出');
  const lost = (r: typeof without) => Object.values(r.defender.losses).reduce((a, b) => a + b, 0);
  assert.ok(lost(withTower) <= lost(without), '有箭塔守方损失不增');
  assert.ok(withTower.attacker.survivors.militia <= without.attacker.survivors.militia, '攻方幸存更少');
});

test('箭塔不会被消灭，但守军全灭仍判守城失败；空守军不触发战斗', () => {
  const noGarrison = simulateBattle({ militia: 5 }, {}, { siege: true, tower: towerStats(10) });
  assert.equal(noGarrison.attackerWon, true);
  assert.equal(noGarrison.towerDamage, 0, '没有守军时塔不出手');
});
