// 掠夺、负重与仓库保护的数值校准脚本（AISLG-4，v16）。
// 纯确定性计算（无随机模拟）：直接引用 common 层权威常量，输出
// 负重覆盖率、仓库保护占比、掠夺收益相对生产、占领上限曲线与占位值清单
// —— 评审调参的依据与复现入口。用法：npm run calibrate:plunder
// 评审记录（定稿结论 + 验收区间）见 docs/battle-calibration.md 的 v16 一节。

import type { TroopKind } from '../common/src/protocol';
import { TERRAIN_KINDS } from '../common/src/protocol';
import { TROOP_INFO, armyCarryCapacity } from '../common/src/troops';
import {
  PLUNDER_POOL_GOLD_PER_LEVEL,
  PLUNDER_POOL_RESOURCE_PER_LEVEL,
  NPC_CITY_PROFILE,
  TERRAIN_INFO,
  WILDERNESS_LEVEL_MAX,
  wildernessPlunderPool,
  wildernessBonusRate,
} from '../common/src/world';
import {
  PLUNDER_COOLDOWN_HOURS,
  WAREHOUSE_PROTECTION_SPLIT,
  WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL,
  loadByCarry,
  lootTotal,
  plunderableAmount,
  territoryLimit,
  warehouseProtectionPerResource,
} from '../common/src/plunder';
import { BASE_PRODUCTION_PER_HOUR, RATE_PER_LEVEL, emptyBuildingLevels, productionPerHour, storageCaps } from '../common/src/production';

type Army = Partial<Record<TroopKind, number>>;

const pct = (ratio: number) => `${(ratio * 100).toFixed(0)}%`;

// ---- 代表编成（对齐 battle-calibration 的阶段编成 + 民夫混编对照） ----

const ARMIES: Array<{ label: string; army: Army }> = [
  { label: '早期：20 义兵 + 4 弓箭兵', army: { militia: 20, archer: 4 } },
  { label: '中期：30 义兵 + 8 弓箭兵', army: { militia: 30, archer: 8 } },
  { label: '掠夺向：20 义兵 + 10 民夫', army: { militia: 20, porter: 10 } },
  { label: '专职掠夺：20 民夫 + 6 斥候', army: { porter: 20, scout: 6 } },
  { label: '后期：150 义兵 + 40 刀盾 + 50 弓 + 15 骑', army: { militia: 150, swordsman: 40, archer: 50, cavalry: 15 } },
];

console.log('# 掠夺与占领数值校准（AISLG-4，v16）\n');

// ---- 1. 占位值清单（权威常量回显） ----

console.log('## 占位值清单（权威出处：common/src/plunder.ts / troops.ts / world.ts）\n');
console.log('| 项 | 值 | 出处 |');
console.log('| --- | --- | --- |');
console.log(`| 仓库保护总量 | ${WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL} × 等级 | plunder.ts |`);
console.log(`| 单资源保护额（固定均分 1/${WAREHOUSE_PROTECTION_SPLIT}） | ${warehouseProtectionPerResource(1)} × 等级（粮/木/石/铁各自） | plunder.ts |`);
console.log(`| 掠夺冷却 | ${PLUNDER_COOLDOWN_HOURS} 小时（胜利即更新 plundered_at） | plunder.ts |`);
console.log(`| 野地掠夺奖励池 | 地形资源 ${PLUNDER_POOL_RESOURCE_PER_LEVEL} × 等级 + 金币 ${PLUNDER_POOL_GOLD_PER_LEVEL} × 等级（金矿空池，v21 含金） | world.ts |`);
console.log(`| 野地占领上限 | 官府等级（territoryLimit） | plunder.ts |`);
console.log(`| 装填顺序 | 金 → 粮 → 木 → 石 → 铁（v21 含金） | plunder.ts |`);
const carryRow = (Object.keys(TROOP_INFO) as TroopKind[])
  .map((kind) => `${TROOP_INFO[kind].label} ${TROOP_INFO[kind].carry}`)
  .join(' / ');
console.log(`| 单兵负重 carry | ${carryRow} | troops.ts |`);
console.log(`| NPC 城库存（1/2/3 级） | ${[1, 2, 3].map((lv) => lootTotalOfNpc(lv)).join(' / ')}（四资源合计，金币不计） | world.ts |`);
console.log('');

