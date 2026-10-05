// 自有城池间运输（v26，AISLG-79）的货物规则与 MARCH 参数校验

import assert from 'node:assert/strict';
import test from 'node:test';
import { cargoOverCapacity, cargoTotal, parseCargo, readCargo } from '../common/src/transport';
import { readMarchParams } from '../api/src/march-target';

test('parseCargo：缺省项补 0，非负整数且总量 ≥ 1 才合法', () => {
  assert.deepEqual(parseCargo({ food: 800, wood: 300 }), { gold: 0, wood: 300, food: 800, stone: 0, iron: 0 });
  assert.equal(parseCargo({}), null, '总量为 0');
  assert.equal(parseCargo({ food: 0 }), null);
  assert.equal(parseCargo({ food: -1 }), null);
  assert.equal(parseCargo({ food: 1.5 }), null);
  assert.equal(parseCargo({ food: '5' }), null);
  assert.equal(parseCargo({ silver: 5 }), null, '未知键');
  assert.equal(parseCargo(null), null);
  assert.equal(parseCargo([1]), null);
});

test('readCargo：库中 jsonb → 完整货物，空 / 全 0 为 null', () => {
  assert.equal(readCargo(null), null);
  assert.equal(readCargo({ gold: 0 }), null);
  assert.deepEqual(readCargo({ iron: 7 }), { gold: 0, wood: 0, food: 0, stone: 0, iron: 7 });
});

test('负重校验：Σ 数量 × 单兵负重，民夫 500 / 义兵 60', () => {
  const cargo = { gold: 100, wood: 0, food: 400, stone: 0, iron: 0 };
  assert.equal(cargoTotal(cargo), 500);
  assert.equal(cargoOverCapacity(cargo, { porter: 1 }), false, '1 个民夫恰好 500');
  assert.equal(cargoOverCapacity({ ...cargo, gold: 101 }, { porter: 1 }), true);
  assert.equal(cargoOverCapacity(cargo, { militia: 8 }), true, '8 义兵只有 480');
});

test('readMarchParams：transport 必带合法 cargo，其他任务带 cargo 视为参数错误', () => {
  const base = { x: 3, y: 4, troops: { porter: 2 } };
  const ok = readMarchParams({ ...base, task: 'transport', cargo: { food: 100 } });
  assert.equal(ok?.task, 'transport');
  assert.deepEqual(ok?.cargo, { gold: 0, wood: 0, food: 100, stone: 0, iron: 0 });
  assert.equal(readMarchParams({ ...base, task: 'transport' }), null, '缺 cargo');
  assert.equal(readMarchParams({ ...base, task: 'transport', cargo: { food: 0 } }), null, '全 0');
  assert.equal(readMarchParams({ ...base, task: 'plunder', cargo: { food: 1 } }), null, '掠夺不接受 cargo');
  assert.equal(readMarchParams({ ...base, cargo: { food: 1 } }), null, '缺省任务不接受 cargo');
  const plain = readMarchParams(base);
  assert.equal(plain?.task, 'plunder');
  assert.equal(plain?.cargo, null);
});
