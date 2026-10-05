// 战斗与耗粮数值的批量校准脚本（AISLG-2 数值评审）。
// 用固定种子的确定性 rng 批量跑 simulateBattle / resolveNpcRaid 场景矩阵，
// 输出胜率、战损、回合数与首次接敌回合等统计 —— 评审调参的依据与复现入口。
// 用法：npm run calibrate:battle [-- --runs 2000 --filter 镜像]
// 评审记录（数值定稿 + 验收区间）见 docs/battle-calibration.md。

import type { TerrainKind, TroopKind } from '../common/src/protocol';
import { TROOP_INFO } from '../common/src/troops';
import { TROOP_STATS, nativeGarrison, npcRaidArmy, resolveNpcRaid, wallDefensePercent, type BattleResult } from '../common/src/battle';
import { simulateBattle } from '../common/src/battle-engine';
import { NPC_CITY_PROFILE, wildernessGatherRate, wildernessBonusRate, TERRAIN_INFO } from '../common/src/world';
import { FIELD_TROOP_FOOD_MULTIPLIER, BASE_PRODUCTION_PER_HOUR, RATE_PER_LEVEL, productionPerHour } from '../common/src/production';

// ---- 确定性随机源（与 world.ts 的 mulberry32 同实现；按场景名 + 局号播种） ----

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

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// ---- 场景统计 ----

interface ScenarioStat {
  runs: number;
  /** 攻方胜率（NPC 袭击场景为守方守住率） */
  winRate: number;
  /** 平均回合数 */
  avgRounds: number;
  /** 平均首次接敌回合（roundLog 首个伤害 > 0 的回合；未接敌为 -） */
  avgFirstContact: number | null;
  /** 攻方平均损失比例（阵亡 / 参战，按兵数） */
  attLossRate: number;
  /** 守方平均损失比例 */
  defLossRate: number;
  /** 攻方零损失取胜的占比（「无风险单方面输出」指标） */
  losslessWinRate: number;
  endReasons: string;
}

type Army = Partial<Record<TroopKind, number>>;

function armySize(troops: Army): number {
  return Object.values(troops).reduce((sum: number, n) => sum + Math.floor(n ?? 0), 0);
}

function goldCost(troops: Army): number {
  let gold = 0;
  for (const [kind, count] of Object.entries(troops) as Array<[TroopKind, number | undefined]>) {
    gold += TROOP_INFO[kind].cost.gold * Math.floor(count ?? 0);
  }
  return gold;
}

function runBattleScenario(name: string, attacker: Army, defender: Army, runs: number, opts?: { siege?: boolean; wallDefensePercent?: number; maxRounds?: number }): ScenarioStat {
  let wins = 0;
  let roundsSum = 0;
  let firstContactSum = 0;
  let firstContactRuns = 0;
  let attLossSum = 0;
  let defLossSum = 0;
  let losslessWins = 0;
  const endReasons = new Map<string, number>();
  const seed = hashString(name);
  for (let i = 0; i < runs; i += 1) {
    const result: BattleResult = simulateBattle(attacker, defender, { rng: mulberry32(seed + i), ...opts });
    if (result.attackerWon) {
      wins += 1;
    }
    roundsSum += result.rounds;
    const firstContact = result.roundLog.find((e) => e.attackerDamage > 0 || e.defenderDamage > 0);
    if (firstContact) {
      firstContactSum += firstContact.round;
      firstContactRuns += 1;
    }
    const attInitial = armySize(result.attacker.troops);
    const defInitial = armySize(result.defender.troops);
    attLossSum += attInitial > 0 ? armySize(result.attacker.losses) / attInitial : 0;
    defLossSum += defInitial > 0 ? armySize(result.defender.losses) / defInitial : 0;
    if (result.attackerWon && armySize(result.attacker.losses) === 0) {
      losslessWins += 1;
    }
    endReasons.set(result.endReason, (endReasons.get(result.endReason) ?? 0) + 1);
  }
  return {
    runs,
    winRate: wins / runs,
    avgRounds: roundsSum / runs,
    avgFirstContact: firstContactRuns > 0 ? firstContactSum / firstContactRuns : null,
    attLossRate: attLossSum / runs,
    defLossRate: defLossSum / runs,
    losslessWinRate: losslessWins / runs,
    endReasons: [...endReasons.entries()].map(([reason, count]) => `${reason} ${(count / runs).toFixed(2)}`).join(' '),
  };
}

