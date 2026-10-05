// 玩家对抗（一）的保护与掠夺规则（common/src/protection.ts，v38 AISLG-122）的单元测试。
// 数值断言与需求占位表同步：单次四资源 30% / 金币 10%、等级差 5 级起每级 −15% 最低 25%、
// 新手 3 天、被打后免战 4 小时、主动免战 12 小时每周一次。

import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeScaleCache } from '../common/src/time-scale';
import {
  CITY_CONQUEST_PROTECTION_MS,
  DURABILITY_DAMAGE_PER_WIN,
  DURABILITY_MAX,
  DURABILITY_RAM_BONUS_MAX,
  DURABILITY_REGEN_PER_HOUR,
  NEWBIE_GOVERNMENT_LEVEL,
  NEWBIE_PROTECTION_MS,
  PVP_CITY_TRUCE_MS,
  PVP_GOLD_SHARE,
  PVP_LEVEL_PENALTY_FLOOR,
  PVP_PLUNDER_SHARE,
  SELF_TRUCE_MS,
  SELF_TRUCE_WEEK_MS,
  activeAt,
  inNewbieProtection,
  inTruce,
  newbieUntilFrom,
  pvpLevelFactor,
  pvpPlunderPool,
  selfTruceNextAvailableAt,
  settleDurability,
  siegeDamage,
} from '../common/src/protection';

// 本文件断言未加速基准值（缩放语义由 time-scale.test.ts 专测）
setTimeScaleCache(1);

const NOW = new Date('2026-10-03T00:00:00.000Z');
const HOUR = 60 * 60 * 1000;

test('常量：与拍板数值一致（v38 需求表 + v42 AISLG-126 校准）', () => {
  assert.equal(NEWBIE_PROTECTION_MS, 3 * 24 * HOUR);
  assert.equal(NEWBIE_GOVERNMENT_LEVEL, 8);
  assert.equal(PVP_CITY_TRUCE_MS, 4 * HOUR);
  assert.equal(SELF_TRUCE_MS, 12 * HOUR);
  assert.equal(SELF_TRUCE_WEEK_MS, 7 * 24 * HOUR);
  assert.equal(PVP_PLUNDER_SHARE, 0.45, 'v42 AISLG-126 拍板：30% → 45%');
  assert.equal(PVP_GOLD_SHARE, 0.15, 'v42 拍板：10% → 15%');
  assert.equal(PVP_LEVEL_PENALTY_FLOOR, 0.25);
});

test('newbieUntilFrom：注册时刻 + 3 天（基准）', () => {
  const created = new Date('2026-10-01T08:00:00.000Z');
  assert.equal(newbieUntilFrom(created).getTime(), created.getTime() + 3 * 24 * HOUR);
});

test('inNewbieProtection：截止未到受保护、到期失效、空值不受保护', () => {
  assert.equal(inNewbieProtection(new Date(NOW.getTime() + HOUR), NOW), true);
  assert.equal(inNewbieProtection(new Date(NOW.getTime() - HOUR), NOW), false);
  assert.equal(inNewbieProtection(NOW, NOW), false, '截止即当前时刻不再保护');
  assert.equal(inNewbieProtection(null, NOW), false);
});

test('activeAt / inTruce：被动与主动任一生效，取更晚截止', () => {
  const cityTruce = new Date(NOW.getTime() + HOUR);
  const shield = new Date(NOW.getTime() + 3 * HOUR);
  assert.equal(activeAt(cityTruce, NOW)?.getTime(), cityTruce.getTime());
  assert.equal(activeAt(new Date(NOW.getTime() - HOUR), NOW), null, '过期不再生效');
  assert.equal(inTruce(cityTruce, null, NOW), true);
  assert.equal(inTruce(null, shield, NOW), true);
  assert.equal(inTruce(new Date(NOW.getTime() - HOUR), new Date(NOW.getTime() - HOUR), NOW), false);
});

test('selfTruceNextAvailableAt：用过之后 7 天内不可再开，可用返回 null', () => {
  assert.equal(selfTruceNextAvailableAt(null), null);
  const usedAt = new Date(NOW.getTime() - 24 * HOUR);
  const next = selfTruceNextAvailableAt(usedAt);
  assert.equal(next?.getTime(), usedAt.getTime() + 7 * 24 * HOUR);
  assert.ok((next as Date).getTime() > NOW.getTime(), '昨天用过 → 仍不可开');
});

test('pvpLevelFactor：差 ≤ 5 级不衰减，每多 1 级 −15%，下限 25%', () => {
  assert.equal(pvpLevelFactor(5, 5), 1);
  assert.equal(pvpLevelFactor(10, 5), 1, '正好差 5 级不衰减');
  assert.equal(pvpLevelFactor(11, 5), 0.85);
  assert.equal(pvpLevelFactor(12, 5), 0.7);
  assert.equal(pvpLevelFactor(20, 5), 0.25, '衰减到下限');
  assert.equal(pvpLevelFactor(30, 5), 0.25, '不会低于下限');
  assert.equal(pvpLevelFactor(3, 10), 1, '小打大不衰减（只罚大打小）');
});

