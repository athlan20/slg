// 联盟外交（v77，AISLG-195）的对外协议文档：友好邀请 / 答复、解除关系、宣布敌对、查询。
// 管理类仅限玩家连接的盟主 / 副盟主；查询玩家与 Agent 通用。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import {
  ALLIANCE_FRIEND_INVITE_TTL_MS,
  ALLIANCE_MAX_FRIENDS,
  ALLIANCE_MAX_HOSTILES,
  ALLIANCE_REFRIEND_COOLDOWN_MS,
  ALLIANCE_UNFRIEND_NO_ATTACK_MS,
} from './protocol-alliance';
import { STARTED_AT } from './protocol-doc-shared';

const RULES =
  `联盟之间有三种关系：**中立**（默认）/ **友好**（一方发邀请、另一方同意，邀请 ${ALLIANCE_FRIEND_INVITE_TTL_MS / 3_600_000} 小时过期）/ **敌对**（一方单方面宣布，不需要对方同意）。` +
  `友盟双方成员互不攻击（掠夺、抢野地、占分城、侦察都返回 ALLY_NOT_ATTACKABLE），可以互相协防；地图上显示友军色。` +
  `敌对只在地图上标红、来袭预警标出「敌对联盟」，不改变战斗与收益规则（不等于宣战）。` +
  `上限：每个联盟最多 ${ALLIANCE_MAX_FRIENDS} 个友盟、${ALLIANCE_MAX_HOSTILES} 个敌对。` +
  `解除友好后 ${ALLIANCE_UNFRIEND_NO_ATTACK_MS / 3_600_000} 小时内双方仍不能互相攻击，${ALLIANCE_REFRIEND_COOLDOWN_MS / 3_600_000} 小时内不能再次结好。` +
  `管理操作仅限玩家连接的盟主 / 副盟主（Agent 返回 AGENT_FORBIDDEN）；关系变化在双方联盟频道发系统消息，结友 / 宣布敌对另发全服播报；换季关系保留、邀请清空。`;

const OTHER = {
  id: '3c9f2a1b-4d5e-4f60-8a71-2b3c4d5e6f70',
  name: '洛阳盟',
  leader: { accountId: '6f1e2d3c-4b5a-4978-8c6d-5e4f3a2b1c0d', username: 'bob' },
  memberCount: 18,
  maxMembers: 30,
  createdAt: STARTED_AT,
};

const FRIEND_ENTRY = {
  alliance: OTHER,
  relation: 'friendly',
  since: STARTED_AT,
  noAttackUntil: null,
  refriendAfter: null,
} as const;

const DIPLOMACY_VIEW = {
  allianceId: '9b2f4c1a-6d3e-4f80-9a71-2c5e8d4b6a10',
  friends: [FRIEND_ENTRY],
  hostiles: [],
  invites: [
    {
      id: '12',
      alliance: OTHER,
      inviter: { accountId: '6f1e2d3c-4b5a-4978-8c6d-5e4f3a2b1c0d', username: 'bob' },
      direction: 'received',
      createdAt: STARTED_AT,
      expiresAt: new Date(Date.parse(STARTED_AT) + ALLIANCE_FRIEND_INVITE_TTL_MS).toISOString(),
    },
  ],
  limits: { friends: ALLIANCE_MAX_FRIENDS, hostiles: ALLIANCE_MAX_HOSTILES },
} as const;

