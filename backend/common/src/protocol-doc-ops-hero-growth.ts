// 武将培养与在野名将的对外文档（v54，AISLG-144）：ALLOCATE_HERO_POINTS（加点）/ RESET_HERO_POINTS（洗点）/
// TRAIN_HERO（历练）/ GIFT_HERO（赏赐）/ BEFRIEND_HERO（结交）/ RECRUIT_FAMOUS_HERO（招揽）。
// 数值直引 hero-growth.ts / hero-wild.ts 的真实常量。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import {
  BEFRIEND_ACTIVE_CAP,
  BEFRIEND_DAILY_LIMIT,
  BEFRIEND_FAVOR_PER_TIME,
  BEFRIEND_GOLD_PER_LEVEL,
  RECRUIT_FAVOR_REQUIRED,
  WILD_GARRISON_MULTIPLIER,
  WILD_HERO_MIN_LEVEL,
} from './hero-wild';
import {
  GIFT_DAILY_LIMIT,
  GIFT_EXP,
  GIFT_GOLD,
  RESET_DAILY_LIMIT,
  RESET_GOLD_PER_LEVEL,
  TRAINING_TIERS,
} from './hero-growth';
import { heroPointsPerLevel, HERO_LEVEL_MAX } from './hero';

const HERO_ID = '5b1f9a2c-0000-4000-8000-0000000000a1';

const GROWTH_RULES = `培养（v54，AISLG-144）：升一级获得自由点数（普通将 ${heroPointsPerLevel(false)}、名将 ${heroPointsPerLevel(true)}），由玩家分到统率 / 武力 / 智力，等级上限 ${HERO_LEVEL_MAX}；升级不再自动加属性。洗点花 等级 × ${RESET_GOLD_PER_LEVEL} 金币，已分配点数全部退回，每个武将每游戏日 ${RESET_DAILY_LIMIT} 次。历练派出去 1 / 4 / 12 小时基准（随时间缩放），到点经验 = 基础经验 × 武将等级 ÷ 10（基础 ${TRAINING_TIERS[1].baseExp} / ${TRAINING_TIERS[2].baseExp} / ${TRAINING_TIERS[3].baseExp}），到点自动到账，离线也结算。赏赐每次花 ${GIFT_GOLD} 金币 → ${GIFT_EXP} 经验，每个武将每游戏日最多 ${GIFT_DAILY_LIMIT} 次。加点 / 洗点 / 历练 / 解雇 / 出征 / 任城守都要求武将不在外出、不在城守、不在历练（赏赐不受限）。`;

const WILD_RULES = `在野名将（v54，AISLG-144）：29 名名将隐居在 Lv${WILD_HERO_MIN_LEVEL} 以上的野地里（开服时分配，之后不变）。地图上该野地带 wildFamous 标记；派部队打赢它的原住守军（守军为同级野地的 ${WILD_GARRISON_MULTIPLIER} 倍）即获得该名将的结交资格（GET_HEROES 的 unlocks）。结交（BEFRIEND_HERO）花主城金币 ${BEFRIEND_GOLD_PER_LEVEL} × 野地等级，好感 +${BEFRIEND_FAVOR_PER_TIME}，每个名将每游戏日最多 ${BEFRIEND_DAILY_LIMIT} 次，同时结交（好感未满、未被招揽）最多 ${BEFRIEND_ACTIVE_CAP} 名。好感满 ${RECRUIT_FAVOR_REQUIRED} 后招揽（RECRUIT_FAMOUS_HERO），全服唯一，先到先得；别人先招揽走，你的结交进度作废（lost=true，金币不退）。名将解雇后回到可获得状态。`;

