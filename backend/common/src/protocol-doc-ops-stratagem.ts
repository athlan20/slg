// 计谋协议的对外文档（GET_STRATAGEMS / CAST_STRATAGEM / PUSH_STRATAGEM，v86，AISLG-211）。
// 数值一律引用 common/src/stratagem.ts 的真实常量，不在这里手抄一份。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { CITY_ID } from './protocol-doc-shared';
import {
  AMBUSH_MINUTES_MAX,
  DECEPTION_SPOT_PERCENT_PER_TECH,
  BURN_FOOD_PERCENT_MAX,
  CICADA_PERCENT_MAX,
  EIGHT_GATES_PERCENT_MAX,
  LOOT_FIRE_PERCENT_MAX,
  STRATAGEM_HERO_COOLDOWN_MS,
  STRATAGEM_TOKENS,
  SUCCESS_BASE_PERCENT,
  SUCCESS_MAX_PERCENT,
  SUCCESS_MIN_PERCENT,
} from './stratagem';

const STRATAGEM_ID = '5c2b1f4e-9d3a-4b8e-9f10-2a3b4c5d6e7f';
const MARCH_ID = '2f1e3d4c-5b6a-4978-8c9d-0a1b2c3d4e5f';

const TOKEN_TABLE = STRATAGEM_TOKENS.map(
  (token) => `${token.label}（${token.kind}）军功价 ${token.cost}、每场限购 ${token.perEventLimit}、持有上限 ${token.holdLimit}`,
).join('；');

