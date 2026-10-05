// 玩家对抗数值校准（AISLG-126）：对三期 PvP（AISLG-122~124）的全部占位数值做模拟，
// 回答需求列出的 6 个问题——掠夺收益 / 被打损失、等级差衰减、占分城代价、新手保护
// 门槛、各保护时长。战斗复用 battle-engine 的 simulateBattle（与 Worker 结算同口径），
// 经济口径取 rules.ts / troops.ts / plunder.ts / protection.ts 的现行常量；时长按
// 未加速基准（time_scale=1）讨论。
// 用法：npm run calibrate:pvp [-- --runs 400]；记录与结论见 docs/battle-calibration.md
//「玩家对抗数值校准（AISLG-126）」一节。

import type { TroopKind } from '../common/src/protocol';
import { simulateBattle } from '../common/src/battle-engine';
import { armyPower, nativeGarrisonBase, npcRaidArmy, wallDefensePercent } from '../common/src/battle';
import { TROOP_INFO, armyCarryCapacity } from '../common/src/troops';
import { wildernessPlunderPool, NPC_CITY_PROFILE } from '../common/src/world';
import { BUILDING_INFO, upgradeCost, upgradeSeconds } from '../common/src/rules';
import {
  DURABILITY_DAMAGE_PER_WIN,
  DURABILITY_MAX,
  DURABILITY_RAM_BONUS_MAX,
  DURABILITY_REGEN_PER_HOUR,
  PVP_CITY_TRUCE_MS,
  PVP_GOLD_SHARE,
  PVP_LEVEL_GAP_START,
  PVP_LEVEL_PENALTY_FLOOR,
  PVP_LEVEL_PENALTY_PER_LEVEL,
  PVP_PLUNDER_SHARE,
  pvpLevelFactor,
} from '../common/src/protection';
import { setTimeScaleCache } from '../common/src/time-scale';

// 本脚本全部时长按未加速基准讨论（文档口径）
setTimeScaleCache(1);

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
const RUNS = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 400;
const HOUR = 3600_000;

function line(title = ''): void {
  console.log(title ? `\n## ${title}` : '');
}

/** 兵力折金：按征兵成本的合成口径（金 + 四资源按集市 4:1 折金） */
function armyCostGold(army: Army): number {
  let gold = 0;
  for (const [kind, count] of Object.entries(army) as Array<[TroopKind, number]>) {
    const cost = TROOP_INFO[kind].cost;
    const fourRes = cost.wood + cost.food + cost.stone + cost.iron;
    gold += count * (cost.gold + fourRes / 4);
  }
  return gold;
}

/** 战损折金（Engine 的 losses 形态） */
function lossesCostGold(losses: Partial<Record<TroopKind, number>>): number {
  return armyCostGold(losses as Army);
}

/** 资源包折金（四资源按 4:1 折金，金币原值） */
function resourcesCostGold(res: { gold: number; food?: number; wood?: number; stone?: number; iron?: number }): number {
  const four = (res.food ?? 0) + (res.wood ?? 0) + (res.stone ?? 0) + (res.iron ?? 0);
  return res.gold + four / 4;
}

/** 典型守军编成（按官府等级推导的「正常玩家」口径：驻军 = 官府等级 × 基础编成） */
function defenderGarrison(govLevel: number): Army {
  const base: Army = { militia: 30, archer: 8 };
  const factor = govLevel;
  const out: Army = {};
  for (const [kind, count] of Object.entries(base) as Array<[TroopKind, number]>) {
    out[kind] = Math.round(count * factor);
  }
  return out;
}

/** 典型攻方编成：标准混编（义兵 60%、弓箭 20%、民夫 20% 保证负重），
 *  按参考战力对齐目标缩放——ratio 是「攻方战力 ÷ 守方战力」 */
function attackerForPower(defenderPower: number, ratio: number): Army {
  const mix: Army = { militia: 6, archer: 2, porter: 2 };
  const mixPower = armyPower(mix);
  const scale = (defenderPower * ratio) / mixPower;
  const out: Army = {};
  for (const [kind, count] of Object.entries(mix) as Array<[TroopKind, number]>) {
    out[kind] = Math.max(1, Math.round(count * scale));
  }
  return out;
}

