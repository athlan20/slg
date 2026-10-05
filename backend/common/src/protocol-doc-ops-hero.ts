// 武将协议的对外文档（v36，AISLG-114/115/116）：GET_HEROES / RECRUIT_HERO /
// DISMISS_HERO / ASSIGN_HERO / PUSH_HERO_STATE。数值直引 hero.ts 的真实常量。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { STARTED_AT, CITY_ID, ACCOUNT_ID } from './protocol-doc-shared';
import {
  ALL_FAMOUS_HEROES,
  ATK_PERCENT_PER_FORCE,
  DEF_PERCENT_PER_WIT,
  FAMOUS_ATTR_MAX,
  FAMOUS_ATTR_MIN,
  FAMOUS_HERO_CAP,
  HERO_ATTR_MAX,
  HERO_ATTR_MIN,
  HERO_BONUS_CAP_PERCENT,
  HERO_LEVEL_MAX,
  LEAD_TROOPS_PER_POINT,
  RECRUIT_BASE_GOLD,
  RECRUIT_GOLD_PER_ATTR,
  SALARY_PER_LEVEL_FAMOUS,
  SALARY_PER_LEVEL_NORMAL,
  TAVERN_CANDIDATE_COUNT,
  TAVERN_REFRESH_HOURS,
  WOUND_HOURS,
  attrGainPerLevel,
  expForNextLevel,
  famousSourceLabel,
  guardProductionPercent,
} from './hero';

const HERO_ID = '5b1f9a2c-0000-4000-8000-0000000000a1';
const CANDIDATE_ID = '6c2f9a2c-0000-4000-8000-0000000000b2';

const HERO_VIEW = {
  id: HERO_ID,
  name: '赵云长',
  famous: false,
  lead: 32,
  force: 28,
  wit: 15,
  level: 3,
  exp: 240,
  expNext: 60,
  salaryPerHour: 60,
  arrears: false,
  woundedUntil: null,
  guardCityId: null,
  marchingMarchId: null,
  bonus: { atkPercent: 8.4, defPercent: 4.5, leadCap: 640 },
  guardProductionPercent: 1.5,
} as const;

const CANDIDATE_VIEW = {
  id: CANDIDATE_ID,
  name: '孙子龙',
  lead: 22,
  force: 30,
  wit: 11,
  cost: RECRUIT_BASE_GOLD + (22 + 30 + 11) * RECRUIT_GOLD_PER_ATTR,
  refreshedAt: STARTED_AT,
} as const;

const FAMOUS_CLAIM_VIEW = {
  name: '吕布',
  sourceLabel: famousSourceLabel(ALL_FAMOUS_HEROES[2].source),
  ownerUsername: null,
  grantedAt: null,
} as const;

const HERO_RULES = `武将规则（数值均为占位）：**普通将**从酒馆招募，三项属性（统率 lead / 武力 force / 智力 wit）各 ${HERO_ATTR_MIN}–${HERO_ATTR_MAX} 随机；招募费 = ${RECRUIT_BASE_GOLD} + 三项合计 × ${RECRUIT_GOLD_PER_ATTR}（金币，从酒馆所在城扣）。**名将**（三项各 ${FAMOUS_ATTR_MIN}–${FAMOUS_ATTR_MAX}）只从 PvE 获得、全服唯一（见 famousClaims）。带兵加成：全军攻击 + 武力 × ${ATK_PERCENT_PER_FORCE}%、全军受到伤害 − 智力 × ${DEF_PERCENT_PER_WIT}%，各自封顶 ${HERO_BONUS_CAP_PERCENT}%；能吃到加成的兵数 = 统率 × ${LEAD_TROOPS_PER_POINT}，部队超出时按比例摊薄（统率是带大军的关键）。俸禄每小时从主城扣（普通将 ${SALARY_PER_LEVEL_NORMAL} × 等级、名将 ${SALARY_PER_LEVEL_FAMOUS} × 等级金币，随全局时间缩放），主城金币不够即「欠饷」（arrears=true，不能出征），扣款成功自动恢复。带队战败（攻方失败或全灭）武将重伤 ${WOUND_HOURS} 小时（随缩放），期间不能出征、不会死亡。经验（v36 AISLG-116）：带队参战（含城守守城）获得经验 = 本场歼灭敌军的参考战力，战败减半；升到 L+1 级需 100 × L²，每升一级三项属性各 +${attrGainPerLevel(false)}（名将 +${attrGainPerLevel(true)}），上限 ${HERO_LEVEL_MAX} 级——加成仍受 ${HERO_BONUS_CAP_PERCENT}% 封顶，高等级的主要收益是统率提高（带更多兵吃满加成）。`;