export const REQUEST_GET_ALLIANCE_DIPLOMACY: RequestOpDoc = {
  kind: 'request',
  name: 'GET_ALLIANCE_DIPLOMACY',
  title: '查询联盟外交（v77，AISLG-195）',
  preAuth: false,
  summary: `${RULES} 本协议返回本联盟的友盟名单、敌对名单与待处理邀请（发出 / 收到）；玩家与 Agent 通用。没有联盟返回 ALLIANCE_NOT_IN。`,
  requestFields: [],
  dataFields: [
    { name: 'allianceId', type: 'string', desc: '我的联盟 id。' },
    { name: 'friends', type: 'array', desc: `友盟名单（最多 ${ALLIANCE_MAX_FRIENDS} 个）：{ alliance 联盟概要 { id, name, leader, memberCount, maxMembers, createdAt }, relation: friendly, since, noAttackUntil, refriendAfter }。` },
    { name: 'hostiles', type: 'array', desc: `敌对名单（最多 ${ALLIANCE_MAX_HOSTILES} 个）：结构同 friends，relation: hostile。` },
    { name: 'invites', type: 'array', desc: `待处理友好邀请：{ id, alliance 对方联盟, inviter 发起人, direction: sent|received, createdAt, expiresAt }。` },
    { name: 'limits', type: 'object', desc: `上限：{ friends: ${ALLIANCE_MAX_FRIENDS}, hostiles: ${ALLIANCE_MAX_HOSTILES} }。` },
  ],
  errors: ['ALLIANCE_NOT_IN'],
  examples: [
    {
      caption: '有一个友盟，并收到洛阳盟的邀请',
      request: { op: Op.GET_ALLIANCE_DIPLOMACY, seq: 50, data: {} },
      responses: [{ op: Op.GET_ALLIANCE_DIPLOMACY, seq: 50, ok: true, data: DIPLOMACY_VIEW }],
    },
  ],
  agentNote: '外交是盟主 / 副盟主的玩家操作，Agent 只能查。友盟成员不能互相攻击，规划进攻前先查 friendships；解除友好有 24 小时不可攻击 + 72 小时不可再结好的冷却。',
};

export const REQUEST_ALLIANCE_DIPLOMACY_INVITE: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_DIPLOMACY_INVITE',
  title: '发起友好邀请（v77，AISLG-195）',
  preAuth: false,
  summary: `${RULES} 本协议由盟主 / 副盟主向另一个联盟发出友好邀请（48 小时有效）。双方任一方的友盟已达 ${ALLIANCE_MAX_FRIENDS} 个返回 DIPLOMACY_LIMIT；已是友盟 / 敌对返回 DIPLOMACY_EXISTS；解除友好 72 小时冷却内返回 DIPLOMACY_COOLDOWN。仅玩家连接。`,
  requestFields: [{ name: 'allianceId', type: 'string', desc: '目标联盟 id。' }],
  dataFields: [{ name: '（同 GET_ALLIANCE_DIPLOMACY）', type: 'object', desc: '返回最新外交全貌（含刚发出的邀请）。' }],
  errors: ['INVALID_PARAMS', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN', 'ALLIANCE_NOT_FOUND', 'DIPLOMACY_LIMIT', 'DIPLOMACY_EXISTS', 'DIPLOMACY_COOLDOWN'],
  examples: [
    {
      caption: '向洛阳盟发出邀请',
      request: { op: Op.ALLIANCE_DIPLOMACY_INVITE, seq: 51, data: { allianceId: OTHER.id } },
      responses: [{ op: Op.ALLIANCE_DIPLOMACY_INVITE, seq: 51, ok: true, data: DIPLOMACY_VIEW }],
    },
  ],
  agentNote: '管理操作 Agent 不能做；由玩家的盟主 / 副盟主在联盟面板发起。',
};

export const REQUEST_ALLIANCE_DIPLOMACY_RESPOND: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_DIPLOMACY_RESPOND',
  title: '同意 / 拒绝友好邀请（v77，AISLG-195）',
  preAuth: false,
  summary: `${RULES} 本协议由收到邀请一方的盟主 / 副盟主答复（accept=true 同意 / false 拒绝）。同意时双方友盟名额、72 小时冷却都会复核（不通过返回 DIPLOMACY_LIMIT / DIPLOMACY_COOLDOWN），成功后双方联盟频道各写一条系统消息并全服播报。仅玩家连接。`,
  requestFields: [
    { name: 'inviteId', type: 'string', desc: '邀请 id（GET_ALLIANCE_DIPLOMACY 的 invites[].id）。' },
    { name: 'accept', type: 'boolean', desc: 'true 同意 / false 拒绝。' },
  ],
  dataFields: [{ name: '（同 GET_ALLIANCE_DIPLOMACY）', type: 'object', desc: '返回最新外交全貌。' }],
  errors: ['INVALID_PARAMS', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN', 'DIPLOMACY_INVITE_NOT_FOUND', 'DIPLOMACY_LIMIT', 'DIPLOMACY_EXISTS', 'DIPLOMACY_COOLDOWN'],
  examples: [
    {
      caption: '同意邀请，双方成为友盟',
      request: { op: Op.ALLIANCE_DIPLOMACY_RESPOND, seq: 52, data: { inviteId: '12', accept: true } },
      responses: [{ op: Op.ALLIANCE_DIPLOMACY_RESPOND, seq: 52, ok: true, data: { ...DIPLOMACY_VIEW, invites: [] } }],
    },
  ],
  agentNote: '同意后双方成员立即不能互相攻击，且可以互相协防；规划军事行动前先确认。',
};

