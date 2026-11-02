// 计谋的纯规则单测（v86，AISLG-211）：成功率、效果数值、免疫时长、计谋令表、
// 欺敌倍数与识破、欺敌换算顺序（先倍数后降级）。全部不碰数据库。
// 随机源用固定种子的确定性实现，便于复现。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AMBUSH_MINUTES_MAX,
  BURN_FOOD_PERCENT_MAX,
  CICADA_PERCENT_MAX,
  DECEPTION_MINUTES_PER_WIT,
  EIGHT_GATES_PERCENT_MAX,
  LOOT_FIRE_PERCENT_MAX,
  PHANTOM_MULTIPLIER_MAX,
  PHANTOM_MULTIPLIER_MIN,
  STRATAGEM_DEFS,
  STRATAGEM_HERO_COOLDOWN_MS,
  STRATAGEM_KINDS,
  STRATAGEM_TOKENS,
  STRATAGEM_TOKEN_KINDS,
  SUCCESS_MAX_PERCENT,
  SUCCESS_MIN_PERCENT,
  ambushDurationMs,
  ambushMinutes,
  applyDeceptionToGarrison,
  burnFoodAmount,
  burnFoodPercent,
  cicadaArriveAt,
  cicadaReducePercent,
  deceptionDurationMs,
  deceptionSpotPercent,
  deceptionSpotted,
  eightGatesArriveAt,
  eightGatesExtendPercent,
  emptyFortMultiplierPercent,
  isStratagemKind,
  isStratagemTokenKind,
  lootFirePercent,
  phantomMultiplierPercent,
  stratagemDef,
  stratagemImmunityMs,
  stratagemSuccessPercent,
  stratagemTokenInfo,
} from '../common/src/stratagem';
import { setTimeScaleCache } from '../common/src/time-scale';
import { TROOP_KINDS } from '../common/src/protocol-army';
import { degradeGarrison } from '../common/src/scout-detail';

// 时长类断言按未加速基准（部署默认缩放是 50，见 common/src/time-scale.ts）
setTimeScaleCache(1);

/** 确定性随机源（线性同余），用于复现「施计时随机定倍数」「识破掷点」 */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

test('8 个计谋与 4 类计谋令的定义齐全，且与 spec 表一致', () => {
  assert.equal(STRATAGEM_KINDS.length, 8);
  assert.deepEqual(new Set(STRATAGEM_DEFS.map((def) => def.kind)), new Set(STRATAGEM_KINDS));
  assert.equal(STRATAGEM_TOKEN_KINDS.length, 4);
  // 会失败 / 会通知的计谋（spec：焚烧粮草 / 趁火打劫 / 十面埋伏 / 八门金锁 / 蛛丝马迹 会失败；
  // 欺敌类与金蝉脱壳不通知任何人）
  const canFail = STRATAGEM_DEFS.filter((def) => def.canFail).map((def) => def.kind);
  assert.deepEqual(canFail.sort(), ['ambush_all_sides', 'burn_granary', 'eight_gates', 'loot_fire', 'spy_trail'].sort());
  const notifying = STRATAGEM_DEFS.filter((def) => def.notifiesTarget).map((def) => def.kind);
  assert.deepEqual(notifying.sort(), canFail.sort());
  // 进攻类（受 PvP 保护限制）：攻心三计 + 情报
  const offensive = STRATAGEM_DEFS.filter((def) => def.offensive).map((def) => def.kind);
  assert.deepEqual(offensive.sort(), ['ambush_all_sides', 'burn_granary', 'loot_fire', 'spy_trail'].sort());
  // 令的类别归属
  assert.equal(stratagemDef('phantom_army').tokenKind, 'deception');
  assert.equal(stratagemDef('empty_fort').tokenKind, 'deception');
  assert.equal(stratagemDef('golden_cicada').tokenKind, 'march');
  assert.equal(stratagemDef('eight_gates').tokenKind, 'march');
  assert.equal(stratagemDef('burn_granary').tokenKind, 'assault');
  assert.equal(stratagemDef('loot_fire').tokenKind, 'assault');
  assert.equal(stratagemDef('ambush_all_sides').tokenKind, 'assault');
  assert.equal(stratagemDef('spy_trail').tokenKind, 'intel');
});

