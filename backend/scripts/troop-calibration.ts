// 二期兵种校准脚本（AISLG-86~90）：固定种子批量跑「等价值」对局，输出攻方胜率——
// 复现需求里的模拟表（克制 / 冲车破墙 / 床弩反弓箭 / 铁骑定位）并写入 docs/battle-calibration.md。
// 价值 = 单兵成本五项资源之和 × 数量（编队价值相当才有可比性）。
// 用法：npm run calibrate:troops [-- --runs 300]

import type { TroopKind } from '../common/src/protocol';
import { TROOP_INFO } from '../common/src/troops';
import { simulateBattle } from '../common/src/battle-engine';

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

function value(army: Army): number {
  let total = 0;
  for (const [kind, count] of Object.entries(army) as Array<[TroopKind, number]>) {
    const c = TROOP_INFO[kind].cost;
    total += count * (c.gold + c.wood + c.food + c.stone + c.iron);
  }
  return total;
}

const runsArg = process.argv.indexOf('--runs');
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 300;

function winRate(name: string, attacker: Army, defender: Army, opts: { siege?: boolean; wall?: number } = {}): string {
  let wins = 0;
  for (let i = 0; i < RUNS; i += 1) {
    const rng = mulberry32(Array.from(name).reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261) + i);
    const result = simulateBattle(attacker, defender, { siege: opts.siege ?? false, wallDefensePercent: opts.wall ?? 0, rng });
    wins += result.attackerWon ? 1 : 0;
  }
  return `${((wins / RUNS) * 100).toFixed(0)}%`;
}

function row(label: string, attacker: Army, defender: Army, opts: { siege?: boolean; wall?: number } = {}): void {
  const defend = Object.entries(defender).map(([k, v]) => `${TROOP_INFO[k as TroopKind].label}${v}`).join('+');
  const attack = Object.entries(attacker).map(([k, v]) => `${TROOP_INFO[k as TroopKind].label}${v}`).join('+');
  console.log(`| ${label} | ${attack}（价值 ${value(attacker)}） | ${defend}${opts.wall ? `，墙 ${opts.wall}%` : ''} | ${winRate(label + attack + defend, attacker, defender, opts)} |`);
}

console.log(`二期兵种校准：每组 ${RUNS} 局固定种子（攻方胜率）\n`);
console.log('## 克制（AISLG-87，野地遭遇战，等价值）\n| 对局 | 攻方 | 守方 | 攻方胜率 |\n|---|---|---|---|');
row('长枪打轻骑', { pikeman: 200 }, { cavalry: 120 });
row('刀盾打弓箭（守方据墙）', { swordsman: 150 }, { archer: 137 }, { siege: true, wall: 0 });
row('长枪打刀盾（不变）', { pikeman: 170 }, { swordsman: 147 });
row('弓箭打长枪（不变）', { archer: 100 }, { pikeman: 126 });

console.log('\n## 冲车破墙（AISLG-86，攻城战，守军 刀盾150 + 弓100）\n| 对局 | 攻方 | 守方 | 攻方胜率 |\n|---|---|---|---|');
for (const wall of [70, 50]) {
  row('无冲车', { swordsman: 250, archer: 150 }, { swordsman: 150, archer: 100 }, { siege: true, wall });
  row('带冲车 20', { swordsman: 200, archer: 150, siege_ram: 20 }, { swordsman: 150, archer: 100 }, { siege: true, wall });
  row('多花 20% 堆兵', { swordsman: 300, archer: 180 }, { swordsman: 150, archer: 100 }, { siege: true, wall });
}
row('带冲车 8%（过多）', { swordsman: 190, archer: 140, siege_ram: 40 }, { swordsman: 150, archer: 100 }, { siege: true, wall: 70 });

console.log('\n## 床弩（AISLG-89，守军 弓200 据墙，墙 50%，等价值）\n| 对局 | 攻方 | 守方 | 攻方胜率 |\n|---|---|---|---|');
row('弓箭同价值', { archer: 180 }, { archer: 200 }, { siege: true, wall: 50 });
row('刀盾同价值', { swordsman: 196 }, { archer: 200 }, { siege: true, wall: 50 });
row('床弩同价值', { ballista: 102 }, { archer: 200 }, { siege: true, wall: 50 });
row('刀盾 + 床弩混编', { swordsman: 100, ballista: 60 }, { archer: 200 }, { siege: true, wall: 50 });

console.log('\n## 铁骑兵（AISLG-90，野地遭遇战，等价值）\n| 对局 | 攻方 | 守方 | 攻方胜率 |\n|---|---|---|---|');
row('铁骑打轻骑', { iron_cavalry: 100 }, { cavalry: 159 });
row('铁骑打刀盾', { iron_cavalry: 100 }, { swordsman: 227 });
row('轻骑打刀盾（对照）', { cavalry: 159 }, { swordsman: 227 });
row('铁骑打长枪（含克制）', { iron_cavalry: 100 }, { pikeman: 263 });
