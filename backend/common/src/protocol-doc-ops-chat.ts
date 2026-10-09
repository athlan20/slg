// 聊天协议（v51，AISLG-138）的协议条目。聊天仅限玩家连接，对外 Agent 文档不收录这些协议：
// protocol-doc-render.ts 按 AGENT_HIDDEN_OPS / AGENT_HIDDEN_ERROR_CODES 过滤。这里仍写全条目，
// 保证 OP_DOC 与协议号一一对应（类型检查与单元测试会校验），维护者查阅与前端对接用。

import { Op, type ErrorCode } from './protocol';
import type { OpDoc, PushOpDoc, RequestOpDoc } from './protocol-doc';

const PLAYER_ONLY = '**仅限玩家连接**：Agent 连接调用返回 AGENT_FORBIDDEN。';
const ACCOUNT_ID = '4f0c1a2e-8d3b-4c5e-9a7f-1b2c3d4e5f60';

/** 一条世界频道消息示例 */
const CHAT_MESSAGE_SAMPLE = {
  id: 101,
  channel: 'world',
  sender: { accountId: ACCOUNT_ID, username: 'example-player' },
  recipient: null,
  type: 'text',
  text: '有人一起打黄巾吗',
  emoji: null,
  card: null,
  createdAt: '2026-10-09T10:00:00.000Z',
} as const;

/** 卡片消息示例（地图坐标） */
const CHAT_CARD_SAMPLE = {
  id: 102,
  channel: 'world',
  sender: { accountId: ACCOUNT_ID, username: 'example-player' },
  recipient: null,
  type: 'card',
  text: '这块地不错',
  emoji: null,
  card: { kind: 'coord', x: 120, y: 340, terrain: 'forest', tileKind: 'wilderness', level: 4 },
  createdAt: '2026-10-09T10:01:00.000Z',
} as const;

export const REQUEST_CHAT_HISTORY: RequestOpDoc = {
  kind: 'request',
  name: 'CHAT_HISTORY',
  title: '查询聊天消息（v51，AISLG-138）',
  preAuth: false,
  summary: `${PLAYER_ONLY}查询世界频道（不传 peerId）或与某玩家的私聊消息，按时间从旧到新返回一页。世界频道只保留最近 7 天、最多 1000 条；私聊保留 30 天。已屏蔽的玩家不出现在世界频道结果里。翻页：取 messages 的第一条 id 作为 beforeId 再查，直到 hasMore 为 false。`,
  requestFields: [
    { name: 'channel', type: "'world' | 'private'", desc: '必填。频道。' },
    { name: 'peerId', type: 'string', desc: '私聊必填：对方账号 id（UUID）。世界频道不传。' },
    { name: 'limit', type: 'number', desc: '可选。1..50，缺省 30。' },
    { name: 'beforeId', type: 'number', desc: '可选。只返回 id 小于它的消息（翻页游标）。' },
  ],
  dataFields: [
    { name: 'messages', type: 'array', desc: '消息列表（从旧到新），每项为消息视图（见 PUSH_CHAT_MESSAGE）。' },
    { name: 'hasMore', type: 'boolean', desc: '是否还有更早的消息。' },
  ],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.CHAT_HISTORY, seq: 30, data: { channel: 'world', limit: 30 } },
      responses: [{ op: Op.CHAT_HISTORY, seq: 30, ok: true, data: { messages: [CHAT_MESSAGE_SAMPLE, CHAT_CARD_SAMPLE], hasMore: false } }],
    },
  ],
};

