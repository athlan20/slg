// 洛阳争夺（v79，AISLG-200）的对外协议文档：查询洛阳状态 / 发布政令。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { STARTED_AT } from './protocol-doc-shared';
import {
  LUOYANG_ASSIST_CAP,
  LUOYANG_BONUS_PERCENT,
  LUOYANG_END_HOUR,
  LUOYANG_START_HOUR,
  DECREE_KINDS,
} from './luoyang';

const RULES =
  `洛阳是 8 座名城之一，仍是占领者的分城；占领者所在联盟成为「洛阳之主」，占领者本人是「洛阳太守」。` +
  `洛阳被玩家占领后，只在每周六 ${LUOYANG_START_HOUR}:00–${LUOYANG_END_HOUR}:00（北京时间，现实时间）可以被攻打 / 侦察；` +
  `窗口外返回 LUOYANG_CLOSED（附 nextOpenAt）。窗口内洛阳没有被动免战、城防值不回涨，每次打赢按现有规则扣城防，归零换主；` +
  `窗口结束时城防回满并进入保护。洛阳可接收 ${LUOYANG_ASSIST_CAP} 支协防（普通城 5 支），盟友 / 友盟都能协防。` +
  `洛阳之主联盟全员所有城的粮木石铁产量 +${LUOYANG_BONUS_PERCENT}%（与名城 / 科技 / 城守同一百分比池相加）。` +
  `盟主每 7 天可以发布一道政令（三选一，持续 7 天）：征兵时长 −15% / 行军速度 +10% / 科技研究时长 −15%；洛阳易主时旧政令立即失效。` +
  `赛季结束时占有洛阳的联盟进入名人堂，结算时在盟成员每人获得 10,000 金币与四资源各 50,000。` +
  `窗口预告 / 开始 / 结束、洛阳易主、政令发布都有全服播报，并在相关联盟频道发系统消息。`;

const STATUS = {
  owner: {
    cityId: '5b1c3d2e-4f60-4a71-8c82-3d4e5f6a7b80',
    cityName: '洛阳',
    accountId: '6f1e2d3c-4b5a-4978-8c6d-5e4f3a2b1c0d',
    username: 'alice',
    allianceId: '9b2f4c1a-6d3e-4f80-9a71-2c5e8d4b6a10',
    allianceName: '卧龙盟',
    durability: 65,
  },
  windowOpen: false,
  windowStartAt: '2026-10-31T13:00:00.000Z',
  windowEndAt: '2026-10-31T15:00:00.000Z',
  nextOpenAt: '2026-10-31T13:00:00.000Z',
  bonusPercent: LUOYANG_BONUS_PERCENT,
  assistCap: LUOYANG_ASSIST_CAP,
  decree: { kind: 'recruit', until: '2026-11-03T04:00:00.000Z', nextAt: '2026-11-03T04:00:00.000Z', canPublish: false, leaderName: 'alice' },
  canPublishDecree: false,
  decreeNextAt: '2026-11-03T04:00:00.000Z',
  myAllianceIsHolder: true,
} as const;

export const REQUEST_GET_LUOYANG: RequestOpDoc = {
  kind: 'request',
  name: 'GET_LUOYANG',
  title: '查询洛阳争夺状态（v79，AISLG-200）',
  preAuth: false,
  summary: `${RULES} 本协议返回洛阳占领者、争夺窗口、洛阳之主联盟加成与当前政令；玩家与 Agent 通用。`,
  requestFields: [],
  dataFields: [
    { name: 'owner', type: 'object | null', desc: '洛阳当前占领者（玩家分城）：{ cityId, cityName, accountId, username, allianceId, allianceName, durability }；NPC 阶段为 null。' },
    { name: 'windowOpen / windowStartAt / windowEndAt / nextOpenAt', type: 'boolean / string', desc: '当前是否在争夺窗口、本次窗口起止、下一次开放时刻（北京时间周六 21:00–23:00）。' },
    { name: 'bonusPercent', type: 'number', desc: `洛阳之主联盟全员的四资源产量加成（当前 ${LUOYANG_BONUS_PERCENT}）；不是洛阳之主为 0。` },
    { name: 'assistCap', type: 'number', desc: `洛阳可接收的协防部队上限（当前 ${LUOYANG_ASSIST_CAP}）。` },
    { name: 'decree', type: 'object | null', desc: '生效中的政令：{ kind: recruit|march|research, until, nextAt, canPublish, leaderName }；没有为 null。' },
    { name: 'canPublishDecree / decreeNextAt / myAllianceIsHolder', type: 'boolean / string / boolean', desc: '我是否能发政令、下次可发时刻、我所在联盟是否洛阳之主。' },
  ],
  errors: [],
  examples: [
    {
      caption: '洛阳由卧龙盟占领，本周窗口未开，征兵政令生效中',
      request: { op: Op.GET_LUOYANG, seq: 70, data: {} },
      responses: [{ op: Op.GET_LUOYANG, seq: 70, ok: true, data: STATUS }],
    },
  ],
  agentNote: '窗口外不要对洛阳发起掠夺 / 占领 / 侦察（LUOYANG_CLOSED）。窗口内洛阳无被动免战、城防不回涨；攻方要有空分城名额。洛阳之主盟员可享受 +5% 产量，盟主每 7 天可发政令。',
};

export const REQUEST_PUBLISH_DECREE: RequestOpDoc = {
  kind: 'request',
  name: 'PUBLISH_DECREE',
  title: '发布洛阳政令（v79，AISLG-200）',
  preAuth: false,
  summary: `${RULES} 仅洛阳之主联盟的盟主（玩家连接）可发布；每 7 天一次，持续 7 天，三选一（${DECREE_KINDS.join(' / ')}）。发布后全服播报并在联盟频道发系统消息。`,
  requestFields: [{ name: 'kind', type: "'recruit' | 'march' | 'research'", desc: '政令：征兵时长 −15% / 行军速度 +10% / 科技研究时长 −15%。' }],
  dataFields: [{ name: '（同 GET_LUOYANG）', type: 'object', desc: '发布后的洛阳状态（含新政令）。' }],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN', 'DECREE_NOT_HOLDER', 'DECREE_COOLDOWN'],
  examples: [
    {
      caption: '发布征兵政令',
      request: { op: Op.PUBLISH_DECREE, seq: 71, data: { kind: 'recruit' } },
      responses: [{ op: Op.PUBLISH_DECREE, seq: 71, ok: true, data: STATUS }],
    },
  ],
  agentNote: '管理操作需要玩家盟主本人；Agent 只能查询 GET_LUOYANG。政令到期后自动失效，冷却按发布时刻 +7 天。',
};
