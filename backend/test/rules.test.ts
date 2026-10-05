import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDING_KINDS, RESOURCE_KEYS, type Resources } from '../common/src/protocol';
import {
  BUILD_QUEUE_CAPACITY,
  BUILDING_INFO,
  INITIAL_BUILDINGS,
  INITIAL_POPULATION,
  DEFAULT_BUILD_SECONDS,
  FARM_COST,
  INITIAL_RESOURCES,
  MAX_ACTIVE_BUILDS,
  MAX_BUILDING_LEVEL,
  upgradeLevelFactor,
  wallBasePercent,
  EXCHANGE_INPUT_PER_GOLD,
  applyCost,
  buildSeconds,
  completeBuild,
  exchangeGoldFor,
  startBuild,
  startUpgrade,
  upgradeChainCost,
  upgradeCost,
  upgradeSeconds,
} from '../common/src/rules';
import { setTimeScaleCache } from '../common/src/time-scale';

// 本文件断言未加速基准值（AISLG-38 全局缩放语义由 time-scale.test.ts 专测）
setTimeScaleCache(1);


test('建筑清单覆盖一期建筑 + 二期建筑（v36 加酒馆），五种生产建筑的产出互不重复', () => {
  assert.deepEqual([...BUILDING_KINDS].sort(), [
    'academy',
    'arrow_tower',
    'barracks',
    'beacon',
    'farm',
    'government',
    'house',
    'iron_mine',
    'lumber_mill',
    'parade_ground',
    'post_station',
    'quarry',
    'tavern',
    'wall',
    'warehouse',
  ]);
  const produced = BUILDING_KINDS.map((kind) => BUILDING_INFO[kind].produces);
  assert.deepEqual(
    produced.filter((p) => p !== null).sort(),
    ['food', 'gold', 'iron', 'stone', 'wood'],
  );
  assert.equal(produced.filter((p) => p === null).length, 10, '十种非生产建筑（民房/军营/仓库/城墙/书院/校场/烽火台/驿站/箭塔/酒馆）');
});

test('开号之初：五资源各 800（v21 AISLG-31 降档）、人口 50、自带 1 级官府', () => {
  assert.deepEqual(INITIAL_RESOURCES, { gold: 2000, wood: 2000, food: 2000, stone: 2000, iron: 2000 });
  assert.equal(INITIAL_POPULATION, 50);
  assert.deepEqual(INITIAL_BUILDINGS, { government: 1 });
});

test('九种建筑的初始资源都够付一次成本（首建可达成）', () => {
  for (const kind of BUILDING_KINDS) {
    const verdict = startBuild(kind, INITIAL_RESOURCES, false, 0, 0);
    assert.ok(verdict.ok, `${kind} 用初始资源应允许首建`);
    assert.deepEqual(verdict.cost, BUILDING_INFO[kind].cost);
    assert.equal(verdict.mode, 'start', '无在建时应立即开工');
    assert.equal(verdict.level, 1, '建造目标等级恒为 1');
  }
});

test('任一所需资源不足时拒绝并返回 INSUFFICIENT_RESOURCES（无论队列状态）', () => {
  for (const kind of BUILDING_KINDS) {
    const cost = BUILDING_INFO[kind].cost;
    for (const key of RESOURCE_KEYS) {
      if (cost[key] === 0) {
        continue;
      }
      const resources = { ...INITIAL_RESOURCES, [key]: cost[key] - 1 };
      for (const [active, queued] of [[0, 0], [1, 0], [1, BUILD_QUEUE_CAPACITY]] as const) {
        const verdict = startBuild(kind, resources, false, active, queued);
        assert.ok(
          !verdict.ok && verdict.code === 'INSUFFICIENT_RESOURCES',
          `${kind} 缺 ${key}（active=${active}, queued=${queued}）应返回 INSUFFICIENT_RESOURCES`,
        );
      }
    }
  }
});

test('单实例规则：已建成或队列中已有该类型时拒绝 BUILDING_EXISTS', () => {
  for (const kindBusy of [true]) {
    const built = startBuild('farm', INITIAL_RESOURCES, kindBusy, 0, 0);
    assert.ok(!built.ok && built.code === 'BUILDING_EXISTS', '已建成应拒绝重复建造');
  }
});

test('有在建且排队未满时进入排队（mode=queued）', () => {
  for (let queued = 0; queued < BUILD_QUEUE_CAPACITY; queued += 1) {
    const verdict = startBuild('farm', INITIAL_RESOURCES, false, MAX_ACTIVE_BUILDS, queued);
    assert.ok(verdict.ok, `排队 ${queued}/${BUILD_QUEUE_CAPACITY} 时应允许入队`);
    assert.equal(verdict.mode, 'queued');
  }
});

test('排队已满时拒绝并返回 QUEUE_FULL', () => {
  const verdict = startBuild('farm', INITIAL_RESOURCES, false, MAX_ACTIVE_BUILDS, BUILD_QUEUE_CAPACITY);
  assert.ok(!verdict.ok && verdict.code === 'QUEUE_FULL');
});

