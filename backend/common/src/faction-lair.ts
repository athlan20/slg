// 攻破五方势力老巢（AISLG-241，v101）的规则与数值：20 个营、每营战力与编成、城墙减伤、
// 歼灭奖励 / 声望、灭亡榜单、24 小时无人进攻的恢复、每天刷新后的残血比例。纯函数，不碰数据库与
// 协议运行时；API（面板 / 出征校验 / 侦察）与 Worker（战斗结算 / 每日刷新 / 灭亡）共用。
// 数据库读写见 faction-lair-db.ts，战斗结算见 worker/src/faction-lair-battle.ts，
// 灭亡联动见 worker/src/faction-lair-destroy.ts。
//
// 数值来源（需求 AISLG-241「数值是怎么定的」，AISLG-247 改为梯度）：老巢分 20 营，每次进攻只打当前一营、
// 走守城战、城墙减伤 50%；20 营由弱到强等比递增（第 1 营最弱、第 20 营最强），由两个锚点定：
// G1 = max(10,000, R10 × 0.35)、G20 = max(G1, R3 × 0.35)、Gk = G1 × (G20 / G1)^((k-1)/19)，
// R10 / R3 = 全服战力第 10 / 第 3 名账号的单人战力；每天刷新一次、两个锚点各自只升不降、最低 10,000；
// 编成按 义兵 100 : 刀盾 30 : 弓箭 40 : 轻骑 12 缩放（与势力围城军同一比例）；
// 歼灭奖励 = 每点守军战力金币 2、四种资源各 10；声望按歼灭战力的 1%；灭亡榜单是黄巾之乱同名次的 3 倍。
// 注意：营的守军 / 满编战力一律按「当前营序号」取 Gk，没有单一的「每营战力」了。

import { armyPower } from './battle';
import { factionSiegeArmy } from './faction-siege';
import { RESOURCE_KEYS, TROOP_KINDS, type Resources, type TroopKind } from './protocol';
import { scaledMs } from './time-scale';

/** 老巢的营数（每次只打当前一营，打掉的营不会回来） */
export const FACTION_LAIR_CAMPS = 20;

/** 锚点用的排名（AISLG-247）：第 10 名定最弱的第 1 营，第 3 名定最强的第 20 营 */
export const FACTION_LAIR_R10_RANK = 10;
export const FACTION_LAIR_R3_RANK = 3;

/** 锚点系数（百分数，需求「0.35」）：G1 = R10 × 35%、G20 = R3 × 35% */
export const FACTION_LAIR_ANCHOR_PERCENT = 35;

/** 战力下限：G1 / G20 都不低于它（开季全服没有部队时两个锚点都是这个值，保证开局就能打） */
export const FACTION_LAIR_MIN_CAMP_POWER = 10_000;

/** 老巢守城战的城墙减伤（百分数；需求「城墙减伤 50%」，与玩家城的城墙等级无关） */
export const FACTION_LAIR_WALL_PERCENT = 50;

/** 每营战力的刷新间隔基准：24 小时（随全局时间缩放，直接按毫秒缩放） */
export const FACTION_LAIR_POWER_REFRESH_MS = 24 * 60 * 60 * 1000;

/** 连续多久没人进攻恢复 1 营的基准时长：24 小时（随全局时间缩放） */
export const FACTION_LAIR_RECOVER_MS = 24 * 60 * 60 * 1000;

/** 歼灭奖励：每歼灭 1 点守军战力的金币与每种资源数量 */
export const FACTION_LAIR_KILL_GOLD_PER_POWER = 2;
export const FACTION_LAIR_KILL_RESOURCE_PER_POWER = 10;

/** 老巢战斗的声望比例（百分数）：歼灭战力的 1%（世界地图其余战斗按 1:1） */
export const FACTION_LAIR_PRESTIGE_PERCENT = 1;

/** 每营战力的刷新间隔（毫秒，已按 time_scale 缩放；不低于 1 分钟，避免缩放到极小时每 tick 重算） */
export function factionLairPowerRefreshMs(): number {
  return Math.max(60_000, scaledMs(FACTION_LAIR_POWER_REFRESH_MS));
}

/** 无人进攻恢复 1 营的时长（毫秒，已按 time_scale 缩放；不低于 1 秒） */
export function factionLairRecoverMs(): number {
  return Math.max(1000, scaledMs(FACTION_LAIR_RECOVER_MS));
}

/** 取整后的战力值（NaN / 负数按 0；数据库的 bigint 可能以字符串返回） */
function sanePower(power: number): number {
  return Number.isFinite(power) ? Math.max(0, Math.floor(power)) : 0;
}

