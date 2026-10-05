// 箭塔数值校准脚本（AISLG-82）：固定种子批量跑「NPC 袭击主城」守城战（simulateBattle siege + 城墙 + 箭塔），
// 对比不同箭塔等级下的守住率、双方战损与箭塔输出占比——评审定出每级伤害 / 射程的依据与复现入口。
// 用法：npm run calibrate:tower [-- --runs 400]；记录见 docs/battle-calibration.md「箭塔」一节。

import type { TroopKind } from '../common/src/protocol';
import { npcRaidArmy, wallDefensePercent } from '../common/src/battle';
import { simulateBattle } from '../common/src/battle-engine';
import { TOWER_DAMAGE_PER_LEVEL, TOWER_RANGE_BASE, TOWER_RANGE_PER_LEVEL, towerStats } from '../common/src/building-effects';

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

type Army = Partial<Record<TroopKind, number>>;
const size = (army: Army): number => Object.values(army).reduce((sum: number, n) => sum + (n ?? 0), 0);

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 400;

/** 守军场景（城内驻军）：新号 / 中期 / 后期；城墙等级对应 */
const DEFENDERS: Array<{ name: string; garrison: Army; wall: number }> = [
  { name: '新号：义兵 30 + 弓 5', garrison: { militia: 30, archer: 5 }, wall: 1 },
  { name: '成长期：义兵 60 + 弓 10', garrison: { militia: 60, archer: 10 }, wall: 3 },
  { name: '中期：长枪 40 + 弓 20 + 刀盾 20', garrison: { pikeman: 40, archer: 20, swordsman: 20 }, wall: 5 },
  { name: '后期：长枪 80 + 弓 50 + 刀盾 60', garrison: { pikeman: 80, archer: 50, swordsman: 60 }, wall: 10 },
];
const RAID_LEVELS = [3, 6, 9];
const TOWER_LEVELS = [0, 1, 3, 5, 10];

console.log(`箭塔校准：每格 ${RUNS} 局，伤害 ${TOWER_DAMAGE_PER_LEVEL}/级，射程 ${TOWER_RANGE_BASE}+${TOWER_RANGE_PER_LEVEL}/级\n`);
for (const defender of DEFENDERS) {
  console.log(`## ${defender.name}（城墙 ${defender.wall} 级 = 减伤 ${wallDefensePercent(defender.wall)}%）`);
  console.log('| 袭击等级 | 箭塔 | 守住率 | 守方损失% | 攻方损失% | 箭塔输出占守方总输出% | 平均回合 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- |');
  for (const raid of RAID_LEVELS) {
    for (const level of TOWER_LEVELS) {
      let held = 0;
      let defLoss = 0;
      let attLoss = 0;
      let towerShare = 0;
      let rounds = 0;
      const attacker = npcRaidArmy(raid);
      for (let i = 0; i < RUNS; i += 1) {
        const rng = mulberry32(raid * 100003 + level * 1009 + i);
        const result = simulateBattle(attacker, defender.garrison, {
          wallDefensePercent: wallDefensePercent(defender.wall),
          siege: true,
          tower: towerStats(level),
          rng,
        });
        held += result.attackerWon ? 0 : 1;
        defLoss += Object.values(result.defender.losses).reduce((s, n) => s + n, 0) / size(defender.garrison);
        attLoss += Object.values(result.attacker.losses).reduce((s, n) => s + n, 0) / size(attacker);
        towerShare += result.defender.damage > 0 ? result.towerDamage / result.defender.damage : 0;
        rounds += result.rounds;
      }
      const pct = (v: number): string => ((v / RUNS) * 100).toFixed(0);
      console.log(`| Lv${raid}（${size(attacker)} 兵） | ${level} | ${pct(held)}% | ${pct(defLoss)} | ${pct(attLoss)} | ${pct(towerShare)} | ${(rounds / RUNS).toFixed(1)} |`);
    }
  }
  console.log('');
}
