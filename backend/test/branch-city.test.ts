// 城池等级与分城资格规则（v24，AISLG-58）

import assert from 'node:assert/strict';
import test from 'node:test';
import { branchCityLimit, checkOccupyNpcCity, cityLevelOf } from '../common/src/branch-city';

test('分城上限 = floor(主城官府等级 ÷ 3)：3 级 1 个、6 级 2 个、9 级 3 个', () => {
  assert.deepEqual([0, 1, 2, 3, 5, 6, 8, 9, 10].map(branchCityLimit), [0, 0, 0, 1, 1, 2, 2, 3, 3]);
});

test('城池等级 = 官府等级（未建官府为 0）', () => {
  assert.equal(cityLevelOf(0), 0);
  assert.equal(cityLevelOf(7), 7);
});

test('占领 NPC 城资格：官府门槛 → 分城名额 → 目标等级，按此优先级返回拒绝原因', () => {
  const ok = { mainGovernment: 3, fromGovernment: 3, branchCount: 0, targetLevel: 3 };
  assert.equal(checkOccupyNpcCity(ok), null);
  assert.equal(checkOccupyNpcCity({ ...ok, mainGovernment: 2, fromGovernment: 2 }), 'GOVERNMENT_TOO_LOW');
  assert.equal(checkOccupyNpcCity({ ...ok, branchCount: 1 }), 'BRANCH_LIMIT', '官府 3 级只有 1 个名额');
  assert.equal(checkOccupyNpcCity({ ...ok, mainGovernment: 6, branchCount: 1 }), null, '官府 6 级有第 2 个名额');
  assert.equal(checkOccupyNpcCity({ ...ok, targetLevel: 4 }), 'TARGET_LEVEL_TOO_HIGH');
  // 门槛判主城官府，目标等级判出发城官府：官府 6 的主城派官府 2 的分城去打 Lv3 城被拒
  assert.equal(checkOccupyNpcCity({ mainGovernment: 6, fromGovernment: 2, branchCount: 1, targetLevel: 3 }), 'TARGET_LEVEL_TOO_HIGH');
  // 多重不满足时官府门槛优先于名额
  assert.equal(checkOccupyNpcCity({ mainGovernment: 2, fromGovernment: 2, branchCount: 5, targetLevel: 9 }), 'GOVERNMENT_TOO_LOW');
});
