// 势力围攻分城（AISLG-240，v100）的规则与数值：入池条件、节奏（6 小时一次 / 每周上限 / 打输 24 小时）、
// 围城军战力与编成、预警提前量、城防结算口径。纯函数，不碰数据库与协议运行时，
// Worker（发起 / 到达结算）与 API（视图与文档）共用，两侧不得各算一套。
// 数据库读写见 faction-siege-db.ts，结算流程见 worker/src/faction-siege-battle.ts。
// 打老巢、奖励、势力灭亡不在本张单（AISLG-241）。
//
// 数值来源（需求 AISLG-240「数值是怎么定的」）：围城军战力 = 分城官府等级 × 倍率（第 8~14 天 100、
// 15~21 天 150、22 天起 200），编成按 3 级 NPC 城守军的比例（义兵 100 : 刀盾 30 : 弓箭 40 : 轻骑 12）；
// 每次打赢扣 35 城防（沿用 siegeDamage，围城军不带冲车），城防 100 → 0 要连赢 6 次、跨约 30 小时。
// AISLG-249（v107）起另受「压制档」影响：老巢被打掉 15 营以上（3 档）时每周上限降为 1 座、
// 围城军战力按压制比例打折（factionSiegeSuppressedPower），压制档本身见 faction-suppression.ts。

import { beaconLeadMultiplier } from './building-effects';
import { MAX_BUILDING_LEVEL } from './rules';
import { armyPower } from './battle';
import { FACTION_SEASON_DAY_MS, chebyshevDistance, factionDayAt, type FactionDef } from './faction';
import { inNewbieProtection, inTruce } from './protection';
import type { TroopKind } from './protocol';
import { scaledMs } from './time-scale';

// ---- 入池与节奏 ----

/** 启用满 7 天后才围攻（势力第 8 天起；天数按势力起点算，见 factionEpochStart，不随 time_scale 变化） */
export const FACTION_SIEGE_START_DAY = 8;

/** 围城军倍率档位：战力 = 分城官府等级 × 倍率（第 8 天前恒为 0，即不围攻） */
export const FACTION_SIEGE_MULTIPLIERS: ReadonlyArray<{ fromDay: number; multiplier: number }> = [
  { fromDay: 1, multiplier: 0 },
  { fromDay: 8, multiplier: 100 },
  { fromDay: 15, multiplier: 150 },
  { fromDay: 22, multiplier: 200 },
];

/** 本周围城军倍率（第 day 天） */
export function factionSiegeMultiplierForDay(day: number): number {
  let multiplier = 0;
  for (const step of FACTION_SIEGE_MULTIPLIERS) {
    if (day >= step.fromDay) {
      multiplier = step.multiplier;
    }
  }
  return multiplier;
}

/** 每家每周最多吞下的玩家分城数（达到上限后本周不再发起围攻）：0~2 档 2 座（AISLG-240 现状） */
export const FACTION_SIEGE_WEEKLY_CAP = 2;

/** 3 档（老巢被打掉 15 营以上，AISLG-249）的每周上限：1 座（减掉一半，只影响拼灭亡的阶段） */
export const FACTION_SIEGE_WEEKLY_CAP_AT_MAX_SUPPRESSION = 1;

/** 压制档上限 3（与 faction-suppression.ts 的 FACTION_SUPPRESSION_MAX_LEVEL 同值，这里只用来判上限档） */
const MAX_SUPPRESSION_LEVEL = 3;

/** 按这家当前的压制档取每周吞分城上限（AISLG-249）：0~2 档 2 座，3 档 1 座 */
export function factionSiegeWeeklyCap(suppressionLevel: number): number {
  return suppressionLevel >= MAX_SUPPRESSION_LEVEL ? FACTION_SIEGE_WEEKLY_CAP_AT_MAX_SUPPRESSION : FACTION_SIEGE_WEEKLY_CAP;
}

/** 一周的时长（真实天数，不随 time_scale 变化）：一周按本季第 8 / 15 / 22 天起算 */
export const FACTION_SIEGE_WEEK_DAYS = 7;

