// 声望与爵位（v76，AISLG-197）：世界地图战斗按歼灭敌军参考战力累计声望，达到门槛自动升爵；
// 爵位给每日俸禄、普通武将上限、名城占领门槛与展示身份。城池称号按官府等级给出。
// 规则与数值为占位（需求按 NPC 守军规模推算），上线一周后按爵位分布调整。

import { getTimeScale } from './time-scale';

export interface NobilityTier {
  /** 序号：0 = 平民 */
  index: number;
  name: string;
  /** 达到该爵位所需累计声望 */
  threshold: number;
  /** 特权说明（展示用；数值效果由函数实现） */
  privilege: string;
}

/** 10 级爵位（需求表格）：序号即俸禄倍数 */
export const NOBILITY_TIERS: readonly NobilityTier[] = [
  { index: 0, name: '平民', threshold: 0, privilege: '—' },
  { index: 1, name: '公士', threshold: 100, privilege: '每日俸禄' },
  { index: 2, name: '簪袅', threshold: 500, privilege: '每日俸禄' },
  { index: 3, name: '大夫', threshold: 2_000, privilege: '可占领名城；每日俸禄' },
  { index: 4, name: '公乘', threshold: 6_000, privilege: '每日俸禄' },
  { index: 5, name: '五大夫', threshold: 15_000, privilege: '普通武将上限 +1' },
  { index: 6, name: '庶长', threshold: 35_000, privilege: '每日俸禄' },
  { index: 7, name: '关内侯', threshold: 80_000, privilege: '每日俸禄' },
  { index: 8, name: '列侯', threshold: 160_000, privilege: '普通武将上限再 +1' },
  { index: 9, name: '王', threshold: 300_000, privilege: '全服播报、名人堂留名' },
] as const;

/** 占领名城所需爵位（大夫） */
export const FAMOUS_CITY_NOBILITY_INDEX = 3;
/** 普通武将上限增加的两个爵位（五大夫 / 列侯） */
export const HERO_CAP_NOBILITY_INDEXES: readonly number[] = [5, 8];

export function nobilityIndexOf(prestige: number): number {
  const value = Math.max(0, Math.floor(prestige));
  let index = 0;
  for (const tier of NOBILITY_TIERS) {
    if (value >= tier.threshold) {
      index = tier.index;
    }
  }
  return index;
}

export function nobilityTier(index: number): NobilityTier {
  const safe = Math.max(0, Math.min(NOBILITY_TIERS.length - 1, Math.floor(index)));
  return NOBILITY_TIERS[safe];
}

export function nobilityName(index: number): string {
  return nobilityTier(index).name;
}

/** 下一级爵位；已到「王」为 null */
export function nextNobilityTier(index: number): NobilityTier | null {
  const next = Math.floor(index) + 1;
  return NOBILITY_TIERS[next] ?? null;
}

/** 每日俸禄金币 = 爵位序号 × 200 × 全局时间缩放（平民为 0） */
export function nobilitySalaryGold(index: number): number {
  const safe = Math.max(0, Math.floor(index));
  return safe * 200 * getTimeScale();
}

/** 普通武将上限加成：五大夫 +1、列侯再 +1 */
export function nobilityHeroCapBonus(index: number): number {
  const safe = Math.max(0, Math.floor(index));
  return HERO_CAP_NOBILITY_INDEXES.filter((need) => safe >= need).length;
}

/** 城市称号：1–4 城池、5–9 县城、10–14 郡城、15–19 州城、20+ 都城；分城最高显示州城 */
export function cityTitle(governmentLevel: number, isMain: boolean): string {
  const level = Math.max(0, Math.floor(governmentLevel));
  if (level >= 20 && isMain) {
    return '都城';
  }
  if (level >= 15) {
    return '州城';
  }
  if (level >= 10) {
    return '郡城';
  }
  if (level >= 5) {
    return '县城';
  }
  return '城池';
}