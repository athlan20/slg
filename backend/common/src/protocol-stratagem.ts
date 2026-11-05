// 计谋协议的类型（AISLG-211，v86）：GET_STRATAGEMS（op 145）/ CAST_STRATAGEM（op 146）
// 与推送 PUSH_STRATAGEM（op 2028）。规则与数值见 common/src/stratagem.ts，
// 施计事务在 api/src/handlers-stratagem.ts，存储见 common/src/stratagem-db.ts。
// 本文件只依赖 protocol / stratagem 的类型与常量（类型导入运行时擦除），不构成加载环。

import type { StratagemCategory, StratagemKind, StratagemTargetType, StratagemTokenKind } from './stratagem';

/** GET_STRATAGEMS（op 145）请求：不带 target = 全量定义与持有；带 target = 附对该目标的判定 */
export interface GetStratagemsRequestData {
  target?: {
    stratagem: StratagemKind;
    heroId: string;
    /** 目标城（自己的城 / 敌方玩家的城 / 敌方玩家任一城） */
    cityId?: string;
    /** 目标行军（金蝉脱壳 = 自己的返程；八门金锁 = 敌方开往自己城池 / 野地的部队） */
    marchId?: string;
    /** 目标 NPC 袭击（八门金锁对 NPC 袭击） */
    attackId?: string;
  };
}

/** 计谋定义（8 个；GET_STRATAGEMS 下发，前端据此渲染） */
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
  /** 成功后的免疫时长（秒，已按全局缩放折算）；无免疫为 null */
  immunitySeconds: number | null;
}

/** 每名武将的预计效果数值（按其智力算好）与冷却状态 */
export interface StratagemHeroView {
  heroId: string;
  name: string;
  famous: boolean;
  wit: number;
  /** 是否可施计（不在家 / 冷却中为 false，见 unavailableReason） */
  available: boolean;
  /** 不可施计原因：training 历练中 / wounded 重伤中 / busy 随队出征中 / cooldown 冷却中 */
  /** v93（AISLG-228）：captive = 被俘囚禁中 */
  unavailableReason: 'training' | 'wounded' | 'busy' | 'captive' | 'cooldown' | null;
  cooldownUntil: string | null;
  /** 按计谋给的效果预览（数值均按该武将智力算好；时长为已折算的毫秒数） */
  effects: Record<StratagemKind, StratagemEffectPreview>;
}

export interface StratagemEffectPreview {
  /** 草木皆兵：倍数范围；空城计：10/20/30 */
  multiplierPercent?: number[];
  /** 焚烧粮草：烧掉比例（百分数） */
  burnFoodPercent?: number;
  /** 趁火打劫：保护降低比例（百分数） */
  protectionDownPercent?: number;
  /** 十面埋伏：锁城分钟数 */
  ambushMinutes?: number;
  /** 金蝉脱壳：返程缩短比例（百分数） */
  returnFasterPercent?: number;
  /** 八门金锁：行军延长比例（百分数） */
  marchSlowerPercent?: number;
  /** 欺敌 / 趁火打劫的持续毫秒数 */
  durationMs?: number;
}

/** 对某目标的判定（GET_STRATAGEMS 带 target 时附在响应里） */
export interface StratagemTargetView {
  stratagem: StratagemKind;
  heroId: string;
  valid: boolean;
  /** valid=false 的原因（INVALID_TARGET / HERO_* 等服务端会拒的理由） */
  invalidReason?: string;
  /** 成功率（百分数 20..90；不会失败的计谋恒 100） */
  successPercent: number;
  /** 目标对该计的免疫截止（ISO 8601）；不在免疫期为 null */
  immuneUntil: string | null;
  /** 目标城城守智力（成功率已按它算好） */
  guardWit: number;
  /** 受 PvP 保护（TARGET_PROTECTED / TRUCE_ACTIVE / ALLY_TARGET；进攻类计谋才会被拒） */
  protectedReason: 'TARGET_PROTECTED' | 'TRUCE_ACTIVE' | 'ALLY_TARGET' | null;
}

/** GET_STRATAGEMS（op 145）响应 */
export interface GetStratagemsResponseData {
  stratagems: StratagemDefView[];
  /** 4 类计谋令的持有数 */
  tokens: Record<StratagemTokenKind, number>;
  /** 4 类计谋令的持有上限（战场商店兑换的上限） */
  tokenLimits: Record<StratagemTokenKind, number>;
  /** 账号全部武将（含不可用者，附原因与冷却） */
  heroes: StratagemHeroView[];
  target: StratagemTargetView | null;
}

/** CAST_STRATAGEM（op 146）请求 */
export interface CastStratagemRequestData {
  heroId: string;
  stratagem: StratagemKind;
  /** 三选一：目标城（cityId）/ 目标行军（marchId）/ 目标 NPC 袭击（attackId） */
  target: { cityId?: string; marchId?: string; attackId?: string };
}

/** CAST_STRATAGEM（op 146）响应：成功失败都扣 1 张令与武将冷却 */
export interface CastStratagemResponseData {
  /** 是否生效（免疫期内施计与成功率判定失败都为 false；令与冷却照常消耗） */
  success: boolean;
  /** success=false 的原因：immune 目标免疫中 / roll 成功率判定失败 */
  failedReason: 'immune' | 'roll' | null;
  /** 按计谋给的效果：烧掉的粮食、持续截止、新的到达时刻、情报列表等 */
  effect: Record<string, unknown>;
  tokenKind: StratagemTokenKind;
  /** 扣完还剩几张该类令 */
  tokensLeft: number;
  /** 施计武将的冷却截止（ISO 8601） */
  heroCooldownUntil: string;
}

/** 蛛丝马迹的情报（effect.intel 与 stratagem_cast 事件 detail共用形态） */
export interface SpyTrailIntel {
  /** 目标玩家全部城池的坐标 */
  cities: Array<{ cityId: string; name: string; x: number; y: number }>;
  /** 目标玩家所有在外部队的去向（不含兵力） */
  marches: Array<{ marchId: string; x: number; y: number; purpose: string; arriveAt: string }>;
}

/** PUSH_STRATAGEM（op 2028）推送载荷：被施计的目标玩家收到（欺敌类与金蝉脱壳不推送） */
export interface StratagemPushData {
  stratagem: StratagemKind;
  stratagemName: string;
  /** 谁的哪名武将施的计 */
  caster: { username: string; heroName: string };
  /** 对哪个目标（自己的城 / 自己的部队） */
  target: { kind: 'city' | 'march'; cityId?: string; marchId?: string; x?: number; y?: number };
  success: boolean;
  /** 目标方可见的效果摘要（不泄露施计方视角的额外情报） */
  effect: Record<string, unknown>;
}

/** GET_STATE 的 city.stratagems：本城生效中的计谋效果（欺敌倍数只对城主自己可见） */
export interface CityStratagemView {
  /** 生效中的欺敌（新施的覆盖旧的；过期为 null） */
  deception: { kind: 'phantom_army' | 'empty_fort'; name: string; multiplierPercent: number; until: string } | null;
  /** 十面埋伏锁城截止（期内 MARCH / 协防 / 商队出发 / 入战场一律被拒） */
  ambushedUntil: string | null;
  /** 趁火打劫（本城仓库防掠保护降低）截止与比例 */
  lootFireUntil: string | null;
  lootFirePercent: number;
}
