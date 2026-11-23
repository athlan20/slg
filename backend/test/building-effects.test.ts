// 二期新建筑效果（v30，AISLG-80~83）：校场 / 烽火台 / 驿站 / 箭塔

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TOWER_DAMAGE_PER_LEVEL,
  beaconIntelOf,
  beaconLeadMultiplier,
  canDeployMore,
  deployLimit,
  isGovernmentCapped,
  paradeAboveGovernment,
  paradeEffectiveTarget,
  paradeLevelCap,
  stationPercent,
  towerStats,
  warningIntel,
} from '../common/src/building-effects';
import { judgeParadeAboveGovernment } from '../common/src/rules';
import { queuedParadeTargets } from '../api/src/handlers-city';
import { simulateBattle } from '../common/src/battle-engine';
import { marchTravelSeconds } from '../common/src/world';

/** 固定序列 rng：全部落在普通命中区间，战斗确定 */
const steady = () => 0.99;

test('校场：上限 = 校场等级，未建按 1；达到上限不能再派', () => {
  // v117（AISLG-269）：上限 = max(1, min(校场等级, 官府等级))，这里先按「官府不低于校场」的旧口径校回归
  assert.equal(deployLimit(0, 20), 1);
  assert.equal(deployLimit(1, 20), 1);
  assert.equal(deployLimit(5, 20), 5);
  assert.equal(canDeployMore(0, 0, 20), true);
  assert.equal(canDeployMore(1, 0, 20), false, '没建校场只能同时 1 支');
  assert.equal(canDeployMore(4, 5, 20), true);
  assert.equal(canDeployMore(5, 5, 20), false);
  assert.equal(canDeployMore(9, 5, 20), false, '上线前已超限的存量不受影响，但新的一律被拒');
});

test('校场等级不能超过官府等级（v117，AISLG-269）：上限取两者较小值，未建都按保底 1', () => {
  // 官府 3 / 校场 18：上限为 3，第 4 支起被拒
  assert.equal(deployLimit(18, 3), 3);
  assert.equal(canDeployMore(2, 18, 3), true);
  assert.equal(canDeployMore(3, 18, 3), false);
  // 未建官府（0 级）与未建校场一样按保底 1
  assert.equal(deployLimit(18, 0), 1);
  assert.equal(deployLimit(0, 0), 1);
  assert.equal(canDeployMore(0, 18, 0), true);
  assert.equal(canDeployMore(1, 18, 0), false);
  // 官府不低于校场时就是校场等级（主城 / 分城 / 名城同口径，无额外系数）
  assert.equal(deployLimit(5, 5), 5);
  assert.equal(deployLimit(5, 12), 5);
  // 被官府压住的标记（客户端据此提示「先升级官府」）
  assert.equal(isGovernmentCapped(18, 3), true);
  assert.equal(isGovernmentCapped(3, 3), false);
  assert.equal(isGovernmentCapped(2, 3), false);
});

test('校场最高可升等级 = 本城已建成的官府等级（v117）：超目标 / toLevel / 队列已排的升级都计入', () => {
  assert.equal(paradeLevelCap(3), 3);
  assert.equal(paradeLevelCap(0), 0, '官府未建时没有可升空间（实际城池开局自带 1 级官府）');
  // 目标等级超过官府被拒（官府 3 / 校场 18 想升到 19、或想升到 4）
  assert.equal(paradeAboveGovernment(19, 3), true);
  assert.equal(paradeAboveGovernment(4, 3), true);
  assert.equal(paradeAboveGovernment(3, 3), false);
  assert.equal(judgeParadeAboveGovernment('parade_ground', 4, 3)?.code, 'PARADE_ABOVE_GOVERNMENT');
  assert.equal(judgeParadeAboveGovernment('parade_ground', 3, 3), null);
  assert.equal(judgeParadeAboveGovernment('government', 20, 3), null, '只约束校场，其他建筑不受影响');
  // 连续升级 toLevel 取最终等级：官府 5 时 toLevel 6 被拒、toLevel 5 通过
  assert.equal(judgeParadeAboveGovernment('parade_ground', paradeEffectiveTarget(6), 5)?.code, 'PARADE_ABOVE_GOVERNMENT');
  assert.equal(judgeParadeAboveGovernment('parade_ground', paradeEffectiveTarget(5), 5), null);
  // 队列里已排的校场升级计入：本次目标 5 + 队列里的 Lv8 链条 → 实际目标等级 8，官府 6 时被拒
  assert.equal(paradeEffectiveTarget(5, [8]), 8);
  assert.equal(judgeParadeAboveGovernment('parade_ground', paradeEffectiveTarget(5, [8]), 6)?.code, 'PARADE_ABOVE_GOVERNMENT');
  assert.equal(judgeParadeAboveGovernment('parade_ground', paradeEffectiveTarget(5, [8]), 8), null, '官府升到 8 后放行');
  assert.equal(paradeEffectiveTarget(3, []), 3, '没有队列条目时就是本次目标');
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

test('队列里已排的校场升级计入目标等级（v117，AISLG-269，无需数据库）', () => {
  // API 侧从队列行算出「已排的校场升级终点」：连续升级取 to_level，单级取 level
  const queued = queuedParadeTargets({
    queue: [
      { kind: 'parade_ground', level: 6, to_level: 8, status: 'building' },
      { kind: 'parade_ground', level: 9, to_level: null, status: 'queued' },
      { kind: 'farm', level: 5, to_level: 12, status: 'queued' },
    ],
  } as unknown as Parameters<typeof queuedParadeTargets>[0]);
  assert.deepEqual(queued, [8, 9], '只取校场条目，且取整链终点 / 目标等级');
  assert.equal(paradeEffectiveTarget(7, queued), 9, '本次目标与队列取最大');
  assert.equal(paradeEffectiveTarget(11, queued), 11);
  assert.equal(paradeAboveGovernment(paradeEffectiveTarget(7, queued), 8), true, '官府 8 < 队列里的 9 → 拒绝');
  assert.equal(paradeAboveGovernment(paradeEffectiveTarget(7, queued), 9), false);
});
