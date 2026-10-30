// 征兵类协议的对外文档（RECRUIT / CANCEL_RECRUIT / PUSH_RECRUIT_STATE，v11）。
// 账号与查询类见 protocol-doc-ops.ts；建造类见 protocol-doc-ops-build.ts；
// 城池管理类见 protocol-doc-ops-city.ts；共用示例常量见 protocol-doc-shared.ts。

import { Op, TROOP_KINDS, type ArmyCounts } from './protocol';
import { famousCityOfEliteTroop } from './famous-effects';
import { DISBAND_REFUND_PERCENT, TROOP_INFO, RECRUIT_COUNT_MAX, disbandRefund } from './troops';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { CITY_ID, exampleCity } from './protocol-doc-shared';
import { EMPTY_ARMY } from './protocol-doc-army-consts';

const TROOP_TYPE = TROOP_KINDS.map((kind) => `'${kind}'`).join(' | ');

/** 名城专属兵种（v64）：占领对应名城的分城才能征募 */
const ELITE_TROOPS = TROOP_KINDS.filter((kind) => famousCityOfEliteTroop(kind) !== null);
/** 专属兵一览（summary 引用） */
const ELITE_TROOP_SUMMARY = ELITE_TROOPS.map(
  (kind) => `${TROOP_INFO[kind].label}（${kind}，仅占领${famousCityOfEliteTroop(kind)}的分城可征，军营 Lv${TROOP_INFO[kind].barracksLevel}）`,
).join('；');

/** 兵种一览（summary 引用，保持与 troops.ts 同步） */
const TROOP_SUMMARY = TROOP_KINDS.map(
  (kind) =>
    `${TROOP_INFO[kind].label}（${kind}，军营 Lv${TROOP_INFO[kind].barracksLevel}）：` +
    `金 ${TROOP_INFO[kind].cost.gold}` +
    (TROOP_INFO[kind].cost.wood > 0 ? ` / 木 ${TROOP_INFO[kind].cost.wood}` : '') +
    (TROOP_INFO[kind].cost.iron > 0 ? ` / 铁 ${TROOP_INFO[kind].cost.iron}` : '') +
    ` / 粮 ${TROOP_INFO[kind].cost.food}，${TROOP_INFO[kind].unitSeconds}s/人（基准，实际 ÷ 全局时间缩放），占 ${TROOP_INFO[kind].population} 人口，负重 ${TROOP_INFO[kind].carry}，耗粮 ${TROOP_INFO[kind].foodUse}/h（基准，实际 × 缩放）`,
).join('；');

export const RECRUIT_VIEW = {
  id: 'b3c0aa13-d864-53b1-9c62-4d1ea5fd3a1f',
  troop: 'porter',
  count: 2,
  status: 'recruiting',
  initiator: 'player',
  startedAt: '2026-09-25T08:20:00.000Z',
  dueAt: '2026-09-25T08:20:16.000Z',
  completedAt: null,
} as const;

export const QUEUED_RECRUIT_VIEW = {
  id: 'c4d1bb24-e975-64c2-ad73-5e2fb6ge4b2f'.replace('g', 'e'),
  troop: 'militia',
  count: 2,
  status: 'queued',
  initiator: 'agent',
  startedAt: '2026-09-25T08:20:30.000Z',
  dueAt: null,
  completedAt: null,
} as const;

