// 一期战斗引擎（common/src/battle-engine.ts）与规则层（common/src/battle.ts）的单元测试。
// v15（AISLG-2 战斗与耗粮数值评审）后的语义：同速档同时结算（无攻守先手差）、
// 兵堆余伤血池、攻城守方据墙待敌 / 出城迎击（离墙失减伤）、终局回合计入战报。
// 确定性断言用固定 rng；验收区间断言用固定种子批量模拟（mulberry32，场景名播种），
// 与 backend/scripts/battle-calibration.ts 同口径（评审记录 docs/battle-calibration.md）。

import test from 'node:test';
import assert from 'node:assert/strict';
import { RESOURCE_KEYS, TROOP_KINDS, type TroopKind } from '../common/src/protocol';
import {
  FIELD_LENGTH,
  JUDGMENT_RATES,
  MAX_BATTLE_ROUNDS,
  NATIVE_JITTER,
  nativeGarrisonBase,
  nativeJitterFactor,
  RAID_ARCHER_PER_LEVEL,
  RAID_MILITIA_PER_LEVEL,
  TROOP_POWER,
  TROOP_STATS,
  armyPower,
  cityRaidLevel,
  isEmptyArmy,
  nativeGarrison,
  npcRaidArmy,
  resolveBattle,
  resolveNpcRaid,
  simulateBattle,
  toFullArmyCounts,
  wallDefensePercent,
} from '../common/src/battle';
import { withSideStats } from '../common/src/battle-db';
import { WALL_DEFENSE_PER_LEVEL } from '../common/src/rules';
import { NPC_CITY_PROFILE } from '../common/src/world';

/** 永远落在「普通命中」区间的固定 rng（判定链不触发） */
const normalRng = (): number => 0.9999;
/** 永远触发「闪避」的固定 rng（伤害为 0） */
const dodgeRng = (): number => 0.0001;

/** mulberry32：确定性 PRNG（与校准脚本同实现；按场景名 + 局号播种可复现） */
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

/** 固定种子批量模拟：返回攻方胜率 / 零损胜率，并校验「攻方获胜 ⇒ 幸存 ≥ 1」不变量 */
function winRates(
  name: string,
  attacker: Partial<Record<TroopKind, number>>,
  defender: Partial<Record<TroopKind, number>>,
  runs: number,
  opts?: { siege?: boolean; wallDefensePercent?: number },
): { winRate: number; losslessWinRate: number } {
  const seed = hashString(name);
  let wins = 0;
  let losslessWins = 0;
  for (let i = 0; i < runs; i += 1) {
    const result = simulateBattle(attacker, defender, { rng: mulberry32(seed + i), ...opts });
    if (result.attackerWon) {
      wins += 1;
      const survivors = TROOP_KINDS.reduce((sum, kind) => sum + result.attacker.survivors[kind], 0);
      assert.ok(survivors >= 1, `${name} 第 ${i} 局：攻方获胜但幸存为 0（违反占领语义不变量）`);
      if (TROOP_KINDS.every((kind) => result.attacker.losses[kind] === 0)) {
        losslessWins += 1;
      }
    }
  }
  return { winRate: wins / runs, losslessWinRate: losslessWins / runs };
}