/**
 * 两个锚点（AISLG-247）：R10 = 全服战力第 10 名、R3 = 第 3 名账号的单人战力。
 * - G1 = max(10,000, R10 × 0.35)，G20 = max(G1, R3 × 0.35)；
 * - 系数是 0.35，乘法结果四舍五入到整数（需求验收给的 47,068 → 16,474、443,174 → 155,111 就是四舍五入；
 *   向下取整会得到 16,473 / 155,110）；
 * - 是不是「历史最大值」由调用方（每日刷新）负责，这里只算这一轮的锚点；
 * - 全服没有部队（R3 = R10 = 0）时两个锚点都是下限 10,000。
 */
export function factionLairAnchorPower(r10: number, r3: number): { g1: number; g20: number } {
  const anchor = (power: number): number =>
    Math.round((sanePower(power) * FACTION_LAIR_ANCHOR_PERCENT) / 100);
  const g1 = Math.max(FACTION_LAIR_MIN_CAMP_POWER, anchor(r10));
  const g20 = Math.max(g1, anchor(r3));
  return { g1, g20 };
}

/**
 * 第 campNo 营的战力 Gk（AISLG-247）：Gk = G1 × (G20 / G1)^((k − 1) / 19)，向下取整。
 * 营序号从 1 起算、夹在 1..20；G20 < G1 时按 G1 处理（锚点只会由 round 与 max 保证，这里兜底）。
 */
export function factionLairCampPowerAt(g1: number, g20: number, campNo: number): number {
  const base = Math.max(FACTION_LAIR_MIN_CAMP_POWER, sanePower(g1));
  const top = Math.max(base, sanePower(g20));
  const no = Math.max(1, Math.min(FACTION_LAIR_CAMPS, Math.floor(campNo) || 1));
  if (top <= base) {
    return base;
  }
  const step = (no - 1) / (FACTION_LAIR_CAMPS - 1);
  return Math.max(base, Math.min(top, Math.floor(base * Math.pow(top / base, step))));
}

/**
 * 一营的守军编成：按 义兵 100 : 刀盾 30 : 弓箭 40 : 轻骑 12 的比例缩放到目标战力。
 * 与势力围城军同一比例，直接复用 factionSiegeArmy（不在这里再写一套）。
 */
export function factionLairGarrison(power: number): Partial<Record<TroopKind, number>> {
  return factionSiegeArmy(Math.max(0, Math.floor(power)));
}

/** 一营满编守军的参考战力（按编成算回来，用于残血比例的换算） */
export function factionLairGarrisonPower(garrison: Partial<Record<TroopKind, number>>): number {
  return armyPower(garrison);
}

/** 一行老巢战况里「当前营」的战力：先按剩余营数得到营序号，再取该营的 Gk（AISLG-247） */
export function factionLairCurrentCampPower(row: {
  camps_total: number;
  camps_remaining: number;
  camp_power_g1: number;
  camp_power_g20: number;
}): number {
  const campNo = factionLairCampNo(row.camps_total || FACTION_LAIR_CAMPS, row.camps_remaining);
  return factionLairCampPowerAt(row.camp_power_g1, row.camp_power_g20, campNo);
}

/**
 * 侦察老巢时看到的当前营守军（v101）：残血按未回满的实况给，满营就是当前营的满编（按营序号取 Gk）。
 * 已经灭亡的废墟直接给空编队（调用方本就不会放侦察进去）。
 */
export function factionLairScoutGarrison(
  lair: {
    camps_total: number;
    camps_remaining: number;
    remaining: Partial<Record<TroopKind, number>> | null;
    camp_power_g1: number;
    camp_power_g20: number;
    destroyed_at: Date | null;
  } | null,
): Partial<Record<TroopKind, number>> {
  if (!lair || lair.destroyed_at) {
    return {};
  }
  return lair.remaining ?? factionLairGarrison(factionLairCurrentCampPower(lair));
}

/** 当前营剩余百分比（整数 0..100；满编 = 100，空营 = 0） */
export function factionLairRemainingPercent(
  remaining: Partial<Record<TroopKind, number>> | null,
  campPower: number,
): number {
  if (!remaining) {
    return 100;
  }
  const full = armyPower(factionLairGarrison(campPower));
  if (full <= 0) {
    return 100;
  }
  const left = armyPower(remaining);
  return Math.max(0, Math.min(100, Math.round((left / full) * 100)));
}

/**
 * 每天刷新每营战力后，当前营保留残血比例：旧残血按「旧满编战力」的比例缩放到新满编。
 * 满营（remaining 为 null）仍是满营；只剩少量残兵时至少保留 1 人（否则比例会四舍五入成空营）。
 */
