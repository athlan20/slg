// 科技研究的规则与效果出口（v27，AISLG-77）

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TECH_LEVEL,
  TECH_KINDS,
  carryingPercent,
  defenseExtraPercent,
  emptyTechLevels,
  farmingPercent,
  marchingPercent,
  researchSeconds,
  scoutDetailOf,
  startResearch,
  storagePercent,
  techCost,
} from '../common/src/tech';
import { degradeGarrison } from '../common/src/scout-detail';
import { BASE_PRODUCTION_PER_HOUR, productionPerHour, storageCaps, emptyBuildingLevels } from '../common/src/production';
import { armyCarryCapacity } from '../common/src/troops';
import { marchTravelSeconds } from '../common/src/world';
import { wallDefensePercent } from '../common/src/battle';

const RICH = { gold: 99999, wood: 99999, food: 99999, stone: 99999, iron: 99999 };

test('第 N 级成本 = 基础 × N，耗时随等级线性增长', () => {
  assert.equal(techCost('farming', 3).gold, 450);
  assert.equal(techCost('defense', 2).stone, 300);
  // 全局缩放与取整作用于总时长，故只断言随等级单调增长且不低于 1 秒
  assert.ok(researchSeconds(1) >= 1);
  assert.ok(researchSeconds(10) > researchSeconds(5) && researchSeconds(5) > researchSeconds(1));
});

test('发起研究：满级 → 已有研究 → 书院等级 → 资源，按此优先级拒绝', () => {
  const levels = emptyTechLevels();
  assert.deepEqual(startResearch('farming', { ...levels, farming: MAX_TECH_LEVEL }, 10, RICH, false), { ok: false, code: 'TECH_LEVEL_MAX' });
  assert.deepEqual(startResearch('farming', levels, 1, RICH, true), { ok: false, code: 'RESEARCH_IN_PROGRESS' });
  const low = startResearch('farming', { ...levels, farming: 2 }, 2, RICH, false);
  assert.equal(low.ok, false);
  assert.equal(!low.ok && low.code, 'ACADEMY_TOO_LOW');
  assert.equal(!low.ok && low.academyRequired, 3, '第 3 级要求书院 ≥ 3');
  const poor = startResearch('farming', levels, 1, { ...RICH, gold: 10 }, false);
  assert.equal(!poor.ok && poor.code, 'INSUFFICIENT_RESOURCES');
  const ok = startResearch('farming', levels, 1, RICH, false);
  assert.equal(ok.ok, true);
  assert.equal(ok.ok && ok.level, 1);
});

test('未建书院（0 级）不能研究任何科技', () => {
  const verdict = startResearch('storage', emptyTechLevels(), 0, RICH, false);
  assert.equal(!verdict.ok && verdict.code, 'ACADEMY_TOO_LOW');
});

test('效果出口：农耕 / 负重 / 行军 / 储存每级 +5%，城防每级 +1%', () => {
  const techs = { ...emptyTechLevels(), farming: 4, carrying: 2, marching: 10, storage: 1, defense: 7 };
  assert.equal(farmingPercent(techs), 20);
  assert.equal(carryingPercent(techs), 10);
  assert.equal(marchingPercent(techs), 50);
  assert.equal(storagePercent(techs), 5);
  assert.equal(defenseExtraPercent(techs), 7);
  assert.equal(farmingPercent(), 0);
});

test('农耕加成作用于四种基础资源产量，金币不变', () => {
  const levels = emptyBuildingLevels();
  levels.government = 1;
  const base = productionPerHour(levels);
  const boosted = productionPerHour(levels, undefined, 0, { farming: 10 });
  assert.equal(boosted.food / base.food, (BASE_PRODUCTION_PER_HOUR.food * 1.5) / BASE_PRODUCTION_PER_HOUR.food, '农耕 10 级 = +50%');
  assert.ok(boosted.food > base.food && boosted.wood > base.wood);
  assert.equal(boosted.gold, base.gold, '金币不吃农耕');
  // 与名城加成加算（同一个百分数池）：+20% + 农耕 +10% = +30%
  const both = productionPerHour(levels, undefined, 20, { farming: 2 });
  assert.equal(both.food / base.food, 1.3);
});

test('储存加成作用于四资源储量上限，金币上限固定', () => {
  const levels = emptyBuildingLevels();
  const base = storageCaps(levels);
  const boosted = storageCaps(levels, { storage: 4 });
  assert.equal(boosted.food, Math.floor(base.food * 1.2));
  assert.equal(boosted.gold, base.gold);
});

test('负重加成向下取整；行军加成缩短总时长', () => {
  assert.equal(armyCarryCapacity({ porter: 3 }), 1500);
  assert.equal(armyCarryCapacity({ porter: 3 }, 15), 1725);
  assert.equal(armyCarryCapacity({ militia: 1 }, 5), 63, '60 × 1.05 = 63');
  const slow = marchTravelSeconds(0, 0, 10, 10, { militia: 5 });
  const fast = marchTravelSeconds(0, 0, 10, 10, { militia: 5 }, 100);
  assert.ok(fast < slow);
  assert.equal(marchTravelSeconds(0, 0, 10, 10, { militia: 5 }, 0), slow);
});

test('城防科技在城墙减伤上额外加百分点', () => {
  assert.equal(wallDefensePercent(4), 20);
  assert.equal(wallDefensePercent(4, 7), 27);
});

test('侦察详细度：Lv0–2 rough、Lv3–5 kinds、Lv6+ exact', () => {
  assert.deepEqual([0, 2, 3, 5, 6, 10].map((scouting) => scoutDetailOf({ scouting })), ['rough', 'rough', 'kinds', 'kinds', 'exact', 'exact']);
});

test('侦察降级：rough 只给总数范围、kinds 给近似兵种且重复侦察一致、exact 精确', () => {
  const real = { militia: 40, archer: 10 };
  const rough = degradeGarrison(real, 7, 9, { scouting: 0 });
  assert.equal(rough.detail, 'rough');
  assert.ok(Object.values(rough.garrison).every((count) => count === 0));
  assert.deepEqual(rough.total, { min: 40, max: 60 }, '50 × ±20%');

  const kinds = degradeGarrison(real, 7, 9, { scouting: 3 });
  assert.equal(kinds.detail, 'kinds');
  assert.ok(kinds.garrison.militia >= 32 && kinds.garrison.militia <= 48);
  assert.ok(kinds.garrison.archer >= 8 && kinds.garrison.archer <= 12);
  assert.equal(kinds.garrison.cavalry, 0, '没有的兵种不会冒出来');
  assert.deepEqual(degradeGarrison(real, 7, 9, { scouting: 4 }).garrison, kinds.garrison, '同一地块重复侦察结果一致');

  const exact = degradeGarrison(real, 7, 9, { scouting: 6 });
  assert.equal(exact.garrison.militia, 40);
  assert.deepEqual(exact.total, { min: 50, max: 50 });
});

test('科技清单覆盖六项且每项有成本与效果说明', () => {
  assert.equal(TECH_KINDS.length, 6);
  for (const kind of TECH_KINDS) {
    assert.ok(techCost(kind, 1).gold > 0);
  }
});