export const REQUEST_CHAT_SEND: RequestOpDoc = {
  kind: 'request',
  name: 'CHAT_SEND',
  title: '发送聊天消息（v51，AISLG-138）',
  preAuth: false,
  summary: `${PLAYER_ONLY}发送文字、表情或卡片。text / emoji / card 至少给一个；emoji 不与 text、card 同发；card 可附一句 text。文字去首尾空白后 1..100 字，屏蔽词在服务端整段替换成 *（匹配前忽略空格与标点）。卡片只传 id 或坐标，快照由服务端生成：coord 需在地图范围内；hero / report / city 的 id 必须属于本账号。世界频道需主城官府 ≥ 3 级；私聊不设等级门槛，对方屏蔽了你则失败。同一频道每 10 秒一条。账号被禁言时全部发送失败。`,
  requestFields: [
    { name: 'channel', type: "'world' | 'private'", desc: '必填。频道。' },
    { name: 'peerId', type: 'string', desc: '私聊必填：对方账号 id（不能是自己）。' },
    { name: 'text', type: 'string', desc: '可选。文字，1..100 字（去首尾空白后）。' },
    { name: 'emoji', type: 'string', desc: '可选。表情，只接受内置表情表中的字符（不与 text、card 同发）。' },
    { name: 'card', type: 'object', desc: '可选。卡片：{ kind: "coord", x, y } | { kind: "hero", heroId } | { kind: "report", reportId } | { kind: "city", cityId }。' },
  ],
  dataFields: [
    { name: 'message', type: 'object', desc: '发出的消息视图（见 PUSH_CHAT_MESSAGE）。' },
  ],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN', 'CHAT_MUTED', 'CHAT_GOVERNMENT_TOO_LOW', 'CHAT_BLOCKED', 'CHAT_RATE_LIMITED'],
  examples: [
    {
      caption: '世界频道发文字',
      request: { op: Op.CHAT_SEND, seq: 31, data: { channel: 'world', text: '有人一起打黄巾吗' } },
      responses: [{ op: Op.CHAT_SEND, seq: 31, ok: true, data: { message: CHAT_MESSAGE_SAMPLE } }],
    },
    {
      caption: '发送地图坐标卡片并附一句话',
      request: { op: Op.CHAT_SEND, seq: 32, data: { channel: 'world', text: '这块地不错', card: { kind: 'coord', x: 120, y: 340 } } },
      responses: [{ op: Op.CHAT_SEND, seq: 32, ok: true, data: { message: CHAT_CARD_SAMPLE } }],
    },
  ],
};

export const REQUEST_CHAT_CONVERSATIONS: RequestOpDoc = {
  kind: 'request',
  name: 'CHAT_CONVERSATIONS',
  title: '私聊会话列表与未读（v51，AISLG-138）',
  preAuth: false,
  summary: `${PLAYER_ONLY}返回本账号的私聊会话（最多 50 个，按最后一条消息时间倒序）、每个会话的未读条数与私聊未读总数，以及我的屏蔽名单。离线期间收到的私聊在此体现为未读。`,
  requestFields: [],
  dataFields: [
    { name: 'conversations', type: 'array', desc: '会话列表：{ peer: { accountId, username }, last: 消息视图, unread: 未读条数 }。' },
    { name: 'unreadTotal', type: 'number', desc: '私聊未读总数（不含世界频道）。' },
    { name: 'blocked', type: 'array', desc: '我屏蔽的玩家：{ accountId, username }。' },
  ],
  errors: ['AGENT_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.CHAT_CONVERSATIONS, seq: 33 },
      responses: [
        {
          op: Op.CHAT_CONVERSATIONS,
          seq: 33,
          ok: true,
          data: {
            conversations: [{ peer: { accountId: ACCOUNT_ID, username: 'example-player' }, last: CHAT_MESSAGE_SAMPLE, unread: 2 }],
            unreadTotal: 2,
            blocked: [],
          },
        },
      ],
    },
  ],
};

export const REQUEST_CHAT_READ: RequestOpDoc = {
  kind: 'request',
  name: 'CHAT_READ',
  title: '标记私聊已读（v51，AISLG-138）',
  preAuth: false,
  summary: `${PLAYER_ONLY}把与对方的私聊标记为已读（截止到调用时刻已收到的消息）。`,
  requestFields: [{ name: 'peerId', type: 'string', desc: '必填。对方账号 id。' }],
  dataFields: [{ name: 'unreadTotal', type: 'number', desc: '标记后的私聊未读总数。' }],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.CHAT_READ, seq: 34, data: { peerId: ACCOUNT_ID } },
      responses: [{ op: Op.CHAT_READ, seq: 34, ok: true, data: { unreadTotal: 0 } }],
    },
  ],
};

