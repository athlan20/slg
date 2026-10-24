// 联盟（v66，AISLG-181 / AISLG-143）的协议条目。GET_ALLIANCE / LIST_ALLIANCES / PUSH_ALLIANCE_STATE 玩家与 Agent 通用，
// 收录进对外 Agent 文档；创建与管理类协议仅限玩家连接，对外 Agent 文档不收录（protocol-doc-render.ts 按
// AGENT_HIDDEN_OPS / AGENT_HIDDEN_ERROR_CODES 过滤），这里仍写全条目，保证 OP_DOC 与协议号一一对应。

import { Op, type ErrorCode } from './protocol';
import type { OpDoc, PushOpDoc, RequestOpDoc } from './protocol-doc';
import {
  ALLIANCE_COOLDOWN_MS,
  ALLIANCE_CREATE_COST_GOLD,
  ALLIANCE_CREATE_MIN_GOVERNMENT,
  ALLIANCE_INVITE_TTL_MS,
  ALLIANCE_LEADER_INACTIVE_MS,
  ALLIANCE_LIST_PAGE_SIZE,
  ALLIANCE_MAX_MEMBERS,
  ALLIANCE_MAX_VICES,
  ALLIANCE_NAME_MAX_CHARS,
  ALLIANCE_NAME_MIN_CHARS,
  ALLIANCE_NOTICE_MAX_CHARS,
  ALLIANCE_POWER_FAMOUS_WEIGHT,
  ALLIANCE_POWER_GOVERNMENT_WEIGHT,
  ALLIANCE_POWER_TERRITORY_WEIGHT,
  ALLIANCE_RANK_MIN_MEMBERS,
  ALLIANCE_REQUEST_TTL_MS,
} from './protocol-alliance';

const PLAYER_ONLY = '**仅限玩家连接**：Agent 连接调用返回 AGENT_FORBIDDEN。';
const HOUR_MS = 3600 * 1000;
const LEADER_ID = '4f0c1a2e-8d3b-4c5e-9a7f-1b2c3d4e5f60';
const MEMBER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
const ALLIANCE_ID = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';
const HOURS = (ms: number): number => ms / HOUR_MS;

const BRIEF_SAMPLE = {
  id: ALLIANCE_ID,
  name: '卧龙盟',
  leader: { accountId: LEADER_ID, username: 'example-leader' },
  memberCount: 2,
  maxMembers: ALLIANCE_MAX_MEMBERS,
  createdAt: '2026-10-24T08:00:00.000Z',
} as const;

const DETAIL_SAMPLE = {
  ...BRIEF_SAMPLE,
  notice: '本周六晚集结打洛阳',
  power: 1530,
  rank: 1,
  members: [
    {
      accountId: LEADER_ID, username: 'example-leader', role: 'leader', governmentLevel: 8, territoryCount: 6,
      joinedAt: '2026-10-24T08:00:00.000Z', lastActiveAt: '2026-10-24T09:30:00.000Z', online: true,
    },
    {
      accountId: MEMBER_ID, username: 'example-member', role: 'member', governmentLevel: 4, territoryCount: 2,
      joinedAt: '2026-10-24T08:20:00.000Z', lastActiveAt: null, online: false,
    },
  ],
} as const;

const MY_VIEW_SAMPLE = {
  alliance: DETAIL_SAMPLE,
  myRole: 'leader',
  cooldownUntil: null,
  myRequest: null,
  myInvites: [],
  requests: [],
  sentInvites: [],
} as const;

const RULES =
  `联盟规则（数值为占位，上线后按数据调整，均按现实时间计、不受 timeScale 影响）：创建需主城官府 ≥ ${ALLIANCE_CREATE_MIN_GOVERNMENT} 级并从主城扣 ${ALLIANCE_CREATE_COST_GOLD} 金币；` +
  `联盟名 ${ALLIANCE_NAME_MIN_CHARS}–${ALLIANCE_NAME_MAX_CHARS} 字、全服唯一（忽略大小写）、过屏蔽词；一个账号只能在一个联盟；成员上限 ${ALLIANCE_MAX_MEMBERS}（待处理邀请也占名额）；` +
  `盟主 1 人、副盟主最多 ${ALLIANCE_MAX_VICES} 人；退出 / 被踢 / 解散者 ${HOURS(ALLIANCE_COOLDOWN_MS)} 小时内不能创建也不能加入联盟；` +
  `盟主 ${HOURS(ALLIANCE_LEADER_INACTIVE_MS) / 24} 天没有活跃，系统自动转给最近活跃的副盟主（没有副盟主则转给最早入盟的成员）。`;

