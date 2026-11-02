// 伤兵 / 俘虏 / 逃兵协议的对外文档（RESTORE_TROOPS / RELEASE_TROOPS，v85，AISLG-212）。
// 费用示例直接调用实现函数（restoreCost / restorePopulationCost），文档数值与代码不漂移。
// 规则常量见 battle-casualties.ts：伤兵率 20%、俘虏率 10%、治疗 / 劝回 50%、招降 60%、
// 伤兵 / 俘虏 72 小时过期、逃兵 24 小时；消耗按「最早一批优先」的 FIFO。

import { Op, type ArmyCounts } from './protocol';
import {
  CAPTIVE_RECRUIT_COST_PERCENT,
  DESERTER_RECALL_COST_PERCENT,
  HEAL_COST_PERCENT,
  restoreCost,
  restorePopulationCost,
} from './battle-casualties';
import { TROOP_INFO } from './troops';
import type { RequestOpDoc } from './protocol-doc';
import { exampleCity } from './protocol-doc-shared';
import { EMPTY_ARMY } from './protocol-doc-army-consts';
import { applyCost, INITIAL_RESOURCES } from './rules';

const POOL_TYPE = "'wounded' | 'captive' | 'deserter'";

/** 池子视图（与 CityView.wounded / captives / deserters 同形态） */
function poolView(troops: Partial<ArmyCounts>, earliestExpireAt: string | null) {
  return { troops: { ...EMPTY_ARMY, ...troops } as ArmyCounts, earliestExpireAt };
}

// ---- 治疗（RESTORE_TROOPS pool=wounded）示例：伤兵营 20 长枪兵全部治好 ----
const HEAL_TROOPS = { pikeman: 20 };
const HEAL_COST = restoreCost(HEAL_TROOPS, HEAL_COST_PERCENT);
/** 示例：野地战斗损失 100 长枪兵 → 20 进伤兵营（验收例 1） */
const HEAL_EXAMPLE_CITY = exampleCity({
  army: { ...EMPTY_ARMY, pikeman: 20 } as ArmyCounts,
  armyFoodUsePerHour: TROOP_INFO.pikeman.foodUse * 20,
  wounded: poolView({ pikeman: 0 }, null),
  resources: applyCost(INITIAL_RESOURCES, HEAL_COST),
});

// ---- 招降（pool=captive）示例：俘虏营 10 剑兵全部招降 ----
const RECRUIT_TROOPS = { swordsman: 10 };
const RECRUIT_COST = restoreCost(RECRUIT_TROOPS, CAPTIVE_RECRUIT_COST_PERCENT);
const RECRUIT_POPULATION = restorePopulationCost(RECRUIT_TROOPS);
/** 示例：攻城战胜后从守军损失抓到 10 剑兵（验收例 2） */
const RECRUIT_EXAMPLE_CITY = exampleCity({
  army: { ...EMPTY_ARMY, swordsman: 10 } as ArmyCounts,
  armyFoodUsePerHour: TROOP_INFO.swordsman.foodUse * 10,
  captives: poolView({ swordsman: 0 }, null),
  resources: applyCost(INITIAL_RESOURCES, RECRUIT_COST),
});

// ---- 释放（RELEASE_TROOPS）示例：释放 10 民兵俘虏 ----
const RELEASE_TROOPS = { militia: 10 };

