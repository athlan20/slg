// 竞技场校准脚本（v53，AISLG-145）：固定种子批量跑「三局两胜」对局，看标准军队（人数 = 基础兵数 + 统率 × 每点统率兵数，刀盾 / 弓箭各一半；当前取值见 common/src/arena.ts）
// 下统率差距的胜率，以及阵容排序（强将放 1 号位还是 3 号位）有没有策略空间。
// 数值仍是占位：这里的输出用来拍板 ARENA_ARMY_KINDS / 标准军队构成，结论记在 docs/battle-calibration.md「竞技场」一节。
// 用法：npm run calibrate:arena [-- --runs 300]

import { playArenaMatch, seededRng, type ArenaFighter } from '../common/src/arena';

const argRuns = process.argv.indexOf('--runs');
const RUNS = argRuns >= 0 ? Math.max(20, Number(process.argv[argRuns + 1]) || 300) : 300;

const fighter = (lead: number, force = 50, wit = 50): ArenaFighter => ({ name: `统${lead}`, lead, force, wit, level: 10 });

/** 挑战方胜率（0..1）：每一局用不同种子，整体可复算 */
function winRate(challengers: ArenaFighter[], defenders: ArenaFighter[]): number {
  let wins = 0;
  for (let i = 0; i < RUNS; i += 1) {
    if (playArenaMatch(challengers, defenders, seededRng(1000 + i)).challengerWon) {
      wins += 1;
    }
  }
  return wins / RUNS;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`竞技场校准（每组 ${RUNS} 场，固定种子，武力 / 智力 = 50）\n`);

console.log('## 1. 统率差距：三名同统率武将对三名同统率武将，挑战方胜率');
const leads = [30, 50, 70, 90];
console.log(`攻 \\ 守   ${leads.map((l) => `统${l}`.padStart(8)).join('')}`);
for (const mine of leads) {
  const row = leads.map((theirs) => {
    const rate = winRate([fighter(mine), fighter(mine), fighter(mine)], [fighter(theirs), fighter(theirs), fighter(theirs)]);
    return pct(rate).padStart(8);
  });
  console.log(`统${String(mine).padEnd(6)}${row.join('')}`);
}

console.log('\n## 2. 阵容排序：守方各号位强度不同时，挑战方排序有没有影响（2×2）');
// 守方的阵容对挑战方可见，所以排序是可以选择的策略；守方全员同强时排序无意义，这里只测异质守方
const heavyFirst = [fighter(90), fighter(50), fighter(30)];
const heavyLast = [fighter(30), fighter(50), fighter(90)];
const defFirst = [fighter(90), fighter(50), fighter(30)];
const defLast = [fighter(30), fighter(50), fighter(90)];
console.log(`${''.padEnd(12)}守方 强在前   守方 强在后`);
console.log(`我方 强在前  ${pct(winRate(heavyFirst, defFirst)).padStart(12)}   ${pct(winRate(heavyFirst, defLast)).padStart(12)}`);
console.log(`我方 强在后  ${pct(winRate(heavyLast, defFirst)).padStart(12)}   ${pct(winRate(heavyLast, defLast)).padStart(12)}`);

console.log('\n## 3. 同样的人，武力高 vs 统率高（武力、智力只加到 20% 封顶，统率决定兵数）');
const leadHeavy = [fighter(90, 50), fighter(90, 50), fighter(90, 50)];
const forceHeavy = [fighter(50, 90), fighter(50, 90), fighter(50, 90)];
console.log(`三人统90 武50 对 三人统50 武90：挑战方 ${pct(winRate(leadHeavy, forceHeavy))}`);
