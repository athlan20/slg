// 世界地图与野地规则（common/src/world.ts）的单元测试（v12 起；v13 起战斗、
// 兵种与原住守军编成的断言在 battle.test.ts）。
// 数值断言与占位常量同步：调整占位数值时同步本文件。

import test from 'node:test';
import assert from 'node:assert/strict';
import { TERRAIN_KINDS } from '../common/src/protocol';
import {
  LOOT_GOLD_PER_LEVEL,
  LOOT_RESOURCE_PER_LEVEL,
  MAX_MAP_WINDOW,
  NPC_CITY_COUNT,
  TERRAIN_INFO,
  WILDERNESS_LEVEL_MAX,
  WORLD_SIZE,
  WORLD_SEED,
  clampMapWindow,
  generateWorldTiles,
  inWorld,
  marchTravelSeconds,
  territoryRates,
  type TerritoryRow,
  wildernessBonusRate,
  wildernessGatherRate,
  wildernessLoot,
  type WorldTileSeed,
} from '../common/src/world';
import { productionPerHour } from '../common/src/production';

import { setTimeScaleCache } from '../common/src/time-scale';

// 本文件断言未加速基准值（AISLG-38 全局缩放语义由 time-scale.test.ts 专测）
setTimeScaleCache(1);

test('地形清单八种（v19 含金矿），每种映射到一种加成资源且速率为正', () => {
  assert.equal(TERRAIN_KINDS.length, 8);
  assert.equal(TERRAIN_INFO.gold_mine.resource, 'gold', '金矿加成金币');
  for (const terrain of TERRAIN_KINDS) {
    const info = TERRAIN_INFO[terrain];
    assert.ok(['food', 'wood', 'stone', 'iron', 'gold'].includes(info.resource), `${terrain} 加成资源`);
    assert.ok(info.bonusPerLevel > 0, `${terrain} 每级加成为正`);
    assert.ok(info.weight > 0, `${terrain} 生成权重为正`);
    assert.ok(info.label.length > 0, `${terrain} 有中文名`);
  }
});

/** 世界内容的滚动哈希（1000×1000 = 100 万格，deepEqual 全量比对代价过高，用哈希比对） */
function worldHash(tiles: WorldTileSeed[]): number {
  let h = 2166136261;
  for (const t of tiles) {
    h = Math.imul(h ^ t.x, 16777619);
    h = Math.imul(h ^ t.y, 16777619);
    h = Math.imul(h ^ t.level, 16777619);
    h = Math.imul(h ^ t.terrain.length, 16777619);
    h = Math.imul(h ^ t.kind.length, 16777619);
    h = Math.imul(h ^ (t.npc ? t.npc.level : -1), 16777619);
  }
  return h >>> 0;
}

test('世界生成确定性：同种子两次生成完全一致，规模与 NPC 城池数量符合常量', () => {
  let tiles = generateWorldTiles();
  assert.equal(tiles.length, WORLD_SIZE * WORLD_SIZE);
  const hashFirst = worldHash(tiles);

  const npcCities = tiles.filter((tile) => tile.kind === 'npc_city');
  assert.equal(npcCities.length, NPC_CITY_COUNT, 'NPC 城池为有限存量');
  for (const city of npcCities) {
    assert.ok(city.npc, 'NPC 城池带驻防与库存快照');
    assert.ok(city.level >= 1 && city.level <= 3, 'NPC 城池等级 1..3');
    assert.equal(city.npc?.level, city.level);
  }
  // 野地逐格校验（只对违规格断言，避免百万次 assert 开销）
  let wildernessCount = 0;
  for (const tile of tiles) {
    if (tile.kind !== 'wilderness') {
      continue;
    }
    wildernessCount += 1;
    if (tile.level < 1 || tile.level > WILDERNESS_LEVEL_MAX || tile.npc !== null ||
        !(TERRAIN_KINDS as readonly string[]).includes(tile.terrain)) {
      assert.fail(`野地字段非法：(${tile.x},${tile.y}) ${JSON.stringify(tile)}`);
    }
  }
  assert.ok(wildernessCount > 0);
  // 出生区保护：中心 5 格内不放 NPC 城池（首座主城在中心附近，其余分散落位）
  const center = Math.floor(WORLD_SIZE / 2);
  for (const city of npcCities) {
    if (Math.max(Math.abs(city.x - center), Math.abs(city.y - center)) < 5) {
      assert.fail(`NPC 城池侵入出生区：(${city.x},${city.y})`);
    }
  }

  // 同种子再生成一次：哈希一致 + 抽查若干格深度相等（生成可复现）
  const spots = [0, 7, 12345, 500000, 999999, tiles.length - 1];
  const firstSpots = spots.map((i) => tiles[i]);
  tiles = generateWorldTiles();
  assert.equal(worldHash(tiles), hashFirst, 'WORLD_SEED 固定，生成可复现（哈希一致）');
  spots.forEach((i, n) => {
    assert.deepEqual(tiles[i], firstSpots[n], `抽查第 ${i} 格一致`);
  });
});

