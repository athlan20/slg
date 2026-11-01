// 计谋（AISLG-211，v86）：8 个计谋的纯规则——定义、成功率、效果数值、免疫时长、
// 欺敌换算顺序与识破概率。API（施计事务、战场商店发令）与 Worker（侦察情报掺假、
// 掠夺仓库保护削弱）共用本文件，两侧不得各自再实现一套数值。
// 存取（令 / 城效果 / 免疫行 / 武将冷却）见 stratagem-db.ts；协议类型见 protocol-stratagem.ts。
// 时间一律按全局缩放折算（scaledMs）；随机源可注入（成功率判定、欺敌倍数、识破），
// 单测用固定种子的确定性随机源。

import { scaledMs } from './time-scale';
import type { ArmyCounts, TroopKind } from './protocol-army';
import { TROOP_KINDS } from './protocol-army';

// ---- 计谋令（战场商店军功兑换，见 battlefield.ts 的货架与 battlefield-shop 处理器）----

export const STRATAGEM_TOKEN_KINDS = ['deception', 'march', 'assault', 'intel'] as const;
export type StratagemTokenKind = (typeof STRATAGEM_TOKEN_KINDS)[number];

export function isStratagemTokenKind(value: unknown): value is StratagemTokenKind {
  return typeof value === 'string' && (STRATAGEM_TOKEN_KINDS as readonly string[]).includes(value);
}

/** 计谋令的兑换与持有数值（spec 定稿）：军功价 / 每场限购 / 持有上限 */
export interface StratagemTokenInfo {
  kind: StratagemTokenKind;
  label: string;
  labelEn: string;
  /** 军功价 */
  cost: number;
  /** 每场限购 */
  perEventLimit: number;
  /** 持有上限 */
  holdLimit: number;
}

export const STRATAGEM_TOKENS: readonly StratagemTokenInfo[] = [
  { kind: 'deception', label: '欺敌令', labelEn: 'Deception Order', cost: 100, perEventLimit: 4, holdLimit: 6 },
  { kind: 'march', label: '行军令', labelEn: 'March Order', cost: 150, perEventLimit: 3, holdLimit: 5 },
  { kind: 'assault', label: '攻心令', labelEn: 'Assault Order', cost: 250, perEventLimit: 2, holdLimit: 3 },
  { kind: 'intel', label: '情报令', labelEn: 'Intel Order', cost: 150, perEventLimit: 2, holdLimit: 3 },
] as const;

export function stratagemTokenInfo(kind: StratagemTokenKind): StratagemTokenInfo {
  const info = STRATAGEM_TOKENS.find((token) => token.kind === kind);
  if (!info) {
    throw new Error(`unknown stratagem token kind: ${kind}`);
  }
  return info;
}

// ---- 8 个计谋 ----

export const STRATAGEM_KINDS = [
  'phantom_army',
  'empty_fort',
  'burn_granary',
  'loot_fire',
  'ambush_all_sides',
  'golden_cicada',
  'eight_gates',
  'spy_trail',
] as const;
export type StratagemKind = (typeof STRATAGEM_KINDS)[number];

export function isStratagemKind(value: unknown): value is StratagemKind {
  return typeof value === 'string' && (STRATAGEM_KINDS as readonly string[]).includes(value);
}

export type StratagemCategory = 'deception' | 'assault' | 'march' | 'intel';
/** 目标形态：自己的城 / 敌方玩家的城 / 自己的返程部队 / 开往自己城池或野地的敌方部队（玩家行军或 NPC 袭击） */
export type StratagemTargetType = 'own_city' | 'enemy_city' | 'own_return_march' | 'enemy_march' | 'enemy_player';

export interface StratagemDef {
  kind: StratagemKind;
  name: string;
  nameEn: string;
  category: StratagemCategory;
  tokenKind: StratagemTokenKind;
  targetType: StratagemTargetType;
  /** 会失败（走成功率判定；否=必成功） */
  canFail: boolean;
  /** 目标玩家是否收到警报（欺敌类与金蝉脱壳不通知任何人） */
  notifiesTarget: boolean;
  /** 进攻类（攻心 / 情报）：受 PvP 保护规则约束（新手保护 / 免战 / 同盟友盟） */
  offensive: boolean;
  /** 成功后对同一目标的免疫时长基准（毫秒，随缩放折算）；null = 无免疫 */
  immunityBaseMs: number | null;
}

