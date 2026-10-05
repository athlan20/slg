// 武将系统（v36，AISLG-114/115/116）的纯规则：招募 / 上限 / 带兵加成（封顶与统率摊薄）/
// 俸禄 / 经验与成长 / 名将定义唯一性 / 引擎加成生效

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALL_FAMOUS_HEROES,
  ATK_PERCENT_PER_FORCE,
  DEF_PERCENT_PER_WIT,
  FAMOUS_ATTR_MAX,
  FAMOUS_ATTR_MIN,
  FAMOUS_HERO_CAP,
  HERO_ATTR_MAX,
  HERO_ATTR_MIN,
  HERO_BONUS_CAP_PERCENT,
  HERO_LEVEL_MAX,
  LEAD_TROOPS_PER_POINT,
  RECRUIT_BASE_GOLD,
  RECRUIT_GOLD_PER_ATTR,
  SALARY_PER_LEVEL_FAMOUS,
  SALARY_PER_LEVEL_NORMAL,
  TAVERN_CANDIDATE_COUNT,
  applyHeroExp,
  attrGainPerLevel,
  expForNextLevel,
  famousHeroForCity,
  guardProductionPercent,
  heroBattleBonus,
  normalHeroCap,
  recruitCost,
  rollFamousAttrs,
  rollNormalHero,
  salaryPerHour,
} from '../common/src/hero';
import { resolveBattle } from '../common/src/battle';
import { nativeGarrison } from '../common/src/battle';
import { setTimeScaleCache } from '../common/src/time-scale';

/** mulberry32 确定性随机源（与 battle-calibration / battle.test 同实现） */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

test('招募费 = 500 + 三项属性合计 × 20；普通将属性落在 10..40、名将 45..65', () => {
  assert.equal(recruitCost({ lead: 10, force: 10, wit: 10 }), RECRUIT_BASE_GOLD + 30 * RECRUIT_GOLD_PER_ATTR);
  assert.equal(recruitCost({ lead: 40, force: 40, wit: 40 }), 500 + 120 * 20);
  for (let seed = 1; seed <= 40; seed += 1) {
    const rng = mulberry32(seed);
    const hero = rollNormalHero(rng);
    for (const attr of [hero.lead, hero.force, hero.wit]) {
      assert.ok(attr >= HERO_ATTR_MIN && attr <= HERO_ATTR_MAX);
    }
    const famous = rollFamousAttrs(rng);
    for (const attr of [famous.lead, famous.force, famous.wit]) {
      assert.ok(attr >= FAMOUS_ATTR_MIN && attr <= FAMOUS_ATTR_MAX);
    }
  }
});

test('普通将上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1；名将上限固定 3', () => {
  assert.equal(normalHeroCap(0), 1, '未建酒馆也保底 1 名');
  assert.equal(normalHeroCap(1), 2);
  assert.equal(normalHeroCap(2), 2);
  assert.equal(normalHeroCap(3), 3);
  assert.equal(normalHeroCap(20), 11);
  assert.equal(FAMOUS_HERO_CAP, 3);
  assert.equal(TAVERN_CANDIDATE_COUNT, 3);
});

test('带兵加成：武力 / 智力 × 0.3% 各封顶 20%；统率 × 20 内吃满、超出按比例摊薄', () => {
  const full = heroBattleBonus({ lead: 30, force: 40, wit: 30 }, 100);
  assert.equal(full.atkPercent, Math.min(HERO_BONUS_CAP_PERCENT, 40 * ATK_PERCENT_PER_FORCE));
  assert.equal(full.defPercent, 9);
  assert.equal(full.leadCap, 30 * LEAD_TROOPS_PER_POINT);
  assert.equal(full.scale, 1, '600 上限内 100 兵吃满');

  // 封顶：武力 70（名将不可能，但规则上封顶）
  const capped = heroBattleBonus({ lead: 100, force: 100, wit: 100 }, 100);
  assert.equal(capped.atkPercent, HERO_BONUS_CAP_PERCENT);
  assert.equal(capped.defPercent, HERO_BONUS_CAP_PERCENT);

  // 摊薄：统率 10（上限 200 兵）带 1000 兵 → 加成 ×0.2
  const thin = heroBattleBonus({ lead: 10, force: 40, wit: 30 }, 1000);
  assert.equal(thin.scale, 0.2);
  assert.equal(thin.atkPercent, Math.round(12 * 0.2 * 10) / 10);
  assert.equal(thin.defPercent, Math.round(9 * 0.2 * 10) / 10);
});