test('升级：未建造返回 BUILDING_NOT_BUILT', () => {
  const verdict = startUpgrade('farm', 0, INITIAL_RESOURCES, false, 0, 0);
  assert.ok(!verdict.ok && verdict.code === 'BUILDING_NOT_BUILT');
});

test('升级：目标等级 = 当前 + 1，成本与时长按当前等级放大', () => {
  const verdict = startUpgrade('farm', 1, INITIAL_RESOURCES, false, 0, 0);
  assert.ok(verdict.ok);
  assert.equal(verdict.level, 2);
  assert.equal(verdict.mode, 'start');
  assert.deepEqual(verdict.cost, upgradeCost('farm', 1));
  assert.deepEqual(verdict.cost, {
    gold: FARM_COST.gold * 1,
    wood: FARM_COST.wood * 1,
    food: 0,
    stone: 0,
    iron: 0,
  });
  assert.equal(upgradeSeconds(1), DEFAULT_BUILD_SECONDS);
  assert.equal(upgradeSeconds(3), DEFAULT_BUILD_SECONDS * 3);

  const level3 = startUpgrade('farm', 3, INITIAL_RESOURCES, false, 0, 0);
  assert.ok(level3.ok && level3.level === 4);
});

test('升级：该类型已在队列中返回 BUILDING_EXISTS（在队冲突先于未建成判定）', () => {
  const verdict = startUpgrade('farm', 1, INITIAL_RESOURCES, true, 0, 0);
  assert.ok(!verdict.ok && verdict.code === 'BUILDING_EXISTS');
  // 首次建造进行中（等级 0、在队）升级同样给出行列冲突，而不是 BUILDING_NOT_BUILT
  const firstBuildInQueue = startUpgrade('farm', 0, INITIAL_RESOURCES, true, 0, 0);
  assert.ok(!firstBuildInQueue.ok && firstBuildInQueue.code === 'BUILDING_EXISTS');
});

test('升级：资源不足返回 INSUFFICIENT_RESOURCES', () => {
  const cost = upgradeCost('farm', 1);
  const verdict = startUpgrade('farm', 1, { ...INITIAL_RESOURCES, gold: cost.gold - 1 }, false, 0, 0);
  assert.ok(!verdict.ok && verdict.code === 'INSUFFICIENT_RESOURCES');
});

test('升级：已达等级上限返回 BUILDING_LEVEL_MAX', () => {
  const verdict = startUpgrade('farm', MAX_BUILDING_LEVEL, INITIAL_RESOURCES, false, 0, 0);
  assert.ok(!verdict.ok && verdict.code === 'BUILDING_LEVEL_MAX');
});

test('升级：有在建立即入队（与建造共用队列）', () => {
  const verdict = startUpgrade('farm', 1, INITIAL_RESOURCES, false, MAX_ACTIVE_BUILDS, 0);
  assert.ok(verdict.ok && verdict.mode === 'queued' && verdict.level === 2);
});

test('applyCost 正确扣减全部五种资源且不修改入参', () => {
  const before = { ...INITIAL_RESOURCES };
  const after = applyCost(INITIAL_RESOURCES, FARM_COST);
  assert.deepEqual(after, {
    gold: INITIAL_RESOURCES.gold - FARM_COST.gold,
    wood: INITIAL_RESOURCES.wood - FARM_COST.wood,
    food: INITIAL_RESOURCES.food - FARM_COST.food,
    stone: INITIAL_RESOURCES.stone,
    iron: INITIAL_RESOURCES.iron,
  });
  assert.deepEqual(INITIAL_RESOURCES, before);
});

test('completeBuild 推进为 completed 并保留目标等级', () => {
  assert.deepEqual(completeBuild({ status: 'building', level: 1 }), { status: 'completed', level: 1 });
  assert.deepEqual(completeBuild({ status: 'building', level: 2 }), { status: 'completed', level: 2 });
});

test('buildSeconds 默认值与环境变量覆盖', () => {
  const saved = process.env.BUILD_SECONDS;
  try {
    delete process.env.BUILD_SECONDS;
    assert.equal(buildSeconds(), DEFAULT_BUILD_SECONDS);
    process.env.BUILD_SECONDS = '7';
    assert.equal(buildSeconds(), 7);
    assert.equal(upgradeSeconds(2), 14);
    process.env.BUILD_SECONDS = 'not-a-number';
    assert.equal(buildSeconds(), DEFAULT_BUILD_SECONDS);
    process.env.BUILD_SECONDS = '0';
    assert.equal(buildSeconds(), DEFAULT_BUILD_SECONDS);
  } finally {
    if (saved === undefined) {
      delete process.env.BUILD_SECONDS;
    } else {
      process.env.BUILD_SECONDS = saved;
    }
  }
});

// ---- v22（AISLG-43）：UPGRADE toLevel 连续升级 ----