export const REQUEST_GET_STRATAGEMS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_STRATAGEMS',
  title: '查询计谋定义、计谋令与逐武将效果预览（v86，AISLG-211）',
  preAuth: false,
  summary: `返回 8 个计谋的定义（类别、目标类型、所需计谋令、是否可失败、免疫时长）、账号 4 类计谋令的持有数与上限，以及每名武将按自身智力算好的效果预览与冷却状态；请求里再带 target 时额外返回对该目标的判定（成功率、是否免疫、是否受新手保护 / 免战 / 同盟限制）。计谋用「计谋令」施放，令**只能用战场军功在战场商店兑换**（BUY_BATTLEFIELD_ITEM 的 stratagem_* 商品：${TOKEN_TABLE}），不退金币、不能转让；令与军功一起换季清零。施计不花金币，每次消耗 1 张对应类别的令，**成功失败都扣**；施计后该武将冷却 ${Math.round(STRATAGEM_HERO_COOLDOWN_MS / 60000)} 分钟（随全局时间缩放）。8 个计谋：草木皆兵 / 空城计（欺敌，别人侦察你的城时看到倍数换算后的假驻军，侦察方侦察科技每级 ${DECEPTION_SPOT_PERCENT_PER_TECH}% 概率识破）、焚烧粮草（烧掉对方一座城现存粮食的 min(智力 × 0.1%, ${BURN_FOOD_PERCENT_MAX}%)）、趁火打劫（该城仓库防掠保护降 min(智力 × 0.5%, ${LOOT_FIRE_PERCENT_MAX}%) 持续 1 小时）、十面埋伏（该城 min(智力, ${AMBUSH_MINUTES_MAX}) 分钟不能派任何部队）、金蝉脱壳（自己返程部队剩余时间缩短 min(智力%, ${CICADA_PERCENT_MAX}%)，每支一次）、八门金锁（开往你城池 / 野地的敌方部队剩余行军时间延长 min(智力 × 0.5%, ${EIGHT_GATES_PERCENT_MAX}%)）、蛛丝马迹（列出目标玩家全部城池坐标与在外部队去向）。会失败的计谋成功率 = ${SUCCESS_BASE_PERCENT}% + (施计武将智力 − 目标城城守智力) × 1%，钳 ${SUCCESS_MIN_PERCENT}%..${SUCCESS_MAX_PERCENT}%（目标无城守按 0）；成功后目标对该种计免疫（6 / 24 小时，随缩放）。`,
  requestFields: [
    {
      name: 'target',
      type: 'object | 省略',
      desc: `可选。带上时附带对该目标的判定：{ stratagem, heroId, cityId?, marchId?, attackId? }。cityId 用于城类计谋（自己的城 / 敌方玩家的城），marchId 用于金蝉脱壳（自己的返程行军）或八门金锁（开往自己城池 / 野地的敌方玩家行军），attackId 用于八门金锁挡 NPC 袭击。省略则只返回定义、令与武将预览。`,
    },
  ],
  dataFields: [
    { name: 'stratagems', type: 'object[]', desc: '8 个计谋的定义：kind（phantom_army / empty_fort / burn_granary / loot_fire / ambush_all_sides / golden_cicada / eight_gates / spy_trail）、name、nameEn、category（deception / assault / march / intel）、tokenKind（deception / march / assault / intel）、targetType、canFail（是否走成功率判定）、notifiesTarget（目标玩家是否收到警报；欺敌与金蝉脱壳为 false）、offensive（进攻类，受 PvP 保护与同盟限制）、immunitySeconds（成功后该目标的免疫时长，无免疫为 null）。' },
    { name: 'tokens', type: 'object', desc: '账号 4 类计谋令的持有数 { deception, march, assault, intel }。' },
    { name: 'tokenLimits', type: 'object', desc: '4 类令的持有上限（战场商店兑换到上限返回 STRATAGEM_TOKEN_FULL）。' },
    { name: 'heroes', type: 'object[]', desc: '账号每名武将：heroId、name、famous、wit、available、unavailableReason（training 历练中 / wounded 重伤中 / busy 随队出征中 / cooldown 冷却中 / null）、cooldownUntil、effects（按该武将智力算好的效果预览：倍数区间、烧粮比例、保护降低比例、锁城分钟数、缩短 / 延长比例、持续毫秒数）。' },
    { name: 'target', type: 'object | null', desc: '带 target 时的判定：stratagem、heroId、valid、invalidReason（INVALID_TARGET 等）、successPercent（不会失败的计谋恒 100）、immuneUntil（目标对该计的免疫截止，不在免疫期为 null）、guardWit（目标城城守智力）、protectedReason（TARGET_PROTECTED / TRUCE_ACTIVE / ALLY_TARGET / null）。不带 target 为 null。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '查询定义、令与武将预览（不带 target）',
      request: { op: Op.GET_STRATAGEMS, seq: 51, data: {} },
      responses: [
        {
          op: Op.GET_STRATAGEMS,
          seq: 51,
          ok: true,
          data: {
            stratagems: [
              { kind: 'phantom_army', name: '草木皆兵', nameEn: 'Phantom Army', category: 'deception', tokenKind: 'deception', targetType: 'own_city', canFail: false, notifiesTarget: false, offensive: false, immunitySeconds: null },
              { kind: 'burn_granary', name: '焚烧粮草', nameEn: 'Burn the Granary', category: 'assault', tokenKind: 'assault', targetType: 'enemy_city', canFail: true, notifiesTarget: true, offensive: true, immunitySeconds: 21600 },
            ],
            tokens: { deception: 2, march: 1, assault: 1, intel: 0 },
            tokenLimits: { deception: 6, march: 5, assault: 3, intel: 3 },
            heroes: [
              {
                heroId: STRATAGEM_ID,
                name: '荀彧',
                famous: true,
                wit: 96,
                available: true,
                unavailableReason: null,
                cooldownUntil: null,
                effects: {
                  phantom_army: { multiplierPercent: [300, 500], durationMs: 57600000 },
                  empty_fort: { multiplierPercent: [10, 20, 30], durationMs: 57600000 },
                  burn_granary: { burnFoodPercent: 8 },
                  loot_fire: { protectionDownPercent: 30, durationMs: 3600000 },
                  ambush_all_sides: { ambushMinutes: 60, durationMs: 3600000 },
                  golden_cicada: { returnFasterPercent: 50 },
                  eight_gates: { marchSlowerPercent: 30 },
                  spy_trail: {},
                },
              },
            ],
            target: null,
          },
        },
      ],
    },
    {
      caption: '带 target：查询对某座敌城的成功率与保护状态',
      request: { op: Op.GET_STRATAGEMS, seq: 52, data: { target: { stratagem: 'burn_granary', heroId: STRATAGEM_ID, cityId: CITY_ID } } },
      responses: [
        {
          op: Op.GET_STRATAGEMS,
          seq: 52,
          ok: true,
          data: {
            stratagems: ['（同上，8 项）'],
            tokens: { deception: 2, march: 1, assault: 1, intel: 0 },
            tokenLimits: { deception: 6, march: 5, assault: 3, intel: 3 },
            heroes: ['（同上）'],
            target: { stratagem: 'burn_granary', heroId: STRATAGEM_ID, valid: true, successPercent: 90, immuneUntil: null, guardWit: 0, protectedReason: null },
          },
        },
      ],
    },
  ],
  agentNote: '先 GET_STRATAGEMS（可带 target）确认令够、武将在家且不在冷却、目标不在免疫期与保护中，再发 CAST_STRATAGEM。成功率按施计武将智力与目标城城守智力算出，已在本协议里给出，不用自己算。令只能用剧本战场军功在战场商店兑换，买满一场共 11 张（1,650 军功），要和资源包取舍。',
};

