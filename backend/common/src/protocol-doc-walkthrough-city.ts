// 完整示例会话的第 8 步（v7 城池管理：改名 / 取消排队；v8 起一期不提供建筑拆除）。
// 与主会话（protocol-doc-walkthrough.ts）拆分存放以控制单文件行数；类型也来自该文件。

import { Op } from './protocol';
import { DEFAULT_BUILD_SECONDS } from './rules';
import type { WalkthroughStep } from './protocol-doc-walkthrough';

const CITY_ID = 'c8a1f1de-3b2a-4c5d-8e9f-0a1b2c3d4e5f';
const HOUSE_BUILD_ID = '9e1a88b1-9647-42f0-8b6a-0a2d9e3cb29f';
const HOUSE_QUEUED_AT = '2026-09-25T08:10:30.000Z';
const FARM_UP_BUILD_ID = 'af2b99c2-3758-47a1-98b1-1c0df4dc3c0f';
const FARM_UP_STARTED_AT = '2026-09-25T08:10:00.000Z';
const FARM_UP_DUE_AT = new Date(Date.parse(FARM_UP_STARTED_AT) + DEFAULT_BUILD_SECONDS * 1000).toISOString();

export const CITY_MANAGEMENT_STEP: WalkthroughStep =   {
    title: '8. 城池管理（v7）：改名与取消排队',
    explain:
      '改名立即生效（RENAME_CITY，名称 trim 后 1..24 字符）。升级农田立即开工后，民房进入排队（v4 排队制）；排队条目可随时取消（CANCEL_BUILD），成本按条目快照全额返还（2026-09-27 确认规则），该类型可立即重新发起建造；进行中条目能否取消待定。一期不提供建筑拆除。本连接是唯一在线连接，故没有其他连接的推送帧；有其他在线连接时它们会收到 PUSH_BUILD_STATE（build_cancelled）与 PUSH_CITY_STATE（city_renamed）。',
    frames: [
      {
        kind: 'request',
        conn: '重连后的新连接',
        frame: { op: Op.RENAME_CITY, seq: 4, data: { name: '临江城' } },
      },
      {
        kind: 'response',
        conn: '重连后的新连接',
        frame: { op: Op.RENAME_CITY, seq: 4, ok: true, data: { cityId: CITY_ID, name: '临江城' } },
      },
      {
        kind: 'request',
        conn: '重连后的新连接',
        frame: { op: Op.UPGRADE, seq: 5, data: { kind: 'farm' } },
      },
      {
        kind: 'response',
        conn: '重连后的新连接',
        frame: {
          op: Op.UPGRADE,
          seq: 5,
          ok: true,
          data: {
            build: {
              id: FARM_UP_BUILD_ID,
              kind: 'farm',
              status: 'building',
              level: 2,
              initiator: 'player',
              startedAt: FARM_UP_STARTED_AT,
              dueAt: FARM_UP_DUE_AT,
              completedAt: null,
            },
          },
        },
      },
      {
        kind: 'request',
        conn: '重连后的新连接',
        frame: { op: Op.BUILD, seq: 6, data: { kind: 'house' } },
      },
      {
        kind: 'response',
        conn: '重连后的新连接',
        frame: {
          op: Op.BUILD,
          seq: 6,
          ok: true,
          data: {
            build: {
              id: HOUSE_BUILD_ID,
              kind: 'house',
              status: 'queued',
              level: 1,
              initiator: 'player',
              startedAt: HOUSE_QUEUED_AT,
              dueAt: null,
              completedAt: null,
            },
          },
        },
      },
      {
        kind: 'request',
        conn: '重连后的新连接',
        frame: { op: Op.CANCEL_BUILD, seq: 7, data: { buildId: HOUSE_BUILD_ID } },
      },
      {
        kind: 'response',
        conn: '重连后的新连接',
        frame: {
          op: Op.CANCEL_BUILD,
          seq: 7,
          ok: true,
          data: {
            build: {
              id: HOUSE_BUILD_ID,
              kind: 'house',
              status: 'cancelled',
              level: 1,
              initiator: 'player',
              startedAt: HOUSE_QUEUED_AT,
              dueAt: null,
              completedAt: null,
            },
          },
        },
      },
    ],
  };
