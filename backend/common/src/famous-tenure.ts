// 名城任期轮换（v111，AISLG-259）：名城不再是永久占有。
// - 每账号同一时间最多占 1 座名城（NPC 占领与他人名城占领都受限）；
// - 任期 7 天，从占下那一刻起算；到期该城回到「没人占的名城 NPC」状态（外围满编 + 城守守军）；
// - 到期失去那座城的原主人 48 小时内不能再占回它（他城不受限，外围 / 掠夺也不受限）；
// - 到期前 24 小时 / 1 小时各提醒一次（cities.famous_warn_stage 0/1/2 去重）；
// - 被玩家打下来不算到期：新主人任期重新从 7 天算，原主人不受 48 小时限制。
// 时间一律走全局时间缩放（time-scale.ts 的 scaledMs 口径），数值集中在本文件，
// API（出征发起初核）与 Worker（到达复核 / 到期处置）共用，两侧不得各写一份。

import { getTimeScale } from './time-scale';

/** 任期（基准 7 天；实际 = 基准 ÷ 全局时间缩放） */
export const FAMOUS_TENURE_DAYS = 7;
/** 到期失去后原主人不能再占回该城的封禁时长（基准 48 小时；按缩放换算） */
export const FAMOUS_EXPIRY_BAN_HOURS = 48;
/** 到期前提醒的两个时间点（基准小时）：24 小时 → stage 1，1 小时 → stage 2 */
export const FAMOUS_WARN_HOURS = [24, 1] as const;
/** 同一账号同一时间最多占有的名城数 */
export const FAMOUS_CITY_LIMIT = 1;

const HOUR_MS = 60 * 60 * 1000;

/** 基准时长 ÷ 全局时间缩放（钳 1 秒下限，与 scaledMs 同口径） */
function scaled(baseMs: number, scale: number): number {
  return Math.max(1_000, Math.floor(baseMs / Math.max(1, scale)));
}

/** 任期时长（毫秒，已按时间缩放） */
export function famousTenureMs(scale: number = getTimeScale()): number {
  return scaled(FAMOUS_TENURE_DAYS * 24 * HOUR_MS, scale);
}

/** 封禁时长（毫秒，已按时间缩放） */
export function famousBanMs(scale: number = getTimeScale()): number {
  return scaled(FAMOUS_EXPIRY_BAN_HOURS * HOUR_MS, scale);
}

/** 占下名城的时刻 → 任期到期时刻（ISO 时刻，已按时间缩放） */
export function famousExpiresAtFrom(now: Date, scale: number = getTimeScale()): Date {
  return new Date(now.getTime() + famousTenureMs(scale));
}

/** 到期失去的时刻 → 封禁截止时刻（已按时间缩放） */
export function famousBanUntilFrom(now: Date, scale: number = getTimeScale()): Date {
  return new Date(now.getTime() + famousBanMs(scale));
}

/** 任期剩余时长（毫秒；已到期或没有任期返回 0） */
export function famousRemainingMs(expiresAt: Date | null, now: Date): number {
  if (!expiresAt) {
    return 0;
  }
  return Math.max(0, expiresAt.getTime() - now.getTime());
}

/** 提醒阶段：0 = 还没提醒；1 = 已发 24 小时提醒；2 = 已发 1 小时提醒（也是终态） */
export type FamousWarnStage = 0 | 1 | 2;

/**
 * 当前时刻应当处于的提醒阶段（只看此刻离到期还有多久，不看已发的阶段）：
 * ≤ 1 小时 → 2；≤ 24 小时 → 1；否则 0。已到期返回 2（到期处置负责掉城，不再补提醒）。
 * 调用方（Worker tick）只在「应当阶段 > 已发阶段」时发一条，所以跳过某个点时只补一条。
 */
export function famousWarnTargetStage(
  expiresAt: Date | null,
  now: Date,
  scale: number = getTimeScale(),
): FamousWarnStage {
  if (!expiresAt) {
    return 0;
  }
  const remaining = expiresAt.getTime() - now.getTime();
  if (remaining <= scaled(FAMOUS_WARN_HOURS[1] * HOUR_MS, scale)) {
    return 2;
  }
  if (remaining <= scaled(FAMOUS_WARN_HOURS[0] * HOUR_MS, scale)) {
    return 1;
  }
  return 0;
}

/** 名城名额与封禁的拒绝原因（并入 branch-city.ts 的 OccupyCityDenial） */
export type FamousTenureDenial = 'FAMOUS_LIMIT' | 'FAMOUS_BANNED';

/** 任期内校验用的账号在该城名号上的现状 */
export interface FamousTenureState {
  /** 本账号当前占有的名城数 */
  famousOwned: number;
  /** 本账号在该名城上的封禁截止（到期失去后 48 小时；无关 / 已过期可为 null） */
  bannedUntil: Date | null;
}

/**
 * 占领名城的资格判定（出征发起与到达复核共用）：先看名额，再看封禁。
 * 名额：已有 1 座名城就不能再占（含打下他人名城）；封禁：只对「到期失去这座城的那个人」生效。
 */
export function checkFamousTenure(state: FamousTenureState, now: Date): FamousTenureDenial | null {
  if (state.famousOwned >= FAMOUS_CITY_LIMIT) {
    return 'FAMOUS_LIMIT';
  }
  if (state.bannedUntil && state.bannedUntil.getTime() > now.getTime()) {
    return 'FAMOUS_BANNED';
  }
  return null;
}