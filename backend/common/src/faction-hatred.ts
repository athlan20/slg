// 五方势力记仇（AISLG-264，v116）的规则与数值：每家势力对每个账号有一个仇恨值，
// 仇恨 = 基础仇恨 + 报复仇恨，换季清零。纯函数，不碰数据库与协议运行时；
// Worker（围攻选目标 / 打老巢结算加仇恨）与 API（GET_FACTIONS 的 hatredTier）共用，两侧不得各算一套。
// 数据库读写见 faction-hatred-db.ts，表结构见 faction-hatred-schema.ts。
//
// 数值来源（需求 AISLG-264「一、仇恨值」，已定死）：
// - 基础仇恨：全服战力榜（口径同 faction-lair-rank-db.ts 的 serverPowerRank）前 20 名，每天刷新；
//   第 k 名 = G1 × (21 − k) ÷ 20，向下取整（G1 = 老巢第 1 营当前战力，五家各自按自己的 G1 给，榜外为 0）；
// - 报复仇恨：玩家每打这家老巢一场，加这场歼灭的守军战力（与 faction_contrib 同口径，1:1），打输也加；
//   按时间衰减、半衰期 3 天（随 time_scale 缩放，与围攻间隔同口径），读和写都按半衰期折算、
//   折算后小于 1 视为 0（读时折算，不每天扫全表）。
// 围攻选谁（第二节）与围城军强度（第三节）见 faction-siege.ts / faction-hatred-db.ts。

import { scaledMs } from './time-scale';
import type { FactionHatredTier } from './protocol-faction';

/** 基础仇恨覆盖的战力榜名次上限：前 20 名（榜外仇恨为 0） */
export const FACTION_HATRED_BASE_RANKS = 20;

/** 档位分界：第 1~5 名 = target（重点目标） */
export const FACTION_HATRED_TARGET_RANK = 5;

/** 档位分界：第 6~20 名 = noticed（被注意），其余 none（无） */
export const FACTION_HATRED_NOTICED_RANK = 20;

/** 报复仇恨的半衰期基准：3 天（随全局时间缩放） */
export const FACTION_HATRED_HALF_LIFE_MS = 3 * 24 * 60 * 60 * 1000;

/** 基础仇恨的重算间隔基准：24 小时（随全局时间缩放；刷新时写一份前 20 名的榜单快照） */
export const FACTION_HATRED_BASE_REFRESH_MS = 24 * 60 * 60 * 1000;

/** 报复仇恨的半衰期（毫秒，已按 time_scale 缩放；不低于 1 秒） */
export function factionHatredHalfLifeMs(): number {
  return Math.max(1000, scaledMs(FACTION_HATRED_HALF_LIFE_MS));
}

/** 基础仇恨的重算间隔（毫秒，已按 time_scale 缩放；不低于 1 分钟，避免每个 tick 重算榜单） */
export function factionHatredBaseRefreshMs(): number {
  return Math.max(60_000, scaledMs(FACTION_HATRED_BASE_REFRESH_MS));
}

/** 取整后的战力值（NaN / 负数按 0） */
function sanePower(power: number): number {
  return Number.isFinite(power) ? Math.max(0, Math.floor(power)) : 0;
}

/**
 * 基础仇恨：第 rank 名 = G1 × (21 − rank) ÷ 20，向下取整（需求写的就是向下取整）。
 * rank 不在 1..20（榜外、脏值）时为 0；G1 见 faction-lair.ts（老巢第 1 营的战力锚点）。
 */
export function factionHatredBase(rank: number, g1: number): number {
  const r = Number.isFinite(rank) ? Math.floor(rank) : 0;
  if (r < 1 || r > FACTION_HATRED_BASE_RANKS) {
    return 0;
  }
  const base = sanePower(g1);
  return Math.floor((base * (FACTION_HATRED_BASE_RANKS + 1 - r)) / FACTION_HATRED_BASE_RANKS);
}

/**
 * 报复仇恨按半衰期折算（读时 / 写时都用它）：floor(retaliation × 0.5^(elapsed / halfLife))，
 * 折算后小于 1 视为 0（需求「折算后小于 1 视为 0」）。时钟回拨（elapsed < 0）按 0 处理，不放大仇恨。
 */
export function factionHatredDecayedRetaliation(args: {
  retaliation: number;
  updatedAt: Date;
  now: Date;
  halfLifeMs?: number;
}): number {
  const raw = Number.isFinite(args.retaliation) ? Math.max(0, args.retaliation) : 0;
  if (raw <= 0) {
    return 0;
  }
  const halfLife = Math.max(1, Math.floor(args.halfLifeMs ?? factionHatredHalfLifeMs()));
  const elapsed = Math.max(0, args.now.getTime() - args.updatedAt.getTime());
  const decayed = Math.floor(raw * Math.pow(0.5, elapsed / halfLife));
  return decayed < 1 ? 0 : decayed;
}

