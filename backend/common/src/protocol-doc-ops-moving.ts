// 移动目标协议的对外文档（GET_MOVING_TARGETS / PUSH_MOVING_TARGET_STATE，v28，AISLG-78）。
// 截击发起走 MARCH 的 targetId（见 protocol-doc-ops-world.ts）。数值引用 moving-target.ts 的真实常量。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { STARTED_AT } from './protocol-doc-shared';
import {
  ACTIVE_PLAYER_WINDOW_HOURS,
  BANDIT_PLUNDER_HOURS,
  INTERCEPT_REACH,
  MOVING_KIND_INFO,
  MOVING_LIFETIME_HOURS,
  MOVING_TARGETS_MAX,
  MOVING_TARGETS_MIN,
  MOVING_TARGETS_PER_ACTIVE_PLAYER,
  ROUTE_STEPS,
} from './moving-target';

const TARGET_ID = '9b2f7a10-3c4d-4e5f-8a6b-7c8d9e0f1a2b';
const START_MS = Date.parse(STARTED_AT);
const STEP_MS = Math.floor((MOVING_LIFETIME_HOURS * 3_600_000) / ROUTE_STEPS);

const TARGET_VIEW = {
  id: TARGET_ID,
  kind: 'caravan',
  label: MOVING_KIND_INFO.caravan.label,
  level: 2,
  status: 'active',
  startedAt: STARTED_AT,
  endsAt: new Date(START_MS + MOVING_LIFETIME_HOURS * 3_600_000).toISOString(),
  stepSeconds: STEP_MS / 1000,
  position: { x: 20, y: 31, index: 0 },
  route: [
    { x: 20, y: 31, at: STARTED_AT },
    { x: 21, y: 32, at: new Date(START_MS + STEP_MS).toISOString() },
    '（共 24 格，其余略）',
  ],
  garrisonTotal: { min: 8, max: 12 },
  stockTotal: { min: 9600, max: 14400 },
} as const;

export const REQUEST_GET_MOVING_TARGETS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_MOVING_TARGETS',
  title: '查询移动目标（流寇与运粮商队，v28，AISLG-78）',
  preAuth: false,
  summary: `地图上会周期性刷出两类沿固定路线移动、过时消失的 NPC 目标：**运粮商队**（${MOVING_KIND_INFO.caravan.note}）与**流寇**（${MOVING_KIND_INFO.bandit.note}）。本协议返回当前存在的全部目标：当前位置、公开路线与时刻表（路线共 ${ROUTE_STEPS} 格，第 i 格从 route[i].at 起占据、到 route[i+1].at 止；最后一格持续到 endsAt）、守军与携带量的**大致范围**（真实 ±20%，要精确情报派斥候去目标所在格）。存在时长基准 ${MOVING_LIFETIME_HOURS} 小时（随全局时间缩放）；全图同时存在的数量随活跃玩家数（最近 ${ACTIVE_PLAYER_WINDOW_HOURS} 小时内登录过的账号）调整：⌈人数 × ${MOVING_TARGETS_PER_ACTIVE_PLAYER}⌉ 夹在 [${MOVING_TARGETS_MIN}, ${MOVING_TARGETS_MAX}]，没有活跃玩家时不刷新。流寇路过玩家占领的野地时会顺手掠夺该地「小时产量（占领加成 + 驻军采集）」的 ${BANDIT_PLUNDER_HOURS} 倍（不超过城内存量，被掠方收到 bandit_plundered 事件），掠到的记在流寇携带量里，截获流寇即可夺回。数值均为占位，上线后按数据调整。`,
  requestFields: [],
  dataFields: [
    { name: 'targets', type: 'array', desc: '当前存在的移动目标，按截止时刻升序；每项 { id, kind: caravan|bandit, label, level 1..5, status: active, startedAt, endsAt 存在截止, stepSeconds 每格停留秒数, position 当前所在格 { x, y, index } 或 null, route 公开时刻表 [{ x, y, at }], garrisonTotal { min, max }, stockTotal { min, max } }。' },
  ],
  errors: [],
  examples: [
    {
      caption: '查询当前所有移动目标',
      request: { op: Op.GET_MOVING_TARGETS, seq: 16, data: {} },
      responses: [{ op: Op.GET_MOVING_TARGETS, seq: 16, ok: true, data: { targets: [TARGET_VIEW] } }],
    },
  ],
  agentNote: `截击流程（v35 起「到了先埋伏」）：先 GET_MOVING_TARGETS 看时刻表，挑一格 route[i] 与出发城估算行军时长。部队到达时目标还在该格或相邻格（Chebyshev 距离 ≤ ${INTERCEPT_REACH}）→ 到达即接战；还没到 → 部队原地埋伏，等目标走进相邻范围再开打（接战时刻 = max(到达时刻, 目标进入范围的时刻，即发起后 MARCH 响应的 arriveAt，无需掐点）；已走远（太晚）→ 扑空返程。埋伏期间部队占校场名额、按在外口径耗粮，可 RECALL_MARCH 撤回；目标被他人击败或过时消失 → 「目标消失」返程。守军精确编成要靠 SCOUT 侦察目标当前所在格（侦察到的是该格地块，不含移动目标本身——目标的大致强度见 garrisonTotal）。刷出 / 被截获 / 消失会收到 PUSH_MOVING_TARGET_STATE，也可以定时重查。`,
};

export const PUSH_MOVING_TARGET_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_MOVING_TARGET_STATE',
  title: '推送：移动目标刷出 / 被截获 / 消失（v28，AISLG-78）',
  summary: '移动目标新刷出、被玩家截获或过时消失时，推送给当前全部在线连接（全服广播，无账号维度）。载荷里的 target 与 GET_MOVING_TARGETS 的 targets[] 同结构（reason=defeated / expired 时 status 已变更）。',
  dataFields: [
    { name: 'reason', type: "'spawned' | 'defeated' | 'expired'", desc: '刷出 / 被截获消失 / 过时消失。' },
    { name: 'target', type: 'object', desc: '移动目标视图（结构同 GET_MOVING_TARGETS 的 targets[]）。' },
  ],
  examples: [{ op: Op.PUSH_MOVING_TARGET_STATE, push: true, data: { reason: 'spawned', target: TARGET_VIEW } }],
  agentNote: '推送可能漏收（网络抖动 / 重连），用 GET_MOVING_TARGETS 重查对齐；截获事件对「谁截获的」不做公开。',
};
