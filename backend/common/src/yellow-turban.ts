// 黄巾之乱（v29，AISLG-76）：纯 PvE、全服共同参与的周期事件，参考旧游戏剧本战场「黄巾之乱」
// （BattleFunc bid 1001）只取玩法结构，数值全部占位、上线后按数据调整。
// 流程：起事（全服播报，地图冒出一批黄巾营地，按活跃玩家数定数量，分小 / 中 / 大三档，守军对应野地
// Lv3 / Lv6 / Lv9）→ 坐大（营地放着不管每隔几小时升一档；大营向附近玩家主城 / 野地发兵，走现有 NPC
// 来袭预警流程）→ 清剿（出征营地同打野地，打赢营地消失、掉落资源与金币）→ 决战（营地清掉 80% 后出现
// 「张角老巢」，高难度、外围 + 城守两段）→ 收场（老巢被打掉或到时限；没清完的营地散成流寇，接 AISLG-78）。
// 贡献 = 每人歼灭的黄巾兵力，结束按名次发资源与金币。API（查询视图）与 Worker（生命周期 / 结算）共用本文件。

import type { Resources, TroopKind } from './protocol';
import { nativeGarrisonBase, armyPower } from './battle';
import { PLUNDER_POOL_GOLD_PER_LEVEL, PLUNDER_POOL_RESOURCE_PER_LEVEL } from './world';
import { getTimeScale, scaledMs } from './time-scale';

/** 营地档位：小 / 中 / 大；boss 为张角老巢（同表存储，tier='boss'） */
export const YT_TIERS = ['small', 'medium', 'large', 'boss'] as const;

export type YtTier = (typeof YT_TIERS)[number];

export function isYtTier(value: unknown): value is YtTier {
  return typeof value === 'string' && (YT_TIERS as readonly string[]).includes(value);
}

/** 普通营地档位（可升档、可散成流寇） */
export const YT_CAMP_TIERS = ['small', 'medium', 'large'] as const;
export type YtCampTier = (typeof YT_CAMP_TIERS)[number];

/** 档位对应的野地等级口径（守军强度）与中文名 */
export const YT_TIER_INFO: Record<YtTier, { label: string; level: number }> = {
  small: { label: '黄巾营地（小）', level: 3 },
  medium: { label: '黄巾营地（中）', level: 6 },
  large: { label: '黄巾营地（大）', level: 9 },
  boss: { label: '张角老巢', level: 10 },
};

/** 起事间隔（基准天，随全局时间缩放）：上一轮开始后隔这么久再起事（上一轮未结束则等其结束） */
export const YT_CYCLE_DAYS = 3;
/** 事件时限（基准小时）：到时没清完则收场 */
export const YT_DURATION_HOURS = 48;
/** 营地坐大间隔（基准小时）：小 → 中 → 大，每过一个间隔升一档 */
export const YT_GROW_HOURS = 6;
/** 大营发兵间隔（基准小时）与影响半径（Chebyshev 格） */
export const YT_RAID_HOURS = 3;
export const YT_RAID_RADIUS = 40;
/** 大营发兵的袭击强度（等价 NPC 袭击等级）：占位，低于档位野地等级以免压垮新号 */
export const YT_RAID_LEVEL = 4;
/** 营地清掉这个比例后出现老巢 */
export const YT_BOSS_UNLOCK_RATIO = 0.8;
/** 老巢外围清空后可攻城守的限时（基准小时），超时外围恢复满编（与名城同口径） */
export const YT_BOSS_KEEPER_WINDOW_HOURS = 6;
/** 老巢外围 / 城守相对「Lv10 野地基准守军」的倍数（高难度，占位） */
export const YT_BOSS_OUTER_MULTIPLIER = 2;
export const YT_BOSS_KEEPER_MULTIPLIER = 4;
/** 营地数量：活跃玩家数 × 比例向上取整，夹在 [MIN, MAX]；三档占比 50% / 30% / 20% */
export const YT_CAMPS_PER_ACTIVE_PLAYER = 2;
export const YT_CAMPS_MIN = 6;
export const YT_CAMPS_MAX = 60;
/** 营地 / 老巢掉落池相对「同等级野地掠夺池」的倍数（五项资源都掉，按幸存部队负重装填） */
export const YT_CAMP_LOOT_MULTIPLIER = 2;
export const YT_BOSS_LOOT_MULTIPLIER = 6;

export function ytCycleMs(): number {
  return scaledMs(YT_CYCLE_DAYS * 24 * 3_600_000);
}
export function ytDurationMs(): number {
  return scaledMs(YT_DURATION_HOURS * 3_600_000);
}
export function ytGrowMs(): number {
  return scaledMs(YT_GROW_HOURS * 3_600_000);
}
export function ytRaidMs(): number {
  return scaledMs(YT_RAID_HOURS * 3_600_000);
}
export function ytKeeperWindowMs(scale: number = getTimeScale()): number {
  return Math.max(1_000, Math.floor((YT_BOSS_KEEPER_WINDOW_HOURS * 3_600_000) / scale));
}

