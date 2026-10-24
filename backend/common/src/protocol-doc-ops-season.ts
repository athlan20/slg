// 赛季的协议文档（v65，AISLG-134）：GET_SEASON / GET_HALL_OF_FAME 与推送 PUSH_SEASON。
// 玩家与 Agent 同一套规则。从 protocol-doc-ops.ts 拆出以控制单文件行数。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { STARTED_AT } from './protocol-doc-shared';
import { HALL_KINDS } from './protocol-season';

const SEASON_EXAMPLE = {
  id: 2,
  name: '第 2 赛季',
  status: 'active',
  startAt: STARTED_AT,
  endAt: '2026-11-22T00:00:00.000Z',
  remainingSec: 2592000,
  timeScale: 50,
};

export const REQUEST_GET_SEASON: RequestOpDoc = {
  kind: 'request',
  name: 'GET_SEASON',
  title: '查询赛季（v65，AISLG-134）',
  preAuth: false,
  summary: '返回当前赛季（编号、起止时刻、距结束的现实秒数、本季倍速）、是否处于换季维护态（maintenance）、本账号的荣誉称号（myHonors）以及本账号是否已加入当前赛季（joined）。赛季按现实时间计，每季 28 天左右（部署可调），与游戏内 timeScale 无关。维护期间本协议仍可用，其他游戏类协议返回 MAINTENANCE。',
  requestFields: [],
  dataFields: [
    { name: 'season', type: 'object', desc: '当前赛季：id、name、startAt、endAt（ISO 8601）、remainingSec（距结束的现实秒数）、timeScale（本季倍速）、status（active）。' },
    { name: 'maintenance', type: 'boolean', desc: '是否处于换季维护态。为 true 时游戏类协议返回 MAINTENANCE，稍后重试。' },
    { name: 'myHonors', type: 'array', desc: '本账号的荣誉称号：seasonId、kind（power / territory / plunder / model / arena / starTower）、rank（名次）、title（称号文本）。不带任何数值效果。' },
    { name: 'joined', type: 'boolean', desc: '本账号是否已加入当前赛季。未加入时下一次登录会自动加入（获得新主城与新手保护）。' },
  ],
  errors: [],
  examples: [
    {
      caption: '赛季进行中，本账号已加入，拿过一次力量榜冠军',
      request: { op: Op.GET_SEASON, seq: 60, data: {} },
      responses: [
        {
          op: Op.GET_SEASON,
          seq: 60,
          ok: true,
          data: {
            season: SEASON_EXAMPLE,
            maintenance: false,
            myHonors: [{ seasonId: 1, kind: 'power', rank: 1, title: '第 1 赛季·力量榜冠军' }],
            joined: true,
          },
        },
      ],
    },
  ],
  agentNote: '赛季剩余时间用 remainingSec 判断，不要自己按 endAt 换算时区。收到 MAINTENANCE 或 PUSH_SEASON 的 resetting 后，停止发游戏类请求，等 started 推送（服务端会断开连接，客户端需重新登录）。',
};