export const REQUEST_ALLOCATE_HERO_POINTS: RequestOpDoc = {
  kind: 'request',
  name: 'ALLOCATE_HERO_POINTS',
  title: '分配自由点数（v54，AISLG-144）',
  preAuth: false,
  summary: `把武将的自由点数（heroes[].freePoints）分到统率 lead / 武力 force / 智力 wit，三项各为非负整数，合计至少 1、不超过自由点数。只能对在家的武将操作（HERO_BUSY / HERO_TRAINING 拒绝）。${GROWTH_RULES}`,
  requestFields: [
    { name: 'heroId', type: 'string', desc: '武将 id。' },
    { name: 'lead', type: 'number', desc: '分给统率的点数（可缺省，缺省为 0；三项合计至少 1）。' },
    { name: 'force', type: 'number', desc: '分给武力的点数（可缺省，缺省为 0）。' },
    { name: 'wit', type: 'number', desc: '分给智力的点数（可缺省，缺省为 0）。' },
  ],
  dataFields: [{ name: 'hero', type: 'object', desc: '分配后的武将视图（结构同 GET_HEROES 的 heroes[] 元素）。' }],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_BUSY', 'HERO_TRAINING', 'HERO_POINTS_INSUFFICIENT'],
  examples: [
    {
      caption: '把 2 点给武力、1 点给统率',
      request: { op: Op.ALLOCATE_HERO_POINTS, seq: 30, data: { heroId: HERO_ID, lead: 1, force: 2 } },
      responses: [{ op: Op.ALLOCATE_HERO_POINTS, seq: 30, ok: true, data: { hero: { id: HERO_ID, freePoints: 0 } } }],
    },
  ],
  agentNote: '武力 / 智力加成在 67 左右就封顶了（各 20%），多余点数优先给统率（统率 × 20 = 能吃满加成的兵数）。',
};

export const REQUEST_RESET_HERO_POINTS: RequestOpDoc = {
  kind: 'request',
  name: 'RESET_HERO_POINTS',
  title: '洗点（v54，AISLG-144）',
  preAuth: false,
  summary: `把已分配的点数全部退回自由点数，属性还原到武将的初始值。花费 = 武将等级 × ${RESET_GOLD_PER_LEVEL} 金币（主城扣）；每个武将每游戏日 ${RESET_DAILY_LIMIT} 次；没有已分配点数时拒绝（HERO_NOTHING_TO_RESET）。`,
  requestFields: [{ name: 'heroId', type: 'string', desc: '武将 id。' }],
  dataFields: [{ name: 'hero', type: 'object', desc: '洗点后的武将视图（freePoints 已含退回的点数，dailyLeft.reset 已减 1）。' }],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_BUSY', 'HERO_TRAINING', 'HERO_NOTHING_TO_RESET', 'HERO_DAILY_LIMIT', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '洗点',
      request: { op: Op.RESET_HERO_POINTS, seq: 31, data: { heroId: HERO_ID } },
      responses: [{ op: Op.RESET_HERO_POINTS, seq: 31, ok: true, data: { hero: { id: HERO_ID, freePoints: 4 } } }],
    },
  ],
  agentNote: '洗点是按等级收费的，武将越高越贵；先在低等级把点数想清楚再洗。',
};

export const REQUEST_TRAIN_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'TRAIN_HERO',
  title: '派武将历练（v54，AISLG-144）',
  preAuth: false,
  summary: `派武将离家历练 1 / 4 / 12 小时基准（tier 1 / 2 / 3，随时间缩放）。到点经验 = 基础经验（${TRAINING_TIERS[1].baseExp} / ${TRAINING_TIERS[2].baseExp} / ${TRAINING_TIERS[3].baseExp}）× 开始历练时的武将等级 ÷ 10，由 Worker 到点结算（离线也结算），到账后推送 reason=training_done，升级的自由点数照常获得。历练期间武将不能带兵 / 城守 / 解雇 / 加点 / 洗点；赏赐不受限。`,
  requestFields: [
    { name: 'heroId', type: 'string', desc: '武将 id。' },
    { name: 'tier', type: 'number', desc: '档位 1 / 2 / 3。' },
  ],
  dataFields: [{ name: 'hero', type: 'object', desc: '历练中的武将视图（training = { tier, endsAt, exp }）。' }],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_BUSY', 'HERO_TRAINING'],
  examples: [
    {
      caption: '派去历练 4 小时',
      request: { op: Op.TRAIN_HERO, seq: 32, data: { heroId: HERO_ID, tier: 2 } },
      responses: [
        {
          op: Op.TRAIN_HERO,
          seq: 32,
          ok: true,
          data: { hero: { id: HERO_ID, training: { tier: 2, endsAt: '2026-10-12T12:00:00.000Z', exp: 320 } } },
        },
      ],
    },
  ],
  agentNote: '历练是把武将变成经验的最省心方式：不花金币，代价是这段时间它不能出战。等级越高，同档位给的经验越多。',
};