export const REQUEST_RESTORE_TROOPS: RequestOpDoc = {
  kind: 'request',
  name: 'RESTORE_TROOPS',
  title: `治疗伤兵 / 招降俘虏 / 劝回逃兵（立即完成，花征兵资源 × ${HEAL_COST_PERCENT}% 或 ${CAPTIVE_RECRUIT_COST_PERCENT}%）`,
  preAuth: false,
  summary: `把指定城池（缺省主城）三个部队池里的兵弄回城内驻军（v85，AISLG-212）：**立即完成、没有等待时间**，按 pool 分三种——伤兵（wounded）治疗花该兵种征兵资源的 ${HEAL_COST_PERCENT}%（治好再遣散不赚不亏）、俘虏（captive）招降花 ${CAPTIVE_RECRUIT_COST_PERCENT}% 且**扣人口**（与征兵同口径；军营等级不够征募该兵种也能招降，俘虏本来就是现成的兵）、逃兵（deserter）劝回花 ${DESERTER_RECALL_COST_PERCENT}% 不扣人口。费用口径同遣散（v84）：每种资源 = floor(Σ 单兵征募成本 × 数量 × 比例%)，多个兵种**先累加再取整一次**。**伤兵 / 俘虏 ${'72'} 小时、逃兵 ${'24'} 小时不处理就没了**（按全局时间缩放换算，earliestExpireAt 为最早一批的过期时刻）；治疗 / 招降 / 劝回**先消耗最早的一批**。人口规则：伤兵治好回来不扣人口（征兵时已扣），逃兵同样不扣，只有招降俘虏扣（俘虏是对方的人）。劝回逃兵要求该城**不在断粮状态**（粮食归零且净产量为负时返回 CITY_STARVING）。三个池子都不吃粮、不参战、不能被掠夺、不占出征名额；城池消失（分城被占 / 放弃 / 合并）时一起消失。玩家与 Agent 都可以发起。`,
  requestFields: [
    { name: 'pool', type: POOL_TYPE, desc: `必填。wounded=治疗伤兵（${HEAL_COST_PERCENT}%、不扣人口）；captive=招降俘虏（${CAPTIVE_RECRUIT_COST_PERCENT}%、扣人口、无视军营等级）；deserter=劝回逃兵（${DESERTER_RECALL_COST_PERCENT}%、断粮中拒绝）。其他值返回 INVALID_PARAMS。` },
    { name: 'troops', type: 'object', desc: '必填。要治疗的兵种与数量，形如 { "pikeman": 20 }：键为兵种（取值同 RECRUIT 的 troop），值为正整数。某兵种超过池内现有数量、空对象、未知兵种、0 / 负数 / 小数一律返回 INVALID_PARAMS（不改任何数据）。' },
  ],
  dataFields: [
    { name: 'restored', type: 'object', desc: '本次回到城内驻军的兵种与数量（= 请求里数量大于 0 的项），已累加进 city.army。' },
    { name: 'cost', type: 'object', desc: `花费的资源 { gold, wood, food, stone, iron }：每种 = floor(Σ 单兵成本 × 数量 × 比例%)（先累加后取整，同遣散口径）。` },
    { name: 'populationCost', type: 'number', desc: `扣的人口：招降俘虏 = Σ 单兵人口 × 数量（与征兵同口径，人口不足返回 INSUFFICIENT_POPULATION）；治疗 / 劝回恒为 0。` },
    { name: 'city', type: 'object', desc: '操作后的城池状态，结构与 GET_STATE 的 city 相同（含新的 wounded / captives / deserters 三池与 army）。' },
  ],
  errors: ['INVALID_PARAMS', 'INSUFFICIENT_RESOURCES', 'INSUFFICIENT_POPULATION', 'CITY_STARVING'],
  examples: [
    {
      caption: `治疗 20 个长枪兵伤兵（花征兵资源 × ${HEAL_COST_PERCENT}%，不扣人口）`,
      request: { op: Op.RESTORE_TROOPS, seq: 1, data: { pool: 'wounded', troops: HEAL_TROOPS } },
      responses: [
        {
          op: Op.RESTORE_TROOPS,
          seq: 1,
          ok: true,
          data: { restored: { ...HEAL_TROOPS }, cost: HEAL_COST, populationCost: 0, city: HEAL_EXAMPLE_CITY },
        },
      ],
    },
    {
      caption: `招降 10 个剑兵俘虏（花征兵资源 × ${CAPTIVE_RECRUIT_COST_PERCENT}% + 扣人口）`,
      request: { op: Op.RESTORE_TROOPS, seq: 2, data: { pool: 'captive', troops: RECRUIT_TROOPS } },
      responses: [
        {
          op: Op.RESTORE_TROOPS,
          seq: 2,
          ok: true,
          data: { restored: { ...RECRUIT_TROOPS }, cost: RECRUIT_COST, populationCost: RECRUIT_POPULATION, city: RECRUIT_EXAMPLE_CITY },
        },
      ],
    },
    {
      caption: '该城正在断粮时劝回逃兵被拒（不改任何数据）',
      request: { op: Op.RESTORE_TROOPS, seq: 3, data: { pool: 'deserter', troops: { militia: 5 } } },
      responses: [
        {
          op: Op.RESTORE_TROOPS,
          seq: 3,
          ok: false,
          error: { code: 'CITY_STARVING', message: '该城正在断粮（粮食归零且净产量为负），只有断粮结束后才能劝回逃兵' },
        },
      ],
    },
  ],
  agentNote: `发起前用 GET_STATE 的 city.wounded / captives / deserters 核对各兵种数量与 earliestExpireAt（最早一批的过期时刻，快过期就先花掉）；资源不足返回 INSUFFICIENT_RESOURCES（附 shortfall 缺口，v22 口径）。治疗与遣散资源口径互补：治好（${HEAL_COST_PERCENT}%）再遣散（返 ${HEAL_COST_PERCENT}%）净变化为 0，不存在套利；招降多花的 ${CAPTIVE_RECRUIT_COST_PERCENT - HEAL_COST_PERCENT}% 是「俘虏变自己人」的代价。同账号其他在线连接会收到 PUSH_CITY_STATE（reason=troop_pools_changed，附 cityId 与 pool）。`,
};

