// 声望与爵位（v76，AISLG-197）：爵位门槛、俸禄、武将上限加成、城池称号。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NOBILITY_TIERS,
  cityTitle,
  nobilityHeroCapBonus,
  nobilityIndexOf,
  nobilityName,
  nobilitySalaryGold,
} from '../common/src/nobility';
import { normalHeroCap } from '../common/src/hero';
import { setTimeScaleCache } from '../common/src/time-scale';

test('爵位门槛：10 级，声望达标取最高一档', () => {
  assert.equal(NOBILITY_TIERS.length, 10);
  assert.equal(nobilityIndexOf(0), 0);
  assert.equal(nobilityIndexOf(99), 0);
  assert.equal(nobilityIndexOf(100), 1);
  assert.equal(nobilityIndexOf(499), 1);
  assert.equal(nobilityIndexOf(500), 2);
  assert.equal(nobilityIndexOf(2_000), 3);
  assert.equal(nobilityIndexOf(299_999), 8);
  assert.equal(nobilityIndexOf(300_000), 9);
  assert.equal(nobilityName(3), '大夫');
});

test('每日俸禄 = 爵位序号 × 200 × 时间缩放', () => {
  setTimeScaleCache(50);
  assert.equal(nobilitySalaryGold(0), 0);
  assert.equal(nobilitySalaryGold(1), 10_000);
  assert.equal(nobilitySalaryGold(3), 30_000);
  assert.equal(nobilitySalaryGold(8), 80_000);
  assert.equal(nobilitySalaryGold(9), 90_000);
  setTimeScaleCache(1);
  assert.equal(nobilitySalaryGold(3), 600);
});

test('普通武将上限：五大夫 +1、列侯再 +1', () => {
  assert.equal(nobilityHeroCapBonus(0), 0);
  assert.equal(nobilityHeroCapBonus(4), 0);
  assert.equal(nobilityHeroCapBonus(5), 1);
  assert.equal(nobilityHeroCapBonus(7), 1);
  assert.equal(nobilityHeroCapBonus(8), 2);
  assert.equal(nobilityHeroCapBonus(9), 2);
  assert.equal(normalHeroCap(3), 3);
  assert.equal(normalHeroCap(3, 5), 4);
  assert.equal(normalHeroCap(3, 8), 5);
});

test('城池称号：按官府等级，分城最高州城（都城只给主城）', () => {
  assert.equal(cityTitle(1, true), '城池');
  assert.equal(cityTitle(4, true), '城池');
  assert.equal(cityTitle(5, true), '县城');
  assert.equal(cityTitle(9, false), '县城');
  assert.equal(cityTitle(10, true), '郡城');
  assert.equal(cityTitle(14, false), '郡城');
  assert.equal(cityTitle(15, true), '州城');
  assert.equal(cityTitle(19, false), '州城');
  assert.equal(cityTitle(20, true), '都城');
  assert.equal(cityTitle(20, false), '州城');
  assert.equal(cityTitle(25, false), '州城');
});