export const REQUEST_CANCEL_TRAINING: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_TRAINING',
  title: '取消武将历练（v71，AISLG-190）',
  preAuth: false,
  summary:
    '取消进行中的历练：武将立刻回家（回到城内，可以带兵、任城守、加点、洗点等），不给经验，已过去的历练时间作废；历练本就不花金币，无返还。取消后可立即再次派去历练（TRAIN_HERO，无次数限制）。历练到点结算与取消并发时先生效者为准：经验已到账（或已到点）后再取消返回 TRAINING_NOT_CANCELLABLE。推送 PUSH_HERO_STATE reason=training_cancelled 给同账号其他在线连接。',
  requestFields: [{ name: 'heroId', type: 'string', desc: '武将 id。' }],
  dataFields: [{ name: 'hero', type: 'object', desc: '取消后的武将视图（training 为 null，已回到城内）。' }],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'TRAINING_NOT_CANCELLABLE'],
  examples: [
    {
      caption: '叫回历练中的武将',
      request: { op: Op.CANCEL_TRAINING, seq: 33, data: { heroId: HERO_ID } },
      responses: [{ op: Op.CANCEL_TRAINING, seq: 33, ok: true, data: { hero: { id: HERO_ID, training: null } } }],
    },
  ],
  agentNote: '取消历练不给经验，只在急用武将时用（比如守城、出征）。想拿满经验就等到点结算。',
};

export const REQUEST_GIFT_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'GIFT_HERO',
  title: '赏赐武将（v54，AISLG-144）',
  preAuth: false,
  summary: `花 ${GIFT_GOLD} 金币（主城扣）给武将加 ${GIFT_EXP} 经验，每个武将每游戏日最多 ${GIFT_DAILY_LIMIT} 次；外出 / 城守 / 历练中的武将也能赏赐。经验可能让武将升级并获得自由点数。`,
  requestFields: [{ name: 'heroId', type: 'string', desc: '武将 id。' }],
  dataFields: [{ name: 'hero', type: 'object', desc: '赏赐后的武将视图（exp / level / freePoints / dailyLeft.gift 已更新）。' }],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_DAILY_LIMIT', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '赏赐一次',
      request: { op: Op.GIFT_HERO, seq: 33, data: { heroId: HERO_ID } },
      responses: [{ op: Op.GIFT_HERO, seq: 33, ok: true, data: { hero: { id: HERO_ID, dailyLeft: { gift: 2, reset: 1 } } } }],
    },
  ],
  agentNote: `1000 金币换 ${GIFT_EXP} 经验，比历练贵，但不占用武将时间；适合临时凑等级。`,
};