/** 同一座城两次围攻之间的最小间隔基准：6 小时（随缩放） */
export const FACTION_SIEGE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** 这座城守住一次（势力打输）后，该势力多少小时内不再打它：24 小时（随缩放） */
export const FACTION_SIEGE_LOSS_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 围攻预警提前量基准：60 分钟（随缩放，再吃烽火台加成） */
export const FACTION_SIEGE_WARNING_MS = 60 * 60 * 1000;

/** 同一座城的围攻间隔（毫秒，随全局时间缩放） */
export function factionSiegeIntervalMs(): number {
  return scaledMs(FACTION_SIEGE_INTERVAL_MS);
}

/** 打输后同一座城的冷却时长（毫秒，随全局时间缩放） */
export function factionSiegeLossCooldownMs(): number {
  return scaledMs(FACTION_SIEGE_LOSS_COOLDOWN_MS);
}

/** 预警提前量（毫秒，随全局时间缩放；烽火台加成由调用方另乘） */
export function factionSiegeMaxLeadMs(): number {
  return Math.round(factionSiegeWarningMs() * beaconLeadMultiplier(MAX_BUILDING_LEVEL));
}

/**
 * 这次围攻的到达时刻；还不到发起的时候返回 null。
 * “同一座城 6 小时打一次”算的是两次**到达**的间隔：预警要提前发，所以下一次在 上次到达 + 6 小时 − 预警提前量
 * 就发起，到达时刻钉在 上次到达 + 6 小时。如果按结算后才发起，间隔会变成 6 小时 + 预警提前量，
 * 超过 7.5 小时后城防回涨比扣得快，城永远打不下来。
 */
export function factionSiegeArrival(args: {
  now: Date;
  leadMs: number;
  intervalMs: number;
  lastArriveAt: Date | null;
}): Date | null {
  const earliest = args.lastArriveAt ? args.lastArriveAt.getTime() + args.intervalMs : 0;
  if (args.now.getTime() < earliest - args.leadMs) {
    return null;
  }
  return new Date(Math.max(args.now.getTime() + args.leadMs, earliest));
}

export function factionSiegeWarningMs(): number {
  return scaledMs(FACTION_SIEGE_WARNING_MS);
}

/**
 * 势力第 day 天属于「第几个可围攻周」与这一周的起止时刻：一周按势力第 8、15、22 天起算，
 * 第 8 天前（day < 8）返回 null（还不能围攻，也就没有周上限）。
 * epochStart 是势力起点（factionEpochStart：max(本季开始时间, 势力启用时间)，AISLG-243）——
 * 当季启用时从启用当天算第 1 天，满 7 天才开始围攻。
 * 周界按真实天数推进（与半径同口径），换算成毫秒时用 scaledMs 之外的原始天数。
 */
export function factionSiegeWeekOf(
  epochStart: Date,
  now: Date,
): { index: number; start: Date; end: Date } | null {
  const day = factionDayAt(epochStart, now);
  if (day < FACTION_SIEGE_START_DAY) {
    return null;
  }
  const index = Math.floor((day - FACTION_SIEGE_START_DAY) / FACTION_SIEGE_WEEK_DAYS);
  const startMs = epochStart.getTime() + (FACTION_SIEGE_START_DAY - 1 + index * FACTION_SIEGE_WEEK_DAYS) * FACTION_SEASON_DAY_MS;
  return {
    index,
    start: new Date(startMs),
    end: new Date(startMs + FACTION_SIEGE_WEEK_DAYS * FACTION_SEASON_DAY_MS),
  };
}

// ---- 围城军 ----

/** 围城军编成的基准比例：与 3 级 NPC 城守军同比例（义兵 100 / 刀盾 30 / 弓箭 40 / 轻骑 12），不带冲车 */
export const FACTION_SIEGE_ARMY_BASE: Partial<Record<TroopKind, number>> = {
  militia: 100,
  swordsman: 30,
  archer: 40,
  cavalry: 12,
};