test('pvpPlunderPool：先扣仓库保护再乘比例与衰减（同等级无衰减）', () => {
  // 仓库 10 级 → 每资源保护 10000；存量 30000 → 可抢 20000；比例上限用现行常量（v42 拍板 45%/15%）
  const pool = pvpPlunderPool(
    { gold: 5000, wood: 30000, food: 30000, stone: 30000, iron: 30000 },
    10, 10, 10,
  );
  assert.equal(pool.gold, Math.floor(5000 * PVP_GOLD_SHARE), `金币不受仓库保护，×${PVP_GOLD_SHARE}`);
  const resourceCap = Math.floor((30000 - 10000) * PVP_PLUNDER_SHARE);
  assert.equal(pool.food, resourceCap);
  assert.equal(pool.wood, resourceCap);
  assert.equal(pool.stone, resourceCap);
  assert.equal(pool.iron, resourceCap);
});

test('pvpPlunderPool：存量低于保护额时四资源为 0，金币仍可抢', () => {
  const pool = pvpPlunderPool(
    { gold: 100, wood: 5000, food: 0, stone: 0, iron: 0 },
    10, 10, 10,
  );
  assert.equal(pool.gold, Math.floor(100 * PVP_GOLD_SHARE));
  assert.equal(pool.wood, 0, '(5000 − 10000) 钳 0');
  assert.equal(pool.food, 0);
});

test('pvpPlunderPool：等级差 7 级（10 打 3）收益 ×0.55', () => {
  const even = pvpPlunderPool({ gold: 10000, wood: 0, food: 0, stone: 0, iron: 0 }, 0, 10, 10);
  const uneven = pvpPlunderPool({ gold: 10000, wood: 0, food: 0, stone: 0, iron: 0 }, 0, 10, 3);
  assert.equal(even.gold, Math.floor(10000 * PVP_GOLD_SHARE));
  // 差 7 级 = 起点之上 2 级 → 1 − 0.3 = 0.7
  assert.equal(uneven.gold, Math.floor(10000 * PVP_GOLD_SHARE * 0.7));
});

test('城防值常量：与 AISLG-124 需求占位表一致', () => {
  assert.equal(DURABILITY_MAX, 100);
  assert.equal(DURABILITY_DAMAGE_PER_WIN, 35);
  assert.equal(DURABILITY_RAM_BONUS_MAX, 15);
  assert.equal(DURABILITY_REGEN_PER_HOUR, 10);
  assert.equal(CITY_CONQUEST_PROTECTION_MS, 6 * 24 * 0 + 6 * HOUR);
  assert.ok(DURABILITY_DAMAGE_PER_WIN * 3 > DURABILITY_MAX, '基础伤害需打 3 次');
});

test('settleDurability：null 为满值、满值不再涨、未到整小时不涨', () => {
  const now = new Date('2026-10-03T12:00:00.000Z');
  assert.equal(settleDurability(null, null, null, now), 100);
  assert.equal(settleDurability(100, new Date(now.getTime() - 10 * HOUR), null, now), 100);
  assert.equal(settleDurability(65, new Date(now.getTime() - 30 * 60 * 1000), null, now), 65, '半小时不涨');
});

test('settleDurability：免战截止前不回涨，之后按小时回涨到满', () => {
  const now = new Date('2026-10-03T12:00:00.000Z');
  const settled = new Date('2026-10-03T06:00:00.000Z');
  const truce = new Date('2026-10-03T10:00:00.000Z');
  // 免战未结束：哪怕结算时刻已过 6 小时也不涨
  const before = new Date('2026-10-03T09:00:00.000Z');
  assert.equal(settleDurability(65, settled, truce, before), 65);
  // 免战后 2 小时：+20
  assert.equal(settleDurability(65, settled, truce, now), 85);
  // 免战后很久：涨满为止
  const later = new Date('2026-10-04T00:00:00.000Z');
  assert.equal(settleDurability(65, settled, truce, later), 100);
});

test('settleDurability：结算时刻晚于免战时按结算时刻起算', () => {
  const now = new Date('2026-10-03T12:00:00.000Z');
  const settled = new Date('2026-10-03T11:00:00.000Z');
  const truce = new Date('2026-10-03T09:00:00.000Z');
  // 结算时刻（11:00）晚于免战截止（09:00）：从 11:00 起算，1 小时 +10
  assert.equal(settleDurability(65, settled, truce, now), 75);
});

test('siegeDamage：基础 35，冲车占比线性加成、10% 拿满 +15', () => {
  assert.equal(siegeDamage(0, 100).damage, 35, '无冲车只吃基础');
  assert.equal(siegeDamage(0, 100).ramBonus, 0);
  const half = siegeDamage(5, 100); // 5% 占位 → 一半加成
  assert.equal(half.ramBonus, 7);
  assert.equal(half.damage, 42);
  const full = siegeDamage(20, 100); // ≥10% 拿满
  assert.equal(full.ramBonus, 15);
  assert.equal(full.damage, 50);
  assert.equal(siegeDamage(100, 0).ramBonus, 0, '总数为 0 视为无加成');
});