/** 典型被打城资源（官府 N 级玩家攒了 12 小时的口径：产量 × 12h，钳储量上限的粗略近似） */
function typicalResources(govLevel: number): { gold: number; food: number; wood: number; stone: number; iron: number } {
  // 产量口径（未加速基准）：官府产金 100×等级/h（v19），四资源各按 2 座 Lv=官府 生产建筑估
  const gold = Math.min(100_000, 100 * govLevel * 12);
  const each = Math.min(22_000, (100 + 120 * Math.min(govLevel, 10)) * 12);
  return { gold, food: each, wood: each, stone: each, iron: each };
}

// ---- 问题 1：抢一次划不划算（对比打野地 / 打 NPC 城） ----

function question1(): void {
  line('问题 1：抢一次划不划算（攻方净收益 = 战利品折金 − 战损折金；负重大于池的口径）');
  const scenarios: Array<{ label: string; gov: number; ratio: number }> = [
    { label: '同级互打（官府 5 vs 5，等势）', gov: 5, ratio: 1.0 },
    { label: '同级互打（官府 10 vs 10，等势）', gov: 10, ratio: 1.0 },
    { label: '攻方略强（官府 5 打 5，1.3×兵力）', gov: 5, ratio: 1.3 },
    { label: '攻方略弱（官府 5 打 5，0.8×兵力）', gov: 5, ratio: 0.8 },
    { label: '大打小（官府 15 打 5）', gov: 5, ratio: 3.0 },
  ];
  console.log('场景 | 胜率 | 战利品折金 | 战损折金 | 净收益 | 行军往返 30 格耗时');
  const rng = mulberry32(20261003);
  for (const sc of scenarios) {
    const attackerGov = sc.label.includes('大打小') ? 15 : sc.gov;
    const defender = defenderGarrison(sc.gov);
    const wall = wallDefensePercent(Math.min(10, Math.floor(sc.gov / 2))); // 常见城墙等级 ≈ 官府一半
    let wins = 0;
    let lootGoldSum = 0;
    let lossGoldSum = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const attacker = attackerForPower(armyPower(defender), sc.ratio);
      const result = simulateBattle(attacker, defender, { siege: true, wallDefensePercent: wall, rng });
      if (result.attackerWon) {
        wins += 1;
        // 战利品：pvpPlunderPool 口径（仓库 5 级保护 5000/资源，30%/10%，等级差衰减）
        const res = typicalResources(sc.gov);
        const warehouse = Math.min(10, Math.floor(sc.gov / 2));
        const protection = 1000 * warehouse;
        const factor = pvpLevelFactor(attackerGov, sc.gov);
        const pool = {
          gold: Math.floor(res.gold * PVP_GOLD_SHARE * factor),
          food: Math.max(0, Math.floor((res.food - protection) * PVP_PLUNDER_SHARE * factor)),
          wood: Math.max(0, Math.floor((res.wood - protection) * PVP_PLUNDER_SHARE * factor)),
          stone: Math.max(0, Math.floor((res.stone - protection) * PVP_PLUNDER_SHARE * factor)),
          iron: Math.max(0, Math.floor((res.iron - protection) * PVP_PLUNDER_SHARE * factor)),
        };
        const carry = armyCarryCapacity(result.attacker.survivors, 0);
        // 按金→粮→木→石→铁装填
        let remaining = carry;
        let lootGold = 0;
        for (const key of ['gold', 'food', 'wood', 'stone', 'iron'] as const) {
          const take = Math.min(remaining, pool[key]);
          if (key === 'gold') {
            lootGold += take;
          } else {
            lootGold += take / 4;
          }
          remaining -= take;
        }
        lootGoldSum += lootGold;
      }
      lossGoldSum += lossesCostGold(result.attacker.losses);
    }
    const winRate = (wins / RUNS) * 100;
    const avgLoot = lootGoldSum / RUNS;
    const avgLoss = lossGoldSum / RUNS;
    console.log(
      `${sc.label} | ${winRate.toFixed(0)}% | ${avgLoot.toFixed(0)} | ${avgLoss.toFixed(0)} | ${(avgLoot - avgLoss).toFixed(0)} | ${(30 * 15 * 2 / 60).toFixed(0)} 分`,
    );
  }
  // 对照：打野地（Lv5）与打 NPC 城（Lv2）的单次收益
  line('对照：打野地 / 打 NPC 城（v16 口径，无等级差衰减）');
  for (const level of [3, 5, 8]) {
    const rngW = mulberry32(20261003 + level);
    let wins = 0;
    let lootSum = 0;
    let lossSum = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const defender = nativeGarrisonBase(level) as Army;
      const attacker = attackerForPower(armyPower(defender), 1.5);
      const result = simulateBattle(attacker, defender, { siege: false, rng: rngW });
      if (result.attackerWon) {
        wins += 1;
        const pool = wildernessPlunderPool('forest', level);
        lootSum += resourcesCostGold(pool as { gold: number });
      }
      lossSum += lossesCostGold(result.attacker.losses);
    }
    console.log(`野地 Lv${level}（60义+20弓+20民） | 胜率 ${(wins / RUNS * 100).toFixed(0)}% | 净收益 ${(lootSum - lossSum) / RUNS >= 0 ? '+' : ''}${((lootSum - lossSum) / RUNS).toFixed(0)} 金`);
  }
  {
    const rngN = mulberry32(20261003 + 99);
    let wins = 0;
    let lootSum = 0;
    let lossSum = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const profile = NPC_CITY_PROFILE[2];
      const attacker = attackerForPower(armyPower(profile.garrison as Army), 2.0);
      const result = simulateBattle(attacker, profile.garrison as Army, {
        siege: true,
        wallDefensePercent: wallDefensePercent(profile.buildings.wall ?? 0),
        rng: rngN,
      });
      if (result.attackerWon) {
        wins += 1;
        lootSum += resourcesCostGold(profile.stockScale as { gold: number });
      }
      lossSum += lossesCostGold(result.attacker.losses);
    }
    console.log(`NPC 城 Lv2（180义+60弓+60民，首次全提） | 胜率 ${(wins / RUNS * 100).toFixed(0)}% | 收益 ${(lootSum / RUNS).toFixed(0)} 金 | 战损 ${(lossSum / RUNS).toFixed(0)} 金`);
  }
}

