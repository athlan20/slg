// 城池管理类协议的对外文档（CANCEL_BUILD / RENAME_CITY / PUSH_CITY_STATE）。
// 建造与推送类见 protocol-doc-ops-build.ts；账号与查询类及 OP_DOC 汇总见 protocol-doc-ops.ts；
// 共用示例常量见 protocol-doc-shared.ts。

import { Op } from './protocol';
import { INITIAL_RESOURCES } from './rules';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { EMPTY_ARMY } from './protocol-doc-army-consts';
import {
  CANCELLED_BUILD_VIEW,
  CITY_ID,
  INITIAL_BUILDINGS_VIEW,
  INITIAL_LEVELS,
  INITIAL_COSTS,
  INITIAL_POPULATION_VIEW,
  INITIAL_STORAGE,
  QUEUED_BUILD_VIEW,
  INITIAL_PRODUCTION,
  exampleCity,
} from './protocol-doc-shared';

export const REQUEST_CANCEL_BUILD: RequestOpDoc = {
  kind: 'request',
  name: 'CANCEL_BUILD',
  title: '取消排队中的建造条目',
  preAuth: false,
  summary:
    '取消建造队列中 status=queued 的条目：该条目退出队列（status 变为 cancelled，保留为历史，不再出现在 city.queue），发起时扣减的成本按条目上的成本快照全额返还（2026-09-27 确认规则）。进行中（building）条目能否取消待定，当前返回 BUILD_NOT_CANCELLABLE。',
  requestFields: [
    { name: 'buildId', type: 'string', desc: '必填。要取消的建造条目 UUID（GET_STATE 的 city.queue 中排队条目的 id）；缺失返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'build', type: 'object', desc: '建造视图，结构与 BUILD 响应相同；status 为 cancelled。' },
  ],
  errors: ['INVALID_PARAMS', 'BUILD_NOT_CANCELLABLE'],
  examples: [
    {
      caption: '取消排队中的伐木场（成本返还）',
      request: { op: Op.CANCEL_BUILD, seq: 1, data: { buildId: QUEUED_BUILD_VIEW.id } },
      responses: [{ op: Op.CANCEL_BUILD, seq: 1, ok: true, data: { build: CANCELLED_BUILD_VIEW } }],
    },
    {
      caption: '取消在建条目被拒（附当前状态）',
      request: { op: Op.CANCEL_BUILD, seq: 2, data: { buildId: '7c9e6679-7425-40de-944b-e07fc1f90ae7' } },
      responses: [
        {
          op: Op.CANCEL_BUILD,
          seq: 2,
          ok: false,
          error: { code: 'BUILD_NOT_CANCELLABLE', message: '只能取消排队中的建造任务（在建任务能否取消待设计）' },
        },
      ],
    },
  ],
  agentNote:
    '先 GET_STATE 拿 city.queue 中排队条目的 id 再取消。取消后该类型可以立即重新发起 BUILD。同账号其他在线连接会收到 PUSH_BUILD_STATE（build_cancelled）推送。',
};

export const REQUEST_RENAME_CITY: RequestOpDoc = {
  kind: 'request',
  name: 'RENAME_CITY',
  title: '城池改名',
  preAuth: false,
  summary: '为一座城池改名（v7；缺省主城，v24 起可传 cityId 给分城改名）。名称去掉首尾空白后须为 1..24 字符，允许中英文与数字。',
  requestFields: [
    { name: 'name', type: 'string', desc: '必填。新城池名（trim 后 1..24 字符）；缺失、为空或超长返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'cityId', type: 'string', desc: '改名的城池 UUID。' },
    { name: 'name', type: 'string', desc: '新城池名（等于请求的 name 去首尾空白）。' },
  ],
  errors: ['INVALID_PARAMS'],
  examples: [
    {
      caption: '改名成功',
      request: { op: Op.RENAME_CITY, seq: 1, data: { name: '临江城' } },
      responses: [{ op: Op.RENAME_CITY, seq: 1, ok: true, data: { cityId: CITY_ID, name: '临江城' } }],
    },
    {
      caption: '名称为空被拒',
      request: { op: Op.RENAME_CITY, seq: 2, data: { name: '   ' } },
      responses: [
        { op: Op.RENAME_CITY, seq: 2, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } },
      ],
    },
  ],
  agentNote:
    '改名写入事件流（city_renamed），同账号其他在线连接收到 PUSH_CITY_STATE（city_renamed）推送。改名是覆盖式操作，不保留历史名称。',
};

/** 重置完成后的城池视图示例（即开号初始状态；数值引用 rules.ts / shared 常量） */
const RESET_CITY = exampleCity();

export const REQUEST_RESET_ACCOUNT: RequestOpDoc = {
  kind: 'request',
  name: 'RESET_ACCOUNT',
  title: '一键重置账号数据',
  preAuth: false,
  summary:
    '把账号的全部游戏数据重置为开号初始状态：城池名称（回默认「主城」）与数字等级、五种资源、全部建筑与等级、建造队列与历史、人口、事件流全部清空复原，随后写入一条 account_reset 审计事件。v12 起一并清理世界数据：进行中行军清空、占领的野地回到无主、分城删除且其地块转回无主野地（NPC 城池有限存量，不因重置复活）；主城与主城地块保留。会话凭证保留——发起方与其他在线连接不会掉线。重置不可逆且立即生效，请求必须显式携带 confirm=true 防误触。**仅限玩家连接调用**：声明为 Agent 的连接（LOGIN 时 asAgent=true）返回 AGENT_FORBIDDEN——该限制基于自报 role，拦住诚实声明的 Agent，不是可独立验证的安全边界。',
  requestFields: [
    { name: 'confirm', type: 'boolean', desc: '必填且必须为 true；缺失或为 false 返回 INVALID_PARAMS。' },
  ],
  dataFields: [
    { name: 'city', type: 'object', desc: '重置完成后的城池现状（结构同 GET_STATE 的 city，即开号初始状态）。' },
  ],
  errors: ['AGENT_FORBIDDEN', 'INVALID_PARAMS'],
  examples: [
    {
      caption: 'Agent 连接调用被拒',
      request: { op: Op.RESET_ACCOUNT, seq: 1, data: { confirm: true } },
      responses: [
        { op: Op.RESET_ACCOUNT, seq: 1, ok: false, error: { code: 'AGENT_FORBIDDEN', message: '该操作不允许当前连接的登录类型调用（仅限玩家或仅限 Agent，见协议说明）' } },
      ],
    },
    {
      caption: '玩家缺少 confirm 被拒',
      request: { op: Op.RESET_ACCOUNT, seq: 1 },
      responses: [
        { op: Op.RESET_ACCOUNT, seq: 1, ok: false, error: { code: 'INVALID_PARAMS', message: '请求参数缺失或格式不正确' } },
      ],
    },
    {
      caption: '确认重置（回到开号初始状态）',
      request: { op: Op.RESET_ACCOUNT, seq: 2, data: { confirm: true } },
      responses: [{ op: Op.RESET_ACCOUNT, seq: 2, ok: true, data: { city: RESET_CITY } }],
    },
  ],
  agentNote:
    'Agent 连接无权调用（AGENT_FORBIDDEN）：需要重置时向用户说明，由玩家的 player 连接发起；不要改用 player 身份重连绕过。重置后 GET_EVENTS 只剩一条 account_reset 事件（历史已清空）；同账号其他在线连接会收到 PUSH_CITY_STATE（account_reset）推送，收到后本地缓存全部失效。',
};

export const PUSH_CITY_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_CITY_STATE',
  title: '推送：城池级状态变化',
  summary:
    '城池级状态变化时推送给该账号所有在线连接（发起连接除外）：city_renamed=城池改名（RENAME_CITY）、account_reset=账号数据被 RESET_ACCOUNT 重置（v9，重置后全部游戏数据回到开号初始状态）。建造队列相关变化走 PUSH_BUILD_STATE。推送只携带变化摘要，完整现状用 GET_STATE 查询。',
  dataFields: [
    { name: 'reason', type: "'city_renamed' | 'account_reset'", desc: '触发本次推送的状态变化。' },
    { name: 'cityId', type: 'string', desc: '城池 UUID。' },
    { name: 'name', type: 'string', desc: 'reason=city_renamed 时的新城池名。' },
  ],
  examples: [
    {
      op: Op.PUSH_CITY_STATE,
      push: true,
      data: { reason: 'city_renamed', cityId: CITY_ID, name: '临江城' },
    },
    {
      op: Op.PUSH_CITY_STATE,
      push: true,
      data: { reason: 'account_reset', cityId: CITY_ID },
    },
  ],
  agentNote: '收到 account_reset 后本地缓存全部失效，立即用 GET_STATE 重新对齐（历史事件也已清空）。',
};
