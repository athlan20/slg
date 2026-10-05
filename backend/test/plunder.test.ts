// 掠夺、负重与仓库保护规则（common/src/plunder.ts / troops.ts 的 armyCarryCapacity /
// world.ts 的 wildernessPlunderPool）的单元测试（v16，AISLG-4）。
// 数值断言与占位常量同步：调整占位数值时同步本文件与 docs/battle-calibration.md。

import test from 'node:test';
import assert from 'node:assert/strict';
import { TROOP_KINDS, type TroopKind } from '../common/src/protocol';
import { TROOP_INFO, armyCarryCapacity } from '../common/src/troops';
import {
  LOOT_RESOURCE_PER_LEVEL,
  PLUNDER_POOL_GOLD_PER_LEVEL,
  PLUNDER_POOL_RESOURCE_PER_LEVEL,
  wildernessLoot,
  wildernessPlunderPool,
} from '../common/src/world';
import {
  NPC_CITY_GOLD_SHARE,
  PLUNDER_COOLDOWN_MS,
  PLUNDER_LOAD_ORDER,
  WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL,
  cityPlunderPool,
  inPlunderCooldown,
  loadByCarry,
  lootTotal,
  plunderableAmount,
  territoryLimit,
  warehouseProtectionPerResource,
} from '../common/src/plunder';

import { setTimeScaleCache } from '../common/src/time-scale';

// 本文件断言未加速基准值（AISLG-38 全局缩放语义由 time-scale.test.ts 专测）
setTimeScaleCache(1);

test('单兵负重表：全部兵种为正整数，民夫显著高于战斗兵种（v16 占位数值）', () => {
  for (const kind of TROOP_KINDS) {
    const carry = TROOP_INFO[kind].carry;
    // 床弩 / 冲车为器械，负重 0（v33）；其余为正整数
    const noCarry = kind === 'ballista' || kind === 'siege_ram';
    assert.ok(Number.isInteger(carry) && (noCarry ? carry === 0 : carry > 0), `${kind} carry 合法`);
  }
  assert.equal(TROOP_INFO.porter.carry, 500, '民夫负重 500');
  assert.ok(TROOP_INFO.archer.carry < TROOP_INFO.swordsman.carry, '弓箭兵低于刀盾兵');
  assert.equal(TROOP_INFO.cavalry.carry, 100, '轻骑兵负重 100');
});

test('armyCarryCapacity：按兵种求和，未知兵种与负数按 0 计', () => {
  assert.equal(armyCarryCapacity({}), 0);
  assert.equal(armyCarryCapacity({ porter: 2, militia: 3 }), 2 * 500 + 3 * 60);
  assert.equal(armyCarryCapacity({ porter: -5, archer: 1.5 }), TROOP_INFO.archer.carry);
  assert.equal(armyCarryCapacity({ unknown: 10 } as Partial<Record<TroopKind, number>>), 0);
});

test('野地掠夺奖励池：地形资源 750×等级 + 金 250×等级（v21 含金）；金矿为空池', () => {
  const pool = wildernessPlunderPool('forest', 3);
  assert.deepEqual(pool, { wood: 3 * PLUNDER_POOL_RESOURCE_PER_LEVEL, gold: 3 * PLUNDER_POOL_GOLD_PER_LEVEL });
  const legacy = wildernessLoot('forest', 3);
  assert.equal(legacy.gold, 3 * 150, 'legacy 战利品含金币（在途 attack 路径专用）');
  assert.equal(legacy.wood, 3 * LOOT_RESOURCE_PER_LEVEL, 'legacy 资源系数维持 250 不变');
  assert.deepEqual(wildernessPlunderPool('plain', 1), { food: PLUNDER_POOL_RESOURCE_PER_LEVEL, gold: PLUNDER_POOL_GOLD_PER_LEVEL });
  assert.deepEqual(wildernessPlunderPool('lake', 0), { food: 0, gold: 0 }, '等级 0 池为 0');
  // v19 金矿：金币不可掠夺，只可占领生息——掠夺池为空
  assert.deepEqual(wildernessPlunderPool('gold_mine', 5), {}, '金矿掠夺池为空');
});

