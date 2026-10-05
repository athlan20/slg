// 玩家对抗的保护规则（v38，AISLG-122「玩家对抗（一）」）：新手保护、被动 / 主动免战、
// 玩家掠夺的单次比例上限与等级差衰减。API（MARCH / SCOUT / TRUCE 发起校验）与
// Worker（到达在锁内复核、结算免战）共用本文件，两侧不得各自再实现一套数值。
// 全部时长为占位决策（需求表拍板，随全局时间倍速缩放），调整入口只在本文件。
// 保护语义：
// - 新手保护（账号级，accounts.newbie_until）：注册后 3 天，或任一城官府升到 8 级（v42 校准），
//   先到为准。期内别人不能侦察 / 攻击他；他自己侦察或攻击别的玩家，保护立即失效
//   （打野地 / NPC 不失效）。
// - 被动免战（城级，cities.truce_until）：城被攻破或被抢后该城免战 4 小时，玩家与
//   NPC 都不能再打它（与 NPC 袭城免战同一状态；NPC 侧沿用 2×袭击间隔，玩家侧 4 小时）。
// - 主动免战（账号级，accounts.self_truce_until）：每周可免费开一次、持续 12 小时。
//   开着时别人打不了他，他自己也不能出兵打玩家（打野地 / NPC 不受影响）。
// - 等级差衰减：出发城官府比目标城官府高 5 级起，每多 1 级掠夺收益 −15%，最低 25%（v42 维持）
//   （大号打小号不禁止，但越打越拿不到东西）。

import type { Resources } from './protocol';
import { scaledMs } from './time-scale';
import { warehouseProtectedPool, type PlunderableKey } from './plunder';

/** 新手保护时长基准：注册后 3 天（随 timeScale 缩放） */
export const NEWBIE_PROTECTION_MS = 3 * 24 * 60 * 60 * 1000;

/** 官府升到该等级即提前结束新手保护（任一城，先到为准）。
 *  v42（AISLG-126 校准拍板）从 5 级提到 8 级：50 倍速下 5 级约 7 分钟即达，
 *  保护被「先到」条款架空；8 级约需 2.6 万金（基准约 15 小时），给新玩家真缓冲 */
export const NEWBIE_GOVERNMENT_LEVEL = 8;

/** 玩家城被攻破 / 被抢后的免战时长基准：4 小时（随 timeScale 缩放） */
export const PVP_CITY_TRUCE_MS = 4 * 60 * 60 * 1000;

/** 主动免战时长基准：12 小时（随 timeScale 缩放） */
export const SELF_TRUCE_MS = 12 * 60 * 60 * 1000;

/** 主动免战的免费周期基准：7 天内只能开一次（随 timeScale 缩放） */
export const SELF_TRUCE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** 野地刚换主人后的保护时长基准：1 小时（v39，AISLG-123；期间谁都不能抢这块地，
 *  记在 world_tiles.owner_changed_until，防拉锯） */
export const TILE_CAPTURE_PROTECTION_MS = 60 * 60 * 1000;

// ---- 分城城防值（v40，AISLG-124「玩家对抗（三）」）----
// 分城可被「占领」任务攻打：守城战打赢一次（守军全灭）降一截，降到 0 当场换主人；
// 主城没有城防值、永远不能被占领。城防值是城自己的，不分是谁打的（补刀者得城）。
// 免战期内不回涨，免战结束后按小时慢慢回涨——占一座分城至少打 3 次、隔开 8 小时以上。

/** 城防值满值 */
export const DURABILITY_MAX = 100;
/** 每次打赢（守军全灭）降低的城防值 */
export const DURABILITY_DAMAGE_PER_WIN = 35;
/** 冲车额外降低的上限（按攻方幸存冲车占比线性加成） */
export const DURABILITY_RAM_BONUS_MAX = 15;
/** 冲车占比达到该比例拿满加成（与 v33 冲车破墙 10% 满额的量级一致） */
export const DURABILITY_RAM_RATIO_FULL = 0.1;
/** 免战结束后每小时回涨的城防值（速率类：一小时基准随全局倍速缩放） */
export const DURABILITY_REGEN_PER_HOUR = 10;
/** 分城换主后的保护时长基准：6 小时（随缩放；期间谁都不能打这座城） */
export const CITY_CONQUEST_PROTECTION_MS = 6 * 60 * 60 * 1000;

/**
 * 城防值的惰性结算（纯函数）：免战期内不回涨，免战结束后从
 * max(上次结算时刻, 免战截止) 起按小时回涨（每小时基准随缩放），到满为止。
 * current 为 null 视为满值（主城永不降、从未被打过的分城未落值）。
 */
export function settleDurability(
  current: number | null,
  settledAt: Date | string | null,
  truceUntil: Date | string | null,
  now: Date,
): number {
  const value = Math.min(DURABILITY_MAX, Math.max(0, Math.floor(current ?? DURABILITY_MAX)));
  if (value >= DURABILITY_MAX) {
    return DURABILITY_MAX;
  }
  const settledMs = settledAt === null || settledAt === undefined ? 0 : new Date(settledAt).getTime();
  const truceMs = truceUntil === null || truceUntil === undefined ? 0 : new Date(truceUntil).getTime();
  const baseMs = Math.max(Number.isFinite(settledMs) ? settledMs : 0, Number.isFinite(truceMs) ? truceMs : 0);
  const nowMs = now.getTime();
  if (baseMs >= nowMs) {
    return value;
  }
  const hours = Math.floor((nowMs - baseMs) / scaledMs(60 * 60 * 1000));
  if (hours <= 0) {
    return value;
  }
  return Math.min(DURABILITY_MAX, value + hours * DURABILITY_REGEN_PER_HOUR);
}

