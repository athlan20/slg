// 征兵类协议的对外文档（RECRUIT / CANCEL_RECRUIT / PUSH_RECRUIT_STATE，v11）。
// 账号与查询类见 protocol-doc-ops.ts；建造类见 protocol-doc-ops-build.ts；
// 城池管理类见 protocol-doc-ops-city.ts；共用示例常量见 protocol-doc-shared.ts。

import { Op, TROOP_KINDS } from './protocol';
import { TROOP_INFO, RECRUIT_COUNT_MAX } from './troops';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { CITY_ID } from './protocol-doc-shared';

const TROOP_TYPE = TROOP_KINDS.map((kind) => `'${kind}'`).join(' | ');

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
  summary: `在当前城池的军营征募士兵（v11）。每种兵有解锁所需的军营等级（未达返回 TROOP_NOT_AVAILABLE）与单兵成本；每次征募 1..${RECRUIT_COUNT_MAX} 人，成本 = 单兵成本 × 数量、人口 = 单兵人口 × 数量，**发起时立即扣减资源与人口**（取消排队条目时全额返还）。征兵队列独立于建造队列：无征募中时立即开始（status=recruiting，dueAt 为预计完成时间，时长 = max(1 秒, floor(单兵基准时长 × 数量 ÷ time_scale))——**1 秒下限作用于批次总时长**而非单兵，**结果向下取整到整秒**（v22 修复 AISLG-39，与建造/升级同模型；显式验证环境变量覆盖时不再缩放）），有征募中且排队未满（当前 2 条，占位）时入队，队满返回 RECRUIT_QUEUE_FULL。资源不足返回 INSUFFICIENT_RESOURCES（v22 起附 shortfall 缺口与 retryAfterSeconds——按当前净产量推导，等满后重发必然成功），人口不足返回 INSUFFICIENT_POPULATION（v22 起附 shortfall 与 retryAfterSeconds——按人口增速推导），失败响应附当前城池状态（**data 仅含 city，无 recruit 载荷**——客户端必须先判 ok 再取载荷）。玩家与 Agent 均可发起。当前兵种：${TROOP_SUMMARY}（均为占位数值）。军队耗粮已接入（v14）：单兵 foodUse 计入城池净产量，城内 1 倍、行军/野地驻军 2 倍（见 GET_STATE 的 armyFoodUsePerHour），断粮仅停止增长；战斗属性随战斗玩法设计。`,
  requestFields: [
    { name: 'troop', type: TROOP_TYPE, desc: '必填。兵种（一期七种 + v33 二期四种：铁骑兵 iron_cavalry 军营 11 级 / 辎重车 supply_wagon 军营 3 级 / 床弩 ballista 军营 7 级 / 冲车 siege_ram 军营 8 级）；缺失或不是已知兵种返回 INVALID_PARAMS。' },
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
  errors: ['INVALID_PARAMS', 'TROOP_NOT_AVAILABLE', 'INSUFFICIENT_RESOURCES', 'INSUFFICIENT_POPULATION', 'RECRUIT_QUEUE_FULL'],
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
    '发起前用 GET_STATE 的 levels.barracks 对照兵种门槛、resources 与 population 预判；失败响应的 data 仅含 city（无 recruit 载荷）。征募中条目能否取消待定，当前只能取消排队条目。同账号其他在线连接会收到 PUSH_RECRUIT_STATE（recruit_started / recruit_queued）推送。',
};

export const REQUEST_CANCEL_RECRUIT: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_RECRUIT',
  title: '取消排队中的征兵条目',
  preAuth: false,
  summary:
    '取消征兵队列中 status=queued 的条目：该条目退出队列（status 变为 cancelled，保留为历史），发起时扣减的资源与人口按条目快照全额返还（人口立即回到城池、恢复增长）。征募中（recruiting）条目能否取消待定，当前返回 RECRUIT_NOT_CANCELLABLE。',
  requestFields: [
    { name: 'recruitId', type: 'string', desc: '必填。要取消的征兵条目 UUID（GET_STATE 的 city.recruitQueue 中排队条目的 id）；缺失返回 INVALID_PARAMS。' },
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
      caption: '取消征募中条目被拒',
      request: { op: Op.CANCEL_RECRUIT, seq: 2, data: { recruitId: RECRUIT_VIEW.id } },
      responses: [
        { op: Op.CANCEL_RECRUIT, seq: 2, ok: false, error: { code: 'RECRUIT_NOT_CANCELLABLE', message: '只能取消排队中的征兵任务（征募中能否取消待设计）' } },
      ],
    },
  ],
  agentNote: '先 GET_STATE 拿 city.recruitQueue 中排队条目的 id 再取消。同账号其他在线连接收到 PUSH_RECRUIT_STATE（recruit_cancelled）推送。',
};

export const PUSH_RECRUIT_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_RECRUIT_STATE',
  title: '推送：征兵状态变化（v11）',
  summary:
    '征兵状态变化时推送给该账号所有在线连接（发起连接除外）：recruit_started=立即开始或队首被后台激活、recruit_queued=进入排队、recruit_completed=完成（兵力累加进城内驻军）、recruit_cancelled=排队条目被取消。完成后的驻军数量变化不逐条推送，用 GET_STATE 对齐或按 city.army 本地累加。',
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