test('计谋令：军功价 / 每场限购 / 持有上限按 spec 表', () => {
  const table = Object.fromEntries(STRATAGEM_TOKENS.map((token) => [token.kind, token]));
  assert.deepEqual(
    { cost: table.deception.cost, limit: table.deception.perEventLimit, hold: table.deception.holdLimit },
    { cost: 100, limit: 4, hold: 6 },
  );
  assert.deepEqual(
    { cost: table.march.cost, limit: table.march.perEventLimit, hold: table.march.holdLimit },
    { cost: 150, limit: 3, hold: 5 },
  );
  assert.deepEqual(
    { cost: table.assault.cost, limit: table.assault.perEventLimit, hold: table.assault.holdLimit },
    { cost: 250, limit: 2, hold: 3 },
  );
  assert.deepEqual(
    { cost: table.intel.cost, limit: table.intel.perEventLimit, hold: table.intel.holdLimit },
    { cost: 150, limit: 2, hold: 3 },
  );
  // 一场全买 11 张、共 1,650 军功（spec 的取舍口径）
  assert.equal(STRATAGEM_TOKENS.reduce((sum, token) => sum + token.perEventLimit, 0), 11);
  assert.equal(STRATAGEM_TOKENS.reduce((sum, token) => sum + token.perEventLimit * token.cost, 0), 1650);
  assert.equal(stratagemTokenInfo('assault').label, '攻心令');
});

test('类型守卫只认已知的计谋与令（未知值一律拒绝）', () => {
  assert.equal(isStratagemKind('phantom_army'), true);
  assert.equal(isStratagemKind('trick_20'), false);
  assert.equal(isStratagemKind(undefined), false);
  assert.equal(isStratagemTokenKind('intel'), true);
  assert.equal(isStratagemTokenKind('gold'), false);
});

test('成功率 = 50% + (施计智力 − 城守智力) × 1%，钳 20..90', () => {
  assert.equal(stratagemSuccessPercent(50, 0), SUCCESS_MAX_PERCENT, '50 打无城守封顶 90');
  assert.equal(stratagemSuccessPercent(50, 50), 50);
  assert.equal(stratagemSuccessPercent(50, 65), 35);
  assert.equal(stratagemSuccessPercent(0, 100), SUCCESS_MIN_PERCENT, '下限 20');
  assert.equal(stratagemSuccessPercent(100, 0), SUCCESS_MAX_PERCENT, '上限 90');
  assert.equal(stratagemSuccessPercent(65, 65), 50);
  assert.equal(stratagemSuccessPercent(52.9, 50.9), 52, '智力按整数部分参与计算');
});

test('焚烧粮草：智力 × 0.1%，最多 8%，烧掉量向下取整', () => {
  assert.equal(burnFoodPercent(50), 5);
  assert.equal(burnFoodPercent(65), 6.5);
  assert.equal(burnFoodPercent(200), BURN_FOOD_PERCENT_MAX);
  assert.equal(burnFoodAmount(10000, 50), 500);
  assert.equal(burnFoodAmount(10000, 200), 800, '封顶 8%');
  assert.equal(burnFoodAmount(99, 50), 4, 'floor(99 × 5%)');
  assert.equal(burnFoodAmount(0, 90), 0);
});

test('趁火打劫：保护降低 智力 × 0.5%，最多 30%；十面埋伏：智力分钟，最多 60', () => {
  assert.equal(lootFirePercent(50), 25);
  assert.equal(lootFirePercent(80), LOOT_FIRE_PERCENT_MAX);
  assert.equal(ambushMinutes(50), 50);
  assert.equal(ambushMinutes(120), AMBUSH_MINUTES_MAX);
  assert.equal(ambushDurationMs(30), 30 * 60 * 1000);
  assert.equal(ambushDurationMs(90), AMBUSH_MINUTES_MAX * 60 * 1000);
});

test('金蝉脱壳缩短返程、八门金锁延长行军：按剩余时间比例改写到达时刻', () => {
  const now = 1_000_000;
  const inOneHour = now + 60 * 60 * 1000;
  assert.equal(cicadaReducePercent(50), 50);
  assert.equal(cicadaReducePercent(80), CICADA_PERCENT_MAX);
  assert.equal(cicadaArriveAt(now, inOneHour, 50), now + 30 * 60 * 1000, '缩短 50%');
  assert.equal(cicadaArriveAt(now, inOneHour, 20), now + 48 * 60 * 1000, '缩短 20%');
  assert.equal(cicadaArriveAt(now, now - 1000, 50), now, '已过期不倒退');
  assert.equal(eightGatesExtendPercent(40), 20);
  assert.equal(eightGatesExtendPercent(100), EIGHT_GATES_PERCENT_MAX);
  assert.equal(eightGatesArriveAt(now, inOneHour, 40), now + 72 * 60 * 1000, '延长 20%');
  assert.equal(eightGatesArriveAt(now, inOneHour, 100), now + 78 * 60 * 1000, '封顶 30%');
});

