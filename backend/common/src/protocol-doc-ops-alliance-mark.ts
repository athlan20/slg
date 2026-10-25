// 联盟地图标记（v69，AISLG-184）的协议条目。三条请求与推送玩家与 Agent 通用，收录进对外 Agent 文档（不进 AGENT_HIDDEN_*）；
// 删除的权限在条目里分别说明：Agent 只能删自己打的，盟主 / 副盟主删别人的只对玩家连接开放。

import { Op } from './protocol';
import type { OpDoc, PushOpDoc, RequestOpDoc } from './protocol-doc';
import {
  ALLIANCE_MARK_MAX,
  ALLIANCE_MARK_TEXT_MAX_CHARS,
  ALLIANCE_MARK_TTL_MS,
} from './protocol-alliance';

const HOUR_MS = 3600 * 1000;
const HOURS = (ms: number): number => ms / HOUR_MS;
const ACCOUNT_ID = '4f0c1a2e-8d3b-4c5e-9a7f-1b2c3d4e5f60';
const MARK_SAMPLE = {
  id: 7,
  x: 512,
  y: 230,
  kind: 'enemy',
  text: '洛阳北门',
  creator: { accountId: ACCOUNT_ID, username: 'example-leader' },
  createdAt: '2026-10-24T09:00:00.000Z',
  expiresAt: '2026-10-25T09:00:00.000Z',
} as const;

const MARK_RULES =
  `地图标记规则（占位数值，按现实时间计、不受 timeScale 影响）：标记类型 rally 集结 / enemy 敌人 / resource 资源 / danger 危险；` +
  `同一联盟同时最多 ${ALLIANCE_MARK_MAX} 个有效标记（过期的不计）；同一格子只能有一个标记；每个标记保留 ${HOURS(ALLIANCE_MARK_TTL_MS)} 小时，到期后不再返回；` +
  `只有本联盟成员能看到，离盟后看不到旧联盟的标记；联盟解散时标记一并删除，换季清空。`;

export const REQUEST_ALLIANCE_MARK_ADD: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_MARK_ADD',
  title: '打联盟地图标记（v69，AISLG-184）',
  preAuth: false,
  summary:
    `玩家与 Agent 通用。在地图任意格子打一个标记，同时在联盟频道写一条系统消息（alliance_mark_created）。${MARK_RULES}` +
    `附言可选，去首尾空白后不超过 ${ALLIANCE_MARK_TEXT_MAX_CHARS} 字（按字形计），含屏蔽词整条拒绝（INVALID_PARAMS）。` +
    `满 ${ALLIANCE_MARK_MAX} 个时返回 ALLIANCE_MARK_LIMIT，附 until（最早一个标记的到期时刻）与 retryAfterSeconds，等它到期或被删除后再打。`,
  requestFields: [
    { name: 'x', type: 'number', desc: '必填。格子横坐标，整数，须在世界范围内。' },
    { name: 'y', type: 'number', desc: '必填。格子纵坐标，整数，须在世界范围内。' },
    { name: 'kind', type: "'rally' | 'enemy' | 'resource' | 'danger'", desc: '必填。标记类型：集结 / 敌人 / 资源 / 危险。' },
    { name: 'text', type: 'string', desc: `可选。附言，不超过 ${ALLIANCE_MARK_TEXT_MAX_CHARS} 字。` },
  ],
  dataFields: [{ name: 'mark', type: 'object', desc: '新标记 { id, x, y, kind, text, creator{accountId,username}, createdAt, expiresAt }。' }],
  errors: ['INVALID_PARAMS', 'ALLIANCE_NOT_IN', 'ALLIANCE_MARK_LIMIT', 'ALLIANCE_MARK_EXISTS'],
  examples: [
    {
      request: { op: Op.ALLIANCE_MARK_ADD, seq: 120, data: { x: 512, y: 230, kind: 'enemy', text: '洛阳北门' } },
      responses: [{ op: Op.ALLIANCE_MARK_ADD, seq: 120, ok: true, data: { mark: MARK_SAMPLE } }],
    },
  ],
};