test('兵种战斗属性：全部兵种齐全、数值为正（辎重车攻击为 0）、射程与速度覆盖克制关系', () => {
  for (const kind of TROOP_KINDS) {
    const s = TROOP_STATS[kind];
    assert.ok(s.hp > 0 && s.def > 0 && (s.atk > 0 || kind === 'supply_wagon'), `${kind} hp/atk/def 为正（辎重车 atk=0）`);
    assert.ok(s.speed > 0 && s.range > 0, `${kind} speed/range 为正`);
    assert.ok(s.marchSpeed >= 0.1, `${kind} 行军速度系数 ≥ 0.1`);
  }
  assert.equal(TROOP_STATS.archer.range, 70, '弓箭兵射程 70（最远，v15 定稿）');
  assert.ok(TROOP_STATS.archer.range > TROOP_STATS.militia.range, '近战射程短于弓箭');
  assert.equal(TROOP_STATS.cavalry.speed, 110, '轻骑兵战斗速度 110（最快，一轮穿越弓箭射程）');
  assert.ok(TROOP_STATS.cavalry.speed > TROOP_STATS.scout.speed, '骑兵快于斥候');
  assert.equal(TROOP_STATS.scout.marchSpeed, 2, '斥候行军速度 ×2（占位）');
  assert.equal(TROOP_STATS.cavalry.marchSpeed, 1.5, '轻骑兵行军速度 ×1.5（占位）');
  assert.equal(FIELD_LENGTH, 120, '战场长度 120（v15 定稿：慢速近战 3 回合接敌）');
  assert.ok(JUDGMENT_RATES.dodge + JUDGMENT_RATES.block + JUDGMENT_RATES.pierce + JUDGMENT_RATES.crit < 10000,
    '判定链概率合计不超过万分位');
});

test('参考战力与编队工具：armyPower / isEmptyArmy / toFullArmyCounts', () => {
  assert.equal(armyPower({ porter: 1, cavalry: 1 }), TROOP_POWER.porter + TROOP_POWER.cavalry);
  assert.ok(isEmptyArmy({}) && isEmptyArmy({ militia: 0 }));
  assert.ok(!isEmptyArmy({ militia: 1 }));
  assert.deepEqual(toFullArmyCounts({ militia: 3 }), {
    porter: 0, militia: 3, scout: 0, pikeman: 0, swordsman: 0, archer: 0, cavalry: 0,
    iron_cavalry: 0, supply_wagon: 0, ballista: 0, siege_ram: 0,
  });
});

test('野地原住守军基准曲线（v24 AISLG-48）：Lv1–2 纯义兵 8×等级，Lv3 起义兵 6×等级 + 弓箭兵(等级−2)', () => {
  assert.deepEqual(nativeGarrisonBase(1), { militia: 8 });
  assert.deepEqual(nativeGarrisonBase(2), { militia: 16 });
  assert.deepEqual(nativeGarrisonBase(3), { militia: 18, archer: 1 });
  assert.deepEqual(nativeGarrisonBase(5), { militia: 30, archer: 3 });
  assert.deepEqual(nativeGarrisonBase(0), {}, '0 级无守军');
  assert.deepEqual(nativeGarrison(1), nativeGarrisonBase(1), '未给坐标 = 基准编成');
});

test('野地原住守军 ±20% 按坐标固定浮动：同坐标恒定、落在区间内、不同坐标有差异', () => {
  const factors = new Set<number>();
  for (let x = 0; x < 40; x++) {
    for (let y = 0; y < 40; y++) {
      const f = nativeJitterFactor(x, y);
      assert.ok(f >= 1 - NATIVE_JITTER && f <= 1 + NATIVE_JITTER, `(${x},${y}) 系数 ${f} 越界`);
      assert.equal(f, nativeJitterFactor(x, y), '同坐标恒定');
      factors.add(Math.round(f * 1000));
    }
  }
  assert.ok(factors.size > 100, '不同坐标浮动有差异');
  for (const [x, y] of [[3, 7], [216, 823], [999, 0]]) {
    const g = nativeGarrison(5, { x, y });
    assert.ok((g.militia ?? 0) >= 24 && (g.militia ?? 0) <= 36, `Lv5 义兵 ${g.militia} 在 30±20% 内`);
    assert.deepEqual(g, nativeGarrison(5, { x, y }));
  }
  assert.ok((nativeGarrison(3, { x: 1, y: 1 }).archer ?? 0) >= 1, '非零兵种至少 1 个');
});

test('NPC 袭击部队：参考战力按等级线性（v21：袭击 25×等级）', () => {
  for (const level of [1, 3, 10]) {
    assert.equal(armyPower(npcRaidArmy(level)), 25 * level, `袭击部队 Lv${level}（v21 调参 40→25）`);
  }
  assert.deepEqual(npcRaidArmy(2), { militia: 2 * RAID_MILITIA_PER_LEVEL, archer: 2 * RAID_ARCHER_PER_LEVEL });
});