test('loadByCarry：按金→粮→木→石→铁顺序装填（v21 含金）、整数取整、不超额、不改入参', () => {
  assert.equal(PLUNDER_LOAD_ORDER.join(','), 'gold,food,wood,stone,iron', '装填顺序固定（v21 金优先）');
  // 池充足时只装到 carry
  const full = loadByCarry(100, { food: 500, wood: 500, stone: 500, iron: 500 });
  assert.deepEqual(full, { gold: 0, food: 100, wood: 0, stone: 0, iron: 0 });
  // 池不足时顺序逐项装满（金在队列首位：有金先装金）
  const mixed = loadByCarry(1000, { gold: 700, food: 120, wood: 80, stone: 300, iron: 900 });
  assert.deepEqual(mixed, { gold: 700, food: 120, wood: 80, stone: 100, iron: 0 });
  // carry 为 0 / 池为空 / 非法输入
  assert.deepEqual(loadByCarry(0, { food: 100 }), { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 });
  assert.deepEqual(loadByCarry(100, {}), { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 });
  assert.deepEqual(loadByCarry(-5, { food: 100 }), { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 });
  const pool = { food: 50.7, wood: 1 };
  const floored = loadByCarry(100, pool);
  assert.equal(floored.food, 50, '向下取整');
  assert.equal(pool.food, 50.7, '不修改入参');
});

test('lootTotal：五资源合计（v21 起含金）', () => {
  assert.equal(lootTotal({ food: 100, wood: 20, stone: 3, iron: 4 }), 127);
  assert.equal(lootTotal({ gold: 10, food: 100, wood: 20, stone: 3, iron: 4 }), 137);
  assert.equal(lootTotal({}), 0);
  assert.equal(lootTotal({ food: -10 } as { food: number }), 0, '负数按 0 计');
});

test('仓库保护：总量 4000×等级，四资源固定均分各 1000×等级（v16 决策）', () => {
  assert.equal(WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL, 4000);
  assert.equal(warehouseProtectionPerResource(0), 0);
  assert.equal(warehouseProtectionPerResource(1), 1000);
  assert.equal(warehouseProtectionPerResource(5), 5000);
  assert.equal(warehouseProtectionPerResource(10), 10000);
  assert.equal(warehouseProtectionPerResource(2.9), 2000, '等级向下取整');
});

test('plunderableAmount：可掠量 = max(0, 存量 − 保护额)', () => {
  assert.equal(plunderableAmount(5000, 1000), 4000);
  assert.equal(plunderableAmount(800, 1000), 0, '保护额以下不可掠');
  assert.equal(plunderableAmount(12000.5, 1000), 11000, '存量向下取整');
  assert.equal(plunderableAmount(5000, -100), 5000, '负保护额按 0 计');
});

test('掠夺冷却：24 小时，胜利即记录 plundered_at；空值与超期不冷却', () => {
  assert.equal(PLUNDER_COOLDOWN_MS, 24 * 60 * 60 * 1000);
  const now = new Date('2026-09-28T12:00:00Z');
  const at = new Date('2026-09-28T00:00:00Z');
  assert.equal(inPlunderCooldown(at, now), true, '12 小时前被掠 → 冷却中');
  const early = new Date('2026-09-27T11:00:00Z');
  assert.equal(inPlunderCooldown(early, now), false, '25 小时前被掠 → 冷却已过');
  assert.equal(inPlunderCooldown(null, now), false, '从未被掠');
  assert.equal(inPlunderCooldown(at.toISOString(), now), true, 'ISO 字符串输入同样判定');
  assert.equal(inPlunderCooldown('not-a-date', now), false, '非法时间按未冷却处理');
});

test('territoryLimit：占领上限 = 官府等级（v16 决策）', () => {
  assert.equal(territoryLimit(1), 1);
  assert.equal(territoryLimit(10), 10);
  assert.equal(territoryLimit(0), 0);
  assert.equal(territoryLimit(3.7), 3, '等级向下取整');
});

test('cityPlunderPool（v41 AISLG-125）：NPC 袭城金币单次最多抢存量 5%，四资源仍只扣仓库保护', () => {
  const resources = { gold: 100_000, wood: 30_000, food: 5_000, stone: 5_000, iron: 5_000 };
  const pool = cityPlunderPool(resources, 10);
  assert.equal(pool.gold, Math.floor(100_000 * NPC_CITY_GOLD_SHARE), '金币 = 存量 × 5%（5000）');
  assert.equal(NPC_CITY_GOLD_SHARE, 0.05, '上限比例常量');
  assert.equal(pool.wood, 20_000, '四资源不受比例上限（30000 − 10000 保护）');
  assert.equal(pool.food, 0, '低于保护额的资源为 0');
  // 金币很少时按比例向下取整（不因取整反而多抢）
  const tiny = cityPlunderPool({ ...resources, gold: 19 }, 0);
  assert.equal(tiny.gold, 0, '19 金 × 5% 向下取整 = 0');
});