export const REQUEST_RECRUIT: RequestOpDoc = {
  kind: 'request',
  name: 'RECRUIT',
  title: '发起征兵（军营征募一期兵种）',
  preAuth: false,
  summary: `在当前城池的军营征募士兵（v11）。每种兵有解锁所需的军营等级（未达返回 TROOP_NOT_AVAILABLE）与单兵成本；专属兵种（v64，AISLG-168）另需城池为对应名城（cities.famous_name），否则返回 ELITE_TROOP_LOCKED；每次征募 1..${RECRUIT_COUNT_MAX} 人，成本 = 单兵成本 × 数量、人口 = 单兵人口 × 数量，**发起时立即扣减资源与人口**（取消排队条目时全额返还）。征兵队列独立于建造队列：无征募中时立即开始（status=recruiting，dueAt 为预计完成时间，时长 = max(1 秒, floor(单兵基准时长 × 数量 ÷ time_scale))——**1 秒下限作用于批次总时长**而非单兵，**结果向下取整到整秒**（v22 修复 AISLG-39，与建造/升级同模型；显式验证环境变量覆盖时不再缩放）），有征募中且排队未满（当前 2 条，占位）时入队，队满返回 RECRUIT_QUEUE_FULL。资源不足返回 INSUFFICIENT_RESOURCES（v22 起附 shortfall 缺口与 retryAfterSeconds——按当前净产量推导，等满后重发必然成功），人口不足返回 INSUFFICIENT_POPULATION（v22 起附 shortfall 与 retryAfterSeconds——按人口增速推导），失败响应附当前城池状态（**data 仅含 city，无 recruit 载荷**——客户端必须先判 ok 再取载荷）。玩家与 Agent 均可发起。当前兵种：${TROOP_SUMMARY}（均为占位数值）。专属兵（v64）：${ELITE_TROOP_SUMMARY}。军队耗粮已接入（v14）：单兵 foodUse 计入城池净产量，城内 1 倍、行军/野地驻军 2 倍（见 GET_STATE 的 armyFoodUsePerHour），断粮仅停止增长；战斗属性随战斗玩法设计。`,
  requestFields: [
    { name: 'troop', type: TROOP_TYPE, desc: '必填。兵种（一期七种 + v33 二期四种：铁骑兵 iron_cavalry 军营 11 级 / 辎重车 supply_wagon 军营 3 级 / 床弩 ballista 军营 7 级 / 冲车 siege_ram 军营 8 级；v64 名城专属八种见 RECRUIT 的 summary）；缺失或不是已知兵种返回 INVALID_PARAMS。' },
    { name: 'count', type: 'number', desc: `必填。征募数量，1..${RECRUIT_COUNT_MAX} 的整数（占位上限）；越界或非整数返回 INVALID_PARAMS。` },
  ],
  dataFields: [
    { name: 'recruit.id', type: 'string', desc: '本次征兵的 UUID（取消时用作 recruitId）。' },
    { name: 'recruit.troop', type: TROOP_TYPE, desc: '兵种，等于请求的 troop。' },
    { name: 'recruit.count', type: 'number', desc: '征募数量。' },
    { name: 'recruit.status', type: "'recruiting' | 'queued' | 'completed' | 'cancelled'", desc: '发起时为 recruiting（立即开始）或 queued（排队）；完成推送为 completed；取消后为 cancelled。' },
    { name: 'recruit.initiator', type: "'player' | 'agent'", desc: '发起原始指令的连接声明的登录类型。' },
    { name: 'recruit.startedAt', type: 'string', desc: '开始时间（ISO 8601）。' },
    { name: 'recruit.dueAt', type: 'string | null', desc: '预计完成时间 = 开始时间 + max(1 秒, floor(单兵基准时长 × 数量 ÷ time_scale))（v22 修复 AISLG-39：下限作用于批次总时长、向下取整到整秒）；排队中为 null，队首激活时由服务端按当时缩放重算。' },
    { name: 'recruit.completedAt', type: 'string | null', desc: '实际完成时间；征募中为 null。' },
  ],
  errors: ['INVALID_PARAMS', 'TROOP_NOT_AVAILABLE', 'ELITE_TROOP_LOCKED', 'INSUFFICIENT_RESOURCES', 'INSUFFICIENT_POPULATION', 'RECRUIT_QUEUE_FULL'],
  examples: [
    {
      caption: '征募 2 名民夫（立即开始，8s/人 → 16 秒后完成）',
      request: { op: Op.RECRUIT, seq: 1, data: { troop: 'porter', count: 2 } },
      responses: [{ op: Op.RECRUIT, seq: 1, ok: true, data: { recruit: RECRUIT_VIEW } }],
    },
    {
      caption: '有征募中：义兵入队',
      request: { op: Op.RECRUIT, seq: 2, data: { troop: 'militia', count: 2 } },
      responses: [{ op: Op.RECRUIT, seq: 2, ok: true, data: { recruit: QUEUED_RECRUIT_VIEW } }],
    },
    {
      caption: '军营等级不足被拒（附当前状态）',
      request: { op: Op.RECRUIT, seq: 3, data: { troop: 'scout', count: 1 } },
      responses: [
        {
          op: Op.RECRUIT,
          seq: 3,
          ok: false,
          error: { code: 'TROOP_NOT_AVAILABLE', message: '该兵种需要更高等级的军营' },
          data: { city: { id: CITY_ID, queue: [], recruitQueue: [], army: {}, population: { current: 50, cap: 50, growthPerHour: 0 } } },
        },
      ],
    },
  ],
  agentNote:
    '发起前用 GET_STATE 的 levels.barracks 对照兵种门槛、resources 与 population 预判；失败响应的 data 仅含 city（无 recruit 载荷）。征募中条目也可取消（CANCEL_RECRUIT，全额返还）。同账号其他在线连接会收到 PUSH_RECRUIT_STATE（recruit_started / recruit_queued）推送。',
};