test('野地收益与战利品按等级放大（v21：基线 + 线性，Lv1 保底）', () => {
  assert.equal(wildernessBonusRate('forest', 3), TERRAIN_INFO.forest.bonusBase + 3 * TERRAIN_INFO.forest.bonusPerLevel);
  assert.equal(wildernessBonusRate('forest', 0), TERRAIN_INFO.forest.bonusBase, 'Lv0 加成 = 基线（保底不减档）');
  assert.equal(wildernessBonusRate('forest', 1), TERRAIN_INFO.forest.bonusBase + TERRAIN_INFO.forest.bonusPerLevel);
  // 采集向下取整：等级 3 × 18 兵 × 1 = 54（v19 采集系数 ×10）
  assert.equal(wildernessGatherRate('forest', 3, 18), 54);
  assert.equal(wildernessGatherRate('forest', 3, 0), 0);

  const loot = wildernessLoot('forest', 4);
  assert.equal(loot.gold, 4 * LOOT_GOLD_PER_LEVEL);
  assert.equal(loot.wood, 4 * LOOT_RESOURCE_PER_LEVEL);
  assert.equal(loot.food, 0);
  assert.equal(loot.stone, 0);
  assert.equal(loot.iron, 0);
});

test('行军时长 = Chebyshev 距离 × 每格秒数 ÷ 编队最慢兵种速度（v13；最少 1 格、向上取整）', () => {
  const perTile = marchTravelSeconds(0, 0, 1, 0) / 1;
  assert.equal(marchTravelSeconds(10, 10, 10, 10), perTile, '同格按 1 格计');
  assert.equal(marchTravelSeconds(0, 0, 3, 4), 4 * perTile);
  assert.equal(marchTravelSeconds(0, 0, 4, 3), 4 * perTile);
  assert.equal(marchTravelSeconds(5, 5, 0, 0), 5 * perTile);
  // 编队速度：纯斥候 ×2（时长减半向上取整）、混合编队按最慢者
  assert.equal(marchTravelSeconds(0, 0, 10, 0, { scout: 5 }), Math.ceil((10 * perTile) / 2));
  assert.equal(marchTravelSeconds(0, 0, 10, 0, { scout: 5, porter: 1 }), 10 * perTile, '混编按最慢兵种');
  assert.equal(marchTravelSeconds(0, 0, 10, 0, { cavalry: 9 }), Math.ceil((10 * perTile) / 1.5), '纯骑兵 ×1.5');
});

test('地图窗口与坐标钳制', () => {
  assert.ok(inWorld(0, 0) && inWorld(WORLD_SIZE - 1, WORLD_SIZE - 1));
  assert.ok(!inWorld(-1, 0) && !inWorld(0, WORLD_SIZE) && !inWorld(1.5, 0));

  const clamped = clampMapWindow(-5, -5, 999, 999);
  assert.equal(clamped.x, 0);
  assert.equal(clamped.y, 0);
  assert.equal(clamped.w, MAX_MAP_WINDOW);
  assert.equal(clamped.h, MAX_MAP_WINDOW);
  // x = 2000 超出世界边界 → 钳到右下角（WORLD_SIZE 曾为 40 时用 100 即越界，扩图后取 2000）
  assert.equal(clampMapWindow(2000, 2000, 5, 5).x, WORLD_SIZE - 5);
  assert.equal(clampMapWindow(2000, 2000, 5, 5).y, WORLD_SIZE - 5);
});