/** 全服战力榜前 20 名的一份快照（account_id + 名次；见 faction-lair-rank-db.ts 的 serverPowerTopAccounts） */
export interface FactionHatredBaseRank {
  accountId: string;
  rank: number;
}

/** faction_hatred 的一行（表里的累计报复仇恨，未折算；读时用 factionHatredDecayedRetaliation 折算） */
export interface FactionHatredRowInput {
  accountId: string;
  retaliation: number;
  updatedAt: Date;
}

/** 仇恨榜的一名：仇恨 = 基础仇恨 + 折算后的报复仇恨 */
export interface FactionHatredEntry {
  accountId: string;
  hatred: number;
  /** 全服战力榜名次（前 20 才有；榜外为 null，排序时排在榜内之后） */
  powerRank: number | null;
}

/**
 * 一家势力的仇恨榜（基础 + 报复，仇恨 > 0 的账号，按围攻选目标的顺序排好）：
 * 仇恨从高到低 → 战力榜名次（前 20 靠前的先） → 账号 id（只为输出稳定，需求里没有这一层）。
 * 基础仇恨只来自前 20 名快照，五家各自按自己的 G1 给；报复仇恨五家各自一份。
 */
export function factionHatredLeaderboard(args: {
  rows: readonly FactionHatredRowInput[];
  baseRanks: readonly FactionHatredBaseRank[];
  /** 这家老巢第 1 营的战力（基础仇恨的基准） */
  g1: number;
  now: Date;
  halfLifeMs?: number;
}): FactionHatredEntry[] {
  const merged = new Map<string, FactionHatredEntry>();
  const take = (accountId: string): FactionHatredEntry => {
    const found = merged.get(accountId);
    if (found) {
      return found;
    }
    const created: FactionHatredEntry = { accountId, hatred: 0, powerRank: null };
    merged.set(accountId, created);
    return created;
  };
  for (const row of args.baseRanks) {
    const base = factionHatredBase(row.rank, args.g1);
    if (base <= 0) {
      continue;
    }
    const entry = take(row.accountId);
    entry.hatred += base;
    entry.powerRank = entry.powerRank === null ? row.rank : Math.min(entry.powerRank, row.rank);
  }
  for (const row of args.rows) {
    const retaliation = factionHatredDecayedRetaliation({
      retaliation: row.retaliation,
      updatedAt: row.updatedAt,
      now: args.now,
      halfLifeMs: args.halfLifeMs,
    });
    if (retaliation <= 0) {
      continue;
    }
    take(row.accountId).hatred += retaliation;
  }
  return Array.from(merged.values())
    .filter((entry) => entry.hatred > 0)
    .sort(factionHatredEntryOrder);
}

/** 仇恨榜的排序（仇恨 → 战力榜名次 → 账号 id） */
export function factionHatredEntryOrder(a: FactionHatredEntry, b: FactionHatredEntry): number {
  return factionHatredSiegeOrder(
    { hatred: a.hatred, powerRank: a.powerRank, distance: 0, accountId: a.accountId },
    { hatred: b.hatred, powerRank: b.powerRank, distance: 0, accountId: b.accountId },
  );
}

/** 围攻候选（一家势力里一个账号的仇恨 + 它的目标城离老巢的距离） */
export interface FactionHatredSiegeCandidateKey {
  hatred: number;
  powerRank: number | null;
  /** 目标分城与老巢的切比雪夫距离（格） */
  distance: number;
  accountId: string;
}

/**
 * 围攻选目标的排序（需求「二、势力选谁围」的第 2 条）：
 * 仇恨从高到低 → 仇恨相同按战力榜名次（榜内靠前的先、榜外垫底） → 再相同按分城离老巢距离 → 账号 id。
 */
export function factionHatredSiegeOrder(a: FactionHatredSiegeCandidateKey, b: FactionHatredSiegeCandidateKey): number {
  if (a.hatred !== b.hatred) {
    return b.hatred - a.hatred;
  }
  if (a.powerRank !== b.powerRank) {
    if (a.powerRank === null) {
      return 1;
    }
    if (b.powerRank === null) {
      return -1;
    }
    return a.powerRank - b.powerRank;
  }
  if (a.distance !== b.distance) {
    return a.distance - b.distance;
  }
  return a.accountId < b.accountId ? -1 : a.accountId > b.accountId ? 1 : 0;
}

/**
 * 玩家在某家仇恨榜上的档位（需求「五、玩家能看到什么」）：
 * 前 5 名 = target（重点目标）、第 6~20 名 = noticed（被注意）、其余 none（无）；
 * 仇恨为 0（或不在榜上）一律 none。只对请求者自己给出，不暴露具体数值。
 */
export function factionHatredTier(rank: number | null, hatred: number): FactionHatredTier {
  if (!(hatred > 0) || rank === null || !Number.isFinite(rank) || rank < 1) {
    return 'none';
  }
  if (rank <= FACTION_HATRED_TARGET_RANK) {
    return 'target';
  }
  if (rank <= FACTION_HATRED_NOTICED_RANK) {
    return 'noticed';
  }
  return 'none';
}