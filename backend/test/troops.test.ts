import test from 'node:test';
import assert from 'node:assert/strict';
import { TROOP_KINDS } from '../common/src/protocol';
import {
  RECRUIT_COUNT_MAX,
  RECRUIT_QUEUE_CAPACITY,
  MAX_ACTIVE_RECRUITS,
  TROOP_INFO,
  armyFoodUsePerHour,
  recruitBatchSeconds,
  recruitUnitSeconds,
  startRecruit,
} from '../common/src/troops';
import { setTimeScaleCache } from '../common/src/time-scale';

// 本文件断言未加速基准值（AISLG-38 全局缩放语义由 time-scale.test.ts 专测）
setTimeScaleCache(1);


const RICH = { gold: 100_000, wood: 100_000, food: 100_000, stone: 100_000, iron: 100_000 };

test('兵种清单覆盖一期七种（旧游戏 1–7 号）+ 二期四种（v33）', () => {
  assert.deepEqual([...TROOP_KINDS], ['porter', 'militia', 'scout', 'pikeman', 'swordsman', 'archer', 'cavalry', 'iron_cavalry', 'supply_wagon', 'ballista', 'siege_ram']);
  for (const troop of TROOP_KINDS) {
    assert.ok(TROOP_INFO[troop].label.length > 0, `${troop} 应有中文名`);
    assert.ok(TROOP_INFO[troop].barracksLevel >= 1, `${troop} 解锁军营等级应为正`);
  }
});

test('征募校验：军营等级门槛（未建军营同样拒绝）', () => {
  const verdict = startRecruit('porter', 1, RICH, 100, 0, 0, 0);
  assert.ok(!verdict.ok && verdict.code === 'TROOP_NOT_AVAILABLE');
  const scout = startRecruit('scout', 1, RICH, 100, 1, 0, 0);
  assert.ok(!scout.ok && scout.code === 'TROOP_NOT_AVAILABLE');
  const ok = startRecruit('scout', 1, RICH, 100, 2, 0, 0);
  assert.ok(ok.ok);
});

test('征募校验：成本与人口按数量放大并正确扣减判定', () => {
  const verdict = startRecruit('pikeman', 3, RICH, 100, 3, 0, 0);
  assert.ok(verdict.ok);
  assert.deepEqual(verdict.cost, {
    gold: 150 * 3,
    wood: 80 * 3,
    food: 100 * 3,
    stone: 0,
    iron: 50 * 3,
  });
  assert.equal(verdict.population, 3);
  const poor = startRecruit('pikeman', 3, { ...RICH, iron: 50 * 3 - 1 }, 100, 3, 0, 0);
  assert.ok(!poor.ok && poor.code === 'INSUFFICIENT_RESOURCES');
  const noPeople = startRecruit('pikeman', 3, RICH, 2, 3, 0, 0);
  assert.ok(!noPeople.ok && noPeople.code === 'INSUFFICIENT_POPULATION');
});

test('征募校验：队列容量与立即开始/入队模式', () => {
  const start = startRecruit('porter', 1, RICH, 100, 1, 0, 0);
  assert.ok(start.ok && start.mode === 'start', '无征募中应立即开始');
  for (let queued = 0; queued < RECRUIT_QUEUE_CAPACITY; queued += 1) {
    const verdict = startRecruit('porter', 1, RICH, 100, 1, MAX_ACTIVE_RECRUITS, queued);
    assert.ok(verdict.ok && verdict.mode === 'queued', `排队 ${queued}/${RECRUIT_QUEUE_CAPACITY} 时应允许入队`);
  }
  const full = startRecruit('porter', 1, RICH, 100, 1, MAX_ACTIVE_RECRUITS, RECRUIT_QUEUE_CAPACITY);
  assert.ok(!full.ok && full.code === 'RECRUIT_QUEUE_FULL');
  assert.ok(RECRUIT_COUNT_MAX >= 1);
});

test('recruitUnitSeconds：环境变量覆盖与默认值', () => {
  const saved = process.env.RECRUIT_UNIT_SECONDS;
  try {
    delete process.env.RECRUIT_UNIT_SECONDS;
    assert.equal(recruitUnitSeconds('porter'), TROOP_INFO.porter.unitSeconds);
    assert.equal(recruitUnitSeconds('cavalry'), TROOP_INFO.cavalry.unitSeconds);
    process.env.RECRUIT_UNIT_SECONDS = '2';
    assert.equal(recruitUnitSeconds('porter'), 2, '覆盖值对全部兵种生效');
    assert.equal(recruitUnitSeconds('archer'), 2);
    process.env.RECRUIT_UNIT_SECONDS = 'not-a-number';
    assert.equal(recruitUnitSeconds('porter'), TROOP_INFO.porter.unitSeconds);
    process.env.RECRUIT_UNIT_SECONDS = '0';
    assert.equal(recruitUnitSeconds('porter'), TROOP_INFO.porter.unitSeconds, '0 视为未覆盖');
  } finally {
    if (saved === undefined) {
      delete process.env.RECRUIT_UNIT_SECONDS;
    } else {
      process.env.RECRUIT_UNIT_SECONDS = saved;
    }
  }
});

test('单兵耗粮表：全部兵种为正整数，骑兵显著高于步兵（v14 占位数值）', () => {
  for (const troop of TROOP_KINDS) {
    assert.ok(
      Number.isInteger(TROOP_INFO[troop].foodUse) && TROOP_INFO[troop].foodUse > 0,
      `${troop} 单兵小时耗粮应为正整数`,
    );
  }
  assert.equal(TROOP_INFO.porter.foodUse, 2, '民夫参照旧源码为 2/h');
  assert.ok(TROOP_INFO.cavalry.foodUse > TROOP_INFO.swordsman.foodUse, '骑兵耗粮应高于步兵');
});

test('armyFoodUsePerHour：按兵种求和，未知兵种与负数按 0 计', () => {
  assert.equal(armyFoodUsePerHour({}), 0);
  assert.equal(armyFoodUsePerHour({ porter: 10 }), TROOP_INFO.porter.foodUse * 10);
  // 混编：10 民夫 + 5 轻骑
  assert.equal(
    armyFoodUsePerHour({ porter: 10, cavalry: 5 }),
    TROOP_INFO.porter.foodUse * 10 + TROOP_INFO.cavalry.foodUse * 5,
  );
  assert.equal(armyFoodUsePerHour({ unknown_kind: 100 } as never), 0, '未知兵种不计入');
  assert.equal(armyFoodUsePerHour({ archer: -5 }), 0, '负数数量按 0 计');
});

// ---- v22（AISLG-39）：批次总时长（下限作用于总时长，env 覆盖不缩放） ----

test('recruitBatchSeconds：基准单兵 × 数量 ÷ 缩放、下限 1 秒作用于总时长', () => {
  // scale=1（本文件顶部已设）：基准即实际
  assert.equal(recruitBatchSeconds('militia', 10), 100);
  assert.equal(recruitBatchSeconds('porter', 3), 24);
  try {
    setTimeScaleCache(50);
    assert.equal(recruitBatchSeconds('militia', 10), 2);
    assert.equal(recruitBatchSeconds('cavalry', 1), 1, '40s ÷ 50 → 钳 1 秒');
    process.env.RECRUIT_UNIT_SECONDS = '1';
    assert.equal(recruitBatchSeconds('militia', 10), 10, '显式 env 覆盖优先且不再缩放');
  } finally {
    delete process.env.RECRUIT_UNIT_SECONDS;
    setTimeScaleCache(1);
  }
});
