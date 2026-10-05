import test from 'node:test';
import assert from 'node:assert/strict';
import type { Resources } from '../common/src/protocol';
import {
  BASE_PRODUCTION_PER_HOUR,
  GOLD_CAP,
  RATE_PER_LEVEL,
  STORAGE_BASE,
  STORAGE_PER_BASE_RATE,
  accruePopulation,
  accrueProduction,
  emptyBuildingLevels,
  productionPerHour,
  storageCaps,
  type ProductionRemainders,
  type ProducedResource,
} from '../common/src/production';
import { populationGrowthPerHour, popCap } from '../common/src/rules';
import { setTimeScaleCache } from '../common/src/time-scale';

// 本文件断言未加速基准值（AISLG-38 全局缩放语义由 time-scale.test.ts 专测）
setTimeScaleCache(1);


const NO_REMS: ProductionRemainders = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
const NO_RESOURCES: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
/** 足够大的统一上限（不影响断言的钳制场景） */
const BIG_CAPS: Record<ProducedResource, number> = {
  gold: GOLD_CAP,
  food: 1_000_000_000,
  wood: 1_000_000_000,
  stone: 1_000_000_000,
  iron: 1_000_000_000,
};

test('productionPerHour：基础产量 + 等级 × 每级速率，按资源归集（含官府产金）', () => {
  // 一座 1 级农田：基础 100 + 1 × 120 = 220 粮/小时
  assert.deepEqual(productionPerHour({ farm: 1 }), { gold: 0, food: 220, wood: 100, stone: 100, iron: 100 });
  // 一座 1 级官府：100 金/小时（v19，金币无基础产量）
  assert.deepEqual(productionPerHour({ government: 1 }), { gold: 100, food: 100, wood: 100, stone: 100, iron: 100 });
  // 五种生产建筑各一座
  assert.deepEqual(
    productionPerHour({ farm: 1, lumber_mill: 1, quarry: 1, iron_mine: 1, government: 1 }),
    { gold: 100, food: 220, wood: 200, stone: 180, iron: 160 },
  );
  // 同一建筑按等级线性叠加；非生产建筑（民房/军营/仓库/城墙）不追加产出
  assert.deepEqual(productionPerHour({ farm: 3 }), { gold: 0, food: 460, wood: 100, stone: 100, iron: 100 });
  assert.deepEqual(productionPerHour({ house: 5, barracks: 5, warehouse: 5, wall: 5 }), {
    gold: 0,
    food: 100,
    wood: 100,
    stone: 100,
    iron: 100,
  });
});

test('productionPerHour：常量与公式自洽（每级速率为正整数）', () => {
  for (const key of Object.keys(RATE_PER_LEVEL) as Array<keyof typeof RATE_PER_LEVEL>) {
    assert.ok(Number.isInteger(RATE_PER_LEVEL[key]) && RATE_PER_LEVEL[key] > 0, `${key} 每级速率应为正整数`);
  }
});

test('productionPerHour：无建筑时四资源仍有基础产量（金币为 0）', () => {
  const base = { gold: 0, food: 100, wood: 100, stone: 100, iron: 100 };
  assert.deepEqual(productionPerHour(emptyBuildingLevels()), base);
  assert.deepEqual(productionPerHour({}), base);
  for (const key of Object.keys(BASE_PRODUCTION_PER_HOUR) as Array<keyof typeof BASE_PRODUCTION_PER_HOUR>) {
    assert.equal(BASE_PRODUCTION_PER_HOUR[key], 100, `${key} 基础产量参照旧源码为 100/h`);
  }
});

test('accrueProduction：整小时的产出与小时产量一致，余数归零（金币同理）', () => {
  const rates: Record<ProducedResource, number> = { gold: 10, food: 220, wood: 200, stone: 180, iron: 160 };
  const { gains, rems } = accrueProduction(rates, NO_REMS, 3_600_000, BIG_CAPS, NO_RESOURCES);
  assert.deepEqual(gains, rates);
  assert.deepEqual(rems, NO_REMS);
});