/** 攻城胜利对城防值的伤害：基础 35 + 冲车占比加成（占比 10% 拿满 +15） */
export function siegeDamage(survivingRams: number, survivingTotal: number): { damage: number; ramBonus: number } {
  const ratio = survivingTotal > 0 ? Math.max(0, survivingRams) / survivingTotal : 0;
  const ramBonus = Math.min(
    DURABILITY_RAM_BONUS_MAX,
    Math.floor((Math.min(ratio, DURABILITY_RAM_RATIO_FULL) / DURABILITY_RAM_RATIO_FULL) * DURABILITY_RAM_BONUS_MAX),
  );
  return { damage: DURABILITY_DAMAGE_PER_WIN + ramBonus, ramBonus };
}

/** 注册时刻 → 新手保护截止时刻（时长按判定时刻的缩放折算，锚定注册时刻） */
export function newbieUntilFrom(createdAt: Date | string): Date {
  const base = createdAt instanceof Date ? createdAt.getTime() : new Date(createdAt).getTime();
  return new Date(base + scaledMs(NEWBIE_PROTECTION_MS));
}

/** 是否处于新手保护期（newbieUntil 为空 = 已出保 / 从未受保护） */
export function inNewbieProtection(newbieUntil: Date | string | null, now: Date): boolean {
  if (newbieUntil === null || newbieUntil === undefined) {
    return false;
  }
  const at = newbieUntil instanceof Date ? newbieUntil : new Date(newbieUntil);
  const ts = at.getTime();
  return Number.isFinite(ts) && ts > now.getTime();
}

/** 是否处于免战期（被动城级 truceUntil 与主动账号级 shieldUntil 任一生效） */
export function inTruce(
  cityTruceUntil: Date | string | null,
  shieldUntil: Date | string | null,
  now: Date,
): boolean {
  return (
    activeAt(cityTruceUntil, now) !== null || activeAt(shieldUntil, now) !== null
  );
}

/** 生效中的截止时刻（两个都生效时取更晚者）；不生效返回 null */
export function activeAt(
  until: Date | string | null,
  now: Date,
): Date | null {
  if (until === null || until === undefined) {
    return null;
  }
  const at = until instanceof Date ? until : new Date(until);
  return Number.isFinite(at.getTime()) && at.getTime() > now.getTime() ? at : null;
}

/** 上次使用主动免战的时刻 → 下一次可开启时刻；本周已用过返回该时刻，可用返回 null */
export function selfTruceNextAvailableAt(
  usedAt: Date | string | null,
): Date | null {
  if (usedAt === null || usedAt === undefined) {
    return null;
  }
  const at = usedAt instanceof Date ? usedAt : new Date(usedAt);
  if (!Number.isFinite(at.getTime())) {
    return null;
  }
  return new Date(at.getTime() + scaledMs(SELF_TRUCE_WEEK_MS));
}

// ---- 玩家掠夺的单次上限与等级差衰减 ----

/** 单次最多抢走可抢四资源（存量 − 仓库保护）的比例（v42 AISLG-126 校准拍板：0.3 → 0.45，
 *  让「打赢守军」接近打平、等势互抢期望为正；空城全拿仍是暴利，保住侦察挑软柿的价值） */
export const PVP_PLUNDER_SHARE = 0.45;
/** 单次最多抢走金币存量的比例（v42 同上：0.1 → 0.15，保持金币比四资源更耐抢） */
export const PVP_GOLD_SHARE = 0.15;
/** 等级差衰减起点：出发城官府比目标城官府高该级数起开始衰减 */
export const PVP_LEVEL_GAP_START = 5;
/** 起点之上每多 1 级的收益衰减（0.15 = −15%） */
export const PVP_LEVEL_PENALTY_PER_LEVEL = 0.15;
/** 等级差衰减的收益下限（0.25 = 最低 25%） */
export const PVP_LEVEL_PENALTY_FLOOR = 0.25;

/** 等级差收益系数（纯函数）：差 ≤ 5 级为 1；之后每多 1 级 −15%，最低 25% */
export function pvpLevelFactor(attackerGovernment: number, defenderGovernment: number): number {
  const gap = Math.floor(attackerGovernment) - Math.floor(defenderGovernment) - PVP_LEVEL_GAP_START;
  if (gap <= 0) {
    return 1;
  }
  return Math.max(PVP_LEVEL_PENALTY_FLOOR, 1 - gap * PVP_LEVEL_PENALTY_PER_LEVEL);
}

/**
 * 玩家城被掠夺的可抢池（v38）：先扣仓库保护（金币不设保护），再叠加单次比例上限
 * （四资源 30% / 金币 10%）与等级差衰减。实际带走仍受部队负重装填约束
 * （loadByCarry），三者取最小。金币口径基于存量（v41 起 NPC 袭城的 5% 上限
 * 只作用于 cityPlunderPool，不影响本函数）。
 */
export function pvpPlunderPool(
  resources: Resources,
  warehouseLevel: number,
  attackerGovernment: number,
  defenderGovernment: number,
): Record<PlunderableKey, number> {
  const pool = warehouseProtectedPool(resources, warehouseLevel);
  const factor = pvpLevelFactor(attackerGovernment, defenderGovernment);
  return {
    gold: Math.floor(pool.gold * PVP_GOLD_SHARE * factor),
    food: Math.floor(pool.food * PVP_PLUNDER_SHARE * factor),
    wood: Math.floor(pool.wood * PVP_PLUNDER_SHARE * factor),
    stone: Math.floor(pool.stone * PVP_PLUNDER_SHARE * factor),
    iron: Math.floor(pool.iron * PVP_PLUNDER_SHARE * factor),
  };
}