test('城墙守城减伤系数 = 城墙等级 × 每级加成', () => {
  assert.equal(wallDefensePercent(0), 0);
  assert.equal(wallDefensePercent(3), 3 * WALL_DEFENSE_PER_LEVEL);
  assert.equal(wallDefensePercent(10), 10 * WALL_DEFENSE_PER_LEVEL);
});

test('空守军：攻方不发生战斗直接获胜（0 回合、零损失）', () => {
  const result = simulateBattle({ militia: 10 }, {}, { rng: normalRng });
  assert.equal(result.attackerWon, true);
  assert.equal(result.rounds, 0);
  assert.equal(result.endReason, 'defender_wiped');
  assert.equal(result.attacker.survivors.militia, 10);
  assert.equal(result.defender.troops.militia, 0);
});

test('固定 rng 下模拟确定：同输入两次运行结果完全一致', () => {
  const a = simulateBattle({ militia: 20, archer: 5 }, nativeGarrison(2), { rng: normalRng });
  const b = simulateBattle({ militia: 20, archer: 5 }, nativeGarrison(2), { rng: normalRng });
  assert.deepEqual(a, b);
});

test('多回合推进：义兵镜像前 3 回合零伤害推进、第 4 回合接敌', () => {
  // 双方义兵 speed 20 / 战场 120：相向推进 3 回合后进入射程（gap 40 → 0），第 4 回合开打
  const result = simulateBattle({ militia: 20 }, { militia: 20 }, { rng: normalRng });
  assert.ok(result.rounds > 5, `总回合数 ${result.rounds} > 5`);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(result.roundLog[i].attackerDamage, 0, `第 ${i + 1} 回合攻方零输出（纯推进）`);
    assert.equal(result.roundLog[i].defenderDamage, 0, `第 ${i + 1} 回合守方零输出（纯推进）`);
  }
  assert.ok(result.roundLog[3].attackerDamage > 0 && result.roundLog[3].defenderDamage > 0,
    '第 4 回合双方同时有输出（同速档同时结算，无先手差）');
  assert.ok(result.attacker.damage > 0 && result.defender.damage > 0, '双方均有输出记录');
});

test('终局回合计入战报：歼灭回合的伤害与损失在 roundLog 末条', () => {
  const result = simulateBattle({ archer: 1 }, { militia: 1 }, { rng: normalRng });
  assert.equal(result.attackerWon, true);
  assert.equal(result.rounds, 4);
  assert.equal(result.roundLog.length, 4, '4 个回合 4 条记录（含终局回合）');
  assert.equal(result.roundLog[3].defenderKilled, 1, '第 4 回合击杀义兵（余伤池累计到单兵生命）');
  assert.ok(result.roundLog[2].attackerDamage > 0 && result.roundLog[2].defenderKilled === 0,
    '第 3 回合齐射有伤害但未折算阵亡（余伤池保留）');
});

test('余伤血池：小输出跨回合累计，不足单兵生命的伤害不再被抹掉', () => {
  // 1 弓箭兵单发 234 < 义兵 450 生命：无血池时每回合取整为 0 杀（回合耗尽）；
  // 有血池时第 4 回合累计 468 ≥ 450 折算 1 杀
  const result = simulateBattle({ archer: 1 }, { militia: 1 }, { rng: normalRng });
  assert.equal(result.attackerWon, true, '弓箭兵靠累计余伤击杀义兵');
  assert.equal(result.endReason, 'defender_wiped');
  assert.equal(result.attacker.losses.archer, 0, '义兵未进入近战即被击杀（射程压制单兵）');
});