export const REQUEST_CREATE_ALLIANCE: RequestOpDoc = {
  kind: 'request',
  name: 'CREATE_ALLIANCE',
  title: '创建联盟（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}创建联盟并成为盟主。${RULES}`,
  requestFields: [{ name: 'name', type: 'string', desc: `必填。联盟名，去首尾空白后 ${ALLIANCE_NAME_MIN_CHARS}–${ALLIANCE_NAME_MAX_CHARS} 字，不含空白与控制字符。` }],
  dataFields: [
    { name: 'allianceId', type: 'string', desc: '新联盟 id。' },
    { name: 'cost', type: 'number', desc: '本次从主城扣除的金币。' },
  ],
  errors: [
    'INVALID_PARAMS', 'AGENT_FORBIDDEN', 'ALLIANCE_NAME_INVALID', 'ALLIANCE_NAME_TAKEN', 'ALLIANCE_ALREADY_IN',
    'ALLIANCE_COOLDOWN', 'ALLIANCE_GOVERNMENT_TOO_LOW', 'INSUFFICIENT_RESOURCES',
  ],
  examples: [
    {
      request: { op: Op.CREATE_ALLIANCE, seq: 101, data: { name: '卧龙盟' } },
      responses: [{ op: Op.CREATE_ALLIANCE, seq: 101, ok: true, data: { allianceId: ALLIANCE_ID, cost: ALLIANCE_CREATE_COST_GOLD } }],
    },
  ],
};

export const REQUEST_GET_ALLIANCE: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ALLIANCE',
  title: '查询联盟（v66，AISLG-181）',
  preAuth: false,
  summary:
    '玩家与 Agent 通用。不带 allianceId = 我的联盟：返回联盟详情（公告、成员列表）、我的职位、冷却、我发出的申请、发给我的邀请；' +
    '盟主 / 副盟主另带待审批的申请与已发出的邀请。带 allianceId = 查看某个联盟的公开信息（公告与成员列表，不含申请 / 邀请）。' +
    `过期（${HOURS(ALLIANCE_REQUEST_TTL_MS)} 小时）的申请与邀请不会返回。${RULES}`,
  requestFields: [{ name: 'allianceId', type: 'string', desc: '可选。联盟 id（UUID）；缺省查看我的联盟。' }],
  dataFields: [
    { name: 'alliance', type: 'object | null', desc: `联盟详情 { id, name, leader{accountId,username}, memberCount, maxMembers, createdAt, notice, members[], power 联盟势力（v70，现算：全体成员占领的野地数 × ${ALLIANCE_POWER_TERRITORY_WEIGHT} + 名城数 × ${ALLIANCE_POWER_FAMOUS_WEIGHT} + 成员主城官府等级之和 × ${ALLIANCE_POWER_GOVERNMENT_WEIGHT}）, rank 联盟榜名次（v70：取最近一次榜单快照；成员不足 ${ALLIANCE_RANK_MIN_MEMBERS} 人或未上榜为 null） }；没有联盟为 null。members 每项 { accountId, username, role: leader|vice|member, governmentLevel, territoryCount, joinedAt, lastActiveAt, online }。` },
    { name: 'myRole', type: "'leader' | 'vice' | 'member' | null", desc: '我在该联盟的职位；没有联盟或查看别人的联盟为 null。' },
    { name: 'cooldownUntil', type: 'string | null', desc: '冷却截止（ISO 8601）；不在冷却中为 null。冷却中不能创建也不能加入联盟。' },
    { name: 'myRequest', type: 'object | null', desc: '我发出的待处理申请 { alliance（联盟概要）, createdAt, expiresAt }；同一时间只有 1 条。' },
    { name: 'myInvites', type: 'array', desc: `发给我的待处理邀请，每项 { alliance（联盟概要）, inviter{accountId,username}, createdAt, expiresAt }（有效期 ${HOURS(ALLIANCE_INVITE_TTL_MS)} 小时）。` },
    { name: 'requests', type: 'array', desc: '待审批的入盟申请 { accountId, username, governmentLevel, createdAt, expiresAt }；仅盟主 / 副盟主查看自己的联盟时有内容，其余为空数组。' },
    { name: 'sentInvites', type: 'array', desc: '已发出的待处理邀请 { accountId, username, inviter, createdAt, expiresAt }；可见范围同 requests。' },
  ],
  errors: ['INVALID_PARAMS', 'ALLIANCE_NOT_FOUND'],
  examples: [
    {
      caption: '我的联盟（我是盟主）',
      request: { op: Op.GET_ALLIANCE, seq: 102, data: {} },
      responses: [{ op: Op.GET_ALLIANCE, seq: 102, ok: true, data: MY_VIEW_SAMPLE }],
    },
  ],
  agentNote: '只能查询。创建、申请、审批、踢人、转让、任免等管理类操作只能由玩家本人做，Agent 调用会得到 AGENT_FORBIDDEN。',
};