/** 基准编成的参考战力（缩放分母） */
export function factionSiegeBasePower(): number {
  return armyPower(FACTION_SIEGE_ARMY_BASE);
}

/**
 * 围城军战力 = 该分城官府等级 × 倍率（倍率见 FACTION_SIEGE_MULTIPLIERS）。
 * 官府等级为 0（还没建官府）时按 1 级算，避免出现 0 战力的空围城军。
 */
export function factionSiegePower(governmentLevel: number, multiplier: number): number {
  return Math.max(1, Math.floor(governmentLevel)) * Math.max(0, Math.floor(multiplier));
}

/**
 * 压制后的围城军战力（AISLG-249）= 原战力 × 压制档比例（100 / 75 / 50 / 25），向下取整、不低于 1。
 * 在围攻发起那一刻算（worker/src/faction-siege-tick.ts）：已出发的围城军不变，缺口留到下一次发起。
 */
export function factionSiegeSuppressedPower(power: number, siegePercent: number): number {
  const base = Math.max(1, Math.floor(Number.isFinite(power) ? power : 0));
  const percent = Math.max(0, Math.min(100, Math.floor(Number.isFinite(siegePercent) ? siegePercent : 100)));
  return Math.max(1, Math.floor((base * percent) / 100));
}

/**
 * 围城军编成：按基准比例缩放到目标战力（逐兵种四舍五入、至少 1），不带冲车。
 * 战力为 0（第 8 天前）时返回空编队（调用方不应发起）。
 */
export function factionSiegeArmy(power: number): Partial<Record<TroopKind, number>> {
  if (power <= 0) {
    return {};
  }
  const scale = power / factionSiegeBasePower();
  const army: Partial<Record<TroopKind, number>> = {};
  for (const [kind, base] of Object.entries(FACTION_SIEGE_ARMY_BASE) as Array<[TroopKind, number]>) {
    army[kind] = Math.max(1, Math.round(base * scale));
  }
  return army;
}

// ---- 入池条件 ----

/** 目标城不合格的原因（判定顺序即提示优先级；null = 可以围攻） */
export type SiegeDenial = 'SEASON_TOO_EARLY' | 'MAIN_CITY' | 'FAMOUS_CITY' | 'TARGET_PROTECTED' | 'TARGET_IN_TRUCE';

/**
 * 一座城能不能被围攻（发起与到达结算共用；并发 / 时间推进后到达时复核一次）。
 * - 本季满 7 天（第 8 天起）之前不围攻；
 * - 主城绝对不动，名城分城（含洛阳）不动；
 * - 目标账号在新手保护或主动免战中、这座城在被动免战中都不入池。
 */
export function factionSiegeDenial(args: {
  day: number;
  isMainCity: boolean;
  famous: boolean;
  newbieUntil: Date | string | null;
  selfTruceUntil: Date | string | null;
  cityTruceUntil: Date | string | null;
  now: Date;
}): SiegeDenial | null {
  if (args.day < FACTION_SIEGE_START_DAY) {
    return 'SEASON_TOO_EARLY';
  }
  if (args.isMainCity) {
    return 'MAIN_CITY';
  }
  if (args.famous) {
    return 'FAMOUS_CITY';
  }
  if (inNewbieProtection(args.newbieUntil, args.now) || inTruce(null, args.selfTruceUntil, args.now)) {
    return 'TARGET_PROTECTED';
  }
  if (inTruce(args.cityTruceUntil, null, args.now)) {
    return 'TARGET_IN_TRUCE';
  }
  return null;
}

/** 这一步的势力范围是否仍然覆盖这一格（到达时复核；范围一季只增不减，通常恒为真） */
export function factionSiegeInRange(def: FactionDef, x: number, y: number, radius: number): boolean {
  return chebyshevDistance(def.lair, { x, y }) <= radius;
}

/** 目标城与老巢的距离（选目标排序用：离老巢最近的先打） */
export function factionSiegeDistance(def: FactionDef, x: number, y: number): number {
  return chebyshevDistance(def.lair, { x, y });
}