export function rescaledLairRemaining(
  remaining: Partial<Record<TroopKind, number>> | null,
  oldPower: number,
  newPower: number,
): Partial<Record<TroopKind, number>> | null {
  if (!remaining) {
    return null;
  }
  const oldFull = armyPower(factionLairGarrison(oldPower));
  const newFull = factionLairGarrison(newPower);
  const ratio = oldFull > 0 ? armyPower(remaining) / oldFull : 1;
  if (ratio <= 0) {
    return null;
  }
  const scaled: Partial<Record<TroopKind, number>> = {};
  for (const kind of TROOP_KINDS) {
    const count = Math.floor((newFull[kind] ?? 0) * ratio);
    if (count > 0) {
      scaled[kind] = count;
    }
  }
  if (armyPower(scaled) <= 0) {
    // 残血比例极小：至少留 1 名义兵，避免“刷新一次就白送一营”
    scaled.militia = 1;
  }
  return scaled;
}

/**
 * 连续 24 小时（随缩放）没人进攻时恢复了几个营：按「距最后一次战斗的时长 ÷ 恢复间隔」向下取整，
 * 最多恢复到满营。从没被打过（lastBattleAt 为 null）的老巢不恢复。
 */
export function factionLairRecoveredCamps(args: {
  campsRemaining: number;
  campsTotal: number;
  lastBattleAt: Date | null;
  now: Date;
  recoverMs?: number;
}): number {
  if (!args.lastBattleAt) {
    return 0;
  }
  const missing = Math.max(0, args.campsTotal - args.campsRemaining);
  if (missing <= 0) {
    return 0;
  }
  const recoverMs = Math.max(1, Math.floor(args.recoverMs ?? factionLairRecoverMs()));
  const idle = args.now.getTime() - args.lastBattleAt.getTime();
  if (idle < recoverMs) {
    return 0;
  }
  return Math.min(missing, Math.floor(idle / recoverMs));
}

/** 当前营是本轮的第几营（1 起算；20 营全在时打第 1 营，只剩 1 营时打第 20 营） */
export function factionLairCampNo(campsTotal: number, campsRemaining: number): number {
  return Math.max(1, Math.min(campsTotal, campsTotal - campsRemaining + 1));
}

/** 歼灭奖励：每歼灭 1 点守军战力，金币 2、木 / 粮 / 石 / 铁各 10（不占部队负重，直接入账到出征城） */
export function factionLairKillReward(killedPower: number): Resources {
  const power = Math.max(0, Math.floor(killedPower));
  const each = power * FACTION_LAIR_KILL_RESOURCE_PER_POWER;
  const reward: Resources = { gold: power * FACTION_LAIR_KILL_GOLD_PER_POWER, wood: each, food: each, stone: each, iron: each };
  for (const key of RESOURCE_KEYS) {
    reward[key] = Math.max(0, Math.floor(reward[key]));
  }
  return reward;
}

/** 老巢战斗的声望：歼灭战力的 1%（向下取整，至少 0） */
export function factionLairPrestige(killedPower: number): number {
  return Math.max(0, Math.floor((Math.max(0, Math.floor(killedPower)) * FACTION_LAIR_PRESTIGE_PERCENT) / 100));
}

/** 灭亡榜单的一档奖励（参战者按歼灭战力排名，灭亡时再发一次；数额 = 黄巾之乱同名次的 3 倍） */
export interface FactionLairRewardTier {
  /** 名次上限（含）；最后一档为参与奖 */
  maxRank: number;
  label: string;
  reward: Resources;
}

export const FACTION_LAIR_DESTROY_TIERS: FactionLairRewardTier[] = [
  { maxRank: 1, label: '第 1 名', reward: { gold: 18000, wood: 90000, food: 90000, stone: 90000, iron: 90000 } },
  { maxRank: 3, label: '第 2–3 名', reward: { gold: 12000, wood: 60000, food: 60000, stone: 60000, iron: 60000 } },
  { maxRank: 10, label: '第 4–10 名', reward: { gold: 7500, wood: 36000, food: 36000, stone: 36000, iron: 36000 } },
  { maxRank: 9999, label: '其余参与者', reward: { gold: 2400, wood: 9000, food: 9000, stone: 9000, iron: 9000 } },
];

/** 名次对应的灭亡奖励档（rank 从 1 起） */
export function factionLairDestroyReward(rank: number): FactionLairRewardTier {
  return (
    FACTION_LAIR_DESTROY_TIERS.find((tier) => rank <= tier.maxRank) ??
    FACTION_LAIR_DESTROY_TIERS[FACTION_LAIR_DESTROY_TIERS.length - 1]
  );
}

/** 战报 / 事件文案里的进攻方名（谁在守）：由调用方拼势力名，这里只给营号文案 */
export function factionLairCampLabel(factionName: string, campNo: number): string {
  return `${factionName}老巢 · 第 ${campNo} 营`;
}