export const REQUEST_GET_HEROES: RequestOpDoc = {
  kind: 'request',
  name: 'GET_HEROES',
  title: '查询武将（账号武将 / 酒馆候选 / 名将归属，v36，AISLG-114/115/116）',
  preAuth: false,
  summary: `返回账号全部武将（含属性、等级 / 经验、俸禄、欠饷 / 重伤状态、占用关系）、当前（或指定）城酒馆的候选（每城一座酒馆，每 ${TAVERN_REFRESH_HOURS} 小时基准随时间缩放刷新 ${TAVERN_CANDIDATE_COUNT} 名）、普通将 / 名将数量与上限，以及全部 ${ALL_FAMOUS_HEROES.length} 名名将的全服归属（famousClaims，未被获得的 ownerUsername 为 null）。${HERO_RULES}`,
  requestFields: [
    { name: 'cityId', type: 'string', desc: '可选。看哪座城的酒馆候选（缺省 = 会话当前城 / 主城）。' },
  ],
  dataFields: [
    { name: 'cityId / tavernLevel', type: 'string / number', desc: '查询城与其酒馆等级（0 = 未建）。' },
    { name: 'maxTavernLevel / normalCap / normalCount', type: 'number', desc: `账号酒馆最高等级；普通将上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1；当前普通将数量。` },
    { name: 'famousCap / famousCount', type: 'number', desc: `名将上限（固定 ${FAMOUS_HERO_CAP}，不占普通将上限）与当前数量。` },
    { name: 'heroes', type: 'array', desc: `账号全部武将：{ id, name, famous, lead, force, wit, level, exp, expNext 距下一级, salaryPerHour 已随时间缩放, arrears 欠饷, woundedUntil 重伤恢复时刻或 null, guardCityId 正在城守的城或 null, marchingMarchId 正在随行的行军或 null, bonus { atkPercent, defPercent, leadCap }（满编口径）, guardProductionPercent 城守产量加成 }。` },
    { name: 'candidates', type: 'array', desc: `该城酒馆当前候选：{ id, name, lead, force, wit, cost 招募费, refreshedAt 本批刷新时刻 }；酒馆未建为空数组。` },
    { name: 'famousClaims', type: 'array', desc: '全部名将归属：{ name, sourceLabel 来源人读描述, ownerUsername 当前主人或 null, grantedAt }。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询武将与酒馆候选',
      request: { op: Op.GET_HEROES, seq: 21, data: {} },
      responses: [
        {
          op: Op.GET_HEROES,
          seq: 21,
          ok: true,
          data: {
            cityId: CITY_ID,
            tavernLevel: 2,
            maxTavernLevel: 2,
            normalCap: 2,
            normalCount: 1,
            famousCap: FAMOUS_HERO_CAP,
            famousCount: 0,
            heroes: [HERO_VIEW],
            candidates: [CANDIDATE_VIEW],
            famousClaims: [FAMOUS_CLAIM_VIEW, '（共 11 名，其余略）'],
          },
        },
      ],
    },
  ],
  agentNote: `配将出征流程：GET_HEROES 挑选 arrears=false 且 woundedUntil 为 null / 已过期、marchingMarchId 与 guardCityId 都为 null 的武将，MARCH / SCOUT 带 heroId 即随队（一支部队至多一名，同一武将同一时间只能在一支部队里，城守不能出征）。经验与等级在 heroes[] 里实时可查（expNext = 距下一级还差多少）。名将归属见 famousClaims——未被获得的名将按 sourceLabel 的条件争取（首占名城 / 老巢首杀 / 贡献前二）。收到 PUSH_HERO_STATE 后重拉本协议对齐。`,
};

