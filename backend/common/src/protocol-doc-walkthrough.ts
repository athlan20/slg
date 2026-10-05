// 完整示例会话（文档「完整示例会话」一节数据）：与 scripts/smoke.ts 的验收路径同构——
// 玩家登录 → Agent 登录 → 发起建造 → 到期完成 → 断线重连按需查询。
// 玩家与 Agent 是两条连接，各自维护独立的 seq 序列；示例数值引用 rules.ts 常量。

import { atBaseTimeScale } from './time-scale';
import { Op, type ClientFrame, type PushFrame, type ResponseFrame } from './protocol';
import { BUILDING_INFO, DEFAULT_BUILD_SECONDS, FARM_COST, INITIAL_RESOURCES, applyCost } from './rules';
import { productionPerHour } from './production';
import { CITY_MANAGEMENT_STEP } from './protocol-doc-walkthrough-city';
import { EMPTY_ARMY } from './protocol-doc-army-consts';
import {
  FARM_LUMBER_COSTS as SHARED_FARM_LUMBER_COSTS,
  FARM_LUMBER_STORAGE,
  INITIAL_BUILDINGS_VIEW,
  INITIAL_COSTS as SHARED_INITIAL_COSTS,
  INITIAL_LEVELS,
  INITIAL_POPULATION_VIEW,
  INITIAL_PRODUCTION,
  INITIAL_STORAGE,
  exampleCity,
} from './protocol-doc-shared';

const ACCOUNT_ID = '0d3d8e2a-6f2b-4f4e-9d8f-1a2b3c4d5e6f';
const CITY_ID = 'c8a1f1de-3b2a-4c5d-8e9f-0a1b2c3d4e5f';
const BUILD_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const USERNAME = 'example-player';
/** 示例令牌：玩家的会话令牌（43 字符随机串形态） */
const PLAYER_TOKEN = 'session-example-token-for-doc-0000000000000';
/** 示例令牌：Agent 连接登录获得自己的另一枚令牌（一账号多会话，互不顶替） */
const AGENT_TOKEN = 'agent-connection-token-example-000000000000';
const TOKEN_EXPIRES_AT = '2026-10-25T08:00:00.000Z';

const BUILD_STARTED_AT = '2026-09-25T08:01:00.000Z';
const BUILD_DUE_AT = new Date(Date.parse(BUILD_STARTED_AT) + DEFAULT_BUILD_SECONDS * 1000).toISOString();
const BUILD_COMPLETED_AT = '2026-09-25T08:02:03.000Z';
const AFTER_COST = applyCost(INITIAL_RESOURCES, FARM_COST);
const AFTER_TWO_COSTS = applyCost(AFTER_COST, BUILDING_INFO.lumber_mill.cost);
const FARM_LUMBER_PRODUCTION = atBaseTimeScale(() => productionPerHour({ ...INITIAL_LEVELS, farm: 1, lumber_mill: 1 }));
const LUMBER_BUILD_ID = '8d0f7790-8536-51ef-a5ef-f18bd2a01b8f';
const LUMBER_QUEUED_AT = '2026-09-25T08:01:30.000Z';
const LUMBER_DUE_AT = '2026-09-25T08:03:03.000Z';
const INITIAL_COSTS = SHARED_INITIAL_COSTS;
const FARM_LUMBER_COSTS = SHARED_FARM_LUMBER_COSTS;

export type WalkthroughFrameKind = 'request' | 'response' | 'push';

export interface WalkthroughFrame {
  kind: WalkthroughFrameKind;
  /** 帧所在/到达的连接，如「玩家连接」「Agent 连接」「重连后的新连接」 */
  conn: string;
  frame: ClientFrame | ResponseFrame | PushFrame;
}

export interface WalkthroughStep {
  title: string;
  explain: string;
  frames: WalkthroughFrame[];
}

