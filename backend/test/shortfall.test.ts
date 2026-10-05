// 失败响应缺口推导（v22，AISLG-43）的单元测试：api/src/handlers-city.ts 的
// insufficientResourcesDetail / insufficientPopulationDetail——纯函数，无数据库。

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeScaleCache } from '../common/src/time-scale';
import { insufficientPopulationDetail, insufficientResourcesDetail } from '../api/src/handlers-city';
import type { CitySnapshot } from '../api/src/views';

// 速率 / 增速含全局缩放（默认 50）：测试按未加速基准断言
setTimeScaleCache(1);

const SNAP = {
  cityId: 'c1', name: '主城', cityLevel: 1, x: 0, y: 0, truceUntil: null,
  levels: {
    farm: 1, lumber_mill: 0, quarry: 0, iron_mine: 0, house: 2, government: 1,
    barracks: 0, warehouse: 0, wall: 0,
  },
  resources: { gold: 100, wood: 50, food: 10, stone: 0, iron: 0 },
  population: 30,
  army: { porter: 0, militia: 0, scout: 0, pikeman: 0, swordsman: 0, archer: 0, cavalry: 0 },
  armyFoodUsePerHour: 0,
  queue: [], recruitQueue: [], marches: [], territory: [],
} as unknown as CitySnapshot;

test('insufficientResourcesDetail：只列缺口资源，ETA = 最大缺口 ÷ 净产量（含人口增速缩放的量级）', () => {
  const cost = { gold: 588, wood: 0, food: 100, stone: 0, iron: 0 };
  const detail = insufficientResourcesDetail(cost, SNAP);
  assert.deepEqual(detail.shortfall, { gold: 488, food: 90 });
  // 净产量：金 = 官府 Lv1 基准 100、粮 = 基础 100 + 农田 Lv1 120 = 220（scale=1 时）
  // ETA = max(ceil(488/100×3600), ceil(90/220×3600)) = max(17568, 1473)
  assert.equal(detail.retryAfterSeconds, 17568);
});

test('insufficientResourcesDetail：缺口资源净产量 ≤ 0 时 ETA 为 null', () => {
  const noFoodArmy = { ...SNAP, armyFoodUsePerHour: 1000 } as CitySnapshot; // 净粮 = 220 − 1000 < 0
  const detail = insufficientResourcesDetail({ gold: 0, wood: 0, food: 100, stone: 0, iron: 0 }, noFoodArmy);
  assert.deepEqual(detail.shortfall, { food: 90 });
  assert.equal(detail.retryAfterSeconds, null);
});

test('insufficientPopulationDetail：缺口 = 需求 − 当前，ETA 按增速（无民房为 0 → null）', () => {
  const noHouse = { ...SNAP, levels: { ...SNAP.levels, house: 0 } } as unknown as CitySnapshot;
  assert.deepEqual(insufficientPopulationDetail(80, noHouse), { shortfall: 50, retryAfterSeconds: null });
  // 民房 Lv2：增速 = 10×2×3 = 60/h（scale=1）→ ceil(50/60×3600) = 3000
  assert.deepEqual(insufficientPopulationDetail(80, SNAP), { shortfall: 50, retryAfterSeconds: 3000 });
});
