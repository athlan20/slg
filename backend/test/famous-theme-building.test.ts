// 名城主题建筑等级上限（v63，AISLG-167）：占有对应名城时主题建筑可升到 25 级，其余仍为 20；城墙 21~25 级单级增益受控

import assert from 'node:assert/strict';
import test from 'node:test';
import { BUILDING_KINDS, type BuildingKind, type Resources } from '../common/src/protocol';
import { FAMOUS_CITY_NAMES } from '../common/src/famous-city';
import {
  FAMOUS_THEME_BUILDING,
  FAMOUS_THEME_LEVEL_MAX,
  famousEffectOf,
  famousThemeBuildingOf,
} from '../common/src/famous-effects';
import {
  MAX_BUILDING_LEVEL,
  actionCosts,
  buildingLevelMax,
  buildingLevelMaxes,
  effectiveBuildingLevel,
  startUpgrade,
  upgradeCost,
  wallBasePercent,
} from '../common/src/rules';
import { wallDefensePercent } from '../common/src/battle';

const RICH: Resources = { gold: 1e12, wood: 1e12, food: 1e12, stone: 1e12, iron: 1e12 };
const levelsWith = (kind: BuildingKind, level: number): Record<BuildingKind, number> => {
  const levels = Object.fromEntries(BUILDING_KINDS.map((k) => [k, 0])) as Record<BuildingKind, number>;
  levels[kind] = level;
  return levels;
};

test('主题建筑表覆盖 8 座名城，每座对应一种已有建筑', () => {
  assert.deepEqual(Object.keys(FAMOUS_THEME_BUILDING).sort(), [...FAMOUS_CITY_NAMES].sort());
  for (const name of FAMOUS_CITY_NAMES) {
    assert.ok((BUILDING_KINDS as readonly string[]).includes(FAMOUS_THEME_BUILDING[name]), name);
  }
  assert.equal(FAMOUS_THEME_BUILDING['洛阳'], 'wall');
  assert.equal(FAMOUS_THEME_BUILDING['长安'], 'arrow_tower');
  assert.equal(FAMOUS_THEME_BUILDING['官渡'], 'farm');
  assert.equal(FAMOUS_THEME_BUILDING['邺城'], 'government');
  assert.equal(FAMOUS_THEME_BUILDING['许昌'], 'post_station');
  assert.equal(FAMOUS_THEME_BUILDING['襄阳'], 'warehouse');
});

test('主题建筑与名城效果同口径：查询函数对非名城与未知名字返回 null', () => {
  assert.equal(famousThemeBuildingOf('洛阳'), 'wall');
  assert.equal(famousThemeBuildingOf(null), null);
  assert.equal(famousThemeBuildingOf(undefined), null);
  assert.equal(famousThemeBuildingOf('不存在的城'), null);
  // 每座主题名城都有效果定义（主题建筑只是上限口径，效果仍由 famous-effects 决定）
  for (const name of FAMOUS_CITY_NAMES) {
    assert.ok(famousEffectOf(name), name);
  }
});

test('等级上限：占有对应名城时主题建筑为 25，其余建筑与非名城均为 20', () => {
  assert.equal(FAMOUS_THEME_LEVEL_MAX, 25);
  assert.equal(buildingLevelMax('wall', '洛阳'), 25);
  assert.equal(buildingLevelMax('farm', '洛阳'), MAX_BUILDING_LEVEL);
  assert.equal(buildingLevelMax('wall', '长安'), MAX_BUILDING_LEVEL);
  assert.equal(buildingLevelMax('wall', null), MAX_BUILDING_LEVEL);
  assert.equal(buildingLevelMax('government', '邺城'), 25);

  const maxes = buildingLevelMaxes('官渡');
  assert.equal(maxes.farm, 25);
  assert.equal(maxes.wall, 20);
  assert.equal(Object.keys(maxes).length, BUILDING_KINDS.length);
});

test('城墙：21~25 级每级 +1，25 级 75%；加满城防科技与洛阳名城恰为 90% 封顶', () => {
  assert.equal(wallBasePercent(20), 70);
  assert.equal(wallBasePercent(21), 71);
  assert.equal(wallBasePercent(25), 75);
  assert.equal(wallBasePercent(25) + 10, 85);
  // 洛阳名城 +5 与城防科技 +10 叠加后恰好为引擎封顶 90%
  assert.equal(wallDefensePercent(25, 10 + 5), 90);
  assert.equal(wallDefensePercent(20, 10 + 5), 85);
});

test('actionCosts：名城主题建筑 24 级可升级、25 级满级；普通建筑 20 级即满级', () => {
  const wall24 = actionCosts(levelsWith('wall', 24), '洛阳').wall;
  assert.ok(wall24.upgrade, '洛阳城墙 24 → 25 应可升级');
  assert.ok(wall24.upgradeSeconds && wall24.upgradeSeconds > 0);

  const wall25 = actionCosts(levelsWith('wall', 25), '洛阳').wall;
  assert.equal(wall25.upgrade, null);
  assert.equal(wall25.upgradeSeconds, null);

  // 非名城的城墙 20 级即满级（上限不因主题建筑表而抬高）
  assert.equal(actionCosts(levelsWith('wall', 20), null).wall.upgrade, null);
  assert.equal(actionCosts(levelsWith('wall', 20), '长安').wall.upgrade, null);
});

test('startUpgrade：按该城上限判定，单级与连升都不超过上限', () => {
  // 洛阳城墙 20 → 21：默认上限 20 拒绝，名城上限 25 放行
  assert.equal(startUpgrade('wall', 20, RICH, false, 0, 0).ok, false);
  const single = startUpgrade('wall', 20, RICH, false, 0, 0, undefined, buildingLevelMax('wall', '洛阳'));
  assert.equal(single.ok, true);
  assert.equal(single.ok && single.level, 21);

  // 25 级已满
  const full = startUpgrade('wall', 25, RICH, false, 0, 0, undefined, 25);
  assert.deepEqual(full, { ok: false, code: 'BUILDING_LEVEL_MAX' });

  // 连升终点超过上限整单拒绝；刚好到上限放行
  assert.deepEqual(startUpgrade('wall', 22, RICH, false, 0, 0, 26, 25), { ok: false, code: 'BUILDING_LEVEL_MAX' });
  const chain = startUpgrade('wall', 22, RICH, false, 0, 0, 25, 25);
  assert.equal(chain.ok, true);
  assert.equal(chain.ok && chain.toLevel, 25);
});

test('升级成本曲线延伸到 25 级：各级成本与耗时有限且随等级递增', () => {
  let prev = 0;
  for (let level = 20; level < 25; level += 1) {
    const cost = upgradeCost('wall', level).gold;
    assert.ok(Number.isFinite(cost) && cost > prev, `level ${level}`);
    prev = cost;
  }
});

test('失守后超出上限的存量等级按当前上限生效：主题建筑 25 → 20，其余建筑不变，重新占领即恢复', () => {
  assert.equal(effectiveBuildingLevel('wall', 25, '洛阳'), 25);
  assert.equal(effectiveBuildingLevel('wall', 25, null), MAX_BUILDING_LEVEL);
  assert.equal(effectiveBuildingLevel('wall', 25, '长安'), MAX_BUILDING_LEVEL);
  assert.equal(effectiveBuildingLevel('farm', 20, null), 20);
  assert.equal(effectiveBuildingLevel('farm', 7, '官渡'), 7);
});