export const STRATAGEM_DEFS: readonly StratagemDef[] = [
  { kind: 'phantom_army', name: '草木皆兵', nameEn: 'Phantom Army', category: 'deception', tokenKind: 'deception', targetType: 'own_city', canFail: false, notifiesTarget: false, offensive: false, immunityBaseMs: null },
  { kind: 'empty_fort', name: '空城计', nameEn: 'Empty Fort', category: 'deception', tokenKind: 'deception', targetType: 'own_city', canFail: false, notifiesTarget: false, offensive: false, immunityBaseMs: null },
  { kind: 'burn_granary', name: '焚烧粮草', nameEn: 'Burn the Granary', category: 'assault', tokenKind: 'assault', targetType: 'enemy_city', canFail: true, notifiesTarget: true, offensive: true, immunityBaseMs: 6 * 60 * 60 * 1000 },
  { kind: 'loot_fire', name: '趁火打劫', nameEn: 'Loot the Fire', category: 'assault', tokenKind: 'assault', targetType: 'enemy_city', canFail: true, notifiesTarget: true, offensive: true, immunityBaseMs: 24 * 60 * 60 * 1000 },
  { kind: 'ambush_all_sides', name: '十面埋伏', nameEn: 'Ambush on All Sides', category: 'assault', tokenKind: 'assault', targetType: 'enemy_city', canFail: true, notifiesTarget: true, offensive: true, immunityBaseMs: 24 * 60 * 60 * 1000 },
  { kind: 'golden_cicada', name: '金蝉脱壳', nameEn: 'Golden Cicada', category: 'march', tokenKind: 'march', targetType: 'own_return_march', canFail: false, notifiesTarget: false, offensive: false, immunityBaseMs: null },
  { kind: 'eight_gates', name: '八门金锁', nameEn: 'Eight Gates Lock', category: 'march', tokenKind: 'march', targetType: 'enemy_march', canFail: true, notifiesTarget: true, offensive: false, immunityBaseMs: 6 * 60 * 60 * 1000 },
  { kind: 'spy_trail', name: '蛛丝马迹', nameEn: 'Spy Trail', category: 'intel', tokenKind: 'intel', targetType: 'enemy_player', canFail: true, notifiesTarget: true, offensive: true, immunityBaseMs: 24 * 60 * 60 * 1000 },
] as const;

export function stratagemDef(kind: StratagemKind): StratagemDef {
  const def = STRATAGEM_DEFS.find((item) => item.kind === kind);
  if (!def) {
    throw new Error(`unknown stratagem kind: ${kind}`);
  }
  return def;
}

/** 施计武将冷却基准：1 小时（随缩放折算） */
export const STRATAGEM_HERO_COOLDOWN_MS = 60 * 60 * 1000;

/** 免疫时长（随缩放折算；无免疫的计谋返回 null） */
export function stratagemImmunityMs(kind: StratagemKind): number | null {
  const base = stratagemDef(kind).immunityBaseMs;
  return base === null ? null : scaledMs(base);
}

// ---- 成功率与效果数值（全部纯函数）----

export const SUCCESS_BASE_PERCENT = 50;
export const SUCCESS_PER_WIT_PERCENT = 1;
export const SUCCESS_MIN_PERCENT = 20;
export const SUCCESS_MAX_PERCENT = 90;

/** 成功率 = 50% + (施计武将智力 − 目标城城守智力) × 1%，钳 20..90；无城守按智力 0 */
export function stratagemSuccessPercent(casterWit: number, guardWit: number): number {
  const raw = SUCCESS_BASE_PERCENT + (Math.floor(casterWit) - Math.floor(guardWit)) * SUCCESS_PER_WIT_PERCENT;
  return Math.max(SUCCESS_MIN_PERCENT, Math.min(SUCCESS_MAX_PERCENT, raw));
}

/** 焚烧粮草：烧掉比例 = 智力 × 0.1%，最多 8%（百分数） */
export const BURN_FOOD_PERCENT_PER_WIT = 0.1;
export const BURN_FOOD_PERCENT_MAX = 8;
export function burnFoodPercent(wit: number): number {
  return Math.min(BURN_FOOD_PERCENT_MAX, Math.floor(wit) * BURN_FOOD_PERCENT_PER_WIT);
}
/** 烧掉的粮食 = floor(现存 × 比例) */
export function burnFoodAmount(food: number, wit: number): number {
  return Math.max(0, Math.floor(Math.max(0, food) * (burnFoodPercent(wit) / 100)));
}

/** 趁火打劫：仓库防掠保护降低 智力 × 0.5%，最多 30%（百分数），持续 1 小时（随缩放） */
export const LOOT_FIRE_PERCENT_PER_WIT = 0.5;
export const LOOT_FIRE_PERCENT_MAX = 30;
export const LOOT_FIRE_DURATION_MS = 60 * 60 * 1000;
export function lootFirePercent(wit: number): number {
  return Math.min(LOOT_FIRE_PERCENT_MAX, Math.floor(wit) * LOOT_FIRE_PERCENT_PER_WIT);
}
export function lootFireDurationMs(): number {
  return scaledMs(LOOT_FIRE_DURATION_MS);
}