export const REQUEST_LIST_ALLIANCES: RequestOpDoc = {
  kind: 'request',
  name: 'LIST_ALLIANCES',
  title: '联盟列表（v66，AISLG-181）',
  preAuth: false,
  summary: `玩家与 Agent 通用。按成员数降序（同数按创建时间）分页返回联盟概要，每页 ${ALLIANCE_LIST_PAGE_SIZE} 条。`,
  requestFields: [{ name: 'page', type: 'number', desc: '可选。页码，从 1 起，缺省 1。' }],
  dataFields: [
    { name: 'alliances', type: 'array', desc: '联盟概要 { id, name, leader{accountId,username}, memberCount, maxMembers, createdAt }。' },
    { name: 'page', type: 'number', desc: '当前页码。' },
    { name: 'total', type: 'number', desc: '联盟总数。' },
  ],
  errors: [],
  examples: [
    {
      request: { op: Op.LIST_ALLIANCES, seq: 103, data: { page: 1 } },
      responses: [{ op: Op.LIST_ALLIANCES, seq: 103, ok: true, data: { alliances: [BRIEF_SAMPLE], page: 1, total: 1 } }],
    },
  ],
};

export const REQUEST_ALLIANCE_APPLY: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_APPLY',
  title: '申请加入联盟 / 撤回申请（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}向联盟发出入盟申请，由盟主或副盟主审批；同一时间只能有 1 条待处理申请（要换联盟先撤回），${HOURS(ALLIANCE_REQUEST_TTL_MS)} 小时未处理自动过期。cancel=true 撤回我对该联盟的申请。联盟已满（成员 + 待处理邀请 ≥ ${ALLIANCE_MAX_MEMBERS}）不能申请。`,
  requestFields: [
    { name: 'allianceId', type: 'string', desc: '必填。联盟 id（UUID）。' },
    { name: 'cancel', type: 'boolean', desc: '可选。true = 撤回申请。' },
  ],
  dataFields: [
    { name: 'allianceId', type: 'string', desc: '申请的联盟 id（申请时返回）。' },
    { name: 'expiresAt', type: 'string', desc: '申请过期时刻（申请时返回）。' },
    { name: 'cancelled', type: 'boolean', desc: '撤回时为 true。' },
  ],
  errors: [
    'INVALID_PARAMS', 'AGENT_FORBIDDEN', 'ALLIANCE_NOT_FOUND', 'ALLIANCE_ALREADY_IN', 'ALLIANCE_COOLDOWN',
    'ALLIANCE_REQUEST_EXISTS', 'ALLIANCE_FULL',
  ],
  examples: [
    {
      request: { op: Op.ALLIANCE_APPLY, seq: 104, data: { allianceId: ALLIANCE_ID } },
      responses: [{ op: Op.ALLIANCE_APPLY, seq: 104, ok: true, data: { allianceId: ALLIANCE_ID, expiresAt: '2026-10-26T08:00:00.000Z' } }],
    },
  ],
};