test('同速同档同时结算：1 义兵互殴同回合同归于尽，攻方全灭优先（不得零幸存获胜）', () => {
  // 双方各 97.6 伤/回合、450 生命：第 8 回合双方累计都越过生命线——同档同时阵亡
  const result = simulateBattle({ militia: 1 }, { militia: 1 }, { rng: normalRng });
  assert.equal(result.endReason, 'attacker_wiped', '同归于尽按攻方全灭（守方守住）');
  assert.equal(result.attackerWon, false);
  assert.equal(result.rounds, 8);
  assert.equal(result.attacker.survivors.militia, 0);
  assert.equal(result.defender.survivors.militia, 0, '极端并灭：守方零幸存（引擎已定义边界，调用方按守住处理）');
});

test('判定链：全部闪避时无人伤亡，回合耗尽判攻方战败', () => {
  const result = simulateBattle({ militia: 30 }, { militia: 30 }, { rng: dodgeRng, maxRounds: 5 });
  assert.equal(result.endReason, 'round_limit');
  assert.equal(result.rounds, 5);
  assert.equal(result.attackerWon, false, '未能歼灭守方 = 攻方战败（幸存者由调用方撤回）');
  assert.equal(result.attacker.losses.militia, 0);
  assert.equal(result.defender.losses.militia, 0);
  assert.equal(result.attacker.damage, 0);
});

test('回合上限：超时未歼灭守方 = 攻方战败（默认上限 100），败方幸存即撤回依据', () => {
  assert.equal(MAX_BATTLE_ROUNDS, 100, '回合上限为定稿常量');
  const result = simulateBattle({ militia: 30 }, { militia: 30 }, { rng: dodgeRng });
  assert.equal(result.rounds, MAX_BATTLE_ROUNDS);
  assert.equal(result.attackerWon, false);
  assert.equal(result.attacker.survivors.militia, 30, '败方幸存 = 引擎报告的实际兵力（撤回结算依据）');
});

test('攻城守方据墙待敌：守方纯近战被纯远程压制时出城迎击，攻方不再无风险输出', () => {
  // 20 弓箭兵攻 40 义兵守城（无墙）：守军够不到驻足输出的弓兵 → 出城迎击；
  // 冲过射程窗口后接敌，攻方必付出损失（v15 前守方站桩、攻方零损白嫖）
  const result = simulateBattle({ archer: 20 }, { militia: 40 }, { rng: normalRng, siege: true });
  assert.equal(result.attackerWon, true, '40 义兵火力不足以反杀（攻方仍胜）');
  assert.ok(result.attacker.losses.archer > 0, `守军出城接敌，攻方有损失（损失 ${result.attacker.losses.archer}）`);
  assert.ok(result.defender.damage > 0, '守方在推进中受击');
});

test('攻城守方据墙待敌：敌方逼近时守军原地等待（不无脑弃墙），城墙位受击减免', () => {
  // 20 弓箭兵对射守城 20 弓箭兵：守方弓兵全程据墙（敌方停驻射程内）。
  // 无墙时同兵力互射同归于尽（攻方全灭优先）；有墙时城墙位守方受击减免，
  // 守方留下幸存——城墙把守城方从「同归于尽」变成「守住有余」
  const noWall = simulateBattle({ archer: 20 }, { archer: 20 }, { rng: normalRng, siege: true, wallDefensePercent: 0 });
  const walled = simulateBattle({ archer: 20 }, { archer: 20 }, { rng: normalRng, siege: true, wallDefensePercent: 25 });
  assert.equal(noWall.attackerWon, false, '无墙同兵力对射：同归于尽判攻方败');
  assert.equal(noWall.defender.survivors.archer, 0, '无墙对射守方零幸存（并灭）');
  assert.equal(walled.attackerWon, false, '有墙对射攻方仍败（守方优势）');
  assert.ok(walled.defender.survivors.archer > 0, `有墙对射守方幸存 ${walled.defender.survivors.archer}（城墙减免生效）`);
  assert.ok(walled.attacker.damage < noWall.attacker.damage,
    `攻方总输出 有墙 ${walled.attacker.damage} < 无墙 ${noWall.attacker.damage}（城墙位减伤）`);
});

