// 武将培养的纯规则（v54，AISLG-144）：加点 / 洗点、历练、赏赐。数据库存取在 hero-growth-db.ts，
// API 校验与 Worker 历练结算共用本文件，数值全部为占位，上线后按数据调整。

import { arenaDayIndex } from './arena';
import type { HeroAttrs } from './hero';

/** 加点的三项属性键（与 HeroAttrs 一致） */
export const POINT_KEYS = ['lead', 'force', 'wit'] as const;
export type PointKey = (typeof POINT_KEYS)[number];
export type PointsRequest = Partial<Record<PointKey, number>>;

/** 游戏日序号（与竞技日同口径：东八区自然日，时间缩放时按缩放后的日长切分）；每日次数按它重置 */
export function heroDayIndex(at: Date | number): number {
  return arenaDayIndex(at);
}

/**
 * 加点请求校验：三项必须是非负整数、合计至少 1、合计不超过自由点数。
 * 通过返回合计点数，否则返回 null（由调用方报 INVALID_PARAMS / HERO_POINTS_INSUFFICIENT）。
 */
export function validatePointsRequest(points: PointsRequest, freePoints: number): { total: number } | 'invalid' | 'insufficient' {
  let total = 0;
  for (const key of POINT_KEYS) {
    const value = points[key];
    if (value === undefined) {
      continue;
    }
    if (!Number.isInteger(value) || value < 0) {
      return 'invalid';
    }
    total += value;
  }
  if (total < 1) {
    return 'invalid';
  }
  if (total > freePoints) {
    return 'insufficient';
  }
  return { total };
}

/** 已分配的点数 = 当前属性合计 − 初始属性合计（老武将的初始属性迁移时取当时的属性，见 hero-schema.ts） */
export function allocatedPoints(current: HeroAttrs, base: HeroAttrs): number {
  return POINT_KEYS.reduce((sum, key) => sum + (current[key] - base[key]), 0);
}

/** 洗点费 = 武将等级 × 1000 金币（占位） */
export const RESET_GOLD_PER_LEVEL = 1000;
/** 每个武将每个游戏日最多洗点次数 */
export const RESET_DAILY_LIMIT = 1;

export function resetCost(level: number): number {
  return RESET_GOLD_PER_LEVEL * Math.max(1, Math.floor(level));
}

/** 赏赐：每次 1000 金币 → 100 经验（主城扣），每个武将每个游戏日最多 3 次 */
export const GIFT_GOLD = 1000;
export const GIFT_EXP = 100;
export const GIFT_DAILY_LIMIT = 3;

/**
 * 历练档位：时长（基准小时，随时间缩放）与基础经验（经验 = 基础 × 武将等级 ÷ 10）。
 * 历练期间武将不能带兵 / 城守 / 解雇 / 加点 / 洗点，赏赐不受限。
 */
export const TRAINING_TIERS: Record<1 | 2 | 3, { hours: number; baseExp: number }> = {
  1: { hours: 1, baseExp: 200 },
  2: { hours: 4, baseExp: 1000 },
  3: { hours: 12, baseExp: 4000 },
};

export type TrainingTier = keyof typeof TRAINING_TIERS;

export function isTrainingTier(value: unknown): value is TrainingTier {
  return value === 1 || value === 2 || value === 3;
}

/** 历练结束时获得的经验（按开始历练时的武将等级结算，向下取整） */
export function trainingExp(tier: TrainingTier, level: number): number {
  return Math.floor((TRAINING_TIERS[tier].baseExp * Math.max(1, Math.floor(level))) / 10);
}