test('accrueProduction：不足整单位时记入微单位余数，不提前进账', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 120, wood: 0, stone: 0, iron: 0 }; // 120/h → 1 单位 = 30 秒
  const first = accrueProduction(rates, NO_REMS, 10_000, BIG_CAPS, NO_RESOURCES);
  assert.deepEqual(first.gains, { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 });
  assert.equal(first.rems.food, 333_333); // 120 × 1e6 × 10000 / 3.6e6 = 333333.3 微单位
  const second = accrueProduction(rates, first.rems, 20_000, BIG_CAPS, NO_RESOURCES);
  assert.deepEqual(second.gains, { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 });
  assert.equal(second.rems.food, 999_999); // 累计 50 秒仍差 1 微单位
  const third = accrueProduction(rates, second.rems, 20_000, BIG_CAPS, NO_RESOURCES);
  assert.deepEqual(third.gains, { gold: 0, food: 1, wood: 0, stone: 0, iron: 0 });
  assert.equal(third.rems.food, 666_665); // 累计 70 秒 = 2.33 单位，进账 1
});

test('accrueProduction：储量上限钳制产出增量，余数冻结（金币同样计入上限，v8）', () => {
  const rates: Record<ProducedResource, number> = { gold: 10, food: 120, wood: 0, stone: 0, iron: 0 }; // 粮 120/h，金 10/h
  const caps: Record<ProducedResource, number> = { gold: 25, food: 10, wood: 999, stone: 999, iron: 999 };
  // 当前粮 8，上限 10：整小时应产 120，只进账剩余空间 2
  const current: Resources = { gold: 20, wood: 0, food: 8, stone: 0, iron: 0 };
  const first = accrueProduction(rates, NO_REMS, 3_600_000, caps, current);
  assert.equal(first.gains.food, 2);
  assert.equal(first.rems.food, 0, '被钳制时余数冻结在原值');
  assert.equal(first.gains.gold, 5, '金币同样钳制到上限（20 + 10 → 25）');
  // 已达上限：产出为 0，余数继续冻结
  const atCap: Resources = { gold: 25, wood: 0, food: 10, stone: 0, iron: 0 };
  const second = accrueProduction(rates, NO_REMS, 3_600_000, caps, atCap);
  assert.equal(second.gains.food, 0);
  assert.equal(second.gains.gold, 0);
  assert.equal(second.rems.food, 0);
});

test('accrueProduction：整除场景下分次结算与一次结算完全一致', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 120, wood: 0, stone: 0, iron: 0 }; // 120/h：每 60 秒恰好 2 单位
  const once = accrueProduction(rates, NO_REMS, 600_000, BIG_CAPS, NO_RESOURCES);
  let rems: ProductionRemainders = NO_REMS;
  let food = 0;
  for (let i = 0; i < 10; i += 1) {
    const step = accrueProduction(rates, rems, 60_000, BIG_CAPS, NO_RESOURCES);
    rems = step.rems;
    food += step.gains.food;
  }
  assert.equal(food, once.gains.food);
  assert.deepEqual(rems, once.rems);
});

test('accrueProduction：任意频率分次结算不丢进度（误差小于每次 1 微单位）', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 240, wood: 0, stone: 0, iron: 60 };
  const totalMs = 123_456;
  const once = accrueProduction(rates, NO_REMS, totalMs, BIG_CAPS, NO_RESOURCES);
  const steps = 101; // 100 步 × 1234ms + 1 步 × 56ms
  let rems: ProductionRemainders = NO_REMS;
  const gained = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
  for (let i = 0; i < steps; i += 1) {
    const stepMs = i < steps - 1 ? 1234 : 56;
    const step = accrueProduction(rates, rems, stepMs, BIG_CAPS, NO_RESOURCES);
    rems = step.rems;
    for (const key of ['gold', 'food', 'wood', 'stone', 'iron'] as const) {
      gained[key] += step.gains[key];
    }
  }
  for (const key of ['gold', 'food', 'wood', 'stone', 'iron'] as const) {
    // 分次合计与一次结算至多相差 steps 微单位（每步截断 < 1 微单位）
    const onceTotal = once.gains[key] * 1_000_000 + once.rems[key];
    const pieceTotal = gained[key] * 1_000_000 + rems[key];
    assert.ok(
      onceTotal - pieceTotal >= 0 && onceTotal - pieceTotal < steps,
      `${key} 分次结算损失应在 ${steps} 微单位内（实际差 ${onceTotal - pieceTotal}）`,
    );
  }
});