export const WALKTHROUGH: WalkthroughStep[] = [
  {
    title: '1. 建立连接',
    explain: '连接 WebSocket（本地开发 ws://127.0.0.1:8080/ws），并在时限内完成登录，否则服务端以 close code 4001 断开。玩家与 Agent 各建一条连接。',
    frames: [],
  },
  {
    title: '2. 玩家密码登录（仅已有账号，v48 起新用户名不再自动注册）',
    explain: '玩家身份用用户名 + 密码登录已有账号。不存在的用户名返回 SIGNUP_CLOSED——密码通道已关闭自动注册，新账号只能经第三方登录（Google / GitHub / 微信扫码）在网页上创建。成功响应签发会话令牌（sessionToken），持久保存后可用于免密自动登录。',
    frames: [
      {
        kind: 'request',
        conn: '玩家连接',
        frame: { op: Op.LOGIN, seq: 1, data: { username: USERNAME, password: 'example-pass-123', asAgent: false } },
      },
      {
        kind: 'response',
        conn: '玩家连接',
        frame: {
          op: Op.LOGIN,
          seq: 1,
          ok: true,
          data: {
            accountId: ACCOUNT_ID,
            username: USERNAME,
            role: 'player',
            sessionToken: PLAYER_TOKEN,
            expiresAt: TOKEN_EXPIRES_AT,
          },
        },
      },
      {
        kind: 'request',
        conn: '玩家连接',
        frame: { op: Op.LOGIN, seq: 2, data: { username: 'never-registered', password: 'example-pass-123', asAgent: false } },
      },
      {
        kind: 'response',
        conn: '玩家连接',
        frame: {
          op: Op.LOGIN,
          seq: 2,
          ok: false,
          error: { code: 'SIGNUP_CLOSED', message: '该用户名不存在：密码登录不再支持注册，请用 Google / GitHub 登录创建账号' },
        },
      },
    ],
  },
  {
    title: '3. 玩家查询初始城池',
    explain: '开号之初自带 1 级官府（自动产金 100×等级/小时，v19）、人口 50 与初始资源（五资源各 2000，v24 上调，见术语表「开号之初」）；无民房时人口上限为 0，建民房后恢复增长。读取时服务端会把产量与人口结算进状态。v7 起视图带城池等级、人口与储量上限字段。',
    frames: [
      { kind: 'request', conn: '玩家连接', frame: { op: Op.GET_STATE, seq: 2 } },
      {
        kind: 'response',
        conn: '玩家连接',
        frame: {
          op: Op.GET_STATE,
          seq: 2,
          ok: true,
          data: {
            city: exampleCity(),
          },
        },
      },
    ],
  },
  {
    title: '4. Agent 用玩家的永久令牌登录（v47：不能用账号密码）',
    explain: 'Agent 与玩家看同一座城（同一账号），但 Agent **不能用账号密码登录**（任何站都一样，返回 AGENT_PASSWORD_FORBIDDEN）：玩家在网页「复制给 AI」的提示词里自带永久令牌（sk_ 前缀、永不过期、expiresAt 为 null），Agent 用它 LOGIN {token, asAgent: true}，player 连接保留自己的会话令牌、两者不互相顶替。Agent 上线会写事件并向账号在线连接推送状态（玩家连接收到 online=true）。',
    frames: [
      {
        kind: 'request',
        conn: 'Agent 连接',
        frame: { op: Op.LOGIN, seq: 1, data: { token: AGENT_TOKEN, asAgent: true } },
      },
      {
        kind: 'response',
        conn: 'Agent 连接',
        frame: {
          op: Op.LOGIN,
          seq: 1,
          ok: true,
          data: {
            accountId: ACCOUNT_ID,
            username: USERNAME,
            role: 'agent',
            sessionToken: AGENT_TOKEN,
            expiresAt: null,
          },
        },
      },
      {
        kind: 'push',
        conn: '玩家连接',
        frame: { op: Op.PUSH_AGENT_STATUS, push: true, data: { online: true, at: '2026-09-25T08:00:10.123Z' } },
      },
    ],
  },
  {
    title: '5. Agent 发起农田建造（立即开工），玩家把伐木场加入队列',
    explain: `用 BUILD 指定建筑类型（四种资源生产建筑通用入口）。无在建时立即扣减成本开工（此处农田，金 ${FARM_COST.gold} / 木 ${FARM_COST.wood}），直接结果回发起连接，同账号其他连接收到 build_started 推送，其中 build.initiator 标明发起者。已有在建时改入队（v4 排队制）：响应 status=queued、dueAt 为 null，队首完成后由后台自动激活。`,
    frames: [
      { kind: 'request', conn: 'Agent 连接', frame: { op: Op.BUILD, seq: 2, data: { kind: 'farm' } } },
      {
        kind: 'response',
        conn: 'Agent 连接',
        frame: {
          op: Op.BUILD,
          seq: 2,
          ok: true,
          data: {
            build: {
              id: BUILD_ID,
              kind: 'farm',
              status: 'building',
              level: 1,
              initiator: 'agent',
              startedAt: BUILD_STARTED_AT,
              dueAt: BUILD_DUE_AT,
              completedAt: null,
            },
          },
        },
      },
      {
        kind: 'push',
        conn: '玩家连接',
        frame: {
          op: Op.PUSH_BUILD_STATE,
          push: true,
          data: {
            reason: 'build_started',
            build: {
              id: BUILD_ID,
              kind: 'farm',
              status: 'building',
              level: 1,
              initiator: 'agent',
              startedAt: BUILD_STARTED_AT,
              dueAt: BUILD_DUE_AT,
              completedAt: null,
            },
          },
        },
      },
      { kind: 'request', conn: '玩家连接', frame: { op: Op.BUILD, seq: 2, data: { kind: 'lumber_mill' } } },
      {
        kind: 'response',
        conn: '玩家连接',
        frame: {
          op: Op.BUILD,
          seq: 2,
          ok: true,
          data: {
            build: {
              id: LUMBER_BUILD_ID,
              kind: 'lumber_mill',
              status: 'queued',
              level: 1,
              initiator: 'player',
              startedAt: LUMBER_QUEUED_AT,
              dueAt: null,
              completedAt: null,
            },
          },
        },
      },
      {
        kind: 'push',
        conn: 'Agent 连接',
        frame: {
          op: Op.PUSH_BUILD_STATE,
          push: true,
          data: {
            reason: 'build_queued',
            build: {
              id: LUMBER_BUILD_ID,
              kind: 'lumber_mill',
              status: 'queued',
              level: 1,
              initiator: 'player',
              startedAt: LUMBER_QUEUED_AT,
              dueAt: null,
              completedAt: null,
            },
          },
        },
      },
    ],
  },
  {
    title: '6. 到期完成，双连接收到推送；队首自动激活',
    explain: '后台 Worker 在到期后结算并落库：农田完成推送（build_completed）发给账号所有在线连接；同一事务里把队首的伐木场激活为 building（重算 startedAt / dueAt）并推送 build_started。伐木场到期后同样收到 build_completed（帧略）。',
    frames: [
      {
        kind: 'push',
        conn: 'Agent 连接',
        frame: {
          op: Op.PUSH_BUILD_STATE,
          push: true,
          data: {
            reason: 'build_started',
            build: {
              id: LUMBER_BUILD_ID,
              kind: 'lumber_mill',
              status: 'building',
              level: 1,
              initiator: 'player',
              startedAt: BUILD_COMPLETED_AT,
              dueAt: LUMBER_DUE_AT,
              completedAt: null,
            },
          },
        },
      },
      {
        kind: 'push',
        conn: '玩家连接',
        frame: {
          op: Op.PUSH_BUILD_STATE,
          push: true,
          data: {
            reason: 'build_completed',
            build: {
              id: BUILD_ID,
              kind: 'farm',
              status: 'completed',
              level: 1,
              initiator: 'agent',
              startedAt: BUILD_STARTED_AT,
              dueAt: BUILD_DUE_AT,
              completedAt: BUILD_COMPLETED_AT,
            },
          },
        },
      },
      {
        kind: 'push',
        conn: 'Agent 连接',
        frame: {
          op: Op.PUSH_BUILD_STATE,
          push: true,
          data: {
            reason: 'build_completed',
            build: {
              id: BUILD_ID,
              kind: 'farm',
              status: 'completed',
              level: 1,
              initiator: 'agent',
              startedAt: BUILD_STARTED_AT,
              dueAt: BUILD_DUE_AT,
              completedAt: BUILD_COMPLETED_AT,
            },
          },
        },
      },
    ],
  },
  {
    title: '7. 断线重连后用会话令牌自动登录，按需查询',
    explain: '断线期间错过的推送不会补发。重连后用持久保存的会话令牌免密登录（无需用户名密码，令牌同时滑动续期）；令牌失效时会收到 SESSION_INVALID，此时回落密码登录。登录后用 GET_STATE 对齐现状（农田与伐木场均已建成、队列清空、产量生效、资源含离线累积），用 GET_EVENTS 拉历史。',
    frames: [
      {
        kind: 'request',
        conn: '重连后的新连接',
        frame: { op: Op.LOGIN, seq: 1, data: { token: PLAYER_TOKEN, asAgent: false } },
      },
      {
        kind: 'response',
        conn: '重连后的新连接',
        frame: {
          op: Op.LOGIN,
          seq: 1,
          ok: true,
          data: {
            accountId: ACCOUNT_ID,
            username: USERNAME,
            role: 'player',
            sessionToken: PLAYER_TOKEN,
            expiresAt: TOKEN_EXPIRES_AT,
          },
        },
      },
      { kind: 'request', conn: '重连后的新连接', frame: { op: Op.GET_STATE, seq: 2 } },
      {
        kind: 'response',
        conn: '重连后的新连接',
        frame: {
          op: Op.GET_STATE,
          seq: 2,
          ok: true,
          data: {
            city: exampleCity({
              resources: AFTER_TWO_COSTS,
              buildings: { ...INITIAL_BUILDINGS_VIEW, farm: 1, lumber_mill: 1 },
              levels: { ...INITIAL_LEVELS, farm: 1, lumber_mill: 1 },
              costs: FARM_LUMBER_COSTS,
              farms: 1,
              production: { ...FARM_LUMBER_PRODUCTION },
              storage: FARM_LUMBER_STORAGE,
            }),
          },
        },
      },
      { kind: 'request', conn: '重连后的新连接', frame: { op: Op.GET_EVENTS, seq: 3, data: { limit: 20 } } },
      {
        kind: 'response',
        conn: '重连后的新连接',
        frame: {
          op: Op.GET_EVENTS,
          seq: 3,
          ok: true,
          data: {
            events: [
              {
                id: 105,
                type: 'build_completed',
                initiator: 'player',
                cityId: CITY_ID,
                buildId: LUMBER_BUILD_ID,
                detail: { kind: 'lumber_mill', level: 1 },
                createdAt: '2026-09-25T08:03:04.000Z',
              },
              {
                id: 104,
                type: 'build_started',
                initiator: 'player',
                cityId: CITY_ID,
                buildId: LUMBER_BUILD_ID,
                detail: { kind: 'lumber_mill', fromQueue: true },
                createdAt: BUILD_COMPLETED_AT,
              },
              {
                id: 103,
                type: 'build_completed',
                initiator: 'agent',
                cityId: CITY_ID,
                buildId: BUILD_ID,
                detail: { kind: 'farm', level: 1 },
                createdAt: BUILD_COMPLETED_AT,
              },
              {
                id: 102,
                type: 'build_queued',
                initiator: 'player',
                cityId: CITY_ID,
                buildId: LUMBER_BUILD_ID,
                detail: { kind: 'lumber_mill', cost: BUILDING_INFO.lumber_mill.cost },
                createdAt: LUMBER_QUEUED_AT,
              },
              {
                id: 101,
                type: 'build_started',
                initiator: 'agent',
                cityId: CITY_ID,
                buildId: BUILD_ID,
                detail: { kind: 'farm', cost: FARM_COST },
                createdAt: BUILD_STARTED_AT,
              },
            ],
          },
        },
      },
    ],
  },
  CITY_MANAGEMENT_STEP,
  {
    title: '9. 登出（吊销会话令牌）',
    explain:
      'LOGOUT 吊销本连接登录所用的令牌，服务端随即关闭连接（close code 1000）；客户端应同时清除本地保存的令牌。此后用该令牌登录会收到 SESSION_INVALID，需回落密码登录。',
    frames: [
      { kind: 'request', conn: '重连后的新连接', frame: { op: Op.LOGOUT, seq: 9 } },
      { kind: 'response', conn: '重连后的新连接', frame: { op: Op.LOGOUT, seq: 9, ok: true, data: {} } },
    ],
  },
];
