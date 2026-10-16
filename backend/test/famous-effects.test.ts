// 名城独有效果（v62，AISLG-166）：8 座名城各一项效果，只对占领该城的一方生效，数值口径与消费方一致

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FAMOUS_EFFECTS,
  famousEffectOf,
  famousEffectView,
  famousMarchPercent,
  famousTerritoryMultiplier,
  famousTowerPercent,
  famousWallExtraPercent,
  famousWarehousePercent,
} from '../common/src/famous-effects';
import { FAMOUS_CITY_NAMES } from '../common/src/famous-city';
import { towerStats, TOWER_DAMAGE_PER_LEVEL } from '../common/src/building-effects';
import { wallDefensePercent } from '../common/src/battle';
import { warehouseProtectionPerResource, cityPlunderPool } from '../common/src/plunder';
import { pvpPlunderPool } from '../common/src/protection';
import { marchTravelSeconds, territoryBonusRates, type TerritoryRow } from '../common/src/world';
import { settleTerritoryReserves, territoryDisplayRates } from '../common/src/wilderness-reserve';

const tile = (overrides: Partial<TerritoryRow>): TerritoryRow => ({
  x: 0, y: 0, terrain: 'plain', level: 5, garrison: 0, famous_name: null, ...overrides,
});

test('八座名城各有一项效果，且名字与名城表一致', () => {
  assert.deepEqual([...FAMOUS_CITY_NAMES].sort(), Object.keys(FAMOUS_EFFECTS).sort());
  assert.deepEqual(FAMOUS_EFFECTS['洛阳'], { kind: 'wall', percent: 5 });
  assert.deepEqual(FAMOUS_EFFECTS['长安'], { kind: 'tower', percent: 20 });
  assert.deepEqual(FAMOUS_EFFECTS['许昌'], { kind: 'march', percent: 20 });
  assert.deepEqual(FAMOUS_EFFECTS['襄阳'], { kind: 'warehouse', percent: 50 });
});

test('非名城或未知名字没有效果，各查询都为 0 / null', () => {
  for (const name of [null, undefined, '', '不存在的城', 'constructor']) {
    assert.equal(famousEffectOf(name), null);
    assert.equal(famousEffectView(name), null);
    assert.equal(famousWallExtraPercent(name), 0);
    assert.equal(famousTowerPercent(name), 0);
    assert.equal(famousWarehousePercent(name), 0);
    assert.equal(famousMarchPercent(name), 0);
    assert.equal(famousTerritoryMultiplier(name, 'food'), 1);
  }
});

test('效果视图带种类、数值与野地资源（非野地为 null）', () => {
  assert.deepEqual(famousEffectView('官渡'), { kind: 'territory', percent: 25, resources: ['food'] });
  assert.deepEqual(famousEffectView('成都'), { kind: 'territory', percent: 25, resources: ['iron', 'stone'] });
  assert.deepEqual(famousEffectView('洛阳'), { kind: 'wall', percent: 5, resources: null });
});

test('洛阳：城墙额外减伤 +5 个百分点，叠在城防科技之上（只对洛阳生效）', () => {
  assert.equal(famousWallExtraPercent('洛阳'), 5);
  assert.equal(famousWallExtraPercent('长安'), 0);
  const base = wallDefensePercent(10, 0);
  assert.equal(wallDefensePercent(10, 0 + famousWallExtraPercent('洛阳')), base + 5);
});

test('长安：箭塔伤害 +20%，射程不变；非长安与未建箭塔不受影响', () => {
  const level = 3;
  const plain = towerStats(level);
  const boosted = towerStats(level, famousTowerPercent('长安'));
  assert.ok(plain && boosted);
  assert.equal(plain.damage, TOWER_DAMAGE_PER_LEVEL * level);
  assert.equal(boosted.damage, Math.round(TOWER_DAMAGE_PER_LEVEL * level * 1.2));
  assert.equal(boosted.range, plain.range);
  assert.equal(towerStats(0, famousTowerPercent('长安')), null);
  assert.equal(towerStats(level, famousTowerPercent('洛阳'))?.damage, plain.damage);
});