export const REQUEST_CANCEL_RECRUIT: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_RECRUIT',
  title: '取消征兵条目（排队中 / 征募中）',
  preAuth: false,
  summary:
    '取消征兵队列中 status=queued（排队中）或 status=recruiting（征募中）的条目：该条目退出队列（status 变为 cancelled，保留为历史），发起时扣减的资源与人口按条目快照全额返还（人口立即回到城池、恢复增长）。征募中取消后已经过去的征募时间作废，该城排队的下一条立即开始征募（同一事务激活，推送 recruit_started）。已完成 / 已取消的条目返回 RECRUIT_NOT_CANCELLABLE。',
  requestFields: [
    { name: 'recruitId', type: 'string', desc: '必填。要取消的征兵条目 UUID（GET_STATE 的 city.recruitQueue 中 queued / recruiting 条目的 id）；缺失返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'recruit', type: 'object', desc: '征兵视图，结构与 RECRUIT 响应相同；status 为 cancelled。' },
  ],
  errors: ['INVALID_PARAMS', 'RECRUIT_NOT_CANCELLABLE'],
  examples: [
    {
      caption: '取消排队中的义兵（资源与人口返还）',
      request: { op: Op.CANCEL_RECRUIT, seq: 1, data: { recruitId: QUEUED_RECRUIT_VIEW.id } },
      responses: [{ op: Op.CANCEL_RECRUIT, seq: 1, ok: true, data: { recruit: { ...QUEUED_RECRUIT_VIEW, status: 'cancelled' } } }],
    },
    {
      caption: '取消已完成的条目被拒',
      request: { op: Op.CANCEL_RECRUIT, seq: 2, data: { recruitId: RECRUIT_VIEW.id } },
      responses: [
        { op: Op.CANCEL_RECRUIT, seq: 2, ok: false, error: { code: 'RECRUIT_NOT_CANCELLABLE', message: '征兵任务不存在、不属于本账号或已完成 / 已取消，无法取消' } },
      ],
    },
  ],
  agentNote: '先 GET_STATE 拿 city.recruitQueue 中条目的 id 再取消（排队中与征募中都可取消）。同账号其他在线连接收到 PUSH_RECRUIT_STATE（recruit_cancelled，以及下一条的 recruit_started）推送。',
};

export const PUSH_RECRUIT_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_RECRUIT_STATE',
  title: '推送：征兵状态变化（v11）',
  summary:
    '征兵状态变化时推送给该账号所有在线连接（发起连接除外）：recruit_started=立即开始或队首被后台激活（含取消在征条目后的下一条）、recruit_queued=进入排队、recruit_completed=完成（兵力累加进城内驻军）、recruit_cancelled=条目被取消（排队或征募中）。完成后的驻军数量变化不逐条推送，用 GET_STATE 对齐或按 city.army 本地累加。',
  dataFields: [
    { name: 'reason', type: "'recruit_started' | 'recruit_queued' | 'recruit_completed' | 'recruit_cancelled'", desc: '触发本次推送的状态变化。' },
    { name: 'recruit', type: 'object', desc: '征兵视图，字段与 RECRUIT 响应的 recruit 相同；完成时 status 为 completed 且 completedAt 非空。' },
  ],
  examples: [
    { op: Op.PUSH_RECRUIT_STATE, push: true, data: { reason: 'recruit_started', recruit: RECRUIT_VIEW } },
    { op: Op.PUSH_RECRUIT_STATE, push: true, data: { reason: 'recruit_completed', recruit: { ...RECRUIT_VIEW, status: 'completed', completedAt: '2026-09-25T08:20:16.500Z' } } },
  ],
  agentNote: '收到 recruit_completed 后把 recruit.count 累加进本地 city.army[recruit.troop]；断线重连用 GET_STATE 对齐。',
};

/** 遣散示例：城内 100 长枪兵，遣散 40 → 城内剩 60，返还 = 单兵成本 × 40 × 50% */
const DISBAND_EXAMPLE_TROOPS = { pikeman: 40 };
/** 示例返还直接调用实现函数，文档数值与代码永远不会漂移 */
const DISBAND_EXAMPLE_REFUND = disbandRefund(DISBAND_EXAMPLE_TROOPS);
/** 示例城池：遣散后的驻军与入账资源（其余字段取开号初始示例） */
const DISBAND_EXAMPLE_CITY = exampleCity({
  army: { ...EMPTY_ARMY, pikeman: 60 } as ArmyCounts,
  armyFoodUsePerHour: TROOP_INFO.pikeman.foodUse * 60,
  resources: { gold: 5000, wood: 3600, food: 3500, stone: 2000, iron: 3000 },
});