test('accrueProduction：elapsedMs 为 0 或负数时不产生变化', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 120, wood: 0, stone: 0, iron: 0 };
  assert.deepEqual(accrueProduction(rates, NO_REMS, 0, BIG_CAPS, NO_RESOURCES).gains, {
    gold: 0,
    food: 0,
    wood: 0,
    stone: 0,
    iron: 0,
  });
  assert.deepEqual(accrueProduction(rates, NO_REMS, -1000, BIG_CAPS, NO_RESOURCES).gains, {
    gold: 0,
    food: 0,
    wood: 0,
    stone: 0,
    iron: 0,
  });
});

test('accrueProduction：耗粮接入后按净产量结算，其余资源不受影响（v14）', () => {
  const rates: Record<ProducedResource, number> = { gold: 10, food: 220, wood: 200, stone: 180, iron: 160 };
  // 全军耗粮 70/h：净粮 +150/h，其余资源照旧
  const { gains, rems } = accrueProduction(rates, NO_REMS, 3_600_000, BIG_CAPS, NO_RESOURCES, 70);
  assert.equal(gains.food, 150);
  assert.deepEqual(rems, NO_REMS);
  assert.equal(gains.gold, 10);
  assert.equal(gains.wood, 200);
  assert.equal(gains.stone, 180);
  assert.equal(gains.iron, 160);
});

test('accrueProduction：净产量为负时扣减存量，余数记账不失进度（v14）', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 100, wood: 0, stone: 0, iron: 0 };
  const current: Resources = { gold: 0, wood: 0, food: 1_000, stone: 0, iron: 0 };
  // 产量 100/h − 耗粮 130/h = 净 −30/h：整小时扣 30
  const hour = accrueProduction(rates, NO_REMS, 3_600_000, BIG_CAPS, current, 130);
  assert.equal(hour.gains.food, -30);
  assert.equal(hour.rems.food, 0);
  // 半小时：微单位 −15e6，floor 为 −15 整，余数 0
  const half = accrueProduction(rates, NO_REMS, 1_800_000, BIG_CAPS, current, 130);
  assert.equal(half.gains.food, -15);
  // 不足 1 单位的净耗（−100/h × 18s = −0.5）：floor 提前扣 1、余 +0.5 记账，
  // 下一步正负相抵——分次结算既不丢进度也不放大
  const step1 = accrueProduction(rates, NO_REMS, 18_000, BIG_CAPS, current, 200);
  assert.equal(step1.gains.food, -1);
  assert.equal(step1.rems.food, 500_000);
  const step2 = accrueProduction(rates, step1.rems, 18_000, BIG_CAPS, current, 200);
  assert.equal(step2.gains.food, 0);
  assert.equal(step2.rems.food, 0);
});

test('accrueProduction：净耗超过存量时粮食钳 0，不记负债、部队不解散（v14）', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 100, wood: 0, stone: 0, iron: 0 };
  const current: Resources = { gold: 0, wood: 0, food: 5, stone: 0, iron: 0 };
  // 净 −30/h，1 小时应扣 30，存量 5 → 只扣到 0
  const drained = accrueProduction(rates, NO_REMS, 3_600_000, BIG_CAPS, current, 130);
  assert.equal(drained.gains.food, -5);
  assert.equal(drained.rems.food, 0, '钳 0 后余数归零，缺口不转为负债');
  // 已断粮后继续结算：保持 0，不产生负数
  const empty: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  const still = accrueProduction(rates, NO_REMS, 3_600_000, BIG_CAPS, empty, 130);
  assert.equal(still.gains.food, 0);
  assert.equal(still.rems.food, 0);
  // 断粮期间不积累欠账：耗粮降为 0 后产量照常恢复
  const recover = accrueProduction(rates, NO_REMS, 3_600_000, BIG_CAPS, empty, 0);
  assert.equal(recover.gains.food, 100);
});