test('襄阳：仓库保护额 +50%，只放大保护额，不改储量；金币不受保护', () => {
  const base = warehouseProtectionPerResource(4);
  assert.equal(base, 4000);
  assert.equal(warehouseProtectionPerResource(4, famousWarehousePercent('襄阳')), 6000);
  const resources = { gold: 100000, food: 9000, wood: 9000, stone: 9000, iron: 9000 };
  const plain = cityPlunderPool(resources, 4);
  const boosted = cityPlunderPool(resources, 4, famousWarehousePercent('襄阳'));
  assert.equal(boosted.food, 9000 - 6000);
  assert.ok(boosted.food < plain.food);
  assert.equal(boosted.gold, plain.gold, 'NPC 袭城的金币口径不因襄阳改变');
  const pvpPlain = pvpPlunderPool(resources, 4, 3, 3);
  const pvpBoosted = pvpPlunderPool(resources, 4, 3, 3, famousWarehousePercent('襄阳'));
  assert.ok(pvpBoosted.food < pvpPlain.food);
});

test('许昌：调兵 / 运输行军速度 +20%，作为速度百分数加算进行军时长', () => {
  const troops = { militia: 10 };
  const plain = marchTravelSeconds(0, 0, 20, 0, troops, 0);
  const boosted = marchTravelSeconds(0, 0, 20, 0, troops, famousMarchPercent('许昌'));
  assert.ok(boosted < plain);
  assert.equal(boosted, marchTravelSeconds(0, 0, 20, 0, troops, 20));
  assert.equal(famousMarchPercent('洛阳'), 0);
});

test('官渡 / 成都 / 建业 / 邺城：只放大对应资源的野地产出，占领加成与采集口径一致', () => {
  assert.equal(famousTerritoryMultiplier('官渡', 'food'), 1.25);
  assert.equal(famousTerritoryMultiplier('官渡', 'wood'), 1);
  assert.equal(famousTerritoryMultiplier('成都', 'iron'), 1.25);
  assert.equal(famousTerritoryMultiplier('成都', 'stone'), 1.25);
  assert.equal(famousTerritoryMultiplier('成都', 'food'), 1);
  assert.equal(famousTerritoryMultiplier('建业', 'wood'), 1.25);
  assert.equal(famousTerritoryMultiplier('邺城', 'gold'), 1.25);

  const plain = territoryBonusRates([tile({ terrain: 'plain' })]);
  const boosted = territoryBonusRates([tile({ terrain: 'plain', famous_name: '官渡' })]);
  assert.ok((boosted.food ?? 0) > (plain.food ?? 0));
  assert.equal(boosted.food, Math.round((plain.food ?? 0) * 1.25));
  const hillBoosted = territoryBonusRates([tile({ terrain: 'hill', famous_name: '官渡' })]);
  assert.equal(hillBoosted.iron, territoryBonusRates([tile({ terrain: 'hill' })]).iron, '官渡不加铁');
});

test('驻军采集与显示速率同享名城加成，且不额外扣储量', () => {
  const from = new Date('2026-10-01T00:00:00Z');
  const to = new Date('2026-10-01T01:00:00Z');
  const plain = settleTerritoryReserves([tile({ terrain: 'forest', garrison: 100, reserve: 1000000, reserve_at: from })], from, to);
  const boosted = settleTerritoryReserves(
    [tile({ terrain: 'forest', garrison: 100, reserve: 1000000, reserve_at: from, famous_name: '建业' })],
    from,
    to,
  );
  assert.ok(boosted.gather.wood && plain.gather.wood);
  assert.ok(Math.abs(boosted.gather.wood - plain.gather.wood * 1.25) < 1e-6);
  assert.equal(boosted.updates[0].reserve, plain.updates[0].reserve, '加成只放大产出，储量扣减不变');

  const shown = territoryDisplayRates([tile({ terrain: 'forest', garrison: 100, reserve: 1000000, famous_name: '建业' })]);
  const shownPlain = territoryDisplayRates([tile({ terrain: 'forest', garrison: 100, reserve: 1000000 })]);
  assert.ok((shownPlain.wood ?? 0) > 0);
  assert.equal(shown.wood, Math.round((shownPlain.wood ?? 0) * 1.25));
});