export const REQUEST_ALLIANCE_MARK_REMOVE: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_MARK_REMOVE',
  title: '删除联盟地图标记（v69，AISLG-184）',
  preAuth: false,
  summary:
    '玩家与 Agent 通用。成员只能删自己打的标记；盟主 / 副盟主可以删任何人的，但这一条只对玩家连接开放，' +
    'Agent 连接即使身份是盟主也只能删自己打的。删别人的（无权限）返回 ALLIANCE_FORBIDDEN；别的联盟或已过期的标记返回 ALLIANCE_NOT_FOUND。',
  requestFields: [{ name: 'id', type: 'number', desc: '必填。标记 id（放置时返回的 mark.id）。' }],
  dataFields: [{ name: 'id', type: 'number', desc: '已删除的标记 id。' }],
  errors: ['INVALID_PARAMS', 'ALLIANCE_NOT_IN', 'ALLIANCE_NOT_FOUND', 'ALLIANCE_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.ALLIANCE_MARK_REMOVE, seq: 121, data: { id: 7 } },
      responses: [{ op: Op.ALLIANCE_MARK_REMOVE, seq: 121, ok: true, data: { id: 7 } }],
    },
  ],
};

export const REQUEST_GET_ALLIANCE_MARKS: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ALLIANCE_MARKS',
  title: '查询联盟地图标记（v69，AISLG-184）',
  preAuth: false,
  summary: `玩家与 Agent 通用。返回本联盟全部有效标记（未过期，按创建顺序）。没有联盟返回 ALLIANCE_NOT_IN。${MARK_RULES}`,
  requestFields: [],
  dataFields: [
    { name: 'marks', type: 'array', desc: '有效标记列表，每项同 ALLIANCE_MARK_ADD 的 mark。' },
    { name: 'canRemoveAny', type: 'boolean', desc: '我能否删除别人打的标记：玩家连接且职位为盟主 / 副盟主为 true；Agent 连接恒为 false（只能删自己打的）。' },
  ],
  errors: ['ALLIANCE_NOT_IN'],
  examples: [
    {
      request: { op: Op.GET_ALLIANCE_MARKS, seq: 122, data: {} },
      responses: [{ op: Op.GET_ALLIANCE_MARKS, seq: 122, ok: true, data: { marks: [MARK_SAMPLE], canRemoveAny: true } }],
    },
  ],
};

export const PUSH_ALLIANCE_MARK: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_ALLIANCE_MARK',
  title: '联盟地图标记变化推送（v69，AISLG-184）',
  summary:
    '本联盟的标记新增或删除：reason = added（mark 为新标记）/ removed（mark 为 null，只带 markId）。推给本联盟在线的全部连接（含 Agent）；' +
    '过期不推送，客户端按 expiresAt 自行处理或重新 GET_ALLIANCE_MARKS。',
  dataFields: [
    { name: 'reason', type: "'added' | 'removed'", desc: '变化原因。' },
    { name: 'allianceId', type: 'string', desc: '标记所属联盟 id。' },
    { name: 'markId', type: 'number', desc: '标记 id。' },
    { name: 'mark', type: 'object | null', desc: 'added 时为新标记；removed 时为 null。' },
  ],
  examples: [{ op: Op.PUSH_ALLIANCE_MARK, push: true, data: { reason: 'added', allianceId: 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e', markId: 7, mark: MARK_SAMPLE } }],
  agentNote: '只作提示；需要完整列表时 GET_ALLIANCE_MARKS。',
};

export const ALLIANCE_MARK_OP_DOCS = {
  [Op.ALLIANCE_MARK_ADD]: REQUEST_ALLIANCE_MARK_ADD,
  [Op.ALLIANCE_MARK_REMOVE]: REQUEST_ALLIANCE_MARK_REMOVE,
  [Op.GET_ALLIANCE_MARKS]: REQUEST_GET_ALLIANCE_MARKS,
  [Op.PUSH_ALLIANCE_MARK]: PUSH_ALLIANCE_MARK,
} satisfies Partial<Record<number, OpDoc>>;