interface RaidStat {
  runs: number;
  /** 驻军守住率 */
  defendedRate: number;
  avgRounds: number;
  garrisonLossRate: number;
}

function runRaidScenario(name: string, garrison: Army, level: number, runs: number): RaidStat {
  let defended = 0;
  let roundsSum = 0;
  let lossSum = 0;
  const seed = hashString(name);
  for (let i = 0; i < runs; i += 1) {
    const raid = resolveNpcRaid(garrison, level, mulberry32(seed + i));
    if (raid.defended) {
      defended += 1;
    }
    roundsSum += raid.result.rounds;
    const initial = armySize(raid.result.defender.troops);
    lossSum += initial > 0 ? armySize(raid.result.defender.losses) / initial : 0;
  }
  return { runs, defendedRate: defended / runs, avgRounds: roundsSum / runs, garrisonLossRate: lossSum / runs };
}

// ---- 输出 ----

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function printBattleRow(name: string, stat: ScenarioStat): void {
  const first = stat.avgFirstContact === null ? '-' : stat.avgFirstContact.toFixed(1);
  console.log(
    `| ${name} | ${pct(stat.winRate)} | ${stat.avgRounds.toFixed(1)} | ${first} | ${pct(stat.attLossRate)} | ${pct(stat.defLossRate)} | ${pct(stat.losslessWinRate)} | ${stat.endReasons} |`,
  );
}

const args = process.argv.slice(2);
function argValue(flag: string): number | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : undefined;
}
const RUNS = argValue('--runs') ?? 1000;
const FILTER = args.includes('--filter') ? args[args.indexOf('--filter') + 1] : undefined;

function battleHeader(): void {
  console.log('| 场景 | 攻方胜率 | 平均回合 | 首次接敌 | 攻方损失 | 守方损失 | 零损胜 | 终局 |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- |');
}

function section(title: string, body: () => void): void {
  console.log(`\n## ${title}\n`);
  body();
}