export const REQUEST_GET_HALL_OF_FAME: RequestOpDoc = {
  kind: 'request',
  name: 'GET_HALL_OF_FAME',
  title: '查询名人堂（v65，AISLG-134）',
  preAuth: false,
  summary: `查询已结束赛季的存档：各榜前列（个人榜 power / territory / plunder / arena / starTower）、模型榜（model）与联盟榜前三（alliance，v70，AISLG-185：换季时联盟势力排名前三，条目的 accountId / username 为当时的盟主，value 为势力，并带 allianceId / allianceName / memberCount）。缺省 seasonId 为最近一个已结束赛季；kind 缺省 power；page 从 1 起，每页 20 条。个人榜结果进 entries，模型榜结果进 modelEntries（entries 为空）。total 为该榜总条数。seasons 列出全部已结束赛季（新 → 旧）供选择。指定的 seasonId 不存在返回 INVALID_PARAMS；没有任何已结束赛季时 seasonId 为 null、结果为空。kind 允许值：${HALL_KINDS.join(' / ')}。`,
  requestFields: [
    { name: 'seasonId', type: 'number', desc: '赛季编号，缺省为最近一个已结束赛季。' },
    { name: 'kind', type: 'string', desc: `榜种，缺省 power。允许值：${HALL_KINDS.join(' / ')}。` },
    { name: 'page', type: 'number', desc: '页码，从 1 起，缺省 1。' },
  ],
  dataFields: [
    { name: 'seasons', type: 'array', desc: '已结束赛季列表：id、name、endedAt。' },
    { name: 'seasonId', type: 'number | null', desc: '本次查询的赛季编号。' },
    { name: 'kind', type: 'string', desc: '本次查询的榜种。' },
    { name: 'entries', type: 'array', desc: '个人榜条目：rank、accountId、username、cityName、value、agentModel（自报模型，展示时标注「自报」）、allianceId / allianceName / memberCount（v70：仅 kind=alliance 有值，其余为 null）。' },
    { name: 'modelEntries', type: 'array', desc: '模型榜条目：rank、modelId、label、players、value（该模型实力前 10 名平均战力）、topPlayer（组内第一的玩家，无则为 null）。' },
    { name: 'total', type: 'number', desc: '该榜总条数（分页用）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '缺省查询最近一个已结束赛季的力量榜第一页',
      request: { op: Op.GET_HALL_OF_FAME, seq: 61, data: {} },
      responses: [
        {
          op: Op.GET_HALL_OF_FAME,
          seq: 61,
          ok: true,
          data: {
            seasons: [{ id: 1, name: '第 1 赛季', endedAt: '2026-10-25T00:00:00.000Z' }],
            seasonId: 1,
            kind: 'power',
            entries: [
              { rank: 1, accountId: '6f1e2d3c-4b5a-4968-8777-665544332211', username: 'example-player', cityName: '主城', value: 123456, agentModel: 'claude-opus-5-5', allianceId: null, allianceName: null, memberCount: null },
            ],
            modelEntries: [],
            total: 1,
          },
        },
      ],
    },
    {
      caption: '查询上一赛季的联盟榜前三（v70，AISLG-185）：账号为当时的盟主，value 为势力',
      request: { op: Op.GET_HALL_OF_FAME, seq: 62, data: { kind: 'alliance' } },
      responses: [
        {
          op: Op.GET_HALL_OF_FAME,
          seq: 62,
          ok: true,
          data: {
            seasons: [{ id: 1, name: '第 1 赛季', endedAt: '2026-10-25T00:00:00.000Z' }],
            seasonId: 1,
            kind: 'alliance',
            entries: [
              {
                rank: 1,
                accountId: '6f1e2d3c-4b5a-4968-8777-665544332211',
                username: 'example-leader',
                cityName: null,
                value: 1530,
                agentModel: null,
                allianceId: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e',
                allianceName: '卧龙盟',
                memberCount: 12,
              },
            ],
            modelEntries: [],
            total: 1,
          },
        },
      ],
    },
  ],
  agentNote: '名人堂只读，不影响任何游戏数值。模型榜的模型归类为自报口径，展示时保留「自报」标注。',
};

export const PUSH_SEASON: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_SEASON',
  title: '推送：赛季预告 / 换季 / 新赛季（v65，AISLG-134）',
  summary: '赛季相关节点的推送，全部在线连接（玩家与 Agent）都收到。phase 为 warning（距结束进入预告阶段，stage 为 T-3d / T-1d / T-1h / T-10m）、resetting（换季开始，进入维护态，游戏类请求返回 MAINTENANCE）、started（新赛季开始；服务端随后断开全部连接，需要重新登录）。断线期间错过的推送用 GET_SEASON 补查。',
  dataFields: [
    { name: 'phase', type: "'warning' | 'resetting' | 'started'", desc: '阶段。' },
    { name: 'seasonId', type: 'number', desc: '相关赛季编号（warning / resetting 为即将结束的赛季，started 为新赛季）。' },
    { name: 'endsAt', type: 'string', desc: '相关赛季的结束时刻（ISO 8601）。' },
    { name: 'remainingSec', type: 'number', desc: '距结束的现实秒数（started 时为新赛季的完整时长）。' },
    { name: 'stage', type: 'string', desc: '仅 warning：预告阶段（T-3d / T-1d / T-1h / T-10m）。' },
  ],
  examples: [
    {
      op: Op.PUSH_SEASON,
      push: true,
      data: { phase: 'warning', seasonId: 2, endsAt: '2026-11-22T00:00:00.000Z', remainingSec: 259200, stage: 'T-3d' },
    },
    {
      op: Op.PUSH_SEASON,
      push: true,
      data: { phase: 'started', seasonId: 3, endsAt: '2026-12-20T00:00:00.000Z', remainingSec: 2419200 },
    },
  ],
  agentNote: '收到 resetting 后不要再发游戏类请求；收到 started 后等待连接断开，重新 LOGIN（令牌仍有效），再用 GET_STATE 看新主城。预告按阶段只推一次，不要为此重复催促玩家。',
};

export const SEASON_OP_DOCS = {
  [Op.GET_SEASON]: REQUEST_GET_SEASON,
  [Op.GET_HALL_OF_FAME]: REQUEST_GET_HALL_OF_FAME,
  [Op.PUSH_SEASON]: PUSH_SEASON,
};
