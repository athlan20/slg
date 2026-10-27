// 科技数值校准脚本（AISLG-192 验收）：固定种子批量跑「满级战斗 + 防护」对「无科技」的野战，
// 确认科技强度落在需求拍板的区间——满科技一方约等于对手多带 15%~19% 的兵。
// 阵容沿用需求里的校准阵容：刀盾 300、弓箭 300、轻骑 100、长枪 100（每组 200 局）。
// 用法：npm run calibrate:tech [-- --runs 200]；记录见 docs/battle-calibration.md「科技」一节。

import type { TroopKind } from '../common/src/protocol';
import { simulateBattle } from '../common/src/battle-engine';
import { combatTechBonus, emptyTechLevels } from '../common/src/tech';

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

/** 需求里的校准阵容（野战） */
const ARMY: Army = { swordsman: 300, archer: 300, cavalry: 100, pikeman: 100 };

function scale(army: Army, factor: number): Army {
  const out: Army = {};
  for (const [kind, count] of Object.entries(army) as Array<[TroopKind, number]>) {
    out[kind] = Math.max(1, Math.round(count * factor));
  }
  return out;
}

function size(army: Army): number {
  return Object.values(army).reduce((sum: number, n) => sum + (n ?? 0), 0);
}

const tech = combatTechBonus({ ...emptyTechLevels(), combat: 10, protection: 10 });

/** 满科技方胜率：攻方带满级战斗 / 防护，守方无科技、兵力 × factor */
function winRate(factor: number): number {
  const defender = scale(ARMY, factor);
  let wins = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const result = simulateBattle(ARMY, defender, { siege: false, attackerTech: tech, rng: mulberry32(Math.round(factor * 10000) * 1009 + i) });
    wins += result.attackerWon ? 1 : 0;
  }
  return wins / RUNS;
}

console.log(`科技校准（战斗 + 防护满级）：每组 ${RUNS} 局；双方阵容 ${JSON.stringify(ARMY)}`);
console.log(`攻方科技：攻击 +${tech?.atkPercent}%、受伤 −${tech?.defPercent}%\n`);
console.log('| 守方兵力倍率 | 守方总兵力 | 满科技方胜率 |');
console.log('| --- | --- | --- |');
let fifty: number | null = null;
for (let factor = 1.08; factor <= 1.3001; factor += 0.02) {
  const rate = winRate(factor);
  console.log(`| ${factor.toFixed(2)}× | ${size(scale(ARMY, factor))} | ${(rate * 100).toFixed(1)}% |`);
  if (fifty === null && rate <= 0.5) {
    fifty = factor;
  }
}
console.log(
  fifty === null
    ? '\n结论：扫描范围内满科技方始终领先 50%，需扩大倍率扫描。'
    : `\n结论：守方多带约 ${Math.round((fifty - 1) * 100)}% 的兵即可与满科技方五五开（目标区间 15%~19%）。`,
);
