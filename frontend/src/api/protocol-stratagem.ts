// 计谋的协议载荷与规则镜像（v86，AISLG-211）：唯一事实来源是
// backend/common/src/stratagem.ts / protocol-stratagem.ts，数值改动以后端为准。
// 界面用这里的常量算「按钮为什么置灰」「确认框里的效果数值」，权威判定仍在服务端。

/** 4 类计谋令（战场商店军功兑换） */
export const STRATAGEM_TOKEN_KINDS = ['deception', 'march', 'assault', 'intel'] as const;
export type StratagemTokenKind = (typeof STRATAGEM_TOKEN_KINDS)[number];

/** 计谋令的兑换与持有数值：镜像 STRATAGEM_TOKENS */
export const STRATAGEM_TOKENS: ReadonlyArray<{
  kind: StratagemTokenKind;
  name: string;
  nameEn: string;
  cost: number;
  perEventLimit: number;
  holdLimit: number;
}> = [
  { kind: 'deception', name: '欺敌令', nameEn: 'Deception Order', cost: 100, perEventLimit: 4, holdLimit: 6 },
  { kind: 'march', name: '行军令', nameEn: 'March Order', cost: 150, perEventLimit: 3, holdLimit: 5 },
  { kind: 'assault', name: '攻心令', nameEn: 'Assault Order', cost: 250, perEventLimit: 2, holdLimit: 3 },
  { kind: 'intel', name: '情报令', nameEn: 'Intel Order', cost: 150, perEventLimit: 2, holdLimit: 3 },
];

/** 8 个计谋（镜像 STRATAGEM_DEFS；name / nameEn 只作兜底，界面文案在 copy-stratagem*.ts） */
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

export type StratagemCategory = 'deception' | 'assault' | 'march' | 'intel';
export type StratagemTargetType = 'own_city' | 'enemy_city' | 'own_return_march' | 'enemy_march' | 'enemy_player';

/** 施计武将冷却基准（毫秒，随全局时间缩放折算）：镜像 STRATAGEM_HERO_COOLDOWN_MS */
export const STRATAGEM_HERO_COOLDOWN_MS = 60 * 60 * 1000;

/** 成功率公式的常量（镜像 stratagem.ts）：50% + (施计智力 − 城守智力) × 1%，钳 20..90 */
export const STRATAGEM_SUCCESS_BASE = 50;
export const STRATAGEM_SUCCESS_MIN = 20;
export const STRATAGEM_SUCCESS_MAX = 90;

/** 识破概率 = 侦察科技等级 × 5%（百分数） */
export const DECEPTION_SPOT_PERCENT_PER_TECH = 5;

export function stratagemSuccessPercent(casterWit: number, guardWit: number): number {
  const raw = STRATAGEM_SUCCESS_BASE + (Math.floor(casterWit) - Math.floor(guardWit));
  return Math.max(STRATAGEM_SUCCESS_MIN, Math.min(STRATAGEM_SUCCESS_MAX, raw));
}

/** 焚烧粮草：智力 × 0.1%，最多 8% */
export function burnFoodPercent(wit: number): number {
  return Math.min(8, Math.floor(wit) * 0.1);
}

/** 趁火打劫：智力 × 0.5%，最多 30% */
export function lootFirePercent(wit: number): number {
  return Math.min(30, Math.floor(wit) * 0.5);
}

/** 十面埋伏：智力分钟，最多 60 */
export function ambushMinutes(wit: number): number {
  return Math.min(60, Math.floor(wit));
}

/** 金蝉脱壳：智力 × 1%，最多 50% */
export function cicadaReducePercent(wit: number): number {
  return Math.min(50, Math.floor(wit));
}

/** 八门金锁：智力 × 0.5%，最多 30% */
export function eightGatesExtendPercent(wit: number): number {
  return Math.min(30, Math.floor(wit) * 0.5);
}