test('野地遭遇战守方迎面推进（非攻城不据墙）', () => {
  // 野地：守方纯近战同样迎面推进，接触后双方互有输出
  const result = simulateBattle({ archer: 8 }, { militia: 20 }, { rng: normalRng });
  assert.equal(result.attackerWon, false, '无掩护弓箭兵被同金义兵冲溃（v15 定稿克制）');
  assert.equal(result.attacker.survivors.archer, 0, '攻方全灭');
  assert.ok(result.defender.survivors.militia > 0, '守方幸存转驻军');
});

test('典型遭遇战：20 义兵攻击 1 级野地原住守军（义兵 8）获胜且幸存 ≥ 1（占领语义）', () => {
  const result = resolveBattle({ militia: 20 }, nativeGarrison(1), { rng: normalRng });
  assert.equal(result.attackerWon, true, '20 义兵对 Lv1 守军（义兵 8）获胜');
  const survivors = Object.values(result.attacker.survivors).reduce((s: number, n) => s + n, 0);
  assert.ok(survivors >= 1, '胜方幸存 ≥ 1（幸存部队转驻军）');
  assert.equal(result.defender.survivors.militia, 0, '守方全灭');
  assert.ok(result.attacker.damage > 0 && result.defender.damage > 0, '双方均有输出记录');
});

test('NPC 袭击：驻军占优守住（含幸存），驻军劣势失守全灭', () => {
  const held = resolveNpcRaid({ cavalry: 30 }, 1, normalRng);
  assert.equal(held.defended, true, '30 轻骑兵守住 1 级袭击');
  const heldSurvivors = Object.values(held.result.defender.survivors).reduce((s: number, n) => s + n, 0);
  assert.ok(heldSurvivors >= 1, '守住时驻军必有幸存（引擎保证）');

  const lost = resolveNpcRaid({ porter: 5 }, 5, normalRng);
  assert.equal(lost.defended, false, '5 民夫守不住 5 级袭击');
  assert.equal(lost.result.defender.survivors.porter, 0, '失守驻军全灭');
});

test('NPC 城池快照：驻防战力递增、库存与继承建筑齐全（校准）', () => {
  for (const level of [1, 2, 3]) {
    const profile = NPC_CITY_PROFILE[level];
    assert.ok(profile, `等级 ${level} 有配置`);
    assert.ok(armyPower(profile.garrison) > 0, '驻防有战力');
    for (const key of RESOURCE_KEYS) {
      assert.ok(profile.stockScale[key] > 0, '库存五资源为正');
    }
    assert.ok(Object.keys(profile.buildings).length > 0, '占领后继承建筑');
    // 攻城战守方带城墙（wall 等级按快照），等级 1..3 城池的守城减伤在合理区间
    const wall = wallDefensePercent((profile.buildings.wall as number | undefined) ?? 0);
    assert.ok(wall >= 0 && wall <= 50, `Lv${level} 城墙减伤 ${wall}% 在 0..50`);
  }
  assert.ok(
    armyPower(NPC_CITY_PROFILE[1].garrison) < armyPower(NPC_CITY_PROFILE[2].garrison) &&
      armyPower(NPC_CITY_PROFILE[2].garrison) < armyPower(NPC_CITY_PROFILE[3].garrison),
  );
});

test('战场长度与兵堆位置不变量：混合编队模拟能正常终结', () => {
  const result = simulateBattle({ scout: 10, cavalry: 10, militia: 10 }, { archer: 10, militia: 10 }, {
    rng: normalRng,
    maxRounds: 50,
  });
  assert.ok(result.rounds <= 50);
  assert.ok(['defender_wiped', 'attacker_wiped', 'round_limit'].includes(result.endReason));
  assert.equal(result.roundLog.length, result.rounds, 'roundLog 条数与回合数一致（含终局回合）');
});

// ---- 固定种子批量模拟的验收区间（docs/battle-calibration.md 的自动化固化） ----

const STAT_RUNS = 400;