export const REQUEST_BEFRIEND_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'BEFRIEND_HERO',
  title: '结交在野名将（v54，AISLG-144）',
  preAuth: false,
  summary: `对已获得结交资格（GET_HEROES 的 unlocks 里）的在野名将结交一次：花 ${BEFRIEND_GOLD_PER_LEVEL} × 野地等级 金币（主城扣），好感 +${BEFRIEND_FAVOR_PER_TIME}（上限 ${RECRUIT_FAVOR_REQUIRED}）。每个名将每游戏日最多 ${BEFRIEND_DAILY_LIMIT} 次；同时结交的名将最多 ${BEFRIEND_ACTIVE_CAP} 名。好感满 ${RECRUIT_FAVOR_REQUIRED} 后不能再结交，改用 RECRUIT_FAMOUS_HERO。${WILD_RULES}`,
  requestFields: [{ name: 'heroName', type: 'string', desc: '在野名将名（GET_HEROES 的 unlocks / famousClaims）。' }],
  dataFields: [
    { name: 'friendship', type: 'object', desc: '结交后的进度：{ heroName, favor 好感, todayLeft 今日剩余次数, cost 下次花费, lost }。' },
  ],
  errors: ['INVALID_PARAMS', 'HERO_NOT_UNLOCKED', 'FAMOUS_CLAIMED', 'HERO_FAVOR_FULL', 'HERO_FRIENDSHIP_LIMIT', 'HERO_DAILY_LIMIT', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '结交一次',
      request: { op: Op.BEFRIEND_HERO, seq: 34, data: { heroName: '关羽' } },
      responses: [
        {
          op: Op.BEFRIEND_HERO,
          seq: 34,
          ok: true,
          data: { friendship: { heroName: '关羽', favor: 10, todayLeft: 4, cost: 1000, lost: false } },
        },
      ],
    },
  ],
  agentNote: '先在 GET_WORLD_MAP / GET_TILE 找 wildFamous 标记的野地，派部队打赢守军拿到资格。结交的金币花在主城，每次都要看 cost。',
};

export const REQUEST_RECRUIT_FAMOUS_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'RECRUIT_FAMOUS_HERO',
  title: '招揽在野名将（v54，AISLG-144）',
  preAuth: false,
  summary: `好感满 ${RECRUIT_FAVOR_REQUIRED} 后招揽该在野名将，加入账号为名将（名将上限 3 名，不占普通将上限）。全服唯一：已被他人获得返回 FAMOUS_CLAIMED；成功后全服播报（hero_granted）。名将的三项属性在落位时已固定，侦察看到的就是它。`,
  requestFields: [{ name: 'heroName', type: 'string', desc: '在野名将名。' }],
  dataFields: [{ name: 'hero', type: 'object', desc: '新名将的武将视图。' }],
  errors: ['INVALID_PARAMS', 'HERO_NOT_UNLOCKED', 'HERO_FAVOR_INSUFFICIENT', 'FAMOUS_CLAIMED', 'HERO_CAP_REACHED'],
  examples: [
    {
      caption: '招揽成功',
      request: { op: Op.RECRUIT_FAMOUS_HERO, seq: 35, data: { heroName: '关羽' } },
      responses: [{ op: Op.RECRUIT_FAMOUS_HERO, seq: 35, ok: true, data: { hero: { id: HERO_ID, name: '关羽', famous: true } } }],
    },
  ],
  agentNote: '招揽是全服竞争：好感满的那一刻就去招，慢一步就会被 FAMOUS_CLAIMED。',
};

/** 供 protocol-doc-ops.ts 注册：六个新协议号的文档（v71 起另加取消历练 CANCEL_TRAINING） */
export const HERO_GROWTH_OP_DOCS = {
  [Op.ALLOCATE_HERO_POINTS]: REQUEST_ALLOCATE_HERO_POINTS,
  [Op.RESET_HERO_POINTS]: REQUEST_RESET_HERO_POINTS,
  [Op.TRAIN_HERO]: REQUEST_TRAIN_HERO,
  [Op.CANCEL_TRAINING]: REQUEST_CANCEL_TRAINING,
  [Op.GIFT_HERO]: REQUEST_GIFT_HERO,
  [Op.BEFRIEND_HERO]: REQUEST_BEFRIEND_HERO,
  [Op.RECRUIT_FAMOUS_HERO]: REQUEST_RECRUIT_FAMOUS_HERO,
};

/** 在野名将规则说明（供 GET_HEROES 与地图文档引用） */
export const WILD_FAMOUS_RULES_DESC = WILD_RULES;