export const REQUEST_RECRUIT_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'RECRUIT_HERO',
  title: '酒馆招募武将（v36，AISLG-114）',
  preAuth: false,
  summary: `从某座城的酒馆候选中招募一名普通将：招募费 = ${RECRUIT_BASE_GOLD} + 三项属性合计 × ${RECRUIT_GOLD_PER_ATTR} 金币，从**酒馆所在城**扣除。候选被招走即从列表消失（同批其余保留）。`,
  requestFields: [
    { name: 'candidateId', type: 'string', desc: '候选 id（GET_HEROES 的 candidates[]）。' },
  ],
  dataFields: [
    { name: 'hero', type: 'object', desc: '新武将视图（结构同 GET_HEROES 的 heroes[] 元素）。' },
  ],
  errors: ['INVALID_PARAMS', 'HERO_CANDIDATE_GONE', 'TAVERN_NOT_BUILT', 'HERO_CAP_REACHED', 'INSUFFICIENT_RESOURCES'],
  examples: [
    {
      caption: '招募一名候选',
      request: { op: Op.RECRUIT_HERO, seq: 22, data: { candidateId: CANDIDATE_ID } },
      responses: [{ op: Op.RECRUIT_HERO, seq: 22, ok: true, data: { hero: HERO_VIEW } }],
    },
  ],
  agentNote: '招前先核对 normalCount < normalCap 与该城金币；招募费随属性浮动（三项合计 × 20），统率高的候选带大队更划算。名将不走酒馆（无法招募），只能 PvE 获得。',
};

export const REQUEST_DISMISS_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'DISMISS_HERO',
  title: '解雇武将（v36，AISLG-114）',
  preAuth: false,
  summary: '解雇一名普通将或名将：直接消失，不再发俸禄。随队出征中（含返程）的武将不能解雇（HERO_BUSY）；正在任城守的武将解雇同时撤任。**名将解雇后回到全服「可获得」状态**，下次满足条件的玩家（首占名城 / 老巢首杀 / 贡献前二）会得到它。',
  requestFields: [{ name: 'heroId', type: 'string', desc: '武将 id。' }],
  dataFields: [{ name: 'heroId', type: 'string', desc: '被解雇的武将 id。' }],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_BUSY'],
  examples: [
    {
      caption: '解雇武将',
      request: { op: Op.DISMISS_HERO, seq: 23, data: { heroId: HERO_ID } },
      responses: [{ op: Op.DISMISS_HERO, seq: 23, ok: true, data: { heroId: HERO_ID } }],
    },
  ],
  agentNote: '俸禄是持续成本（欠饷武将不能出征），低属性武将留着不划算；解雇名将前想清楚——全服唯一，放手就是别人的了。',
};

