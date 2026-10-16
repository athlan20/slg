// 名城专属兵种（v64，AISLG-168）：8 座名城各一种，只能在占领该名城的分城军营征募；数值相对同类普通兵的倍率；克制与专长

import assert from 'node:assert/strict';
import test from 'node:test';
import { TROOP_KINDS, type TroopKind } from '../common/src/protocol';
import { FAMOUS_CITY_NAMES } from '../common/src/famous-city';
import { FAMOUS_ELITE_TROOP, eliteTroopOf, famousCityOfEliteTroop } from '../common/src/famous-effects';
import { TROOP_INFO, startRecruit, MAX_ACTIVE_RECRUITS, RECRUIT_QUEUE_CAPACITY } from '../common/src/troops';
import { TROOP_STATS } from '../common/src/battle-engine';
import { TROOP_POWER } from '../common/src/battle';
import { counterMultiplier } from '../common/src/troop-counter';
import { SPECIALTY_RULES } from '../common/src/hero-specialty';

const RICH = { gold: 1e9, wood: 1e9, food: 1e9, stone: 1e9, iron: 1e9 };
const ELITE = Object.values(FAMOUS_ELITE_TROOP);

/** 普通底版：每种专属兵对应的同类普通兵（成本 ×2、人口 ×2、时长 ×1.5、耗粮 ×1.5、军营门槛 +3） */
const BASE_OF: Record<string, TroopKind> = {
  yulin_guard: 'swordsman',
  danyang_soldier: 'swordsman',
  baimao_soldier: 'pikeman',
  huwei_guard: 'pikeman',
  zhuge_crossbow: 'archer',
  xiandeng_warrior: 'archer',
  hubao_cavalry: 'cavalry',
  xiliang_cavalry: 'cavalry',
};

test('名城与专属兵一一对应：8 座名城各一种、8 种专属兵互不重复，且都在 TROOP_KINDS 内', () => {
  assert.equal(new Set(ELITE).size, 8);
  for (const name of FAMOUS_CITY_NAMES) {
    assert.ok(FAMOUS_ELITE_TROOP[name], `${name} 应有专属兵`);
    assert.ok((TROOP_KINDS as readonly string[]).includes(FAMOUS_ELITE_TROOP[name]));
    assert.equal(famousCityOfEliteTroop(FAMOUS_ELITE_TROOP[name]), name);
    assert.equal(eliteTroopOf(name), FAMOUS_ELITE_TROOP[name]);
  }
  assert.equal(eliteTroopOf(null), null);
  assert.equal(eliteTroopOf('不存在的名城'), null);
  assert.equal(famousCityOfEliteTroop('swordsman'), null, '普通兵种不属于任何名城');
});

test('专属兵数值表齐全：属性、人口、成本、时长、耗粮、门槛、参考战力都有', () => {
  for (const troop of ELITE) {
    assert.ok(TROOP_STATS[troop], `${troop} 应有战斗属性`);
    assert.ok(TROOP_INFO[troop].label.length > 0, `${troop} 应有中文名`);
    assert.ok(TROOP_POWER[troop] > 0, `${troop} 应有参考战力`);
  }
});

test('专属兵相对同类普通兵：成本 ×2、人口 ×2、时长 ×1.5、耗粮 ×1.5、军营门槛 +3', () => {
  for (const troop of ELITE) {
    const base = TROOP_INFO[BASE_OF[troop]];
    const elite = TROOP_INFO[troop];
    assert.equal(elite.population, base.population * 2, `${troop} 人口`);
    assert.equal(elite.unitSeconds, Math.round(base.unitSeconds * 1.5), `${troop} 时长`);
    assert.ok(Math.abs(elite.foodUse - base.foodUse * 1.5) <= 0.5, `${troop} 耗粮`);
    assert.equal(elite.barracksLevel, base.barracksLevel + 3, `${troop} 军营门槛`);
    for (const key of ['gold', 'wood', 'food', 'iron'] as const) {
      assert.equal(elite.cost[key], base.cost[key] * 2, `${troop} 成本 ${key}`);
    }
  }
});