const scenarios: Array<{ name: string; run: () => void }> = [
  {
    name: '初期（开局编成 vs Lv1 野地；同金 1600 的克制与混编对照）',
    run: () => {
      battleHeader();
      // 20 义兵（金 1600）挑战 1 级野地（10 义兵 + 2 弓箭兵）为开局基准场景
      printBattleRow('20 义兵 vs Lv1 野地', runBattleScenario('early-militia20-lv1', { militia: 20 }, nativeGarrison(1), RUNS));
      printBattleRow('8 弓箭兵（同金） vs Lv1 野地', runBattleScenario('early-archer8-lv1', { archer: 8 }, nativeGarrison(1), RUNS));
      printBattleRow('12 义兵 + 3 弓箭兵（同金） vs Lv1 野地', runBattleScenario('early-mix-lv1', { militia: 12, archer: 3 }, nativeGarrison(1), RUNS));
      printBattleRow('10 民夫（金 500） vs Lv1 野地', runBattleScenario('early-porter10-lv1', { porter: 10 }, nativeGarrison(1), RUNS));
      printBattleRow('10 斥候（金 1000） vs Lv1 野地', runBattleScenario('early-scout10-lv1', { scout: 10 }, nativeGarrison(1), RUNS));
    },
  },
  {
    name: '单位克制（同金对照：骑兵克远程 / 枪兵克骑兵 / 刀盾克义兵 / 混编价值）',
    run: () => {
      battleHeader();
      printBattleRow('8 弓箭兵（金 1600） vs 20 义兵（金 1600）', runBattleScenario('counter-archer-vs-militia', { archer: 8 }, { militia: 20 }, RUNS));
      printBattleRow('15 义兵 + 2 弓箭兵（金 1600） vs 20 义兵（金 1600）', runBattleScenario('counter-mixed15-vs-militia', { militia: 15, archer: 2 }, { militia: 20 }, RUNS));
      printBattleRow('5 轻骑兵（金 1500） vs 8 弓箭兵（金 1600）', runBattleScenario('counter-cav-vs-archer', { cavalry: 5 }, { archer: 8 }, RUNS));
      printBattleRow('10 长枪兵（金 1500） vs 5 轻骑兵（金 1500）', runBattleScenario('counter-pike-vs-cav', { pikeman: 10 }, { cavalry: 5 }, RUNS));
      printBattleRow('18 刀盾兵（金 1620） vs 20 义兵（金 1600）', runBattleScenario('counter-sword-vs-militia', { swordsman: 18 }, { militia: 20 }, RUNS));
      printBattleRow('6 刀盾兵 + 3 弓箭兵（金 1680） vs 20 义兵（金 1600）', runBattleScenario('counter-mixed-vs-militia', { swordsman: 6, archer: 3 }, { militia: 20 }, RUNS));
      printBattleRow('20 义兵（金 1600） vs 6 刀盾兵 + 3 弓箭兵（金 1680）守', runBattleScenario('counter-militia-vs-mixed', { militia: 20 }, { swordsman: 6, archer: 3 }, RUNS));
    },
  },
  {
    name: '难度曲线（野地 1~3 级，固定中期编成 30 义兵 + 8 弓箭兵）',
    run: () => {
      battleHeader();
      const army = { militia: 30, archer: 8 };
      for (const level of [1, 2, 3]) {
        printBattleRow(`30 义兵 + 8 弓箭兵 vs Lv${level} 野地`, runBattleScenario(`curve-wild-lv${level}`, army, nativeGarrison(level), RUNS));
      }
      // 同金（≈3120）混编 vs 纯编攻打 Lv2 野地（守军 20 义兵 + 4 弓箭兵）：混编是否有用途
      printBattleRow('39 义兵（金 3120） vs Lv2 野地', runBattleScenario('curve-pure-lv2', { militia: 39 }, nativeGarrison(2), RUNS));
      printBattleRow('24 义兵 + 6 弓箭兵（金 3120） vs Lv2 野地', runBattleScenario('curve-mixed-lv2', { militia: 24, archer: 6 }, nativeGarrison(2), RUNS));
    },
  },
  {
    name: 'NPC 袭击（驻军 20 义兵 / 30 义兵 + 8 弓箭兵守住 Lv1~3 袭击）',
    run: () => {
      console.log('| 场景 | 守住率 | 平均回合 | 驻军损失 |');
      console.log('| --- | --- | --- | --- |');
      for (const garrison of [{ militia: 20 }, { militia: 25 }, { militia: 15, archer: 2 }]) {
        const label = garrison.archer ? '15 义兵 + 2 弓箭兵' : `${garrison.militia} 义兵`;
        const a = runRaidScenario(`raid-${label}-lv1`, garrison, 1, RUNS);
        console.log(`| ${label}驻 Lv1 野地 | ${pct(a.defendedRate)} | ${a.avgRounds.toFixed(1)} | ${pct(a.garrisonLossRate)} |`);
      }
      for (const level of [2, 3]) {
        const a = runRaidScenario(`raid-militia20-lv${level}`, { militia: 20 }, level, RUNS);
        console.log(`| 20 义兵驻 Lv${level} 野地 | ${pct(a.defendedRate)} | ${a.avgRounds.toFixed(1)} | ${pct(a.garrisonLossRate)} |`);
      }
      for (const level of [1, 2, 3]) {
        const a = runRaidScenario(`raid-mix30-lv${level}`, { militia: 30, archer: 8 }, level, RUNS);
        console.log(`| 30 义兵 + 8 弓箭兵驻 Lv${level} 野地 | ${pct(a.defendedRate)} | ${a.avgRounds.toFixed(1)} | ${pct(a.garrisonLossRate)} |`);
      }
    },
  },
  {
    name: '攻 NPC 城池（Lv1 早期 / Lv2 中期 / Lv3 后期编成，守方据墙 + 城墙减伤）',
    run: () => {
      battleHeader();
      const attackers: Record<number, Army> = {
        1: { militia: 40, archer: 12 },
        2: { militia: 80, pikeman: 20, archer: 24, cavalry: 8 },
        3: { militia: 150, swordsman: 40, archer: 50, cavalry: 15 },
      };
      for (const level of [1, 2, 3]) {
        const profile = NPC_CITY_PROFILE[level];
        printBattleRow(
          `攻方（金 ${goldCost(attackers[level])}） vs NPC 城池 Lv${level}`,
          runBattleScenario(`npc-city-lv${level}`, attackers[level], profile.garrison, RUNS, {
            siege: true,
            wallDefensePercent: wallDefensePercent((profile.buildings.wall as number | undefined) ?? 0),
          }),
        );
      }
    },
  },
  {
    name: '镜像对抗（同编成互攻 / 交换攻守，野地遭遇战）',
    run: () => {
      battleHeader();
      const armies: Array<[string, Army]> = [
        ['20 义兵', { militia: 20 }],
        ['20 义兵 + 5 弓箭兵', { militia: 20, archer: 5 }],
        ['15 长枪兵 + 8 弓箭兵', { pikeman: 15, archer: 8 }],
      ];
      for (const [label, army] of armies) {
        printBattleRow(`镜像 ${label}（A 攻 B 守）`, runBattleScenario(`mirror-a-${label}`, army, army, RUNS));
        printBattleRow(`镜像 ${label}（B 攻 A 守，交换）`, runBattleScenario(`mirror-b-${label}`, army, army, RUNS));
      }
    },
  },
  {
    name: '城墙收益（等势攻防：34 义兵 + 10 弓箭兵 攻 30 义兵 + 8 弓箭兵守城）',
    run: () => {
      battleHeader();
      const attacker: Army = { militia: 34, archer: 10 };
      const garrison: Army = { militia: 30, archer: 8 };
      for (const wallLevel of [0, 1, 5, 10]) {
        printBattleRow(
          `墙 Lv${wallLevel} = ${wallDefensePercent(wallLevel)}%`,
          runBattleScenario(`wall-lv${wallLevel}`, attacker, garrison, RUNS, { siege: true, wallDefensePercent: wallDefensePercent(wallLevel) }),
        );
      }
      // 不死锁验证：等势攻方打不动墙 Lv10 时，2 倍兵力强攻必须可下
      printBattleRow(
        '墙 Lv10：强攻编成（2 倍兵力 60 义兵 + 20 弓箭兵）',
        runBattleScenario('wall-lv10-strong', { militia: 60, archer: 20 }, garrison, RUNS, { siege: true, wallDefensePercent: wallDefensePercent(10) }),
      );
    },
  },
  {
    name: '极端编成（守方纯近战 vs 攻方纯远程；同金 1600）',
    run: () => {
      battleHeader();
      // 20 义兵（金 1600）守城 vs 8 弓箭兵（金 1600）攻
      printBattleRow('8 弓箭兵 攻 20 义兵守城（无墙）', runBattleScenario('extreme-archer-vs-militia', { archer: 8 }, { militia: 20 }, RUNS, { siege: true, wallDefensePercent: 0 }));
      printBattleRow('8 弓箭兵 攻 20 义兵野地迎击', runBattleScenario('extreme-archer-vs-militia-field', { archer: 8 }, { militia: 20 }, RUNS));
      printBattleRow('8 弓箭兵 攻 20 义兵守城（墙 Lv5）', runBattleScenario('extreme-archer-vs-militia-wall5', { archer: 8 }, { militia: 20 }, RUNS, { siege: true, wallDefensePercent: wallDefensePercent(5) }));
      // 同金近战内战与远程内战
      printBattleRow('20 义兵 vs 20 义兵（同金近战内战）', runBattleScenario('extreme-melee-mirror', { militia: 20 }, { militia: 20 }, RUNS));
      printBattleRow('8 弓箭兵 vs 8 弓箭兵（同金远程内战）', runBattleScenario('extreme-archer-mirror', { archer: 8 }, { archer: 8 }, RUNS));
      // 强弱悬殊与少量单位长期互殴、回合耗尽（maxRounds 压到 12 制造 round_limit）
      printBattleRow('60 义兵 vs Lv1 野地（强弱悬殊）', runBattleScenario('extreme-overrun', { militia: 60 }, nativeGarrison(1), RUNS));
      printBattleRow('2 义兵 vs 2 义兵（少量单位互殴）', runBattleScenario('extreme-tiny', { militia: 2 }, { militia: 2 }, RUNS));
      printBattleRow('2 民夫 vs 2 民夫（回合上限 12）', runBattleScenario('extreme-porter-limit', { porter: 2 }, { porter: 2 }, RUNS, { maxRounds: 12 }));
    },
  },
];