test('验收：开局基准——20 义兵打 1 级野地高胜率，义兵 / 民夫 / 斥候不构成碾压', () => {
  const a = winRates('test-early-militia20-lv1', { militia: 20 }, nativeGarrison(1), STAT_RUNS);
  assert.ok(a.winRate >= 0.9, `20 义兵 vs Lv1 胜率 ${a.winRate} ≥ 0.9`);
  const porter = winRates('test-early-porter10-lv1', { porter: 10 }, nativeGarrison(1), STAT_RUNS);
  assert.ok(porter.winRate <= 0.05, `民夫无战力（胜率 ${porter.winRate} ≤ 5%；v24 Lv1 守军降为纯义兵 8，极端翻盘偶发）`);
  const scout = winRates('test-early-scout10-lv1', { scout: 10 }, nativeGarrison(1), STAT_RUNS);
  assert.ok(scout.winRate <= 0.3, `斥候不构成碾压（侦察用途，胜率 ${scout.winRate} ≤ 30%；v24 Lv1 守军降为纯义兵 8）`);
});

test('验收：同金克制——骑兵克远程、枪兵克骑兵、刀盾克义兵人海', () => {
  const cav = winRates('test-cav-vs-archer', { cavalry: 5 }, { archer: 8 }, STAT_RUNS);
  assert.ok(cav.winRate >= 0.75, `5 轻骑兵 vs 8 弓箭兵 胜率 ${cav.winRate} ≥ 0.75`);
  const pike = winRates('test-pike-vs-cav', { pikeman: 10 }, { cavalry: 5 }, STAT_RUNS);
  assert.ok(pike.winRate >= 0.6, `10 长枪兵 vs 5 轻骑兵 胜率 ${pike.winRate} ≥ 0.6`);
  const sword = winRates('test-sword-vs-militia', { swordsman: 18 }, { militia: 20 }, STAT_RUNS);
  assert.ok(sword.winRate >= 0.95, `18 刀盾兵 vs 20 义兵 胜率 ${sword.winRate} ≥ 0.95`);
});

test('验收：无掩护远程不再无风险——同金纯弓箭兵打纯义兵败多胜少且零损胜罕见', () => {
  const a = winRates('test-archer-vs-militia', { archer: 8 }, { militia: 20 }, STAT_RUNS);
  assert.ok(a.winRate <= 0.35, `8 弓箭兵 vs 20 义兵 胜率 ${a.winRate} ≤ 0.35（冲脸即溃）`);
  assert.ok(a.losslessWinRate <= 0.05, `零损胜率 ${a.losslessWinRate} ≤ 0.05（不再无风险输出）`);
});

test('验收：混编有用途——同金混编胜率高于同金纯编', () => {
  const mixed = winRates('test-mixed15-vs-militia', { militia: 15, archer: 2 }, { militia: 20 }, STAT_RUNS);
  const pure = winRates('test-pure-archer-vs-militia', { archer: 8 }, { militia: 20 }, STAT_RUNS);
  assert.ok(mixed.winRate >= 0.55, `15 义兵 + 2 弓箭兵 vs 20 义兵 胜率 ${mixed.winRate} ≥ 0.55`);
  assert.ok(mixed.winRate > pure.winRate + 0.3, `混编 ${mixed.winRate} 显著高于纯弓 ${pure.winRate}`);
});

test('验收：镜像攻守交换差异小（同战力不因攻守位置出现过大先手差）', () => {
  // 攻方有约 7pt 的固有劣势（歼灭守方才算获胜，同归于尽判攻方败）——这是语义而非
  // 先手差；验收重点是「交换攻守不改变胜率」（两方向的镜像应基本一致）
  const army = { militia: 20, archer: 5 };
  const a = winRates('test-mirror-a', army, army, STAT_RUNS);
  const b = winRates('test-mirror-b', army, army, STAT_RUNS);
  assert.ok(a.winRate >= 0.36 && a.winRate <= 0.52, `镜像 A 攻 ${a.winRate} 在 0.36..0.52`);
  assert.ok(b.winRate >= 0.36 && b.winRate <= 0.52, `镜像 B 攻（交换） ${b.winRate} 在 0.36..0.52`);
  assert.ok(Math.abs(a.winRate - b.winRate) <= 0.08, `交换攻守差异 ${Math.abs(a.winRate - b.winRate)} ≤ 0.08`);
});