/** 十面埋伏：锁城时长 = 智力 × 1 分钟，最多 60 分钟（随缩放） */
export const AMBUSH_MINUTES_PER_WIT = 1;
export const AMBUSH_MINUTES_MAX = 60;
export function ambushMinutes(wit: number): number {
  return Math.min(AMBUSH_MINUTES_MAX, Math.floor(wit) * AMBUSH_MINUTES_PER_WIT);
}
export function ambushDurationMs(wit: number): number {
  return scaledMs(ambushMinutes(wit) * 60 * 1000);
}

/** 金蝉脱壳：返程剩余时间减少 智力 × 1%，最多 50% */
export const CICADA_PERCENT_PER_WIT = 1;
export const CICADA_PERCENT_MAX = 50;
export function cicadaReducePercent(wit: number): number {
  return Math.min(CICADA_PERCENT_MAX, Math.floor(wit) * CICADA_PERCENT_PER_WIT);
}
/** 新的到达时刻（毫秒时间戳）：now + 剩余 × (1 − 比例) */
export function cicadaArriveAt(nowMs: number, arriveAtMs: number, wit: number): number {
  const left = Math.max(0, arriveAtMs - nowMs);
  return nowMs + Math.floor(left * (1 - cicadaReducePercent(wit) / 100));
}

/** 八门金锁：行军剩余时间增加 智力 × 0.5%，最多 30% */
export const EIGHT_GATES_PERCENT_PER_WIT = 0.5;
export const EIGHT_GATES_PERCENT_MAX = 30;
export function eightGatesExtendPercent(wit: number): number {
  return Math.min(EIGHT_GATES_PERCENT_MAX, Math.floor(wit) * EIGHT_GATES_PERCENT_PER_WIT);
}
/** 新的到达时刻（毫秒时间戳）：now + 剩余 × (1 + 比例) */
export function eightGatesArriveAt(nowMs: number, arriveAtMs: number, wit: number): number {
  const left = Math.max(0, arriveAtMs - nowMs);
  return nowMs + Math.floor(left * (1 + eightGatesExtendPercent(wit) / 100));
}

// ---- 欺敌（草木皆兵 / 空城计）----

/** 欺敌持续时长 = 智力 × 10 分钟（随缩放；同老游戏） */
export const DECEPTION_MINUTES_PER_WIT = 10;
export function deceptionDurationMs(wit: number): number {
  return scaledMs(Math.floor(wit) * DECEPTION_MINUTES_PER_WIT * 60 * 1000);
}

export type RandomSource = () => number;

/** 草木皆兵：随机定一个 300..500 的整数百分比（3~5 倍），持续期内不变 */
export const PHANTOM_MULTIPLIER_MIN = 300;
export const PHANTOM_MULTIPLIER_MAX = 500;
export function phantomMultiplierPercent(rng: RandomSource): number {
  return PHANTOM_MULTIPLIER_MIN + Math.floor(rng() * (PHANTOM_MULTIPLIER_MAX - PHANTOM_MULTIPLIER_MIN + 1));
}

/** 空城计：随机定 10 / 20 / 30 之一的整十百分比 */
export const EMPTY_FORT_MULTIPLIERS = [10, 20, 30] as const;
export function emptyFortMultiplierPercent(rng: RandomSource): number {
  return EMPTY_FORT_MULTIPLIERS[Math.min(EMPTY_FORT_MULTIPLIERS.length - 1, Math.floor(rng() * EMPTY_FORT_MULTIPLIERS.length))];
}

/** 识破概率 = 侦察科技等级 × 5%（百分数） */
export const DECEPTION_SPOT_PERCENT_PER_TECH = 5;
export function deceptionSpotPercent(scoutTechLevel: number): number {
  return Math.max(0, Math.floor(scoutTechLevel)) * DECEPTION_SPOT_PERCENT_PER_TECH;
}
/** 侦察方是否识破（true = 识破，情报给真实数据并标注） */
export function deceptionSpotted(scoutTechLevel: number, rng: RandomSource): boolean {
  return rng() * 100 < deceptionSpotPercent(scoutTechLevel);
}

/**
 * 欺敌换算（顺序敏感：先按倍数换算真实驻军，再交给侦察科技降级）：
 * 各兵种 floor(真实 × 倍数%)；识破时原样返回真实驻军。
 */
export function applyDeceptionToGarrison(
  garrison: Partial<Record<TroopKind, number>>,
  multiplierPercent: number,
  spotted: boolean,
): ArmyCounts {
  const result = {} as ArmyCounts;
  const factor = spotted ? 1 : Math.max(0, multiplierPercent) / 100;
  for (const kind of TROOP_KINDS) {
    const count = Math.max(0, Math.floor(garrison[kind] ?? 0));
    result[kind] = spotted ? count : Math.floor(count * factor);
  }
  return result;
}