test('野地加成计入城池产量：territoryRates 按资源归集并叠加到 productionPerHour', () => {
  // v21：加成 = 基线 + 等级 × 每级增量；森林 Lv3 = 30 + 3×70 = 240 + 采集 3×18×1 = 294 木
  const rates = territoryRates([
    { x: 1, y: 2, terrain: 'forest', level: 3, garrison: 18 },
    { x: 4, y: 5, terrain: 'lake', level: 2, garrison: 0 }, // 粮：40 + 2×80 = 200
    { x: 7, y: 8, terrain: 'gold_mine', level: 2, garrison: 10 }, // 金：30 + 2×70 + 2×10×1 = 190
  ]);
  assert.equal(rates.wood, 294);
  assert.equal(rates.food, 200);
  assert.equal(rates.gold, 190, '金矿占领产金（第二金源）');

  const base = productionPerHour({ government: 1 });
  const withWilderness = productionPerHour({ government: 1 }, rates);
  assert.equal(withWilderness.gold, base.gold + 190, '金矿加成计入城池产金');
  assert.equal(withWilderness.wood, base.wood + 294);
  assert.equal(withWilderness.food, base.food + 200);
});

test('WORLD_SEED 为固定值（生成可复现是既定行为）', () => {
  assert.equal(WORLD_SEED, 20260927);
});

test('世界规模与 NPC 城池密度为占位决策：1000×1000、NPC 随面积放缩（2026-09-27 扩图）', () => {
  assert.equal(WORLD_SIZE, 1000);
  // 40×40 时 24 座 → 面积放缩 625 倍后 15000 座，密度不变
  assert.equal(NPC_CITY_COUNT, 15000);
  // 扩图后容量：100 万格减 NPC 城池仍余量充足（分散落位的占位边界成立）
  assert.ok(WORLD_SIZE * WORLD_SIZE - NPC_CITY_COUNT > 1000);
});

// ---- v23（AISLG-59）：相邻野地连片加成 ----

test('连片加成：同地形 4 向相邻成片才加成，3–4 块 +10%、≥5 块 +20%，丢失即重算', () => {
  const forest = (x: number, y: number): TerritoryRow => ({ x, y, terrain: 'forest', level: 3, garrison: 0 });
  // 单块：基线 30 + 3×70 = 240 木，无加成
  const single = territoryRates([forest(1, 1)]);
  assert.equal(single.wood, 240);
  // 两块相邻：仍不足 3 块，无加成（每块各自 240）
  const pair = territoryRates([forest(1, 1), forest(2, 1)]);
  assert.equal(pair.wood, 480);
  // 三块相邻：每块 240 × 1.1 = 264，合计 792
  const trio = territoryRates([forest(1, 1), forest(2, 1), forest(3, 1)]);
  assert.equal(trio.wood, 792);
  // 五块相邻：× 1.2 = 288/块，合计 1440
  const five = territoryRates([forest(1, 1), forest(2, 1), forest(3, 1), forest(1, 2), forest(2, 2)]);
  assert.equal(five.wood, 1440);
  // 斜角不算相邻：(1,1)-(2,2) 不相连 → 连通块 2 + 1（最大块 2 → 无加成）
  const diagonal = territoryRates([forest(1, 1), forest(1, 2), forest(3, 3)]);
  assert.equal(diagonal.wood, 480 + 240);
  // 折线连通：(1,1)-(2,1)-(2,2) 经 (2,1) 相连成 3 块（4 向连通不以直线为限）
  const bent = territoryRates([forest(1, 1), forest(2, 1), forest(2, 2)]);
  assert.equal(bent.wood, 792);
  // 不同地形不算连片：森林与丘陵相邻互不连片
  const mixed = territoryRates([
    { x: 1, y: 1, terrain: 'forest', level: 3, garrison: 0 },
    { x: 2, y: 1, terrain: 'hill', level: 3, garrison: 0 },
    { x: 3, y: 1, terrain: 'forest', level: 3, garrison: 0 },
  ]);
  const hillBase = 25 + 3 * 55; // 丘陵 Lv3 = 190 铁
  assert.equal(mixed.wood, 480, '森林被丘陵隔断，两块各自 240');
  assert.equal(mixed.iron, hillBase);
});