export const REQUEST_ALLIANCE_INVITE: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_INVITE',
  title: '邀请玩家入盟 / 撤回邀请（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}盟主或副盟主按昵称邀请玩家；被邀请人用 ALLIANCE_RESPOND 接受或拒绝。待处理邀请占成员名额（成员 + 待处理邀请 ≤ ${ALLIANCE_MAX_MEMBERS}）；重复邀请同一人是覆盖；${HOURS(ALLIANCE_INVITE_TTL_MS)} 小时未答复自动过期。cancel=true 撤回对该玩家的邀请。`,
  requestFields: [
    { name: 'username', type: 'string', desc: '必填。被邀请玩家的昵称（精确匹配）。' },
    { name: 'cancel', type: 'boolean', desc: '可选。true = 撤回邀请。' },
  ],
  dataFields: [
    { name: 'accountId', type: 'string', desc: '被邀请玩家的账号 id（邀请时返回）。' },
    { name: 'expiresAt', type: 'string', desc: '邀请过期时刻（邀请时返回）。' },
    { name: 'cancelled', type: 'boolean', desc: '撤回时为 true。' },
  ],
  errors: [
    'INVALID_PARAMS', 'AGENT_FORBIDDEN', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN', 'ALLIANCE_NOT_FOUND',
    'ALLIANCE_ALREADY_IN', 'ALLIANCE_FULL',
  ],
  examples: [
    {
      request: { op: Op.ALLIANCE_INVITE, seq: 105, data: { username: 'example-member' } },
      responses: [{ op: Op.ALLIANCE_INVITE, seq: 105, ok: true, data: { accountId: MEMBER_ID, expiresAt: '2026-10-26T08:00:00.000Z' } }],
    },
  ],
};

export const REQUEST_ALLIANCE_RESPOND: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_RESPOND',
  title: '答复入盟申请或邀请（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}kind=request：盟主 / 副盟主审批别人发来的申请（给 accountId = 申请人）；kind=invite：我答复发给我的邀请（给 allianceId）。accept=true 同意（同意后申请人 / 我立刻成为普通成员，并清掉其余申请与邀请），false 拒绝。`,
  requestFields: [
    { name: 'kind', type: "'request' | 'invite'", desc: '必填。答复申请还是邀请。' },
    { name: 'accountId', type: 'string', desc: 'kind=request 必填：申请人的账号 id。' },
    { name: 'allianceId', type: 'string', desc: 'kind=invite 必填：发出邀请的联盟 id。' },
    { name: 'accept', type: 'boolean', desc: '必填。true 同意 / 接受，false 拒绝。' },
  ],
  dataFields: [{ name: 'accepted', type: 'boolean', desc: '本次是否同意 / 接受。' }],
  errors: [
    'INVALID_PARAMS', 'AGENT_FORBIDDEN', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN', 'ALLIANCE_NOT_FOUND',
    'ALLIANCE_ALREADY_IN', 'ALLIANCE_COOLDOWN', 'ALLIANCE_FULL',
  ],
  examples: [
    {
      caption: '盟主同意一条申请',
      request: { op: Op.ALLIANCE_RESPOND, seq: 106, data: { kind: 'request', accountId: MEMBER_ID, accept: true } },
      responses: [{ op: Op.ALLIANCE_RESPOND, seq: 106, ok: true, data: { accepted: true } }],
    },
  ],
};