export const REQUEST_CHAT_BLOCK: RequestOpDoc = {
  kind: 'request',
  name: 'CHAT_BLOCK',
  title: '屏蔽 / 取消屏蔽玩家（v51，AISLG-138）',
  preAuth: false,
  summary: `${PLAYER_ONLY}屏蔽后：看不到对方在世界频道的发言，对方也不能给我发私聊（发送时返回 CHAT_BLOCKED）。屏蔽是单向的，只影响屏蔽方。不能屏蔽自己。`,
  requestFields: [
    { name: 'accountId', type: 'string', desc: '必填。对方账号 id。' },
    { name: 'blocked', type: 'boolean', desc: '必填。true 屏蔽，false 取消屏蔽。' },
  ],
  dataFields: [{ name: 'blocked', type: 'array', desc: '更新后的屏蔽名单：{ accountId, username }。' }],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.CHAT_BLOCK, seq: 35, data: { accountId: ACCOUNT_ID, blocked: true } },
      responses: [
        {
          op: Op.CHAT_BLOCK,
          seq: 35,
          ok: true,
          data: { blocked: [{ accountId: ACCOUNT_ID, username: 'example-player' }] },
        },
      ],
    },
  ],
};

export const REQUEST_CHAT_REPORT_DETAIL: RequestOpDoc = {
  kind: 'request',
  name: 'CHAT_REPORT_DETAIL',
  title: '打开聊天里的战报卡片（v51，AISLG-138）',
  preAuth: false,
  summary: `${PLAYER_ONLY}返回一条战报卡片的详情快照（分享那一刻的战报，不含 Agent 点评）。消息须是世界频道，或与我相关的私聊；分享者屏蔽了我（或我屏蔽了分享者）时返回 INVALID_PARAMS。`,
  requestFields: [{ name: 'messageId', type: 'number', desc: '必填。卡片消息的 id。' }],
  dataFields: [{ name: 'report', type: 'object', desc: '战报快照，字段同 GET_BATTLE_REPORTS 的 reports[]（不含 comment）。' }],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.CHAT_REPORT_DETAIL, seq: 36, data: { messageId: 103 } },
      responses: [
        {
          op: Op.CHAT_REPORT_DETAIL,
          seq: 36,
          ok: true,
          data: { report: { id: 17, x: 120, y: 340, kind: 'wilderness', role: 'attacker', won: true, rounds: 6, endReason: 'defender_wiped' } },
        },
      ],
    },
  ],
};

export const PUSH_CHAT_MESSAGE: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_CHAT_MESSAGE',
  title: '推送：聊天新消息（v51，AISLG-138）',
  summary: '有新消息时推送给玩家连接（Agent 连接不收）。世界频道推给所有在线玩家，但不推给屏蔽了发言人的玩家；私聊推给对方的在线玩家连接，并推给发送人自己的其他在线连接。发送人本连接的结果经 CHAT_SEND 直接返回，不重复推送。',
  dataFields: [
    { name: 'message', type: 'object', desc: '消息视图：{ id, channel, sender, recipient, type, text, emoji, card, createdAt }。type 为 text / emoji / card；card 为卡片快照（kind 为 coord / hero / report / city）。' },
  ],
  examples: [{ op: Op.PUSH_CHAT_MESSAGE, push: true, data: { message: CHAT_MESSAGE_SAMPLE } }],
};

/** 聊天协议号 → 文档条目（并入 OP_DOC） */
export const CHAT_OP_DOC = {
  [Op.CHAT_HISTORY]: REQUEST_CHAT_HISTORY,
  [Op.CHAT_SEND]: REQUEST_CHAT_SEND,
  [Op.CHAT_CONVERSATIONS]: REQUEST_CHAT_CONVERSATIONS,
  [Op.CHAT_READ]: REQUEST_CHAT_READ,
  [Op.CHAT_BLOCK]: REQUEST_CHAT_BLOCK,
  [Op.CHAT_REPORT_DETAIL]: REQUEST_CHAT_REPORT_DETAIL,
  [Op.PUSH_CHAT_MESSAGE]: PUSH_CHAT_MESSAGE,
} satisfies Partial<Record<Op, OpDoc>>;

/** 不写进 Agent 文档的协议号（聊天仅限玩家本人） */
export const AGENT_HIDDEN_OPS: ReadonlySet<number> = new Set<number>(Object.keys(CHAT_OP_DOC).map(Number));

/** 不写进 Agent 文档的错误码（聊天专属） */
export const AGENT_HIDDEN_ERROR_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'CHAT_GOVERNMENT_TOO_LOW',
  'CHAT_MUTED',
  'CHAT_BLOCKED',
  'CHAT_RATE_LIMITED',
]);
