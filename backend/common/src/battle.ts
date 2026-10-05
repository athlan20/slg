// 一期战斗的规则层（v13 结构落地，v15 规则定稿：AISLG-2 战斗数值评审）。
// 本文件承载：兵种参考战力与编队工具、野地原住守军 / NPC 袭击部队编成、
// 城墙守城减伤系数与两种战斗入口。多回合引擎（战场结构、行动顺序、余伤血池、
// 判定链）在 battle-engine.ts —— API 与 Worker 共用，两侧不得各自另算。
// 全部数值经 backend/scripts/battle-calibration.ts 固定种子批量模拟评审定稿
// （评审记录 docs/battle-calibration.md）；调整需重跑校准并更新记录。

import { TROOP_KINDS, type ArmyCounts, type TroopKind } from './protocol';
import { wallBasePercent } from './rules';
import { simulateBattle, type BattleOptions, type BattleResult } from './battle-engine';

// 消费方的历史引用面保持在 './battle'（引擎与兵种属性经本文件重导出）
export * from './battle-engine';

// ---- 参考战力与编队工具 ----

/** 参考战力（展示与势力对比用；不参与战斗结算，数值评审定稿） */
export const TROOP_POWER: Record<TroopKind, number> = {
  porter: 1,
  militia: 2,
  scout: 2,
  pikeman: 4,
  swordsman: 5,
  archer: 5,
  cavalry: 8,
  iron_cavalry: 14,
  supply_wagon: 1,
  ballista: 8,
  siege_ram: 3,
};

/** 编队参考战力 = Σ 数量 × 单兵参考战力（未知兵种按 0 计） */
export function armyPower(troops: Partial<Record<TroopKind, number>>): number {
  let power = 0;
  for (const kind of TROOP_KINDS) {
    power += (troops[kind] ?? 0) * TROOP_POWER[kind];
  }
  return power;
}

/** 空编队判断（出征 / 侦察校验用：全部为 0 视为空） */
export function isEmptyArmy(troops: Partial<Record<TroopKind, number>>): boolean {
  return armyPower(troops) === 0 && TROOP_KINDS.every((kind) => (troops[kind] ?? 0) === 0);
}

/** 按兵种补全为完整计数视图（缺省 0；tile_army / marches 的 troops 快照共用的形态） */
export function toFullArmyCounts(troops: Partial<Record<TroopKind, number>>): ArmyCounts {
  const full = {} as ArmyCounts;
  for (const kind of TROOP_KINDS) {
    full[kind] = Math.max(0, Math.floor(troops[kind] ?? 0));
  }
  return full;
}

// ---- 野地原住守军与 NPC 袭击部队（数值评审定稿） ----

/**
 * 未占领野地的原住守军基准编成（v24，AISLG-48）：Lv1–2 纯近战义兵 8×等级（新号第一仗
 * 不会「摸不到人、单方面挨打」）；Lv3 起义兵 6×等级 + 弓箭兵（等级 − 2），远程随等级渐增。
 * 实际守军在基准上按地块坐标固定浮动 ±20%（见 nativeGarrison）。
 */
export const NATIVE_MILITIA_PER_LEVEL_LOW = 8;
export const NATIVE_MILITIA_PER_LEVEL_HIGH = 6;
/** 配弓箭兵的起始等级（含）与「等级 − 偏移」的偏移量 */
export const NATIVE_ARCHER_FROM_LEVEL = 3;
export const NATIVE_ARCHER_LEVEL_OFFSET = 2;
/** 守军 ±浮动比例（按地块坐标固定，侦察可见具体数量） */
export const NATIVE_JITTER = 0.2;
/** 战后守军每小时恢复的比例（相对基准编成；随全局时间倍速缩放，AISLG-48 第二步） */
export const NATIVE_RECOVERY_PER_HOUR = 0.25;
/** NPC 袭击部队构成：参考战力 = 25 × 等级（v21 AISLG-28：40 → 25，降低袭击折损
 *  把低等级占领净收益拉正；编成公式已对文档公开，AISLG-29） */
export const RAID_MILITIA_PER_LEVEL = 10;
export const RAID_ARCHER_PER_LEVEL = 1;

/** 未占领野地的基准守军编成（未浮动；文档进攻口径与恢复上限的参照） */
export function nativeGarrisonBase(level: number): Partial<Record<TroopKind, number>> {
  const lv = Math.max(0, Math.floor(level));
  if (lv === 0) {
    return {};
  }
  if (lv < NATIVE_ARCHER_FROM_LEVEL) {
    return { militia: lv * NATIVE_MILITIA_PER_LEVEL_LOW };
  }
  return { militia: lv * NATIVE_MILITIA_PER_LEVEL_HIGH, archer: lv - NATIVE_ARCHER_LEVEL_OFFSET };
}