function lootTotalOfNpc(level: number): number {
  const stock = NPC_CITY_PROFILE[level].stockScale;
  return (stock.food ?? 0) + (stock.wood ?? 0) + (stock.stone ?? 0) + (stock.iron ?? 0);
}

// ---- 2. 负重覆盖率：编队满编携回量 / 奖励池 ----

console.log('## 负重覆盖率（编队总负重对奖励池的可携比例）\n');
console.log(`| 编成 | 总负重 | Lv5 野地池（${PLUNDER_POOL_RESOURCE_PER_LEVEL + PLUNDER_POOL_GOLD_PER_LEVEL}×等级） | 携回 / 池 | NPC 城库存（合计） | 携回 / 库存 |`);
console.log('| --- | --- | --- | --- | --- | --- |');
for (const { label, army } of ARMIES) {
  const carry = armyCarryCapacity(army);
  // 野地：以平原（food，8/级加成）代表——奖励池只有一种地形资源
  const wildPool = wildernessPlunderPool('plain', 5);
  const wildPoolTotal = lootTotal(loadByCarry(Number.MAX_SAFE_INTEGER, wildPool));
  const wildTake = lootTotal(loadByCarry(carry, wildPool));
  const npcPool = npcPoolOf(1);
  const npcTake = lootTotal(loadByCarry(carry, npcPool));
  const npcTotal = lootTotal(loadByCarry(Number.MAX_SAFE_INTEGER, npcPool));
  console.log(
    `| ${label} | ${carry} | Lv5 平原 ${wildPoolTotal} | ${wildTake}（${pct(wildTake / wildPoolTotal)}） | Lv1 ${npcTotal} | ${npcTake}（${pct(npcTake / npcTotal)}） |`,
  );
}
console.log(`\n读法：全额携回野地池需要 carry ≥ ${PLUNDER_POOL_RESOURCE_PER_LEVEL + PLUNDER_POOL_GOLD_PER_LEVEL}×等级（如 Lv5 = ${(PLUNDER_POOL_RESOURCE_PER_LEVEL + PLUNDER_POOL_GOLD_PER_LEVEL) * 5}）——早期纯战斗编成（≤2200）只能携回三成上下，`);
console.log('Lv10 高级野地（池 10000）几乎必带辎重；对 NPC 城库存（v21 起含金币）纯战斗编成同样受限，');
console.log('民夫（单兵 500）把 Lv5 野地池或 NPC 城库存携空需要 10–30 人规模的辎重队（负重是硬约束）。\n');

function npcPoolOf(level: number): Partial<Record<'food' | 'wood' | 'stone' | 'iron', number>> {
  const stock = NPC_CITY_PROFILE[level].stockScale;
  return { food: stock.food ?? 0, wood: stock.wood ?? 0, stone: stock.stone ?? 0, iron: stock.iron ?? 0 };
}

// ---- 3. 仓库保护占比（玩家城掠夺消费方预演；v16 规则层输出） ----

console.log('## 仓库保护占比（可掠量 = max(0, 存量 − 1000×等级)，四资源各自）\n');
console.log('| 仓库等级 | 单资源保护 | 存量 800（开局，v21） | 存量 11000（Lv1 建筑 + 基础储量） | 存量 22000（农田 Lv2） | 存量 50000（中后期） |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const level of [0, 1, 2, 5, 10]) {
  const protection = warehouseProtectionPerResource(level);
  const cells = [800, 11000, 22000, 50000]
    .map((stock) => {
      const lootable = plunderableAmount(stock, protection);
      return `${lootable}（${pct(lootable / stock)} 可掠）`;
    })
    .join(' | ');
  console.log(`| Lv${level} | ${protection} | ${cells} |`);
}
console.log('\n读法：仓库 Lv10 保护 10000/资源——开局 800 存量全保（Lv1 即保 1000/资源），中后期存量下仍有 1/3–4/5 可掠（NPC 掠城走同口径，AISLG-32 方案 A）；');
console.log('玩家城掠夺（本表的真实消费方）随玩家对抗阶段接入，v16 只落地规则层与数值出口。\n');

// ---- 4. 掠夺收益相对生产（一次满编掠夺 ≈ 多少小时产量） ----