export const REQUEST_DISBAND_TROOPS: RequestOpDoc = {
  kind: 'request',
  name: 'DISBAND_TROOPS',
  title: '遣散士兵（解散城内驻军并返还一半征兵资源）',
  preAuth: false,
  summary: `把指定城池（缺省主城）的**城内驻军**按兵种解散（v84，AISLG-209）：请求 troops = { 兵种: 数量 }，**立即生效、没有等待时间**，并返还当初征兵花掉的资源的 ${DISBAND_REFUND_PERCENT}%（金 / 木 / 铁 / 粮 / 石分别计算，石只在冲车等成本里出现，没有就是 0）。每种资源返还 = floor(Σ 单兵征募成本 × 遣散数量 × ${DISBAND_REFUND_PERCENT}%)——多个兵种**先累加再取整一次**（不按兵种逐个取整）。**不返还人口**：人口是征兵时消耗、随民房自然增长的征兵额度，退人口会让「征兵 → 遣散」循环绕开征兵速度上限。返还直接入账该城，不钳储量上限（与 CANCEL_RECRUIT 同口径）。只认该城的城内驻军：在外部队（行军 / 返程 / 运输 / 侦察）、驻守野地的兵、派去盟友城的协防部队都不受影响，要遣散得先召回。该城或其名下野地正有行军在途指向、或有未结的 NPC 来袭时拒绝（CITY_IN_BATTLE，与放弃分城同一判定），否则会变成「躲战损 + 拿回一半资源」的投机；遣散**不受断粮、欠饷、免战状态限制**（断粮时遣散正好是止损手段）。遣散后 armyFoodUsePerHour 立即下降；遣散前先结算到当前时刻，断粮状态下若因此不再断粮，starveAt / mutinyNextAt 会同时清空。玩家与 Agent 都可以发起。`,
  requestFields: [
    {
      name: 'troops',
      type: 'object',
      desc: `必填。要遣散的兵种与数量，形如 { "pikeman": 40, "porter": 200 }：键为兵种（取值同 RECRUIT 的 troop），值为 1..城内该兵种现有数量的正整数。空对象 / 未知兵种 / 0 / 负数 / 小数 / 非对象一律返回 INVALID_PARAMS；某兵种超过城内数量返回 INSUFFICIENT_TROOPS；两种拒绝都不改任何数据。`,
    },
  ],
  dataFields: [
    { name: 'disbanded', type: 'object', desc: '本次实际解散的兵种与数量（= 请求里数量大于 0 的项），如 { "pikeman": 40 }。' },
    { name: 'refunded', type: 'object', desc: `返还的资源 { gold, wood, food, stone, iron }：每种资源 = floor(Σ 单兵成本 × 数量 × ${DISBAND_REFUND_PERCENT}%)，已直接入账 city.resources。不返还人口。` },
    { name: 'city', type: 'object', desc: '遣散后的城池状态，结构与 GET_STATE 的 city 相同（含新的 army / armyFoodUsePerHour / starveAt / mutinyNextAt）。' },
  ],
  errors: ['INVALID_PARAMS', 'INSUFFICIENT_TROOPS', 'CITY_IN_BATTLE'],
  examples: [
    {
      caption: `遣散 40 个长枪兵（城内 100 → 60，返还单兵成本的 ${DISBAND_REFUND_PERCENT}%）`,
      request: { op: Op.DISBAND_TROOPS, seq: 1, data: { troops: DISBAND_EXAMPLE_TROOPS } },
      responses: [
        {
          op: Op.DISBAND_TROOPS,
          seq: 1,
          ok: true,
          data: { disbanded: { ...DISBAND_EXAMPLE_TROOPS }, refunded: DISBAND_EXAMPLE_REFUND, city: DISBAND_EXAMPLE_CITY },
        },
      ],
    },
    {
      caption: '遣散数量超过城内驻军被拒（不改任何数据）',
      request: { op: Op.DISBAND_TROOPS, seq: 2, data: { troops: { pikeman: 200 } } },
      responses: [
        {
          op: Op.DISBAND_TROOPS,
          seq: 2,
          ok: false,
          error: { code: 'INSUFFICIENT_TROOPS', message: '城内兵力不足以派出该编队（或要遣散的数量超过城内驻军）' },
        },
      ],
    },
    {
      caption: '有敌情（行军指向本城 / NPC 来袭未结）时被拒',
      request: { op: Op.DISBAND_TROOPS, seq: 3, data: { troops: { pikeman: 10 } } },
      responses: [
        {
          op: Op.DISBAND_TROOPS,
          seq: 3,
          ok: false,
          error: { code: 'CITY_IN_BATTLE', message: '该城或其名下野地正有行军在途 / 有 NPC 来袭未结，暂不能放弃分城或遣散士兵' },
        },
      ],
    },
  ],
  agentNote: `遣散是「止损与调兵种结构」的手段，不是回血：只拿回 ${DISBAND_REFUND_PERCENT}%，换阵容有真实代价。发起前用 GET_STATE 的 city.army 核对各兵种城内数量（city.inBattle 为 true 时先别发，会被 CITY_IN_BATTLE 拒绝）；响应直接给遣散后的 city，不必再查。同账号其他在线连接会收到 PUSH_CITY_STATE（reason=troops_disbanded），事件流新增 troops_disbanded（detail = { cityId, troops, refunded }）。`,
};