/** 地块固定浮动系数（0.8..1.2）：坐标整数哈希，同一地块恒定，与调用进程无关 */
export function nativeJitterFactor(x: number, y: number): number {
  let h = Math.imul(x | 0, 0x45d9f3b) ^ Math.imul(y | 0, 0x119de1f3);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  h ^= h >>> 16;
  const unit = (h >>> 0) / 0x100000000;
  return 1 - NATIVE_JITTER + 2 * NATIVE_JITTER * unit;
}

/**
 * 未占领野地满编原住守军：基准编成 × 地块固定浮动系数（四舍五入，非零兵种至少 1 个）。
 * 未提供坐标时返回基准编成。真实编队参与多回合战斗。
 */
export function nativeGarrison(level: number, at?: { x: number; y: number }): Partial<Record<TroopKind, number>> {
  const base = nativeGarrisonBase(level);
  if (!at) {
    return base;
  }
  const factor = nativeJitterFactor(at.x, at.y);
  const jittered: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = base[kind] ?? 0;
    if (count > 0) {
      jittered[kind] = Math.max(1, Math.round(count * factor));
    }
  }
  return jittered;
}

/** NPC 袭击部队编成（数值评审定稿） */
export function npcRaidArmy(level: number): Partial<Record<TroopKind, number>> {
  const lv = Math.max(0, Math.floor(level));
  return lv === 0 ? {} : { militia: lv * RAID_MILITIA_PER_LEVEL, archer: lv * RAID_ARCHER_PER_LEVEL };
}

// ---- 主城袭击的强度推导（v22，AISLG-40 方案 B） ----

/** 主城袭击战力每级锚点 = armyPower(npcRaidArmy(1))（编成义兵10+弓1 → 参考战力 25） */
export const CITY_RAID_POWER_PER_LEVEL = 10 * 2 + 1 * 5;
/** 主城袭击强度下限 = 官府等级 ÷ 本系数（防「清空守军骗低强度袭击」） */
export const CITY_RAID_MIN_LEVEL_DIVISOR = 2;

/**
 * 主城袭击等级推导（v22，AISLG-40 方案 B）：level = clamp(ceil(守军参考战力 ÷ 25),
 * max(1, floor(官府等级 ÷ 2)), 官府等级)。强度锚点从「经济等级（官府）」换到
 * 「防守能力（守军战力）」：守军归零时袭击降到官府一半强度，不再零守军挨满编；
 * 官府升级不再自动放大挨打规模。下限防故意清守军骗低强度。野地袭击仍按地块等级。
 */
export function cityRaidLevel(garrisonPower: number, governmentLevel: number): number {
  const gov = Math.max(0, Math.floor(governmentLevel));
  const lower = Math.max(1, Math.floor(gov / CITY_RAID_MIN_LEVEL_DIVISOR));
  const byPower = Math.ceil(Math.max(0, garrisonPower) / CITY_RAID_POWER_PER_LEVEL);
  return Math.max(1, Math.min(gov, Math.max(lower, byPower)));
}

/** 城墙守城减伤（百分数）= wallBasePercent（rules.ts：前 10 级每级 +5、11~20 级每级 +2，v31）
 *  + extraPercent（v27 城防科技，仅玩家主城守城传入，NPC 城墙不传）；
 *  只对城墙位的守方兵堆生效（攻城守军出城迎击即失去，见 battle-engine） */
export function wallDefensePercent(wallLevel: number, extraPercent = 0): number {
  return wallBasePercent(wallLevel) + Math.max(0, extraPercent);
}

/**
 * 一次攻防结算（野地遭遇战：守方编成迎面推进、无城墙）。攻方败 = 未能歼灭守方
 * （守方全灭攻方或回合耗尽）；败方幸存者由调用方结算去向（出征败退撤回出发城），
 * 胜方幸存 ≥ 1（占领语义）。
 */
export function resolveBattle(
  attacker: Partial<Record<TroopKind, number>>,
  defender: Partial<Record<TroopKind, number>>,
  opts: BattleOptions = {},
): BattleResult {
  return simulateBattle(attacker, defender, { siege: false, ...opts });
}

export interface NpcRaidOutcome {
  /** 守方（玩家驻军）是否守住：NPC 部队未能歼灭驻军 */
  defended: boolean;
  /** 战斗明细（攻方 = NPC 袭击部队，守方 = 玩家驻军） */
  result: BattleResult;
}

/**
 * NPC 袭击占领野地的结算（野地遭遇战结构）：NPC 部队为攻方。守住（攻方未歼灭
 * 驻军）时驻军必有幸存（引擎保证：守方胜 ⇔ 驻军存活）；失守 = 驻军全灭、占领失效。
 * NPC 部队回合耗久未能突破时视为撤退消失（NPC 编队不落库，无需撤回行军）。
 */
export function resolveNpcRaid(
  garrison: Partial<Record<TroopKind, number>>,
  level: number,
  rng?: () => number,
): NpcRaidOutcome {
  const result = simulateBattle(npcRaidArmy(level), garrison, { siege: false, rng });
  return { defended: !result.attackerWon, result };
}