test('accrueProduction：净增仍受储量上限钳制，净耗不受上限限制（v14）', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 200, wood: 0, stone: 0, iron: 0 };
  const caps: Record<ProducedResource, number> = { gold: 999, food: 50, wood: 999, stone: 999, iron: 999 };
  // 净 +130/h（耗 70）、存量 40、上限 50 → 只进账剩余空间 10，余数冻结
  const nearCap: Resources = { gold: 0, wood: 0, food: 40, stone: 0, iron: 0 };
  const grow = accrueProduction(rates, NO_REMS, 3_600_000, caps, nearCap, 70);
  assert.equal(grow.gains.food, 10);
  assert.equal(grow.rems.food, 0);
  // 超限存量（已有超限不直接扣减是产量规则）遇耗粮照常被扣：净 −30/h 从 500 扣到 470
  const overCap: Resources = { gold: 0, wood: 0, food: 500, stone: 0, iron: 0 };
  const drain = accrueProduction(rates, NO_REMS, 3_600_000, caps, overCap, 230);
  assert.equal(drain.gains.food, -30);
  assert.equal(drain.rems.food, 0);
});

test('accrueProduction：耗粮下任意频率分次结算不丢进度（净速率为负）', () => {
  const rates: Record<ProducedResource, number> = { gold: 0, food: 240, wood: 0, stone: 0, iron: 60 };
  // 存量充裕（不触发钳 0），检验纯负速率的分次记账
  const stock: Resources = { gold: 0, wood: 0, food: 10_000, stone: 0, iron: 0 };
  const totalMs = 123_456;
  const once = accrueProduction(rates, NO_REMS, totalMs, BIG_CAPS, stock, 400); // 净粮 −160/h
  const steps = 101;
  let rems: ProductionRemainders = NO_REMS;
  const gained = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
  for (let i = 0; i < steps; i += 1) {
    const stepMs = i < steps - 1 ? 1234 : 56;
    const step = accrueProduction(rates, rems, stepMs, BIG_CAPS, stock, 400);
    rems = step.rems;
    for (const key of ['gold', 'food', 'wood', 'stone', 'iron'] as const) {
      gained[key] += step.gains[key];
    }
  }
  for (const key of ['gold', 'food', 'wood', 'stone', 'iron'] as const) {
    const onceTotal = once.gains[key] * 1_000_000 + once.rems[key];
    const pieceTotal = gained[key] * 1_000_000 + rems[key];
    assert.ok(
      Math.abs(onceTotal - pieceTotal) < steps,
      `${key} 分次结算误差应在 ${steps} 微单位内（实际差 ${onceTotal - pieceTotal}）`,
    );
  }
  // 净耗为负（240 − 400 = −160/h）：一次结算 123_456ms ≈ −5.49 粮（floor 进位 −6、余数记账 513,066）
  assert.equal(once.gains.food, -6);
  assert.equal(once.rems.food, 513_066);
});