export const REQUEST_CAST_STRATAGEM: RequestOpDoc = {
  kind: 'request',
  name: 'CAST_STRATAGEM',
  title: '施放计谋（v86，AISLG-211）',
  preAuth: false,
  summary: `派一名**在家的**武将消耗 1 张对应类别的计谋令施计。武将必须在家（不在出征 / 随行、不在历练、不在重伤），施计后冷却 ${Math.round(STRATAGEM_HERO_COOLDOWN_MS / 60000)} 分钟（随缩放），冷却中返回 HERO_STRATAGEM_COOLDOWN（附 retryAfterSeconds）。令不够返回 STRATAGEM_TOKEN_SHORT（附 tokenKind / have），此时不扣任何东西；令一旦够就**扣令 + 冷却**，之后免疫或成功率判定失败也照扣（同老游戏）。会失败的计谋（焚烧粮草 / 趁火打劫 / 十面埋伏 / 八门金锁 / 蛛丝马迹）成功率 = ${SUCCESS_BASE_PERCENT}% + (施计智力 − 目标城城守智力) × 1%，钳 ${SUCCESS_MIN_PERCENT}%..${SUCCESS_MAX_PERCENT}%；不论成败目标玩家都收到警报（PUSH_STRATAGEM + stratagem_received 事件），欺敌类与金蝉脱壳不通知任何人。成功中计后目标对该种计免疫（焚烧粮草 / 八门金锁 6 小时，趁火打劫 / 十面埋伏 / 蛛丝马迹 24 小时；免疫期内再施直接判失败、照常扣令与冷却）。进攻类计谋（焚烧粮草 / 趁火打劫 / 十面埋伏 / 蛛丝马迹）与 PvP 规则一致：目标在新手保护或免战中返回 TARGET_PROTECTED；自己主动免战中返回 TRUCE_ACTIVE；同盟 / 友盟返回 ALLY_TARGET；自己在新手保护中施进攻类计谋会让新手保护立即失效。欺敌、金蝉脱壳、八门金锁是防守类，任何时候都能用。所有持续时长按全局时间缩放换算。`,
  requestFields: [
    { name: 'heroId', type: 'string', desc: '必填。施计武将 id，必须是本账号的武将在且在家（GET_STRATAGEMS 的 heroes[].available）。' },
    {
      name: 'stratagem',
      type: 'string',
      desc: '必填。计谋 kind：phantom_army 草木皆兵 / empty_fort 空城计（自己的城）、burn_granary 焚烧粮草 / loot_fire 趁火打劫 / ambush_all_sides 十面埋伏（敌方玩家的城）、golden_cicada 金蝉脱壳（自己的返程行军）、eight_gates 八门金锁（开往自己城池 / 野地的敌方部队）、spy_trail 蛛丝马迹（敌方玩家，用他的任意一座城指定）。',
    },
    {
      name: 'target',
      type: 'object',
      desc: '必填。{ cityId } | { marchId } | { attackId } 三选一：城类计谋给 cityId；金蝉脱壳给自己返程行军的 marchId；八门金锁给敌方行军的 marchId，或挡 NPC 袭击时给 attackId。不合法的组合返回 INVALID_TARGET（不扣令）。',
    },
  ],
  dataFields: [
    { name: 'success', type: 'boolean', desc: '是否生效。免疫期内施计与成功率判定失败都为 false（令与武将冷却照常消耗）。' },
    { name: 'failedReason', type: "'immune' | 'roll' | null", desc: 'success=false 的原因：immune = 目标还在免疫期；roll = 成功率判定没中。' },
    { name: 'effect', type: 'object', desc: '按计谋给的效果：foodBurned（烧掉的粮食）/ multiplierPercent + until（欺敌倍数与截止）/ protectionDownPercent + until（趁火打劫）/ until（十面埋伏锁城截止）/ arriveAt + reducedPercent（金蝉脱壳后的到达时刻与缩短比例）/ arriveAt + extendedPercent（八门金锁后的到达时刻与延长比例）/ intel（蛛丝马迹：{ cities: [{ cityId, name, x, y }], marches: [{ marchId, x, y, purpose, arriveAt }] }，不含兵力）。失败时为空对象。' },
    { name: 'tokenKind', type: 'string', desc: '本次消耗的计谋令类别。' },
    { name: 'tokensLeft', type: 'number', desc: '扣完这类令还剩几张。' },
    { name: 'heroCooldownUntil', type: 'string', desc: '施计武将的冷却截止（ISO 8601）。' },
  ],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_NOT_AVAILABLE', 'HERO_STRATAGEM_COOLDOWN', 'INVALID_TARGET', 'TARGET_PROTECTED', 'TRUCE_ACTIVE', 'ALLY_TARGET', 'STRATAGEM_TOKEN_SHORT'],
  examples: [
    {
      caption: '对敌方玩家的城施焚烧粮草成功（扣 1 张攻心令）',
      request: { op: Op.CAST_STRATAGEM, seq: 53, data: { heroId: STRATAGEM_ID, stratagem: 'burn_granary', target: { cityId: CITY_ID } } },
      responses: [
        {
          op: Op.CAST_STRATAGEM,
          seq: 53,
          ok: true,
          data: { success: true, failedReason: null, effect: { foodBurned: 4200 }, tokenKind: 'assault', tokensLeft: 0, heroCooldownUntil: '2026-09-25T12:00:00.000Z' },
        },
      ],
    },
    {
      caption: '金蝉脱壳：自己的返程部队剩余时间缩短 50%',
      request: { op: Op.CAST_STRATAGEM, seq: 54, data: { heroId: STRATAGEM_ID, stratagem: 'golden_cicada', target: { marchId: MARCH_ID } } },
      responses: [
        {
          op: Op.CAST_STRATAGEM,
          seq: 54,
          ok: true,
          data: { success: true, failedReason: null, effect: { arriveAt: '2026-09-25T11:20:00.000Z', reducedPercent: 50 }, tokenKind: 'march', tokensLeft: 1, heroCooldownUntil: '2026-09-25T12:00:00.000Z' },
        },
      ],
    },
    {
      caption: '计谋令不足（不扣任何东西）',
      request: { op: Op.CAST_STRATAGEM, seq: 55, data: { heroId: STRATAGEM_ID, stratagem: 'spy_trail', target: { cityId: CITY_ID } } },
      responses: [
        { op: Op.CAST_STRATAGEM, seq: 55, ok: false, error: { code: 'STRATAGEM_TOKEN_SHORT', message: '计谋令不足：请用战场军功到战场商店兑换' }, data: { tokenKind: 'intel', have: 0 } },
      ],
    },
    {
      caption: '成功率判定失败（照常扣令与冷却，对方收到警报）',
      request: { op: Op.CAST_STRATAGEM, seq: 56, data: { heroId: STRATAGEM_ID, stratagem: 'ambush_all_sides', target: { cityId: CITY_ID } } },
      responses: [
        {
          op: Op.CAST_STRATAGEM,
          seq: 56,
          ok: true,
          data: { success: false, failedReason: 'roll', effect: {}, tokenKind: 'assault', tokensLeft: 1, heroCooldownUntil: '2026-09-25T12:00:00.000Z' },
        },
      ],
    },
  ],
  agentNote: `施计前用 GET_STRATAGEMS（带 target）看成功率与限制，别在免疫期或保护目标上白扔令。令很贵：一场剧本战场最多买 11 张，攻心令一场只能买 2 张。焚烧粮草 / 十面埋伏是骚扰手段，真正的收益仍靠出兵掠夺——趁火打劫后 1 小时内做一次掠夺最划算。自己被施计时会收到 PUSH_STRATAGEM 与 stratagem_received 事件；中了十面埋伏期间所有出兵会返回 CITY_AMBUSHED（附 retryAfterSeconds），在外的部队仍可召回。`,
};