console.log('## 掠夺收益相对生产（满携掠夺收入 vs 城池产量）\n');
const basicProduction = productionPerHour({ farm: 2, lumber_mill: 2, government: 2 });
console.log(`对照城：农田/伐木场/官府各 Lv2 → 粮 ${basicProduction.food}/h、木 ${basicProduction.wood}/h（含 100/h 基础产量）。\n`);
console.log('| 掠夺目标 | 满携收入（含金币） | 折算基础产量时长 | 冷却内可掠夺次数 |');
console.log('| --- | --- | --- | --- |');
for (const level of [1, 3, 5, 10]) {
  const poolTotal = lootTotal(loadByCarry(Number.MAX_SAFE_INTEGER, wildernessPlunderPool('plain', level)));
  const rate = BASE_PRODUCTION_PER_HOUR.food + RATE_PER_LEVEL.food * 2;
  console.log(`| Lv${level} 平原野地（池 ${poolTotal}） | ${poolTotal} 粮 | ≈ ${(poolTotal / rate).toFixed(1)} h 产量 | ${PLUNDER_COOLDOWN_HOURS}h 内 1 次 |`);
}
for (const level of [1, 2, 3]) {
  const pool = npcPoolOf(level);
  const total = lootTotal(loadByCarry(Number.MAX_SAFE_INTEGER, pool));
  console.log(`| NPC 城 Lv${level}（库存 ${total}） | ≤ ${total}（负重重叠） | 一次性（库存不再生） | 掠空前每 24h 一次 |`);
}
console.log('\n读法：野地掠夺是「每日一次的批量收入」，满携量级约 4.4–44 小时的对照城产量（随野地等级，v19 ×6），');
console.log('受负重封顶——Lv5+ 野地与 NPC 城需混编民夫；NPC 城库存为一次性总量，掠夺数次后归零。\n');

// ---- 5. 占领上限曲线（官府等级 → 领地数 → 加成收入） ----

console.log('## 占领上限曲线（上限 = 官府等级；加成按地形均值估算）\n');
const avgBonusPerLevel =
  TERRAIN_KINDS.reduce((sum, terrain) => sum + TERRAIN_INFO[terrain].bonusBase + TERRAIN_INFO[terrain].bonusPerLevel, 0) / TERRAIN_KINDS.length;
console.log(`地形均值：${avgBonusPerLevel.toFixed(1)}/小时（Lv1 合计均值 = 基线 + 每级增量，v21 加成保底）。\n`);
console.log('| 官府等级 | 占领上限 | 满额 Lv2 野地加成 | 满额 Lv5 野地加成 |');
console.log('| --- | --- | --- | --- |');
for (const gov of [1, 2, 3, 5, 10]) {
  const limit = territoryLimit(gov);
  const lv2 = limit * wildernessBonusRate('grass', 2);
  const lv5 = limit * wildernessBonusRate('grass', 5);
  console.log(`| Lv${gov} | ${limit} 块 | ${lv2}/h | ${lv5}/h |`);
}
console.log('读法：v21 加成保底后 Lv1 野地即 60~120/h（≈ 一座 Lv1 资源建筑），高等级线性收敛；');
console.log('占领收入与袭击折损（间隔 120 分钟、编成 25×等级）配合后低等级野地净收益为正——');
console.log('仍受官府上限、驻军供养（耗粮 ×2）约束。\n');

// ---- 6. 储量上限对照（掠夺入账不钳上限的边界说明） ----

console.log('## 边界：掠夺入账不钳储量上限（与取消返还同规则）\n');
console.log(`| 建筑（粮） | 储量上限 | 满携 Lv10 野地（${PLUNDER_POOL_RESOURCE_PER_LEVEL * 10} 粮）入账后是否超限 |`);
console.log('| --- | --- | --- |');
for (const farmLevel of [0, 1, 5, 10]) {
  const caps = storageCaps({ ...emptyBuildingLevels(), farm: farmLevel });
  console.log(`| 农田 Lv${farmLevel} | ${caps.food} | ${800 + PLUNDER_POOL_RESOURCE_PER_LEVEL * 10 > caps.food ? '可能超限（存量接近上限时）' : '不超限（开局存量 800）'} |`);
}
console.log('\n结论：掠夺即时入账不做储量钳制（占位规则，已列入评审记录）；超限存量不直接扣减，');
console.log('仅停止对应生产增长——与 v8 既定的「已有超限存量不扣减」语义一致。\n');