test('accruePopulation：线性增长到上限为止，微单位余数不丢进度', () => {
  // v19：民房 Lv1 增长 = 10 × 1 × 2 = 20/h
  assert.deepEqual(accruePopulation(0, 0, populationGrowthPerHour(1), popCap(1), 3_600_000), {
    current: 20,
    rem: 0,
  });
  // 不足 1 人时记入余数
  const partial = accruePopulation(0, 0, populationGrowthPerHour(1), popCap(1), 60_000);
  assert.equal(partial.current, 0);
  assert.equal(partial.rem, 333_333); // 20 × 1e6 × 60000 / 3.6e6
  // 增长不越过上限：current 195、cap 200、整小时应 +20 → 只到 200
  const toCap = accruePopulation(195, 0, populationGrowthPerHour(1), 200, 3_600_000);
  assert.deepEqual(toCap, { current: 200, rem: 0 });
  // 已达上限后不再增长（余数冻结）
  assert.deepEqual(accruePopulation(200, 123_456, populationGrowthPerHour(1), 200, 3_600_000), {
    current: 200,
    rem: 123_456,
  });
  // 防御性：人口超过上限时停止增长（当前规则下民房等级只增不减，不应出现）
  const overCap = accruePopulation(250, 0, populationGrowthPerHour(1), 200, 3_600_000);
  assert.equal(overCap.current, 250);
});

test('popCap：50 + 100 × 民房等级 × (等级 + 1)，无民房即基线 50（v19，AISLG-22）', () => {
  assert.equal(popCap(0), 50);
  assert.equal(popCap(1), 250);
  assert.equal(popCap(2), 650);
  assert.equal(popCap(3), 1250);
  assert.equal(popCap(-1), 50, '负等级按 0 处理');
});

test('populationGrowthPerHour：10 × 民房等级 × (等级 + 1)，无民房为 0（v19，AISLG-19）', () => {
  assert.equal(populationGrowthPerHour(0), 0);
  assert.equal(populationGrowthPerHour(1), 20);
  assert.equal(populationGrowthPerHour(2), 60);
  assert.equal(populationGrowthPerHour(10), 1100);
  assert.equal(populationGrowthPerHour(-3), 0, '负等级按 0 处理');
});

test('storageCaps：四资源 = 10000 + 基础小时产量 × 100，金币固定 100 万（确认规则）', () => {
  // 无生产建筑：四资源都是基础值
  assert.deepEqual(storageCaps(emptyBuildingLevels()), {
    gold: GOLD_CAP,
    food: STORAGE_BASE,
    wood: STORAGE_BASE,
    stone: STORAGE_BASE,
    iron: STORAGE_BASE,
  });
  // 农田 Lv1（基础产量 120/h）→ 粮上限 22000；伐木场 Lv2（200/h）→ 木上限 30000
  assert.deepEqual(storageCaps({ ...emptyBuildingLevels(), farm: 1, lumber_mill: 2 }), {
    gold: GOLD_CAP,
    food: STORAGE_BASE + 120 * STORAGE_PER_BASE_RATE,
    wood: STORAGE_BASE + 200 * STORAGE_PER_BASE_RATE,
    stone: STORAGE_BASE,
    iron: STORAGE_BASE,
  });
  // 官府等级不影响金币上限；仓库不改变任何储量上限
  const withGovWh = storageCaps({ ...emptyBuildingLevels(), government: 5, warehouse: 5 });
  assert.equal(withGovWh.gold, GOLD_CAP);
  assert.equal(withGovWh.food, STORAGE_BASE);
});

// ---- v22（AISLG-41）：储量上限随全局缩放（填满时长恢复基准） ----

test('storageCaps × timeScale：上限与产出同幅缩放，填满时长恒为基准 100 小时', () => {
  const levels = emptyBuildingLevels();
  const caps1 = storageCaps(levels);
  assert.deepEqual(caps1, { gold: GOLD_CAP, food: 10_000, wood: 10_000, stone: 10_000, iron: 10_000 });
  try {
    setTimeScaleCache(50);
    const caps50 = storageCaps(levels);
    assert.equal(caps50.gold, GOLD_CAP * 50, '金币上限同幅缩放');
    assert.equal(caps50.food, 500_000);
    // 填满时长 = cap ÷ production：无建筑时 10000×50 ÷ (100×50) = 100 小时（基准不变）
    const rates = productionPerHour(levels);
    assert.equal(caps50.food / rates.food, 100);
  } finally {
    setTimeScaleCache(1);
  }
});