/** 守军编成：营地按档位野地等级的基准编成（无坐标浮动）；老巢外围 / 城守为 Lv10 基准的倍数 */
export function ytGarrison(tier: YtTier, stage: 'outer' | 'keeper' = 'outer'): Partial<Record<TroopKind, number>> {
  const base = nativeGarrisonBase(YT_TIER_INFO[tier].level);
  if (tier !== 'boss') {
    return base;
  }
  const multiplier = stage === 'keeper' ? YT_BOSS_KEEPER_MULTIPLIER : YT_BOSS_OUTER_MULTIPLIER;
  const scaled: Partial<Record<TroopKind, number>> = {};
  for (const [kind, count] of Object.entries(base) as Array<[TroopKind, number]>) {
    scaled[kind] = Math.max(1, Math.round(count * multiplier));
  }
  return scaled;
}

/** 掉落池：同等级野地掠夺池 × 倍数（金 + 四资源）；老巢仅城守阶段击破时掉落 */
export function ytLootPool(tier: YtTier): Resources {
  const level = YT_TIER_INFO[tier].level;
  const multiplier = tier === 'boss' ? YT_BOSS_LOOT_MULTIPLIER : YT_CAMP_LOOT_MULTIPLIER;
  const resource = level * PLUNDER_POOL_RESOURCE_PER_LEVEL * multiplier;
  return { gold: level * PLUNDER_POOL_GOLD_PER_LEVEL * multiplier, wood: resource, food: resource, stone: resource, iron: resource };
}

/** 营地数量：随活跃玩家数调整；无人活跃为 0（不起事） */
export function ytCampCount(activePlayers: number): number {
  if (activePlayers <= 0) {
    return 0;
  }
  return Math.min(YT_CAMPS_MAX, Math.max(YT_CAMPS_MIN, Math.ceil(activePlayers * YT_CAMPS_PER_ACTIVE_PLAYER)));
}

/** 按 50% / 30% / 20% 把总数分到 小 / 中 / 大（余数归「小」，保证总数不变） */
export function ytTierSplit(total: number): Record<YtCampTier, number> {
  const large = Math.floor(total * 0.2);
  const medium = Math.floor(total * 0.3);
  return { small: total - large - medium, medium, large };
}

/** 营地升一档：小 → 中 → 大；大已封顶返回 null */
export function ytNextTier(tier: YtCampTier): YtCampTier | null {
  return tier === 'small' ? 'medium' : tier === 'medium' ? 'large' : null;
}

/** 营地「该清掉多少才出老巢」：向上取整，至少 1 个 */
export function ytBossUnlockCount(totalCamps: number): number {
  return Math.max(1, Math.ceil(totalCamps * YT_BOSS_UNLOCK_RATIO));
}

/** 老巢阶段（惰性推导）：外围清空时刻起限时内为城守阶段，超时回到外围 */
export function ytBossStage(outerClearedAt: Date | null, now: Date, scale: number = getTimeScale()): 'outer' | 'keeper' {
  if (!outerClearedAt) {
    return 'outer';
  }
  return now.getTime() < outerClearedAt.getTime() + ytKeeperWindowMs(scale) ? 'keeper' : 'outer';
}

/** 排名奖励（占位）：按名次发资源与金币；歼敌 > 0 的参与者都有保底 */
export interface YtRewardTier {
  /** 名次上限（含）；最后一档为参与奖 */
  maxRank: number;
  label: string;
  reward: Resources;
}

export const YT_REWARD_TIERS: YtRewardTier[] = [
  { maxRank: 1, label: '第 1 名', reward: { gold: 6000, wood: 30000, food: 30000, stone: 30000, iron: 30000 } },
  { maxRank: 3, label: '第 2–3 名', reward: { gold: 4000, wood: 20000, food: 20000, stone: 20000, iron: 20000 } },
  { maxRank: 10, label: '第 4–10 名', reward: { gold: 2500, wood: 12000, food: 12000, stone: 12000, iron: 12000 } },
  { maxRank: 9999, label: '参与奖', reward: { gold: 800, wood: 3000, food: 3000, stone: 3000, iron: 3000 } },
];

/** 名次对应的奖励档（rank 从 1 起） */
export function ytRewardFor(rank: number): YtRewardTier {
  return YT_REWARD_TIERS.find((tier) => rank <= tier.maxRank) ?? YT_REWARD_TIERS[YT_REWARD_TIERS.length - 1];
}

/** 参考战力（视图 / 文档用） */
export function ytPower(tier: YtTier, stage: 'outer' | 'keeper' = 'outer'): number {
  return armyPower(ytGarrison(tier, stage));
}

/** 散成流寇时的流寇等级（移动目标等级 1..5）：小 2 / 中 3 / 大 5 */
export const YT_SCATTER_LEVEL: Record<YtCampTier, number> = { small: 2, medium: 3, large: 5 };