// ---- 问题 2：被抢的人还能不能玩（全天在线 Agent 反复打） ----

function question2(): void {
  line('问题 2：被一个全天在线的 Agent 反复打，一天的损失（产出补充计入）');
  const truceHours = PVP_CITY_TRUCE_MS / HOUR;
  const raidsPerDay = Math.floor(24 / truceHours);
  console.log(`参数：免战 ${truceHours} 小时 → 一天最多被打 ${raidsPerDay} 次；单次四资源 ${PVP_PLUNDER_SHARE * 100}% / 金币 ${PVP_GOLD_SHARE * 100}%（存量口径，产出在两次进攻间持续补充）`);
  for (const gov of [5, 10]) {
    const res = typicalResources(gov);
    // 模拟一天：每次被抢走 可抢存量×share；免战 + 行军窗口按 4h 一轮，期间产出补充（钳上限）
    const shares: Record<string, number> = {
      gold: PVP_GOLD_SHARE,
      food: PVP_PLUNDER_SHARE,
      wood: PVP_PLUNDER_SHARE,
      stone: PVP_PLUNDER_SHARE,
      iron: PVP_PLUNDER_SHARE,
    };
    const caps: Record<string, number> = {
      gold: 100_000,
      food: 22_000,
      wood: 22_000,
      stone: 22_000,
      iron: 22_000,
    };
    const perHour: Record<string, number> = {
      gold: 100 * gov,
      food: 100 + 120 * Math.min(gov, 10),
      wood: 100 + 120 * Math.min(gov, 10),
      stone: 100 + 120 * Math.min(gov, 10),
      iron: 100 + 120 * Math.min(gov, 10),
    };
    const protection = 1000 * Math.min(10, Math.floor(gov / 2));
    const stock: Record<string, number> = { ...res };
    const lost: Record<string, number> = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
    for (let raid = 0; raid < raidsPerDay; raid += 1) {
      for (const key of Object.keys(stock)) {
        const lootable = key === 'gold' ? stock[key] : Math.max(0, stock[key] - protection);
        const taken = Math.floor(lootable * shares[key]);
        stock[key] -= taken;
        lost[key] += taken;
      }
      // 免战期产出补充（钳上限）
      for (const key of Object.keys(stock)) {
        stock[key] = Math.min(caps[key], stock[key] + perHour[key] * truceHours);
      }
    }
    const dailyProduceGold = perHour.gold * 24;
    const lostGoldPct = ((lost.gold / (res.gold + dailyProduceGold)) * 100).toFixed(0);
    const lostFoodPct = ((lost.food / (res.food + perHour.food * 24)) * 100).toFixed(0);
    console.log(
      `官府 ${gov} 级城：一天被抢 ${raidsPerDay} 次共失 金 ${lost.gold}（占当日总量 ${lostGoldPct}%）、粮 ${lost.food}（占 ${lostFoodPct}%）` +
        `；木/石/铁同粮。仓底始终保有保护额 ${protection}/资源。`,
    );
  }
  console.log('对照方案（若免战延长为 8 小时）：一天最多 3 次，四资源日损失降至约 1 − 0.7³ = 66%。');
}