test('专属兵属性按复验口径的倍率（f 乘在 v64 占位基准上，四舍五入）：步兵约 1.5、西凉 1.35、虎豹 1.8、连弩 80 射程 ×0.95', () => {
  // 基准 = 上一版占位属性（对同类普通兵的 f 已在建议里定稿）；f 变化见 battle-engine.ts 注释与 scratchpad 校准记录
  const BASE: Record<string, { hp: number; atk: number; def: number; f: number }> = {
    yulin_guard: { hp: 1400, atk: 320, def: 390, f: 1.5 },
    danyang_soldier: { hp: 1200, atk: 410, def: 340, f: 1.45 },
    baimao_soldier: { hp: 975, atk: 286, def: 234, f: 1.55 },
    huwei_guard: { hp: 1100, atk: 240, def: 240, f: 1.6 },
    zhuge_crossbow: { hp: 276, atk: 265, def: 66, f: 0.95 },
    xiandeng_warrior: { hp: 325, atk: 340, def: 78, f: 1.5 },
    hubao_cavalry: { hp: 1430, atk: 494, def: 195, f: 1.8 },
    xiliang_cavalry: { hp: 1500, atk: 500, def: 190, f: 1.35 },
  };
  for (const [troop, b] of Object.entries(BASE)) {
    const s = TROOP_STATS[troop as TroopKind];
    for (const key of ['hp', 'atk', 'def'] as const) {
      assert.ok(Math.abs(s[key] - b[key] * b.f) <= 1, `${troop} ${key} 应为 ${b[key]}×${b.f}，实际 ${s[key]}`);
    }
  }
  assert.equal(TROOP_STATS.zhuge_crossbow.range, 80, '连弩射程 80（射程 ≤79 对弓箭几乎必败，80 起才有可用区间）');
  assert.equal(TROOP_STATS.xiandeng_warrior.range, 60, '先登死士射程保留 60');
  assert.equal(TROOP_STATS.hubao_cavalry.speed, 130, '虎豹骑速度 130，全军最快');
  // 虎豹骑补足后三项合计略超铁骑兵（建议口径，约 1.11 倍）：此上限为校准口径，不是压倒性上限
  const ironSum = TROOP_STATS.iron_cavalry.hp + TROOP_STATS.iron_cavalry.atk + TROOP_STATS.iron_cavalry.def;
  const hubaoSum = TROOP_STATS.hubao_cavalry.hp + TROOP_STATS.hubao_cavalry.atk + TROOP_STATS.hubao_cavalry.def;
  assert.ok(hubaoSum <= ironSum * 1.15, `虎豹骑三项合计 ${hubaoSum} 不应超过铁骑兵 ${ironSum} 的 1.15 倍`);
});

test('征兵校验：只有占领对应名城才能征募，主城 / 其他名城 / 失守（null）都拒绝', () => {
  const troop: TroopKind = 'yulin_guard';
  const ok = startRecruit(troop, 1, RICH, 100, 7, 0, 0, '洛阳');
  assert.ok(ok.ok && ok.mode === 'start', '洛阳分城应能征募羽林卫');
  for (const other of [null, '建业', '长安'] as const) {
    const verdict = startRecruit(troop, 1, RICH, 100, 7, 0, 0, other);
    assert.ok(!verdict.ok && verdict.code === 'ELITE_TROOP_LOCKED', `城池为 ${other} 时应拒绝：${JSON.stringify(verdict)}`);
  }
});

test('征兵校验：专属兵的锁先于军营门槛判定；对应名城后仍受军营门槛约束', () => {
  const locked = startRecruit('hubao_cavalry', 1, RICH, 100, 0, 0, 0, null);
  assert.ok(!locked.ok && locked.code === 'ELITE_TROOP_LOCKED', '非名城时即使军营不够也先报专属锁');
  const lowBarracks = startRecruit('hubao_cavalry', 1, RICH, 100, 8, 0, 0, '官渡');
  assert.ok(!lowBarracks.ok && lowBarracks.code === 'TROOP_NOT_AVAILABLE', '官渡分城军营 8 级仍不够虎豹骑（需 9）');
  const enough = startRecruit('hubao_cavalry', 1, RICH, 100, 9, 0, 0, '官渡');
  assert.ok(enough.ok, '官渡分城军营 9 级可征虎豹骑');
});

test('征兵校验：专属兵与普通兵一样受资源、人口、队列约束', () => {
  const poor = startRecruit('xiandeng_warrior', 1, { ...RICH, iron: 0 }, 100, 8, 0, 0, '邺城');
  assert.ok(!poor.ok && poor.code === 'INSUFFICIENT_RESOURCES');
  const noPeople = startRecruit('xiandeng_warrior', 1, RICH, 1, 8, 0, 0, '邺城');
  assert.ok(!noPeople.ok && noPeople.code === 'INSUFFICIENT_POPULATION');
  const full = startRecruit('xiandeng_warrior', 1, RICH, 100, 8, MAX_ACTIVE_RECRUITS, RECRUIT_QUEUE_CAPACITY, '邺城');
  assert.ok(!full.ok && full.code === 'RECRUIT_QUEUE_FULL');
});

test('克制：白毦兵对骑兵 ×1.4（高于普通长枪 ×1.2），对四种骑兵一视同仁；虎卫军与长枪同为 ×1.2', () => {
  assert.equal(counterMultiplier('baimao_soldier', 'cavalry'), 1.4);
  assert.equal(counterMultiplier('baimao_soldier', 'iron_cavalry'), 1.4);
  assert.equal(counterMultiplier('baimao_soldier', 'hubao_cavalry'), 1.4);
  assert.equal(counterMultiplier('baimao_soldier', 'xiliang_cavalry'), 1.4);
  assert.equal(counterMultiplier('pikeman', 'hubao_cavalry'), 1.2, '长枪克制的骑兵清单含新骑兵');
  assert.equal(counterMultiplier('baimao_soldier', 'swordsman'), 1);
});

test('专长：专属兵计入对应兵种类（英雄专长对专属兵生效）', () => {
  assert.ok(SPECIALTY_RULES.cavalry.troops.includes('hubao_cavalry'));
  assert.ok(SPECIALTY_RULES.cavalry.troops.includes('xiliang_cavalry'));
  assert.ok(SPECIALTY_RULES.infantry.troops.includes('yulin_guard'));
  assert.ok(SPECIALTY_RULES.ranged.troops.includes('zhuge_crossbow'));
});
