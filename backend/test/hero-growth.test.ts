// 武将培养与在野名将的纯规则（v54，AISLG-144）：加点校验 / 洗点费与还原点数 / 历练经验 /
// 赏赐与每日次数 / 结交花费 / 在野名将名单与守军加强 / 视图的今日剩余次数

import assert from 'node:assert/strict';
import test from 'node:test';
import { ALL_FAMOUS_HEROES, HERO_LEVEL_MAX, type HeroAttrs } from '../common/src/hero';
import {
  allocatedPoints,
  GIFT_DAILY_LIMIT,
  GIFT_EXP,
  GIFT_GOLD,
  heroDayIndex,
  isTrainingTier,
  RESET_DAILY_LIMIT,
  resetCost,
  trainingExp,
  validatePointsRequest,
} from '../common/src/hero-growth';
import { BEFRIEND_ACTIVE_CAP, befriendCost, WILD_FAMOUS_HEROES, WILD_GARRISON_MULTIPLIER, WILD_HERO_MIN_LEVEL } from '../common/src/hero-wild';
import { fullGarrisonOf } from '../common/src/native-garrison';
import { nativeGarrison } from '../common/src/battle';
import { heroView, type AccountHeroRow } from '../common/src/hero-db';
import { setTimeScaleCache } from '../common/src/time-scale';

test('加点校验：非负整数、合计至少 1、不超过自由点数', () => {
  assert.deepEqual(validatePointsRequest({ lead: 1, force: 2 }, 3), { total: 3 });
  assert.deepEqual(validatePointsRequest({ wit: 5 }, 5), { total: 5 });
  assert.equal(validatePointsRequest({}, 5), 'invalid', '合计为 0 不合法');
  assert.equal(validatePointsRequest({ lead: -1, force: 3 }, 5), 'invalid', '负数不合法');
  assert.equal(validatePointsRequest({ lead: 1.5 }, 5), 'invalid', '小数不合法');
  assert.equal(validatePointsRequest({ lead: 4, force: 2 }, 5), 'insufficient', '超过自由点数');
});

test('已分配点数 = 当前属性合计 − 初始属性合计（洗点退回量）', () => {
  const base: HeroAttrs = { lead: 30, force: 20, wit: 25 };
  assert.equal(allocatedPoints({ lead: 30, force: 20, wit: 25 }, base), 0);
  assert.equal(allocatedPoints({ lead: 33, force: 22, wit: 25 }, base), 5);
});

test('洗点费 = 等级 × 1000，每武将每日 1 次', () => {
  assert.equal(resetCost(1), 1000);
  assert.equal(resetCost(HERO_LEVEL_MAX), 40_000);
  assert.equal(RESET_DAILY_LIMIT, 1);
});

test('历练：档位校验；经验 = 基础 × 等级 ÷ 10（向下取整）', () => {
  assert.ok(isTrainingTier(1) && isTrainingTier(2) && isTrainingTier(3));
  assert.equal(isTrainingTier(0) || isTrainingTier(4) || isTrainingTier('1'), false);
  assert.equal(trainingExp(1, 10), 200);
  assert.equal(trainingExp(2, 3), 300);
  assert.equal(trainingExp(3, 40), 16_000);
});

test('赏赐：1000 金币 → 100 经验，每武将每日 3 次', () => {
  assert.equal(GIFT_GOLD, 1000);
  assert.equal(GIFT_EXP, 100);
  assert.equal(GIFT_DAILY_LIMIT, 3);
});

test('结交花费 = 500 × 野地等级；同时结交上限 2', () => {
  assert.equal(befriendCost(3), 1500);
  assert.equal(befriendCost(10), 5000);
  assert.equal(BEFRIEND_ACTIVE_CAP, 2);
});

test('在野名将：29 名、名字与名城 / 黄巾不重复、落位等级不低于 Lv3', () => {
  assert.equal(WILD_FAMOUS_HEROES.length, 29);
  const fixed = new Set(ALL_FAMOUS_HEROES.filter((def) => def.source.kind !== 'wild').map((def) => def.name));
  for (const def of WILD_FAMOUS_HEROES) {
    assert.equal(def.source.kind, 'wild');
    assert.equal(fixed.has(def.name), false, `${def.name} 不与名城 / 黄巾重名`);
  }
  assert.equal(WILD_HERO_MIN_LEVEL, 3);
});

test('守军加强：在野名将所在野地的原住守军为同级的 2 倍，普通野地不变', () => {
  setTimeScaleCache(1);
  const tile = { x: 12, y: 34, level: 4 };
  const plain = fullGarrisonOf(tile);
  assert.deepEqual(plain, nativeGarrison(4, tile), '普通野地与原住守军一致');
  const wild = fullGarrisonOf({ ...tile, wild_hero: '关羽' });
  for (const [kind, count] of Object.entries(plain)) {
    assert.equal(wild[kind as keyof typeof wild], (count ?? 0) * WILD_GARRISON_MULTIPLIER, `${kind} 翻倍`);
  }
  assert.equal(WILD_GARRISON_MULTIPLIER, 2);
});

test('视图：今日剩余次数跨游戏日归零；training 为空时给 null', () => {
  setTimeScaleCache(1);
  const now = new Date();
  const row = {
    id: 'h1',
    account_id: 'a1',
    name: '张三',
    famous: false,
    lead: 20,
    force: 20,
    wit: 20,
    base_lead: 20,
    base_force: 20,
    base_wit: 20,
    free_points: 2,
    level: 3,
    exp: 0,
    arrears: false,
    salary_at: now,
    wounded_until: null,
    train_until: null,
    train_tier: null,
    train_exp: null,
    gift_day: String(heroDayIndex(now)),
    gift_count: 3,
    reset_day: String(heroDayIndex(now) - 1),
    reset_count: 1,
    created_at: now,
  } as unknown as AccountHeroRow;
  const view = heroView(row, null, null, now);
  assert.deepEqual(view.dailyLeft, { gift: 0, reset: RESET_DAILY_LIMIT }, '赏赐今日用完；洗点昨日用过，今日重置');
  assert.equal(view.training, null);
  assert.equal(view.freePoints, 2);
});
