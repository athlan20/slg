// 盟友协防（v74，AISLG-194）：合并 / 伤亡分摊 / 上限与引擎的城守覆盖比例。

import assert from 'node:assert/strict';
import test from 'node:test';
import { simulateBattle } from '../common/src/battle-engine';
import {
  ASSIST_MAX_PER_CITY,
  assistCap,
  armyUnits,
  mergeDefense,
  splitAssistLosses,
  survivorsAfter,
  type AssistParty,
} from '../common/src/city-assist';
import { fullArmy } from '../common/src/city-assist';

const PARTIES: AssistParty[] = [
  { id: 'a', accountId: 'acc-a', fromCityId: 'city-a', troops: { swordsman: 10, cavalry: 2 } },
  { id: 'b', accountId: 'acc-b', fromCityId: 'city-b', troops: { swordsman: 10 } },
];

test('合并守方：城主 + 各协防部队逐兵种相加；上限为每城 5 支', () => {
  const merged = mergeDefense({ swordsman: 5, archer: 3 }, PARTIES);
  assert.equal(merged.swordsman, 25);
  assert.equal(merged.archer, 3);
  assert.equal(merged.cavalry, 2);
  assert.equal(armyUnits(merged), 30);
  assert.equal(ASSIST_MAX_PER_CITY, 5);
  assert.equal(assistCap(null), 5);
});

test('伤亡按同兵种开战数量比例分摊，取整余数归城主', () => {
  const split = splitAssistLosses({ swordsman: 10, archer: 4 }, PARTIES, { swordsman: 3, archer: 1 });
  // 20 刀盾伤亡 3：各方 floor(3×10/20)=1、1；余数 1 归城主
  assert.equal(split.hostLosses.swordsman, 1);
  assert.equal(split.partyLosses.get('a')?.swordsman, 1);
  assert.equal(split.partyLosses.get('b')?.swordsman, 1);
  // 弓 4 伤亡 1：两家协防都没有弓，城主承担全部
  assert.equal(split.hostLosses.archer, 1);
  assert.equal(split.partyLosses.get('a')?.archer, 0);

  // 城主 0、协防 10，伤亡 3 → 协防 floor(3×10/10)=3，城主 0；分摊不超过开战数量
  const noHost = splitAssistLosses({}, [{ id: 'solo', accountId: 'x', fromCityId: 'y', troops: { swordsman: 10 } }], { swordsman: 3 });
  assert.equal(noHost.hostLosses.swordsman, 0);
  assert.equal(noHost.partyLosses.get('solo')?.swordsman, 3);

  const survivors = survivorsAfter({ swordsman: 10 }, { swordsman: 3 });
  assert.equal(survivors.swordsman, 7);
  assert.deepEqual(fullArmy({}) , { porter: 0, militia: 0, scout: 0, pikeman: 0, swordsman: 0, archer: 0, cavalry: 0, iron_cavalry: 0, supply_wagon: 0, ballista: 0, siege_ram: 0, yulin_guard: 0, danyang_soldier: 0, baimao_soldier: 0, huwei_guard: 0, zhuge_crossbow: 0, xiandeng_warrior: 0, hubao_cavalry: 0, xiliang_cavalry: 0 });
});

test('城守武将只覆盖城主部队：defenderHeroScale=0 时守方武将完全不生效', () => {
  const rng = () => 0.5;
  const full = simulateBattle({ militia: 100 }, { militia: 100 }, {
    rng, maxRounds: 6, defenderHero: { atkPercent: 20, defPercent: 20 }, defenderHeroScale: 1,
  });
  const none = simulateBattle({ militia: 100 }, { militia: 100 }, {
    rng, maxRounds: 6, defenderHero: { atkPercent: 20, defPercent: 20 }, defenderHeroScale: 0,
  });
  assert.ok(full.defender.damage > none.defender.damage, '覆盖比例 1 时守方输出更高');
  assert.ok(none.attacker.losses.militia <= full.attacker.losses.militia);
});