export const REQUEST_ALLIANCE_DIPLOMACY_END: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_DIPLOMACY_END',
  title: '解除友好 / 敌对（v77，AISLG-195）',
  preAuth: false,
  summary: `${RULES} 本协议由盟主 / 副盟主单方面解除与目标联盟的友好或敌对，回到中立。解除友好会写入 ${ALLIANCE_UNFRIEND_NO_ATTACK_MS / 3_600_000} 小时不可攻击 + ${ALLIANCE_REFRIEND_COOLDOWN_MS / 3_600_000} 小时不可再结好的冷却（防解约偷袭 / 反复横跳）。仅玩家连接。`,
  requestFields: [{ name: 'allianceId', type: 'string', desc: '目标联盟 id。' }],
  dataFields: [{ name: '（同 GET_ALLIANCE_DIPLOMACY）', type: 'object', desc: '返回最新外交全貌。' }],
  errors: ['INVALID_PARAMS', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN'],
  examples: [
    {
      caption: '解除与洛阳盟的友好（24 小时内仍不能互相攻击）',
      request: { op: Op.ALLIANCE_DIPLOMACY_END, seq: 53, data: { allianceId: OTHER.id } },
      responses: [{ op: Op.ALLIANCE_DIPLOMACY_END, seq: 53, ok: true, data: { ...DIPLOMACY_VIEW, friends: [], invites: [] } }],
    },
  ],
  agentNote: '解除友好不等于立刻能打：24 小时冷却内攻击仍会被拒（ALLY_NOT_ATTACKABLE）。',
};

export const REQUEST_ALLIANCE_DIPLOMACY_HOSTILE: RequestOpDoc = {
  kind: 'request',
  name: 'ALLIANCE_DIPLOMACY_HOSTILE',
  title: '宣布敌对（v77，AISLG-195）',
  preAuth: false,
  summary: `${RULES} 本协议由盟主 / 副盟主单方面把目标联盟标为敌对（不需要对方同意，最多 ${ALLIANCE_MAX_HOSTILES} 个），地图上对方成员的城与野地标红、对方来袭时预警标出「敌对联盟」。若原是友盟，保留 24 小时不可攻击冷却。仅玩家连接。`,
  requestFields: [{ name: 'allianceId', type: 'string', desc: '目标联盟 id。' }],
  dataFields: [{ name: '（同 GET_ALLIANCE_DIPLOMACY）', type: 'object', desc: '返回最新外交全貌。' }],
  errors: ['INVALID_PARAMS', 'ALLIANCE_NOT_IN', 'ALLIANCE_FORBIDDEN', 'DIPLOMACY_LIMIT', 'DIPLOMACY_EXISTS'],
  examples: [
    {
      caption: '把洛阳盟标为敌对',
      request: { op: Op.ALLIANCE_DIPLOMACY_HOSTILE, seq: 54, data: { allianceId: OTHER.id } },
      responses: [{ op: Op.ALLIANCE_DIPLOMACY_HOSTILE, seq: 54, ok: true, data: { ...DIPLOMACY_VIEW, hostiles: [{ ...FRIEND_ENTRY, relation: 'hostile' }], friends: [] } }],
    },
  ],
  agentNote: '敌对只是标记，不改变战斗与收益；可以随时单方面解除回到中立。',
};