test('欺敌：持续 = 智力 × 10 分钟；草木皆兵 300~500 整数倍、空城计 10/20/30', () => {
  assert.equal(deceptionDurationMs(50), 50 * DECEPTION_MINUTES_PER_WIT * 60 * 1000);
  const rng = seeded(20260925);
  for (let i = 0; i < 200; i += 1) {
    const multiplier = phantomMultiplierPercent(rng);
    assert.ok(multiplier >= PHANTOM_MULTIPLIER_MIN && multiplier <= PHANTOM_MULTIPLIER_MAX);
    assert.equal(Number.isInteger(multiplier), true);
    assert.ok([10, 20, 30].includes(emptyFortMultiplierPercent(rng)));
  }
  // 固定种子可复现
  assert.equal(phantomMultiplierPercent(seeded(42)), phantomMultiplierPercent(seeded(42)));
  // 边界值可达（rng 给 0 与接近 1）
  assert.equal(phantomMultiplierPercent(() => 0), PHANTOM_MULTIPLIER_MIN);
  assert.equal(phantomMultiplierPercent(() => 0.999999), PHANTOM_MULTIPLIER_MAX);
  assert.equal(emptyFortMultiplierPercent(() => 0), 10);
  assert.equal(emptyFortMultiplierPercent(() => 0.999999), 30);
});

test('识破概率 = 侦察科技 × 5%；0 级永远识破不了，10 级约一半', () => {
  assert.equal(deceptionSpotPercent(0), 0);
  assert.equal(deceptionSpotPercent(10), 50);
  assert.equal(deceptionSpotPercent(12), 60);
  const zeroTech = seeded(7);
  for (let i = 0; i < 500; i += 1) {
    assert.equal(deceptionSpotted(0, zeroTech), false, '侦察科技 0 级永远识破不了');
  }
  let spotted = 0;
  const rng = seeded(99);
  for (let i = 0; i < 4000; i += 1) {
    if (deceptionSpotted(10, rng)) {
      spotted += 1;
    }
  }
  assert.ok(spotted > 1700 && spotted < 2300, `10 级约 50%，实测 ${spotted}/4000`);
});

test('欺敌换算：各兵种按倍数向下取整；识破时原样返回真实驻军', () => {
  const real = { militia: 41, archer: 13 };
  const zero = Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0]));
  assert.deepEqual(applyDeceptionToGarrison(real, 300, false), { ...zero, militia: 123, archer: 39 });
  assert.deepEqual(applyDeceptionToGarrison(real, 450, false), { ...zero, militia: 184, archer: 58 }, 'floor(41 × 4.5)');
  assert.deepEqual(applyDeceptionToGarrison(real, 20, false), { ...zero, militia: 8, archer: 2 }, '空城计 20%');
  assert.deepEqual(applyDeceptionToGarrison(real, 300, true), { ...zero, militia: 41, archer: 13 }, '识破 = 真实驻军');
});

test('欺敌换算顺序：先乘倍数、再走侦察科技降级（不是先降级后乘）', () => {
  const real = { militia: 40, archer: 10 };
  const faked = applyDeceptionToGarrison(real, 300, false);
  const rough = degradeGarrison(faked, 7, 9, { scouting: 0 });
  assert.equal(rough.detail, 'rough');
  // 总数 150 的 ±20% 范围（若顺序反了会是 50 的 ±20% 再放大）
  assert.deepEqual(rough.total, { min: 120, max: 180 });
  const exact = degradeGarrison(faked, 7, 9, { scouting: 6 });
  const expected = Object.fromEntries(TROOP_KINDS.map((kind) => [kind, 0]));
  assert.deepEqual(exact.garrison, { ...expected, militia: 120, archer: 30 }, 'Lv6+ 精确：假驻军即 3 倍数');
  assert.deepEqual(exact.total, { min: 150, max: 150 });
});

test('免疫时长：欺诈类与金蝉脱壳无免疫；焚烧粮草 / 八门金锁 6 小时，其余 24 小时', () => {
  assert.equal(stratagemImmunityMs('phantom_army'), null);
  assert.equal(stratagemImmunityMs('empty_fort'), null);
  assert.equal(stratagemImmunityMs('golden_cicada'), null);
  assert.equal(stratagemImmunityMs('burn_granary'), 6 * 60 * 60 * 1000);
  assert.equal(stratagemImmunityMs('eight_gates'), 6 * 60 * 60 * 1000);
  assert.equal(stratagemImmunityMs('loot_fire'), 24 * 60 * 60 * 1000);
  assert.equal(stratagemImmunityMs('ambush_all_sides'), 24 * 60 * 60 * 1000);
  assert.equal(stratagemImmunityMs('spy_trail'), 24 * 60 * 60 * 1000);
});

test('所有持续时长按全局时间缩放折算（缩放 10 倍时基准时长 ÷10）', () => {
  try {
    setTimeScaleCache(10);
    assert.equal(stratagemImmunityMs('burn_granary'), (6 * 60 * 60 * 1000) / 10);
    assert.equal(ambushDurationMs(60), (60 * 60 * 1000) / 10);
    assert.equal(deceptionDurationMs(50), (50 * 10 * 60 * 1000) / 10);
    assert.equal(STRATAGEM_HERO_COOLDOWN_MS, 60 * 60 * 1000, '冷却基准本身不变，折算在使用处');
  } finally {
    setTimeScaleCache(1);
  }
});
