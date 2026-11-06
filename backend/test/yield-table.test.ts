// 产出图层（AISLG-216）的数值口径测试：前端镜像的野地占领加成表必须与后端 TERRAIN_INFO 完全一致，
// 另外钉住产量缩写、储量档位与「自己的地含驻军采集」的取值。
// 运行：cd backend && npx tsx --test test/yield-table.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import { TERRAIN_INFO, wildernessBonusRate } from '../common/src/world';
import type { TerrainKind } from '../common/src/protocol';
import type { TerrainResource, TerritoryView, TileView } from '../../frontend/src/api/protocol';
import { TERRAIN_YIELD, formatYieldRate, reserveTier, wildernessBonusRate as frontendBonusRate, yieldOfTile } from '../../frontend/src/components/map/yieldTable';

/** 毫秒基准时刻：所有用例用相对时间，避免依赖真实时钟 */
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (msFromStart: number): string => new Date(T0 + msFromStart).toISOString();

function tileBase(overrides: Partial<TileView>): TileView {
  return {
    x: 0,
    y: 0,
    terrain: 'plain',
    kind: 'wilderness',
    level: 1,
    owner: null,
    garrison: 0,
    npcStockTier: null,
    famous: null,
    camp: null,
    protection: null,
    durability: null,
    wildFamous: false,
    relic: null,
    heroSite: null,
    reserve: null,
    facility: null,
    ...overrides,
  };
}

test('产出表与后端 TERRAIN_INFO 完全一致（含每级加成与 Lv0～10 的产量）', () => {
  for (const terrain of Object.keys(TERRAIN_INFO) as TerrainKind[]) {
    assert.equal(TERRAIN_YIELD[terrain].resource, TERRAIN_INFO[terrain].resource);
    assert.equal(TERRAIN_YIELD[terrain].bonusBase, TERRAIN_INFO[terrain].bonusBase);
    assert.equal(TERRAIN_YIELD[terrain].bonusPerLevel, TERRAIN_INFO[terrain].bonusPerLevel);
    for (let level = 0; level <= 10; level += 1) {
      assert.equal(frontendBonusRate(terrain, level), wildernessBonusRate(terrain, level));
    }
  }
  // 需求文档里的样本值
  assert.equal(frontendBonusRate('plain', 1), 80);
  assert.equal(frontendBonusRate('forest', 5), 380);
  assert.equal(frontendBonusRate('forest', 10), 730);
  assert.equal(frontendBonusRate('lake', 10), 840);
  assert.equal(frontendBonusRate('marsh', 10), 420);
});

test('产量缩写：不足 1000 原样，1000 起一位小数 k', () => {
  assert.equal(formatYieldRate(0), '0');
  assert.equal(formatYieldRate(380), '380');
  assert.equal(formatYieldRate(575), '575');
  assert.equal(formatYieldRate(1000), '1.0k');
  assert.equal(formatYieldRate(1200), '1.2k');
  assert.equal(formatYieldRate(12_345), '12.3k');
});

test('储量档位：> 60% 充足、20%～60% 一般、< 20% 枯竭；只有档位时用后端给的', () => {
  assert.equal(reserveTier(0.61, null), 'ample');
  assert.equal(reserveTier(0.6, null), 'normal');
  assert.equal(reserveTier(0.2, null), 'normal');
  assert.equal(reserveTier(0.19, null), 'depleted');
  assert.equal(reserveTier(null, 'depleted'), 'depleted');
  assert.equal(reserveTier(null, null), null);
});

test('格子产出：野地给数字、自己的地含驻军采集、营地与城池不给', () => {
  const unowned = yieldOfTile(tileBase({ terrain: 'forest', level: 5 }), undefined, 'me');
  assert.ok(unowned);
  assert.equal(unowned.resource, 'wood');
  assert.equal(unowned.rate, 380);
  assert.equal(unowned.own, false);

  const ownTile: TerritoryView = {
    x: 1,
    y: 1,
    terrain: 'forest',
    level: 5,
    resource: 'wood',
    bonusRate: 380,
    gatherRate: 120,
    reserve: { tier: 'ample', current: 800, cap: 1000, eta: { kind: 'empty', at: iso(3_600_000) } },
    garrison: 60,
    clusterSize: 3,
    clusterBonusPercent: 10,
    facility: null,
  };
  const mine = yieldOfTile(tileBase({ x: 1, y: 1, terrain: 'forest', level: 5, owner: { accountId: 'me', username: 'me', cityId: 'c1', cityName: '城', nobility: 0, nobilityName: '平民', ally: false, relation: 'self', canAssist: false }, reserve: ownTile.reserve }), ownTile, 'me');
  assert.ok(mine);
  assert.equal(mine.rate, 500);
  assert.equal(mine.own, true);
  assert.equal(mine.reservePct, 0.8);
  assert.equal(mine.tier, 'ample');

  // 黄巾营地格不能占领 → 不显示产出；NPC 城与玩家城不算野地
  assert.equal(yieldOfTile(tileBase({ camp: { tier: 'small', label: '营地', level: 3, garrisonTotal: { min: 1, max: 2 }, nextGrowAt: null } }), undefined, 'me'), null);
  assert.equal(yieldOfTile(tileBase({ kind: 'npc_city' }), undefined, 'me'), null);
  assert.equal(yieldOfTile(tileBase({ kind: 'city' }), undefined, 'me'), null);
});

test('资源映射：八种地形对应五种资源，没有遗漏', () => {
  const expected: Record<TerrainKind, TerrainResource> = {
    plain: 'food',
    grass: 'food',
    forest: 'wood',
    hill: 'iron',
    desert: 'stone',
    marsh: 'food',
    lake: 'food',
    gold_mine: 'gold',
  };
  for (const terrain of Object.keys(expected) as TerrainKind[]) {
    assert.equal(TERRAIN_YIELD[terrain].resource, expected[terrain]);
  }
});