test('startUpgrade 连续升级：整链成本 = Σ 各级公式价，toLevel 越界拒绝', () => {
  const rich: Resources = { gold: 1_000_000, wood: 1_000_000, food: 1_000_000, stone: 1_000_000, iron: 1_000_000 };
  // farm 基价 gold100/wood50：Lv1→10 需 ×(1+2+...+9)=45
  const chain = startUpgrade('farm', 1, rich, false, 0, 0, 10);
  assert.ok(chain.ok);
  if (chain.ok) {
    assert.equal(chain.level, 2, 'level = 第一个目标等级');
    assert.equal(chain.toLevel, 10);
    assert.equal(chain.cost.gold, 100 * 45);
    assert.equal(chain.cost.wood, 50 * 45);
    assert.equal(chain.mode, 'start');
  }
  // toLevel = 当前 +1 视同单级：toLevel 为 null、成本只含一级
  const single = startUpgrade('farm', 1, rich, false, 0, 0, 2);
  assert.ok(single.ok);
  if (single.ok) {
    assert.equal(single.toLevel, null);
    assert.equal(single.cost.gold, 100);
  }
  // 超过等级上限整单拒绝
  const over = startUpgrade('farm', 1, rich, false, 0, 0, 21);
  assert.deepEqual(over, { ok: false, code: 'BUILDING_LEVEL_MAX' });
  // 资源只够单级、不够整链：INSUFFICIENT_RESOURCES 且失败附整链成本
  const poor: Resources = { gold: 150, wood: 100, food: 0, stone: 0, iron: 0 };
  const denied = startUpgrade('farm', 1, poor, false, 0, 0, 10);
  assert.ok(!denied.ok);
  if (!denied.ok) {
    assert.equal(denied.code, 'INSUFFICIENT_RESOURCES');
    assert.equal(denied.cost?.gold, 100 * 45, '失败附整链成本（供缺口推导）');
  }
  // upgradeChainCost 与逐级求和一致
  const manual = upgradeChainCost('farm', 1, 10);
  assert.equal(manual.gold, 100 * 45);
});

// ---- v22（AISLG-42）：集市兑换 ----

test('集市兑换：4 单位资源换 1 金，不足汇率换 0 金', () => {
  assert.equal(EXCHANGE_INPUT_PER_GOLD, 4);
  assert.equal(exchangeGoldFor(4000), 1000);
  assert.equal(exchangeGoldFor(7), 1);
  assert.equal(exchangeGoldFor(3), 0);
  assert.equal(exchangeGoldFor(-5), 0);
});

test('v31 等级上限 20：1~10 级成本线性不变，10 级以后每级 ×1.3（9 × 1.3^(L−9)）', () => {
  assert.equal(MAX_BUILDING_LEVEL, 20);
  for (const level of [1, 5, 9]) {
    assert.equal(upgradeLevelFactor(level), level, `${level} 级倍数 = 等级（线性不变）`);
  }
  const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.06, `${actual} ≈ ${expected}`);
  close(upgradeLevelFactor(10), 11.7);
  close(upgradeLevelFactor(14), 33.4);
  close(upgradeLevelFactor(19), 124.1);
  // 农田基价 gold 100：19→20 = 12410（取整），1~10 级成本不变
  assert.equal(upgradeCost('farm', 9).gold, 900);
  assert.equal(upgradeCost('farm', 10).gold, 1170);
  assert.equal(upgradeCost('farm', 19).gold, Math.round(100 * upgradeLevelFactor(19)));
  // 10→20 合计约 499 倍基础成本（≈ 1→10 的 45 倍 × 11）
  let sum = 0;
  for (let level = 10; level < 20; level += 1) {
    sum += upgradeLevelFactor(level);
  }
  assert.ok(sum > 495 && sum < 503, `10→20 合计倍数 ${sum.toFixed(1)}`);
});

test('v31 升到 20 级：20 级可再升被拒，连升可选到 20，21 被拒', () => {
  const rich: Resources = { gold: 99_999_999, wood: 99_999_999, food: 99_999_999, stone: 99_999_999, iron: 99_999_999 };
  assert.deepEqual(startUpgrade('farm', 20, rich, false, 0, 0), { ok: false, code: 'BUILDING_LEVEL_MAX' });
  const chain = startUpgrade('farm', 10, rich, false, 0, 0, 20);
  assert.ok(chain.ok && chain.toLevel === 20);
  assert.deepEqual(startUpgrade('farm', 10, rich, false, 0, 0, 21), { ok: false, code: 'BUILDING_LEVEL_MAX' });
});

test('v31 城墙：前 10 级每级 +5%，11~20 级每级 +2%，20 级 70%、加满城防科技 80% 仍低于引擎封顶 90%', () => {
  assert.equal(wallBasePercent(0), 0);
  assert.equal(wallBasePercent(5), 25);
  assert.equal(wallBasePercent(10), 50);
  assert.equal(wallBasePercent(11), 52);
  assert.equal(wallBasePercent(20), 70);
  assert.equal(wallBasePercent(20) + 10, 80);
});