export const REQUEST_ALLIANCE_LEAVE: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_LEAVE',
  title: '退出联盟（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}退出当前联盟，随后 ${HOURS(ALLIANCE_COOLDOWN_MS)} 小时内不能创建也不能加入联盟。盟主在盟里还有其他成员时不能直接退出（ALLIANCE_LEADER_MUST_TRANSFER），须先用 ALLIANCE_SET_ROLE 转让或 ALLIANCE_DISBAND 解散；盟里只剩盟主一人时退出等于解散。`,
  requestFields: [],
  dataFields: [{ name: 'disbanded', type: 'boolean', desc: '是否因为盟里只剩盟主一人而解散了联盟。' }],
  errors: ['AGENT_FORBIDDEN', 'ALLIANCE_NOT_IN', 'ALLIANCE_LEADER_MUST_TRANSFER'],
  examples: [
    {
      request: { op: Op.ALLIANCE_LEAVE, seq: 107, data: {} },
      responses: [{ op: Op.ALLIANCE_LEAVE, seq: 107, ok: true, data: { disbanded: false } }],
    },
  ],
};

export const REQUEST_ALLIANCE_DISBAND: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_DISBAND',
  title: '解散联盟（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}仅盟主。解散后全部成员离盟、申请与邀请作废；盟主本人进入 ${HOURS(ALLIANCE_COOLDOWN_MS)} 小时冷却，其他成员不进冷却。`,
  requestFields: [],
  dataFields: [],
  errors: ['AGENT_FORBIDDEN', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN'],
  examples: [{ request: { op: Op.ALLIANCE_DISBAND, seq: 108, data: {} }, responses: [{ op: Op.ALLIANCE_DISBAND, seq: 108, ok: true, data: {} }] }],
};

export const REQUEST_ALLIANCE_KICK: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_KICK',
  title: '踢出成员（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}盟主可踢副盟主和普通成员，副盟主只能踢普通成员；不能踢盟主，不能踢自己。立即生效，被踢者进入 ${HOURS(ALLIANCE_COOLDOWN_MS)} 小时冷却。`,
  requestFields: [{ name: 'accountId', type: 'string', desc: '必填。被踢成员的账号 id。' }],
  dataFields: [],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN', 'ALLIANCE_NOT_FOUND'],
  examples: [{ request: { op: Op.ALLIANCE_KICK, seq: 109, data: { accountId: MEMBER_ID } }, responses: [{ op: Op.ALLIANCE_KICK, seq: 109, ok: true, data: {} }] }],
};

export const REQUEST_ALLIANCE_SET_ROLE: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_SET_ROLE',
  title: '任免副盟主 / 转让盟主（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}仅盟主。role=vice 任命副盟主（最多 ${ALLIANCE_MAX_VICES} 人），role=member 撤销副盟主，role=leader 把盟主转让给该成员（原盟主降为普通成员，对象可以是任意成员）。目标必须在本联盟，且不能是自己。`,
  requestFields: [
    { name: 'accountId', type: 'string', desc: '必填。目标成员的账号 id。' },
    { name: 'role', type: "'vice' | 'member' | 'leader'", desc: '必填。目标职位。' },
  ],
  dataFields: [],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN', 'ALLIANCE_NOT_FOUND', 'ALLIANCE_ROLE_FULL'],
  examples: [
    {
      request: { op: Op.ALLIANCE_SET_ROLE, seq: 110, data: { accountId: MEMBER_ID, role: 'vice' } },
      responses: [{ op: Op.ALLIANCE_SET_ROLE, seq: 110, ok: true, data: {} }],
    },
  ],
};

export const REQUEST_ALLIANCE_SET_NOTICE: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_SET_NOTICE',
  title: '修改联盟公告（v66，AISLG-181）',
  preAuth: false,
  summary: `${PLAYER_ONLY}盟主或副盟主修改公告；去首尾空白后不超过 ${ALLIANCE_NOTICE_MAX_CHARS} 字（按字形计），可为空（清空）；屏蔽词整段替换成 *。`,
  requestFields: [{ name: 'notice', type: 'string', desc: '必填。公告文字。' }],
  dataFields: [{ name: 'notice', type: 'string', desc: '过滤后实际保存的公告。' }],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.ALLIANCE_SET_NOTICE, seq: 111, data: { notice: '本周六晚集结打洛阳' } },
      responses: [{ op: Op.ALLIANCE_SET_NOTICE, seq: 111, ok: true, data: { notice: '本周六晚集结打洛阳' } }],
    },
  ],
};

