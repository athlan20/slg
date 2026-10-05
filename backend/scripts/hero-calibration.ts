// 武将加成校准脚本（AISLG-114 / 116 验收）：固定种子批量跑 PvE 对局，对比「不带将 / 各档武将」的攻方胜率，
// 确认 20% 加成封顶下难度没有失控——满级名将也不会把现有 PvE 打穿。
// 做法：攻方 = 守军同构成按倍率 f 缩放的部队（f = 0.8 / 1.0 / 1.2，等势上下的三档），
// 武将加成按部队规模折算统率摊薄（heroBattleBonus），与 Worker 结算同口径。
// 用法：npm run calibrate:hero [-- --runs 300]；记录见 docs/battle-calibration.md「武将加成」一节。

import type { TroopKind } from '../common/src/protocol';
import { nativeGarrisonBase, wallDefensePercent } from '../common/src/battle';
import { simulateBattle } from '../common/src/battle-engine';
import { armyTotal, heroBattleBonus, HERO_LEVEL_MAX, type HeroAttrs } from '../common/src/hero';
import { famousGarrisons } from '../common/src/famous-city';
import { ytGarrison } from '../common/src/yellow-turban';
import { MOVING_KIND_INFO } from '../common/src/moving-target';
import { NPC_CITY_PROFILE } from '../common/src/world';

type Army = Partial<Record<TroopKind, number>>;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 300;

function scale(army: Army, factor: number): Army {
  const out: Army = {};
  for (const [kind, count] of Object.entries(army) as Array<[TroopKind, number]>) {
    out[kind] = Math.max(1, Math.round(count * factor));
  }
  return out;
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

interface HeroCase {
  label: string;
  attrs: HeroAttrs | null;
}

/** 武将档位：普通将随机范围 10–40（均值 25）；满级 = 20 级（19 次成长，普通 +1 / 名将 +2 每项） */
const HEROES: HeroCase[] = [
  { label: '不带将', attrs: null },
  { label: '普通将均值 25/25/25', attrs: { lead: 25, force: 25, wit: 25 } },
  { label: '普通将极品 40/40/40', attrs: { lead: 40, force: 40, wit: 40 } },
  { label: '普通将满级 59/59/59', attrs: { lead: 40 + HERO_LEVEL_MAX - 1, force: 40 + HERO_LEVEL_MAX - 1, wit: 40 + HERO_LEVEL_MAX - 1 } },
  { label: '名将 65/65/65', attrs: { lead: 65, force: 65, wit: 65 } },
  { label: '名将满级 103/103/103', attrs: { lead: 65 + 2 * (HERO_LEVEL_MAX - 1), force: 65 + 2 * (HERO_LEVEL_MAX - 1), wit: 65 + 2 * (HERO_LEVEL_MAX - 1) } },
];

interface Target {
  name: string;
  defender: Army;
  siege: boolean;
  wall: number;
}

const npcWall = (level: number): number => wallDefensePercent(NPC_CITY_PROFILE[level].buildings.wall ?? 0);

const TARGETS: Target[] = [
  ...[1, 3, 5, 8, 10].map((level) => ({ name: `野地 Lv${level}`, defender: nativeGarrisonBase(level) as Army, siege: false, wall: 0 })),
  ...[1, 2, 3].map((level) => ({ name: `NPC 城 Lv${level}（据墙）`, defender: NPC_CITY_PROFILE[level].garrison as Army, siege: true, wall: npcWall(level) })),
  { name: '名城外围 Lv3', defender: famousGarrisons(3).outer, siege: false, wall: 0 },
  { name: '名城守将 Lv3（据墙）', defender: famousGarrisons(3).keeper, siege: true, wall: npcWall(3) },
  { name: '黄巾小营', defender: ytGarrison('small'), siege: false, wall: 0 },
  { name: '黄巾中营', defender: ytGarrison('medium'), siege: false, wall: 0 },
  { name: '黄巾大营', defender: ytGarrison('large'), siege: false, wall: 0 },
  { name: '黄巾老巢外围', defender: ytGarrison('boss', 'outer'), siege: false, wall: 0 },
  { name: '黄巾老巢城守', defender: ytGarrison('boss', 'keeper'), siege: true, wall: npcWall(3) },
  { name: '运粮商队 Lv5', defender: MOVING_KIND_INFO.caravan.garrison(5) as Army, siege: false, wall: 0 },
  { name: '流寇 Lv5', defender: MOVING_KIND_INFO.bandit.garrison(5) as Army, siege: false, wall: 0 },
];

const FACTORS = [0.8, 1.0, 1.2];

function winRate(target: Target, factor: number, hero: HeroCase): { rate: number; bonus: string } {
  const attacker = scale(target.defender, factor);
  const bonus = hero.attrs ? heroBattleBonus(hero.attrs, armyTotal(attacker)) : null;
  const seed = hashString(`${target.name}-${factor}`);
  let wins = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const result = simulateBattle(attacker, target.defender, {
      siege: target.siege,
      wallDefensePercent: target.wall,
      rng: mulberry32(seed + i),
      attackerHero: bonus ? { atkPercent: bonus.atkPercent, defPercent: bonus.defPercent } : null,
    });
    wins += result.attackerWon ? 1 : 0;
  }
  return { rate: wins / RUNS, bonus: bonus ? `攻 +${bonus.atkPercent}% 减伤 ${bonus.defPercent}%${bonus.scale < 1 ? ` 摊薄×${bonus.scale}` : ''}` : '' };
}

console.log(`武将加成校准：每格 ${RUNS} 局固定种子；攻方 = 守军同构成 × 倍率（等势上下），数值为攻方胜率\n`);
for (const factor of FACTORS) {
  console.log(`## 攻方兵力 = 守军 × ${factor}`);
  console.log(`| 目标 | 攻方兵数 | ${HEROES.map((hero) => hero.label).join(' | ')} |`);
  console.log(`| --- | --- | ${HEROES.map(() => '---').join(' | ')} |`);
  for (const target of TARGETS) {
    const cells = HEROES.map((hero) => `${Math.round(winRate(target, factor, hero).rate * 100)}%`);
    console.log(`| ${target.name} | ${armyTotal(scale(target.defender, factor))} | ${cells.join(' | ')} |`);
  }
  console.log('');
}
console.log('## 各档武将的实际加成（部队 200 兵 / 1000 兵）');
console.log('| 武将 | 200 兵 | 1000 兵 |');
console.log('| --- | --- | --- |');
for (const hero of HEROES.slice(1)) {
  const small = heroBattleBonus(hero.attrs as HeroAttrs, 200);
  const large = heroBattleBonus(hero.attrs as HeroAttrs, 1000);
  console.log(`| ${hero.label} | 攻 +${small.atkPercent}% / 减伤 ${small.defPercent}%（吃满上限 ${small.leadCap} 兵） | 攻 +${large.atkPercent}% / 减伤 ${large.defPercent}% |`);
}