export const REQUEST_ASSIGN_HERO: RequestOpDoc = {
  kind: 'request',
  name: 'ASSIGN_HERO',
  title: '任命 / 撤换城守（v36，AISLG-115）',
  preAuth: false,
  summary: `每座城可任命 1 名武将（普通将或名将）当城守：守城战（NPC 来袭、黄巾大营进攻）时守军享受该武将的攻击 / 减伤加成（同出征口径，含统率摊薄）；平时该城四资源（非金）产量 + 智力 × 0.1%（封顶 5%，已含在城池产量里）。城守不能同时出征（出征校验会拒）。`,
  requestFields: [
    { name: 'cityId', type: 'string', desc: '可选。目标城（缺省 = 会话当前城 / 主城）。' },
    { name: 'heroId', type: 'string | null', desc: '武将 id；null 或缺省 = 撤任。一名武将至多守一城，重复任命自动从原城卸任。' },
  ],
  dataFields: [
    { name: 'cityId', type: 'string', desc: '目标城 id。' },
    { name: 'guard', type: 'object', desc: '任命后的城守武将视图（撤任为 null）。' },
  ],
  errors: ['INVALID_PARAMS', 'HERO_NOT_FOUND', 'HERO_BUSY'],
  examples: [
    {
      caption: '任命城守',
      request: { op: Op.ASSIGN_HERO, seq: 24, data: { heroId: HERO_ID } },
      responses: [{ op: Op.ASSIGN_HERO, seq: 24, ok: true, data: { cityId: CITY_ID, guard: HERO_VIEW } }],
    },
  ],
  agentNote: `智力高的武将当城守最划算（产量 +智力 × 0.1% 封顶 5%，如 wit=50 → +5%）；守城战另享攻防加成。heroes[].guardProductionPercent 已按当前智力给出可预期产量加成。账号 ${ACCOUNT_ID} 视角：城守加成在守城战报（defender.hero）与 CityView.production 里都能看到。`,
};

export const PUSH_HERO_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_HERO_STATE',
  title: '推送：武将状态变化（v36，AISLG-114/115/116）',
  summary: '账号武将发生变化时推给该账号全部在线连接（含 Agent）：招募 / 解雇 / 城守任命、欠饷开始 / 恢复、带队战败重伤、战斗获得经验（含升级）、获得名将。载荷只带变化摘要，收到后重拉 GET_HEROES 对齐。',
  dataFields: [
    { name: 'reason', type: 'string', desc: "recruited / dismissed / guard_changed / arrears / salary_paid / wounded / exp_gained / granted。" },
    { name: 'heroId', type: 'string', desc: '涉及的武将 id（guard_changed 撤任时可能为 null）。' },
    { name: 'exp', type: 'object', desc: 'reason=exp_gained 时给出 { gained 本次经验, level, leveledTo 升到几级或 null }。' },
  ],
  examples: [
    { op: Op.PUSH_HERO_STATE, push: true, data: { reason: 'exp_gained', heroId: HERO_ID, exp: { gained: 86, level: 4, leveledTo: 4 } } },
  ],
  agentNote: '推送可能漏收（网络抖动 / 重连），以 GET_HEROES 重拉为准；exp_gained 的升级信息也会写进对应 march_completed 事件的 heroExp 字段。',
};

/** 供 MARCH 文档引用的 heroId 字段描述（注册在 protocol-doc-ops-world.ts） */
export const MARCH_HERO_FIELD_DESC = `可选（v36，AISLG-114）。随队武将 id（GET_HEROES 的 heroes[]）：全军攻击 + 武力 × ${ATK_PERCENT_PER_FORCE}%、受到伤害 − 智力 × ${DEF_PERCENT_PER_WIT}%（各封顶 ${HERO_BONUS_CAP_PERCENT}%，统率超编按比例摊薄——能吃到加成的兵数 = 统率 × ${LEAD_TROOPS_PER_POINT}）。一支部队至多一名；同一武将同一时间只能在一支部队里；城守 / 重伤（战败后 ${WOUND_HOURS} 小时基准）/ 欠饷的武将不能带队（GUARD_ASSIGN_DENIED / HERO_WOUNDED / HERO_ARREARS）。战报与 march_completed 事件的 heroExp 会带出武将与经验信息。`;

/** 供城池 / 建筑文档引用的酒馆效果描述 */
export const TAVERN_EFFECT_DESC = `酒馆（tavern，v36 AISLG-114）：每城限一座；每 ${TAVERN_REFRESH_HOURS} 小时（随全局时间缩放）刷新 ${TAVERN_CANDIDATE_COUNT} 名候选普通将（三项属性各 ${HERO_ATTR_MIN}–${HERO_ATTR_MAX}），花金币招募（${RECRUIT_BASE_GOLD} + 三项合计 × ${RECRUIT_GOLD_PER_ATTR}）；账号普通将上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1（酒馆取账号所有城中的最高等级）。`;