/** 欺敌持续 = 智力 × 10 分钟（毫秒，未按缩放折算；展示时用 formatDurationText） */
export function deceptionBaseMs(wit: number): number {
  return Math.floor(wit) * 10 * 60 * 1000;
}

/** GET_STATE 的 city.stratagems：本城生效中的计谋效果（欺敌倍数只对城主自己可见） */
export interface CityStratagemView {
  deception: { kind: 'phantom_army' | 'empty_fort'; name: string; multiplierPercent: number; until: string } | null;
  ambushedUntil: string | null;
  lootFireUntil: string | null;
  lootFirePercent: number;
}

export interface StratagemDefView {
  kind: StratagemKind;
  name: string;
  nameEn: string;
  category: StratagemCategory;
  tokenKind: StratagemTokenKind;
  targetType: StratagemTargetType;
  canFail: boolean;
  notifiesTarget: boolean;
  offensive: boolean;
  immunitySeconds: number | null;
}

export interface StratagemEffectPreview {
  multiplierPercent?: number[];
  burnFoodPercent?: number;
  protectionDownPercent?: number;
  ambushMinutes?: number;
  returnFasterPercent?: number;
  marchSlowerPercent?: number;
  durationMs?: number;
}

export interface StratagemHeroView {
  heroId: string;
  name: string;
  famous: boolean;
  wit: number;
  available: boolean;
  unavailableReason: 'training' | 'wounded' | 'busy' | 'cooldown' | null;
  cooldownUntil: string | null;
  effects: Record<StratagemKind, StratagemEffectPreview>;
}

export interface StratagemTargetView {
  stratagem: StratagemKind;
  heroId: string;
  valid: boolean;
  invalidReason?: string;
  successPercent: number;
  immuneUntil: string | null;
  guardWit: number;
  protectedReason: 'TARGET_PROTECTED' | 'TRUCE_ACTIVE' | 'ALLY_TARGET' | null;
}

/** GET_STRATAGEMS（op 145）请求载荷 */
export interface GetStratagemsRequestData {
  target?: { stratagem: StratagemKind; heroId: string; cityId?: string; marchId?: string; attackId?: string };
}

/** GET_STRATAGEMS（op 145）响应载荷 */
export interface GetStratagemsResponseData {
  stratagems: StratagemDefView[];
  tokens: Record<StratagemTokenKind, number>;
  tokenLimits: Record<StratagemTokenKind, number>;
  heroes: StratagemHeroView[];
  target: StratagemTargetView | null;
}

/** CAST_STRATAGEM（op 146）请求载荷 */
export interface CastStratagemRequestData {
  heroId: string;
  stratagem: StratagemKind;
  target: { cityId?: string; marchId?: string; attackId?: string };
}

/** CAST_STRATAGEM（op 146）响应载荷（成功失败都扣 1 张令与武将冷却） */
export interface CastStratagemResponseData {
  success: boolean;
  failedReason: 'immune' | 'roll' | null;
  effect: Record<string, unknown>;
  tokenKind: StratagemTokenKind;
  tokensLeft: number;
  heroCooldownUntil: string;
}

/** 蛛丝马迹的情报（不含兵力） */
export interface SpyTrailIntel {
  cities: Array<{ cityId: string; name: string; x: number; y: number }>;
  marches: Array<{ marchId: string; x: number; y: number; purpose: string; arriveAt: string }>;
}

/** PUSH_STRATAGEM（op 2028）推送载荷：被施计的目标玩家收到 */
export interface StratagemPushData {
  stratagem: StratagemKind;
  stratagemName: string;
  caster: { username: string; heroName: string };
  target: { kind: 'city' | 'march' | 'npc_attack'; cityId?: string; cityName?: string; marchId?: string; attackId?: string; x?: number; y?: number };
  success: boolean;
  effect: Record<string, unknown>;
}

/** 侦察情报里的识破标记（v86）：只有识破时才有，没识破时不带任何标记 */
export interface ScoutDeceptionMark {
  stratagem: StratagemKind;
  name: string;
  seen: true;
}