test('城守产量加成：智力 × 0.1% 封顶 5%', () => {
  assert.equal(guardProductionPercent(30), 3);
  assert.equal(guardProductionPercent(65), 5, '智力 65 封顶 5%');
  assert.equal(guardProductionPercent(100), 5);
});

test('俸禄：普通将 20 × 等级、名将 100 × 等级（金币 / 小时基准）', () => {
  assert.equal(salaryPerHour(1, false), SALARY_PER_LEVEL_NORMAL);
  assert.equal(salaryPerHour(5, false), 100);
  assert.equal(salaryPerHour(1, true), SALARY_PER_LEVEL_FAMOUS);
  assert.equal(salaryPerHour(20, true), 2000);
});

test('经验与成长：升到 L+1 需 100 × L²；每级三项 +1（名将 +2）；封顶 20 级', () => {
  assert.equal(expForNextLevel(1), 100);
  assert.equal(expForNextLevel(3), 900);
  // 1 级 0 经验 + 250 → 升到 2 级（1→2 需 100，余 150；2→3 需 400，不够）
  const r1 = applyHeroExp(1, 0, 250, false);
  assert.deepEqual({ level: r1.level, exp: r1.exp, leveledTo: r1.leveledTo, levelsGained: r1.levelsGained }, {
    level: 2, exp: 150, leveledTo: 2, levelsGained: 1,
  });
  // 连升两级：1→2 需 100、2→3 需 400，共 500；多给 50 余 50
  const r1b = applyHeroExp(1, 0, 550, false);
  assert.deepEqual({ level: r1b.level, exp: r1b.exp, levelsGained: r1b.levelsGained }, { level: 3, exp: 50, levelsGained: 2 });
  // 战败减半由调用方乘好再传入（这里只验整数化）
  const r2 = applyHeroExp(1, 0, Math.floor(99 * 0.5), false);
  assert.equal(r2.level, 1, '不足 100 不升级');
  // 名将每级 +2（属性成长量）
  assert.equal(attrGainPerLevel(false), 1);
  assert.equal(attrGainPerLevel(true), 2);
  // 满级后经验照加、不再升级
  let exp = expForNextLevel(19) - 1;
  const r3 = applyHeroExp(19, exp, 1, false);
  assert.equal(r3.level, HERO_LEVEL_MAX);
  const r4 = applyHeroExp(HERO_LEVEL_MAX, 0, 999_999, false);
  assert.equal(r4.level, HERO_LEVEL_MAX);
  assert.ok(r4.exp >= 999_999, '满级经验累计不丢');
});

test('名将定义：8 名城 + 黄巾 3 名，名字全服唯一且与名城一一对应', () => {
  assert.equal(ALL_FAMOUS_HEROES.length, 11);
  const names = ALL_FAMOUS_HEROES.map((def) => def.name);
  assert.equal(new Set(names).size, names.length, '名字不重复');
  for (const city of ['官渡', '许昌', '洛阳', '长安', '成都', '建业', '襄阳', '邺城']) {
    assert.ok(famousHeroForCity(city), `${city} 绑定名将`);
  }
  assert.equal(famousHeroForCity('不存在'), null);
});

test('引擎：同等兵力带武将攻击加成，固定种子下胜率显著高于不带（20% 封顶内不打穿）', () => {
  setTimeScaleCache(1);
  // 攻方 = Lv3 野地守军同构成（等势对局，不带将约五五开），对照固定种子批量模拟
  const defender = nativeGarrison(3);
  const attacker = { ...defender };
  const bonus = heroBattleBonus({ lead: 40, force: 40, wit: 40 }, Object.values(attacker).reduce((a, b) => a + (b ?? 0), 0));
  assert.equal(bonus.atkPercent, 12);
  assert.equal(bonus.defPercent, 12);
  let withHero = 0;
  let without = 0;
  const RUNS = 300;
  for (let i = 0; i < RUNS; i += 1) {
    const rng = mulberry32(1000 + i);
    if (resolveBattle(attacker, defender, { rng, attackerHero: { atkPercent: bonus.atkPercent, defPercent: bonus.defPercent } }).attackerWon) {
      withHero += 1;
    }
    if (resolveBattle(attacker, defender, { rng }).attackerWon) {
      without += 1;
    }
  }
  // 基线：等势不带将约五五开；带将明显改善但不满 100%（封顶保证难度不被打穿）
  assert.ok(without < RUNS * 0.65, `不带将胜率应低，实际 ${without}/${RUNS}`);
  assert.ok(withHero > without + RUNS * 0.2, `带将胜率应显著更高，实际 ${withHero}/${RUNS} vs ${without}/${RUNS}`);
  assert.ok(withHero < RUNS, `封顶 20% 下不应必胜，实际 ${withHero}/${RUNS}`);
});
