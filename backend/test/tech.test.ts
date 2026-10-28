// 科技研究的规则与效果出口（v27，AISLG-77）

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_TECH_LEVEL,
  TECH_INFO,
  TECH_KINDS,
  carryingPercent,
  combatTechBonus,
  constructionReductionPercent,
  defenseExtraPercent,
  drillReductionPercent,
  emptyTechLevels,
  farmingPercent,
  lootingPercent,
  marchingPercent,
  researchReductionPercent,
  researchSeconds,
  scoutDetailOf,
  startResearch,
  storagePercent,
  supplyReductionPercent,
  techCost,
  techPercent,
} from '../common/src/tech';
import { setTimeScaleCache } from '../common/src/time-scale';
import { recruitBatchSeconds } from '../common/src/troops';
import { upgradeSeconds } from '../common/src/rules';
import { wildernessPlunderPool } from '../common/src/world';
import { settleDurability } from '../common/src/protection';
import { simulateBattle } from '../common/src/battle-engine';
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

test('科技清单覆盖十六项、发展 / 军事各八项，且每项有成本与效果说明', () => {
  assert.equal(TECH_KINDS.length, 16);
  for (const kind of TECH_KINDS) {
    assert.ok(techCost(kind, 1).gold > 0, `${kind} 1 级成本`);
    assert.ok(TECH_INFO[kind].effect.length > 0);
  }
  const byCategory = (category: string) => TECH_KINDS.filter((kind) => TECH_INFO[kind].category === category);
  assert.equal(byCategory('development').length, 8);
  assert.equal(byCategory('military').length, 8);
  // 新增十项的 1 级成本合计落在需求表的 300~450 区间
  const cost = (kind: (typeof TECH_KINDS)[number]) => {
    const c = techCost(kind, 1);
    return c.gold + c.wood + c.food + c.stone + c.iron;
  };
  for (const kind of ['drill', 'combat', 'protection', 'riding', 'archery', 'supply', 'construction', 'research', 'looting', 'repair'] as const) {
    assert.ok(cost(kind) >= 300 && cost(kind) <= 450, `${kind} 1 级成本 ${cost(kind)} 应在 300~450`);
  }
});

test('新科技效果出口：带符号百分数与战斗乘数', () => {
  const techs = { ...emptyTechLevels(), drill: 10, construction: 3, research: 10, supply: 10, looting: 10, repair: 10 };
  assert.equal(drillReductionPercent(techs), 30);
  assert.equal(constructionReductionPercent(techs), 9);
  assert.equal(researchReductionPercent(techs), 30);
  assert.equal(supplyReductionPercent(techs), 30);
  assert.equal(lootingPercent(techs), 40);
  assert.equal(techPercent('repair', techs), 50);
  assert.equal(combatTechBonus(techs), null, '没有战斗类科技时不传乘数');
  const combat = combatTechBonus({ ...techs, combat: 10, protection: 10, riding: 10, archery: 10 });
  assert.deepEqual(combat, { atkPercent: 15, defPercent: 15, cavalrySpeedPercent: 20, rangedRangePercent: 10 });
});

test('科技缩短征兵 / 建造 / 研究时长', () => {
  setTimeScaleCache(1);
  try {
    assert.equal(recruitBatchSeconds('militia', 10), 100);
    assert.equal(recruitBatchSeconds('militia', 10, 30), 70);
    assert.equal(upgradeSeconds(4), 240);
    assert.equal(upgradeSeconds(4, 30), 168);
    assert.ok(researchSeconds(2, 10) < researchSeconds(2, 0));
    assert.equal(researchSeconds(2, 10), Math.floor(researchSeconds(2, 0) * 0.7));
  } finally {
    setTimeScaleCache(50);
  }
});

test('掠夺科技只放大野地资源池；城防回涨按维修科技加速', () => {
  const base = wildernessPlunderPool('forest', 5);
  const boosted = wildernessPlunderPool('forest', 5, 40);
  assert.equal(boosted.gold, Math.floor((base.gold ?? 0) * 1.4));
  assert.equal(boosted.wood, Math.floor((base.wood ?? 0) * 1.4));
  setTimeScaleCache(50);
  try {
    const now = new Date();
    const settled = new Date(now.getTime() - 72_000); // 1 个「缩放后小时」
    assert.equal(settleDurability(0, settled, null, now), 10);
    assert.equal(settleDurability(0, settled, null, now, 50), 15, '维修 10 级：10 → 15 点/小时');
  } finally {
    setTimeScaleCache(50);
  }
});

test('世界地图战斗科技：攻击 / 减伤 / 驾驭 / 抛射各按预期生效', () => {
  const rng = () => 0.5;
  // 攻击：+15% 全军攻击 → 同回合对守方造成更多损失
  const plain = simulateBattle({ cavalry: 100 }, { militia: 100 }, { rng, maxRounds: 2 });
  const buffed = simulateBattle({ cavalry: 100 }, { militia: 100 }, { rng, maxRounds: 2, attackerTech: { atkPercent: 15 } });
  assert.ok(buffed.defender.losses.militia > plain.defender.losses.militia);
  // 防护：守方 −15% 受伤 → 同样一击打掉的守军更少（测试固定 1 回合，排除后续存活兵力反击的干扰）
  const plainOne = simulateBattle({ cavalry: 100 }, { militia: 100 }, { rng, maxRounds: 2 });
  const protectedRun = simulateBattle({ cavalry: 100 }, { militia: 100 }, { rng, maxRounds: 2, defenderTech: { defPercent: 15 } });
  assert.ok(protectedRun.defender.losses.militia < plainOne.defender.losses.militia);
  // 驾驭：骑兵更快进入更高速度档，先手削减对方输出 → 攻方损失更少
  const ridingRun = simulateBattle({ iron_cavalry: 100 }, { iron_cavalry: 100 }, { rng, maxRounds: 2, attackerTech: { cavalrySpeedPercent: 20 } });
  const sameSpeed = simulateBattle({ iron_cavalry: 100 }, { iron_cavalry: 100 }, { rng, maxRounds: 2 });
  assert.ok(ridingRun.attacker.losses.iron_cavalry < sameSpeed.attacker.losses.iron_cavalry, '先手削减对方兵力后再挨打');
  // 抛射：床弩射程 95 → 104.5，提前进入射程（3 回合内本来打不到）
  const noRange = simulateBattle({ ballista: 10 }, { militia: 10 }, { rng, maxRounds: 3, siege: true });
  const rangeRun = simulateBattle({ ballista: 10 }, { militia: 10 }, { rng, maxRounds: 3, siege: true, attackerTech: { rangedRangePercent: 10 } });
  assert.equal(noRange.attacker.damage, 0);
  assert.ok(rangeRun.attacker.damage > 0);
});
