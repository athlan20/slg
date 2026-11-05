// 名将忠诚度与被俘的纯规则（v93，AISLG-228）：只有 29 位在野名将有忠诚度（loyalty 非 NULL），
// 其余武将完全不受影响。被俘判定只在玩家打玩家时调用（见 worker/src/pvp-capture.ts），随机数
// 由调用方注入，便于测试。数据库存取在 hero-loyalty-db.ts / hero-capture-db.ts；数值以需求为准。

import { WILD_FAMOUS_NAMES } from './hero-wild';

/** 忠诚度上下限 */
export const LOYALTY_MAX = 100;
export const LOYALTY_MIN = 0;
/** 自然下降：每 24 小时（基准）−10，从招揽时刻起算，每名将各自结算 */
export const LOYALTY_DECAY_PER_PERIOD = 10;
export const LOYALTY_DECAY_PERIOD_HOURS = 24;
/** 赏赐（GIFT_HERO）：每次 +10，上限 100 */
export const LOYALTY_GIFT = 10;
/** 欠饷：欠饷期间每小时（基准）额外 −1 */
export const LOYALTY_ARREARS_PER_HOUR = 1;
/** 忠诚度降到这条线及以下发一次事件提醒，回到线以上后下次再提醒 */
export const LOYALTY_WARN_LINE = 30;
/** 赎回：忠诚度 −20，最低保留 1 */
export const LOYALTY_RANSOM_DROP = 20;
export const LOYALTY_AFTER_RANSOM_FLOOR = 1;
/** 赎金 = 2000 × 名将等级（从主人主城扣） */
export const RANSOM_GOLD_PER_LEVEL = 2000;
/** 赎金分成：胜方主城收 50%（向下取整），另一半销毁 */
export const RANSOM_TAKER_PERCENT = 50;
/** 囚禁时长（基准小时，随时间缩放）；期间不扣俸禄、忠诚度不变 */
export const CAPTIVE_HOURS = 24;
/** 每个账号被俘名将的频率限制（基准天，随时间缩放）：窗口内最多被俘 1 名，不管赎没赎回 */
export const CAPTURE_LIMIT_DAYS = 7;

/** 被俘概率 = 5% + (100 − 忠诚度) × 0.25%（百分数） */
export const CAPTURE_BASE_PERCENT = 5;
export const CAPTURE_PER_MISSING_PERCENT = 0.25;

const WILD_NAME_SET: ReadonlySet<string> = new Set(WILD_FAMOUS_NAMES);

/** 名字属于在野名将名单（29 名）→ 有忠诚度 */
export function hasLoyalty(heroName: string): boolean {
  return WILD_NAME_SET.has(heroName);
}

/** 招揽 / 上线迁移时的初始忠诚度：在野名将 100，其余为 null（无忠诚度） */
export function initialLoyalty(heroName: string): number | null {
  return hasLoyalty(heroName) ? LOYALTY_MAX : null;
}

export function clampLoyalty(value: number): number {
  return Math.min(LOYALTY_MAX, Math.max(LOYALTY_MIN, Math.floor(value)));
}

/** 忠诚度是否处于提醒线及以下 */
export function isLowLoyalty(loyalty: number): boolean {
  return loyalty <= LOYALTY_WARN_LINE;
}

/** 被俘概率（百分数）：忠诚度越低越容易被俘；入参先钳到 0..100 */
export function captureChancePercent(loyalty: number): number {
  const clamped = Math.min(LOYALTY_MAX, Math.max(LOYALTY_MIN, loyalty));
  return CAPTURE_BASE_PERCENT + (LOYALTY_MAX - clamped) * CAPTURE_PER_MISSING_PERCENT;
}

/** 掷骰：rng 返回 [0, 1)，小于概率即被俘（rng 由调用方注入，测试可固定） */
export function rollCapture(loyalty: number, rng: () => number): boolean {
  return rng() < captureChancePercent(loyalty) / 100;
}

/** 赎金（金币）：2000 × 等级，等级向下取整且至少 1 */
export function ransomCost(level: number): number {
  return RANSOM_GOLD_PER_LEVEL * Math.max(1, Math.floor(level));
}

/** 胜方主城分到的赎金（向下取整）；其余销毁 */
export function ransomTakerShare(cost: number): number {
  return Math.floor((cost * RANSOM_TAKER_PERCENT) / 100);
}

/** 赎回后的忠诚度：−20，最低保留 1 */
export function loyaltyAfterRansom(loyalty: number): number {
  return Math.max(LOYALTY_AFTER_RANSOM_FLOOR, clampLoyalty(loyalty - LOYALTY_RANSOM_DROP));
}

/** 赏赐后的忠诚度：+10，上限 100 */
export function loyaltyAfterGift(loyalty: number): number {
  return clampLoyalty(loyalty + LOYALTY_GIFT);
}
