// 城防器械校准脚本（AISLG-193）：固定种子跑「城墙 10 + 箭塔 10」的守城战，
// 对比 0 / 500 / 600 / 1000 件器械（按陷阱:拒马:滚木:擂石 = 4:3:2:1 分配）时，
// 攻方需要多带多少兵才能五五开。需求预研的估计是 0 件 0.91×、500 件 1.08×、1000 件 1.21×；
// 正式引擎复跑后绝对值更高（1.28× → 1.42× → 1.46×），相对增量 +11% / +14%，
// 原因见 docs/battle-calibration.md「城防器械」一节（城墙减伤 + 攻守角色不对称 + 擂石反制冲车）。
// 用法：npm run calibrate:defense [-- --runs 200]。

import type { TroopKind } from '../common/src/protocol';
import { simulateBattle } from '../common/src/battle-engine';
import { wallDefensePercent } from '../common/src/battle';
import { towerStats } from '../common/src/building-effects';
import { DEFENSE_KINDS, type DefenseStock } from '../common/src/city-defense';

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
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 200;

/** 守方：刀盾 600 + 弓箭 600 + 长枪 200；城墙 10 级、箭塔 10 级（与需求一致） */
const DEFENDER: Army = { swordsman: 600, archer: 600, pikeman: 200 };
const WALL = wallDefensePercent(10);

/** 攻方基准混编（步兵 / 弓箭 / 骑兵 / 冲车），按倍率放大：
 *  与守方同规模的核心步弓 + 一支骑兵与冲车分队（四种器械都有对口目标） */
const ATTACKER_BASE: Army = { swordsman: 600, archer: 600, pikeman: 200, cavalry: 200, siege_ram: 20 };

/** 器械配比 4:3:2:1 */
const RATIO: Record<(typeof DEFENSE_KINDS)[number], number> = { trap: 4, chevaux: 3, rolling_log: 2, boulder: 1 };

function defenseStock(total: number): DefenseStock {
  const sum = DEFENSE_KINDS.reduce((s, kind) => s + RATIO[kind], 0);
  const stock: DefenseStock = {};
  for (const kind of DEFENSE_KINDS) {
    stock[kind] = Math.floor((total * RATIO[kind]) / sum);
  }
  return stock;
}

function scale(army: Army, factor: number): Army {
  const out: Army = {};
  for (const [kind, count] of Object.entries(army) as Array<[TroopKind, number]>) {
    out[kind] = Math.max(1, Math.round(count * factor));
  }
  return out;
}

function winRate(factor: number, stock: DefenseStock | null): number {
  const attacker = scale(ATTACKER_BASE, factor);
  let wins = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const result = simulateBattle(attacker, DEFENDER, {
      siege: true,
      wallDefensePercent: WALL,
      tower: towerStats(10),
      defenses: stock,
      rng: mulberry32(Math.round(factor * 10000) * 1013 + (stock?.trap ?? 0) * 31 + i),
    });
    wins += result.attackerWon ? 1 : 0;
  }
  return wins / RUNS;
}

/** 找到五五开需要的兵力倍率（0.60..2.40，步长 0.02，首个 ≥50% 的倍率） */
function fiftyPercent(stock: DefenseStock | null): { factor: number; rate: number } {
  for (let factor = 0.6; factor <= 2.4001; factor += 0.02) {
    const rate = winRate(factor, stock);
    if (rate >= 0.5) {
      return { factor, rate };
    }
  }
  return { factor: 2.4, rate: 1 };
}

console.log(`城防器械校准：每组 ${RUNS} 局；守方 ${JSON.stringify(DEFENDER)}，城墙减伤 ${WALL}%，箭塔 10 级`);
console.log(`攻方基准混编 ${JSON.stringify(ATTACKER_BASE)}，器械按 4:3:2:1 分配\n`);
console.log('| 器械总数 | 陷阱/拒马/滚木/擂石 | 五五开所需兵力倍率 | 相对无器械 | 实测胜率 |');
console.log('| --- | --- | --- | --- | --- |');
let baseline: number | null = null;
for (const total of [0, 500, 600, 1000]) {
  const stock = total > 0 ? defenseStock(total) : null;
  const found = fiftyPercent(stock);
  baseline ??= found.factor;
  const split = stock ? DEFENSE_KINDS.map((kind) => stock[kind] ?? 0).join('/') : '0/0/0/0';
  const relative = baseline > 0 ? `${(((found.factor / baseline) - 1) * 100).toFixed(1)}%` : '—';
  console.log(`| ${total} | ${split} | ${found.factor.toFixed(2)}× | ${relative} | ${(found.rate * 100).toFixed(1)}% |`);
}