export const PUSH_STRATAGEM: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_STRATAGEM',
  title: '推送：被施计警报（v86，AISLG-211）',
  summary: `目标玩家收到：谁、用哪名武将、对哪座城 / 哪支部队施了什么计、成没成。只有**会失败**的计谋推送，且不论成功失败都推（欺敌类草木皆兵 / 空城计与金蝉脱壳不通知任何人）。同一事件同时写入目标方事件流（stratagem_received），施计方自己的记录是 stratagem_cast。行军到达时刻被改写（金蝉脱壳 / 八门金锁）另走 PUSH_MARCH_STATE（reason = march_time_changed），城池中计（欺敌覆盖 / 烧粮 / 趁火打劫 / 十面埋伏）另走 PUSH_CITY_STATE（reason = stratagem），收到后重新 GET_STATE。`,
  dataFields: [
    { name: 'stratagem / stratagemName', type: 'string', desc: '计谋 kind 与中文名。' },
    { name: 'caster', type: 'object', desc: '{ username, heroName }：施计方账号与武将。' },
    { name: 'target', type: 'object', desc: '{ kind: "city" | "march" | "npc_attack", cityId?, cityName?, marchId?, attackId?, x?, y? }：被施加的目标。' },
    { name: 'success', type: 'boolean', desc: '是否生效。false = 免疫期内或成功率判定失败（施计方照常扣令与冷却）。' },
    { name: 'effect', type: 'object', desc: '目标方可见的效果：foodBurned（被烧掉的粮食）/ protectionDownPercent + until（仓库保护降低）/ until（锁城截止）/ arriveAt + extendedPercent（行军被延长后的到达时刻）。成功但无可见效果为空对象。' },
  ],
  examples: [
    {
      op: Op.PUSH_STRATAGEM,
      push: true,
      data: {
        stratagem: 'burn_granary',
        stratagemName: '焚烧粮草',
        caster: { username: '孟起', heroName: '荀彧' },
        target: { kind: 'city', cityId: CITY_ID, cityName: '主城', x: 12, y: 34 },
        success: true,
        effect: { foodBurned: 4200 },
      },
    },
  ],
  agentNote: '收到后按 stratagem 应对：焚烧粮草 → 检查粮食并考虑补产；趁火打劫 → 1 小时内可能被掠夺，优先把资源用掉或堆高仓库保护；十面埋伏 → 这段时间派不出兵，用在外部队召回与协防应对；八门金锁 → 自己的行军到达时间被延后（PUSH_MARCH_STATE 里有新时刻）；蛛丝马迹 → 对方已知你所有城池坐标与在外部队去向。',
};