console.log(`# 战斗数值校准（AISLG-2）\n`);
console.log(`每场景 ${RUNS} 局固定种子（场景名哈希播种，可复现）；rng = mulberry32。`);

for (const scenario of scenarios) {
  if (FILTER && !scenario.name.includes(FILTER)) {
    continue;
  }
  section(scenario.name, scenario.run);
}

// ---- 耗粮与供养经济（确定性计算，非随机模拟） ----

function foodSection(): void {
  console.log('| 场景 | 城内耗粮 | 野外耗粮(×2) | 采集收入 | 占领加成 | 野外净耗 |');
  console.log('| --- | --- | --- | --- | --- | --- |');
  const farmRates = [1, 2, 3];
  console.log(`\n基础产粮 ${BASE_PRODUCTION_PER_HOUR.food}/h，农田每级 +${RATE_PER_LEVEL.food}/h；野外耗粮 ×${FIELD_TROOP_FOOD_MULTIPLIER}。\n`);
  const terrains: TerrainKind[] = ['plain', 'grass', 'lake'];
  for (const level of [1, 2, 3]) {
    const garrison: Army = { militia: 50 };
    const upkeep = 50 * TROOP_INFO.militia.foodUse;
    for (const terrain of terrains.slice(0, 1)) {
      const gather = wildernessGatherRate(terrain, level, armySize(garrison));
      const bonus = wildernessBonusRate(terrain, level);
      console.log(
        `| 50 义兵驻 Lv${level} ${TERRAIN_INFO[terrain].label} | ${upkeep}/h | ${upkeep * FIELD_TROOP_FOOD_MULTIPLIER}/h | ${gather}/h | ${bonus}/h | ${upkeep * FIELD_TROOP_FOOD_MULTIPLIER - gather - bonus}/h |`,
      );
    }
  }
  console.log('\n| 农田配置 | 总产粮/h | 城 50 义兵净产 | 城养上限(1×) | 野养上限(2×, 无采集) |');
  console.log('| --- | --- | --- | --- | --- |');
  const militiaUpkeep = TROOP_INFO.militia.foodUse;
  for (const farmLevel of farmRates) {
    const total = productionPerHour({ farm: farmLevel }).food;
    console.log(`| 农田 Lv${farmLevel} | ${total}/h | ${total - 50 * militiaUpkeep}/h | ${Math.floor(total / militiaUpkeep)} 兵 | ${Math.floor(total / (militiaUpkeep * FIELD_TROOP_FOOD_MULTIPLIER))} 兵 |`);
  }
}

if (!FILTER || '耗粮'.includes(FILTER) || FILTER === '经济') {
  section('军队耗粮与供养经济', foodSection);
}