export const PUSH_ALLIANCE_STATE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_ALLIANCE_STATE',
  title: '联盟状态变化推送（v66，AISLG-181）',
  summary:
    '联盟里与你相关的变化：reason = joined（有人入盟 / 你入盟）/ left（有人退出）/ kicked（有人被踢，含你被踢）/ role_changed（职位或盟主变更）/ disbanded（联盟解散）/ notice（公告更新）/ ' +
    'request_received（盟主 / 副盟主收到新申请）/ request_resolved（你的申请被拒绝）/ invited（你收到邀请）。推给相关账号的全部在线连接（含 Agent）；收到后重新 GET_ALLIANCE 取最新状态即可。',
  dataFields: [
    { name: 'reason', type: 'string', desc: '变化原因，见上。' },
    { name: 'allianceId', type: 'string | null', desc: '相关联盟 id。' },
    { name: 'allianceName', type: 'string | null', desc: '相关联盟名。' },
  ],
  examples: [{ op: Op.PUSH_ALLIANCE_STATE, push: true, data: { reason: 'joined', allianceId: ALLIANCE_ID, allianceName: '卧龙盟' } }],
  agentNote: '只作提示，不必逐条处理；需要时 GET_ALLIANCE 查看最新状态。',
};

export const ALLIANCE_OP_DOCS = {
  [Op.CREATE_ALLIANCE]: REQUEST_CREATE_ALLIANCE,
  [Op.GET_ALLIANCE]: REQUEST_GET_ALLIANCE,
  [Op.LIST_ALLIANCES]: REQUEST_LIST_ALLIANCES,
  [Op.ALLIANCE_APPLY]: REQUEST_ALLIANCE_APPLY,
  [Op.ALLIANCE_INVITE]: REQUEST_ALLIANCE_INVITE,
  [Op.ALLIANCE_RESPOND]: REQUEST_ALLIANCE_RESPOND,
  [Op.ALLIANCE_LEAVE]: REQUEST_ALLIANCE_LEAVE,
  [Op.ALLIANCE_DISBAND]: REQUEST_ALLIANCE_DISBAND,
  [Op.ALLIANCE_KICK]: REQUEST_ALLIANCE_KICK,
  [Op.ALLIANCE_SET_ROLE]: REQUEST_ALLIANCE_SET_ROLE,
  [Op.ALLIANCE_SET_NOTICE]: REQUEST_ALLIANCE_SET_NOTICE,
  [Op.PUSH_ALLIANCE_STATE]: PUSH_ALLIANCE_STATE,
} satisfies Partial<Record<number, OpDoc>>;

/** 不写进 Agent 文档的协议号：创建与管理类（查询类 GET_ALLIANCE / LIST_ALLIANCES 与推送对 Agent 可见） */
export const ALLIANCE_AGENT_HIDDEN_OPS: ReadonlySet<number> = new Set<number>([
  Op.CREATE_ALLIANCE,
  Op.ALLIANCE_APPLY,
  Op.ALLIANCE_INVITE,
  Op.ALLIANCE_RESPOND,
  Op.ALLIANCE_LEAVE,
  Op.ALLIANCE_DISBAND,
  Op.ALLIANCE_KICK,
  Op.ALLIANCE_SET_ROLE,
  Op.ALLIANCE_SET_NOTICE,
]);

/** 不写进 Agent 文档的错误码：只会由上面那些玩家专属协议返回的联盟错误码（ALLIANCE_NOT_FOUND 对 GET_ALLIANCE 可见） */
export const ALLIANCE_AGENT_HIDDEN_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ALLIANCE_NAME_INVALID',
  'ALLIANCE_NAME_TAKEN',
  'ALLIANCE_GOVERNMENT_TOO_LOW',
  'ALLIANCE_ALREADY_IN',
  'ALLIANCE_NOT_IN',
  'ALLIANCE_COOLDOWN',
  'ALLIANCE_FULL',
  'ALLIANCE_FORBIDDEN',
  'ALLIANCE_ROLE_FULL',
  'ALLIANCE_LEADER_MUST_TRANSFER',
  'ALLIANCE_REQUEST_EXISTS',
]);