test('验收：城墙收益单调可感知，高墙不构成死锁（2 倍兵力可下）', () => {
  const attacker = { militia: 34, archer: 10 };
  const garrison = { militia: 30, archer: 8 };
  const w0 = winRates('test-wall-0', attacker, garrison, STAT_RUNS, { siege: true, wallDefensePercent: 0 });
  const w5 = winRates('test-wall-5', attacker, garrison, STAT_RUNS, { siege: true, wallDefensePercent: 25 });
  const w10 = winRates('test-wall-10', attacker, garrison, STAT_RUNS, { siege: true, wallDefensePercent: 50 });
  assert.ok(w0.winRate > w5.winRate, `墙 0 (${w0.winRate}) > 墙 5 (${w5.winRate})`);
  assert.ok(w5.winRate > w10.winRate, `墙 5 (${w5.winRate}) > 墙 10 (${w10.winRate})`);
  const strong = winRates('test-wall-10-strong', { militia: 60, archer: 20 }, garrison, STAT_RUNS, {
    siege: true,
    wallDefensePercent: 50,
  });
  assert.ok(strong.winRate >= 0.9, `2 倍兵力强攻墙 10 胜率 ${strong.winRate} ≥ 0.9（不死锁）`);
});

// ---- v22（AISLG-40 方案 B）：主城袭击等级按守军战力推导 ----

test('cityRaidLevel：clamp(ceil(守军战力/25), max(1, 官府/2), 官府)', () => {
  // 守军归零：官府 10 → 下限 5（不再零守军挨满编）；官府 2 → 下限 1
  assert.equal(cityRaidLevel(0, 10), 5);
  assert.equal(cityRaidLevel(0, 2), 1);
  // 实测场景复现：守军战力 132（官府 10）→ ceil(132/25)=6
  assert.equal(cityRaidLevel(132, 10), 6);
  // 随守军战力单调上升到官府等级封顶
  assert.equal(cityRaidLevel(150, 10), 6);
  assert.equal(cityRaidLevel(3000, 10), 10, '超过官府等级按官府封顶');
  // 下限防清守军骗低强度：官府 10 时无论守军多弱至少 Lv5
  assert.equal(cityRaidLevel(1, 10), 5);
});

// ---- v23（AISLG-49）：战报侧汇总的远程口径 ----

test('withSideStats：maxRange / rangedUnits 直接给出远程威胁，不被近战数量稀释', () => {
  const side = withSideStats({
    name: '守方',
    troops: toFullArmyCounts({ militia: 20, archer: 4 }),
    losses: toFullArmyCounts({}),
    survivors: toFullArmyCounts({ militia: 20, archer: 4 }),
    damage: 0,
  });
  // 实测反例复现：avgRange = (20×10 + 4×70) ÷ 24 = 20，读起来像「全军射程 20」
  assert.equal(side.units, 24);
  assert.equal(side.avgRange, 20);
  // 新字段：最大射程与远程单位数不受近战数量稀释
  assert.equal(side.maxRange, 70);
  assert.equal(side.rangedUnits, 4);
  // 纯近战编成：无远程位
  const melee = withSideStats({
    name: '攻方',
    troops: toFullArmyCounts({ militia: 30 }),
    losses: toFullArmyCounts({}),
    survivors: toFullArmyCounts({ militia: 30 }),
    damage: 0,
  });
  assert.equal(melee.maxRange, 10);
  assert.equal(melee.rangedUnits, 0);
  // 空编成
  const empty = withSideStats({
    name: '空',
    troops: toFullArmyCounts({}),
    losses: toFullArmyCounts({}),
    survivors: toFullArmyCounts({}),
    damage: 0,
  });
  assert.equal(empty.maxRange, 0);
  assert.equal(empty.rangedUnits, 0);
  assert.equal(empty.avgRange, 0);
});