// ---- 问题 3：大打小的衰减曲线 ----

function question3(): void {
  line('问题 3：等级差衰减曲线（出发城官府 − 目标城官府）');
  console.log('官府差 | 收益系数 | 说明');
  for (const gap of [0, 5, 6, 8, 10, 15, 20]) {
    const factor = Math.max(PVP_LEVEL_PENALTY_FLOOR, 1 - Math.max(0, gap - PVP_LEVEL_GAP_START) * PVP_LEVEL_PENALTY_PER_LEVEL);
    console.log(`${gap} 级 | ×${factor.toFixed(2)} | ${gap <= PVP_LEVEL_GAP_START ? '不衰减' : gap - PVP_LEVEL_GAP_START + ' 级超额衰减'}`);
  }
  // 大打小的攻方战损极低（碾压），净收益 = 池 × 系数；对照打同级
  const res = typicalResources(5);
  const warehouse = 2;
  const protection = 1000 * warehouse;
  const basePool =
    Math.floor(res.gold * PVP_GOLD_SHARE) +
    4 * Math.max(0, Math.floor((res.food - protection) * PVP_PLUNDER_SHARE));
  console.log(`以官府 5 级目标城为例：无衰减满池折金约 ${basePool} 金；官府差 10 级（×${pvpLevelFactor(15, 5).toFixed(2)}）≈ ${(basePool * pvpLevelFactor(15, 5)).toFixed(0)} 金，差 20 级（×${pvpLevelFactor(25, 5).toFixed(2)}）≈ ${(basePool * pvpLevelFactor(25, 5)).toFixed(0)} 金。`);
}

// ---- 问题 4：占一座分城的代价 ----

function question4(): void {
  line('问题 4：占一座分城的代价（城防 100 / 每胜 −35 / 免战后 +10 每小时）');
  const hits = Math.ceil(DURABILITY_MAX / DURABILITY_DAMAGE_PER_WIN);
  const gapHours = PVP_CITY_TRUCE_MS / HOUR;
  const totalHours = hits * gapHours;
  console.log(`基础口径：需打胜 ${hits} 次，每次后免战 ${gapHours}h → 总耗时 ≥ ${totalHours} 小时（占位设计「至少 3 次隔 8 小时」）。带冲车（占比 ≥10%，一击 −${DURABILITY_DAMAGE_PER_WIN + DURABILITY_RAM_BONUS_MAX}）需 ${Math.ceil(DURABILITY_MAX / (DURABILITY_DAMAGE_PER_WIN + DURABILITY_RAM_BONUS_MAX))} 次、约 ${Math.ceil(DURABILITY_MAX / (DURABILITY_DAMAGE_PER_WIN + DURABILITY_RAM_BONUS_MAX)) * gapHours} 小时。`);
  // 每次攻城的战损（守方每次满编补兵的防守口径）
  for (const ratio of [2.0, 3.0]) {
    const rng = mulberry32(20261004);
    let lossSum = 0;
    let wins = 0;
    for (let i = 0; i < RUNS; i += 1) {
      const defender = defenderGarrison(5);
      const attacker = attackerForPower(armyPower(defender), ratio);
      const result = simulateBattle(attacker, defender, { siege: true, wallDefensePercent: wallDefensePercent(3), rng });
      if (result.attackerWon) {
        wins += 1;
      }
      lossSum += lossesCostGold(result.attacker.losses);
    }
    const perHitLoss = lossSum / RUNS;
    const winRate = (wins / RUNS * 100).toFixed(0);
    console.log(`攻方 ${ratio} 倍战力强攻官府 5 分城（城墙 3 级）：胜率 ${winRate}%，场均战损折金 ${perHitLoss.toFixed(0)} → 三击总战损 ≈ ${(perHitLoss * 3).toFixed(0)} 金。守方两次进攻之间有 ${gapHours} 小时补兵（官府 5 产金 500/h 可回 ${500 * gapHours} 金的征兵本）。`);
  }
  // 对照：占 NPC 城（一次战斗）
  console.log('对照：占同级 NPC 城一次战斗拿下（v24 口径），总代价约为单场战损；占玩家分城 = 三场战损 + 8 小时 + 承担守方增援，代价显著更高（定位合理：玩家城是活人防守）。');
}