export const REQUEST_RELEASE_TROOPS: RequestOpDoc = {
  kind: 'request',
  name: 'RELEASE_TROOPS',
  title: '放弃治疗伤兵 / 释放俘虏（免费，池子消失不返还）',
  preAuth: false,
  summary: `把指定城池（缺省主城）伤兵营 / 俘虏营里的兵直接清掉（v85，AISLG-212）：**免费、立即生效、不返还任何东西**——放弃治疗（pool=wounded）等于让这批伤兵死亡，释放俘虏（pool=captive）等于放人。池子快过期、资源不够治疗 / 招降、或兵种结构不想要时用它止损（省下抢人口的顾虑）。逃兵不能释放（deserter 只能 RESTORE_TROOPS 劝回或等 24 小时过期），传 deserter 返回 INVALID_PARAMS。消耗同样按最早一批优先。玩家与 Agent 都可以发起。`,
  requestFields: [
    { name: 'pool', type: "'wounded' | 'captive'", desc: "必填。wounded=放弃治疗（伤兵消失）；captive=释放俘虏。deserter 不能释放（只能劝回或等过期），其他值返回 INVALID_PARAMS。" },
    { name: 'troops', type: 'object', desc: '必填。要清掉的兵种与数量，形如 { "militia": 10 }：值为正整数；某兵种超过池内现有数量、空对象、未知兵种一律返回 INVALID_PARAMS（不改任何数据）。' },
  ],
  dataFields: [
    { name: 'released', type: 'object', desc: '本次消失的兵种与数量（= 请求里数量大于 0 的项），已从池子扣除。' },
    { name: 'city', type: 'object', desc: '操作后的城池状态，结构与 GET_STATE 的 city 相同。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '释放 10 个民兵俘虏（免费，不返还任何东西）',
      request: { op: Op.RELEASE_TROOPS, seq: 1, data: { pool: 'captive', troops: RELEASE_TROOPS } },
      responses: [
        {
          op: Op.RELEASE_TROOPS,
          seq: 1,
          ok: true,
          data: {
            released: { ...RELEASE_TROOPS },
            city: exampleCity({ captives: poolView({ militia: 0 }, null) }),
          },
        },
      ],
    },
    {
      caption: '逃兵不能释放（只能 RESTORE_TROOPS 劝回或等过期）',
      request: { op: Op.RELEASE_TROOPS, seq: 2, data: { pool: 'deserter', troops: { militia: 5 } } },
      responses: [
        {
          op: Op.RELEASE_TROOPS,
          seq: 2,
          ok: false,
          error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' },
        },
      ],
    },
  ],
  agentNote: '只在没有更优选择时用：治疗 / 招降能拿回兵，放弃 / 释放什么都拿不到。同账号其他在线连接会收到 PUSH_CITY_STATE（reason=troop_pools_changed，附 cityId 与 pool）。',
};