// ---- 问题 5：新手保护够不够（官府到 5 级要多久） ----

function question5(): void {
  line('问题 5：正常玩法多久把官府升到 5 级（新手保护门槛）');
  // 只算官府链 1→5：成本 = 建造成本 × 升级倍数；时长 = 建造基准 × 倍数（未加速基准）
  const buildSeconds = 120; // DEFAULT_BUILD_SECONDS 基准
  let totalGold = 0;
  let totalSeconds = 0;
  console.log('等级 | 升级金 | 升级时长（基准）');
  for (let level = 1; level <= 5; level += 1) {
    const cost = upgradeCost('government', level);
    const seconds = buildSeconds * level; // upgradeLevelFactor(L) = L（1~9 线性）
    totalGold += cost.gold + (cost.wood + cost.food + cost.stone + cost.iron) / 4;
    totalSeconds += seconds;
    console.log(`${level} → ${level + 1} | ${cost.gold} 金（+四资源） | ${seconds / 60} 分`);
  }
  // 收入口径：官府产金 100×等级/h + 四资源折金（4:1）
  const goldPerHour = 100 * 2.5 + 4 * ((100 + 120 * 2.5) / 4); // 平均等级 2.5 的粗口径
  console.log(`官府 1→5 合计：约 ${Math.round(totalGold)} 金（含四资源折金），纯产金攒钱约 ${(totalGold / goldPerHour).toFixed(1)} 小时（未加速基准；含打野地 / NPC 收入会更快，加速 50 倍时仅数分钟）。`);
  console.log(`结论：未加速下数小时可达官府 5 级，「3 天」保护期才是主要约束；部署全局 50 倍速时 3 天 ≈ 86 分钟实际时间。`);
}

// ---- 问题 6：其他时长 ----

function question6(): void {
  line('问题 6：其他保护时长（定性 + 算术核对）');
  console.log(`主动免战 12h / 每周一次：覆盖一周的 ${(12 / 168 * 100).toFixed(0)}%（约 7%）——定位「关键离线窗口」而非常态防护，量级合理；不建议加长（会伤掠夺玩法）。`);
  console.log(`野地换主保护 1h：抢占后守方 1h 内无法回抢；行军单程常 >15 分（30 格 7.5 分 × 基准），1h 足够新主增防一轮，同时不阻碍次日反抢——合理。`);
  console.log(`分城换主保护 6h：与被打免战 4h 同量级偏长半档，给新主「接手 + 补兵 + 重排队列」的窗口；城防回满后本身也有威慑——合理。`);
  console.log(`NPC 袭城免战（2×2h = 4h）与玩家攻打免战同为 4h：一致，维持。`);
}

async function main(): Promise<void> {
  console.log(`玩家对抗数值校准（AISLG-126）— ${RUNS} 局/场景，固定种子，未加速基准`);
  question1();
  question2();
  question3();
  question4();
  question5();
  question6();
  console.log('\n（结论与建议值见 docs/battle-calibration.md「玩家对抗数值校准（AISLG-126）」）');
}

void main();
