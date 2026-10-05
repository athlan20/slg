// 微信扫码登录与 Agent 令牌协议的对外文档：
// WX_QR_CREATE / WX_SCAN / WX_CONFIRM / WX_CANCEL / PUSH_WX_QR_STATUS（v43，仅供网页与微信小游戏）
// 与 GET_AGENT_TOKEN / RESET_AGENT_TOKEN（v46 永久 Agent 令牌，仅玩家连接）。

import { Op } from './protocol';
import type { PushOpDoc, RequestOpDoc } from './protocol-doc';
import { ACCOUNT_ID, TOKEN } from './protocol-doc-shared';

const WX_ONLY_NOTE = '**仅供网页与微信小游戏使用，Agent 无需调用。**';
const TICKET = 'k3JfQ9xLm2PaZ7wB';
const QR_IMAGE = 'data:image/jpeg;base64,/9j/4AAQSkZJRg…（省略）';
const SK_TOKEN = 'sk_3YtKq9vZmXcA2LbN8wEr5tHfQjWn4RdUxCz6BmGhJkPq';
const WX_EXPIRES_AT = '2026-10-03T08:03:00.000Z';

export const REQUEST_WX_QR_CREATE: RequestOpDoc = {
  kind: 'request',
  name: 'WX_QR_CREATE',
  title: '生成微信扫码二维码（v43）',
  preAuth: true,
  summary: `${WX_ONLY_NOTE}网页请求一张带 ticket 的微信小游戏码：玩家用微信扫码打开小游戏、点确认，网页经 PUSH_WX_QR_STATUS 收到结果。purpose=login 登录前即可发送（成功确认后推送里带会话令牌，网页再走 LOGIN {token}；从没绑定过的微信第一次扫码会自动建号，用户名随机如 wx_8f3k2a、带初始城池）；purpose=bind 需玩家连接已登录（给当前账号绑定微信）。ticket 只存服务端内存，3 分钟有效、一次性；一条连接同时只保留一个 ticket，重新生成即作废旧的，连接断开也一并作废。同一 IP 每分钟最多生成 20 张。服务端没配置微信小游戏凭证时整体关闭，返回 WX_UNAVAILABLE。`,
  requestFields: [
    { name: 'purpose', type: "'login' | 'bind'", desc: '必填。login = 扫码登录（登录前可发）；bind = 给当前账号绑定微信（须玩家连接已登录；Agent 连接返回 AGENT_FORBIDDEN）。' },
  ],
  dataFields: [
    { name: 'ticket', type: 'string', desc: '二维码对应的 16 位一次性 ticket，后续 PUSH_WX_QR_STATUS 用它对应。' },
    { name: 'qrImage', type: 'string', desc: '小游戏码图片，data URI（data:image/jpeg;base64,...），可直接放进 <img src>。' },
    { name: 'expiresAt', type: 'string', desc: 'ticket 过期时间（ISO 8601，约 3 分钟后）。过期会推送 expired，需重新生成。' },
  ],
  errors: ['INVALID_PARAMS', 'NOT_LOGGED_IN', 'ALREADY_LOGGED_IN', 'AGENT_FORBIDDEN', 'WX_ALREADY_BOUND', 'WX_UNAVAILABLE', 'RATE_LIMITED'],
  examples: [
    {
      caption: '登录前生成扫码登录的码',
      request: { op: Op.WX_QR_CREATE, seq: 1, data: { purpose: 'login' } },
      responses: [{ op: Op.WX_QR_CREATE, seq: 1, ok: true, data: { ticket: TICKET, qrImage: QR_IMAGE, expiresAt: WX_EXPIRES_AT } }],
    },
    {
      caption: '服务端未配置微信',
      request: { op: Op.WX_QR_CREATE, seq: 2, data: { purpose: 'login' } },
      responses: [{ op: Op.WX_QR_CREATE, seq: 2, ok: false, error: { code: 'WX_UNAVAILABLE', message: '微信扫码登录暂不可用' } }],
    },
  ],
  agentNote: 'Agent 不需要也不应该调用微信相关协议：纯微信账号没有密码，让玩家在网页「Agent 令牌」里签发一个令牌，你用 LOGIN {token, asAgent: true} 登录即可。',
};

export const REQUEST_WX_SCAN: RequestOpDoc = {
  kind: 'request',
  name: 'WX_SCAN',
  title: '微信小游戏扫码上报（v43）',
  preAuth: true,
  summary: `${WX_ONLY_NOTE}小游戏被码打开后，用启动参数里的 ticket 与 wx.login 拿到的 code 上报。服务端先校验 ticket，再用 code 向微信换 openid（openid 只留在服务端，不发给网页与小游戏），把 ticket 置为 scanned、记下这条小游戏连接，并向网页推送 scanned。响应带确认页要展示的信息：将登录哪个账号 / 将创建新账号（bind 时为将绑定到哪个账号）、发起请求的时间与打码后的 IP，供玩家确认「这是我自己在网页上发起的」。已被扫过的 ticket 再被扫（另一部手机）一律无效。code 只能用一次，重试需重新调 wx.login。`,
  requestFields: [
    { name: 'ticket', type: 'string', desc: '必填。小游戏启动参数 scene 里的 ticket（16 位字母数字）。' },
    { name: 'code', type: 'string', desc: '必填。wx.login 返回的 code。' },
  ],
  dataFields: [
    { name: 'purpose', type: "'login' | 'bind'", desc: '这张码的用途。' },
    { name: 'accountName', type: 'string | null', desc: 'login：该微信已绑定的账号用户名，没有绑定过（将自动创建新账号）为 null；bind：当前要绑定的账号用户名。' },
    { name: 'requestedAt', type: 'string', desc: '网页生成这张码的时间（ISO 8601）。' },
    { name: 'requesterIp', type: 'string | null', desc: '网页发起请求的 IP，已打码（如 113.87.*.*）；取不到为 null。' },
  ],
  errors: ['INVALID_PARAMS', 'WX_TICKET_INVALID', 'WX_CODE_INVALID', 'WX_ALREADY_BOUND', 'WX_UNAVAILABLE'],
  examples: [
    {
      request: { op: Op.WX_SCAN, seq: 1, data: { ticket: TICKET, code: '0a3Xyz…（wx.login 的 code）' } },
      responses: [
        { op: Op.WX_SCAN, seq: 1, ok: true, data: { purpose: 'login', accountName: null, requestedAt: '2026-10-03T08:00:00.000Z', requesterIp: '113.87.*.*' } },
      ],
    },
  ],
  agentNote: '仅供微信小游戏使用，Agent 无需调用。',
};

export const REQUEST_WX_CONFIRM: RequestOpDoc = {
  kind: 'request',
  name: 'WX_CONFIRM',
  title: '微信小游戏确认登录 / 绑定（v43）',
  preAuth: true,
  summary: `${WX_ONLY_NOTE}玩家在小游戏确认页手动点【确认】后发送（不能扫码即登录）。只接受发出 WX_SCAN 的那条连接。login：openid 已绑定则给绑定账号签发会话，没绑定则创建新账号（随机用户名、初始城池、无密码）；bind：把微信绑到网页连接所登录的账号。成功后网页收到 PUSH_WX_QR_STATUS（confirmed；login 带 sessionToken，bind 带 bound=true），ticket 随即作废。`,
  requestFields: [{ name: 'ticket', type: 'string', desc: '必填。WX_SCAN 过的 ticket。' }],
  dataFields: [],
  errors: ['INVALID_PARAMS', 'WX_TICKET_INVALID', 'WX_ALREADY_BOUND', 'WX_UNAVAILABLE'],
  examples: [
    {
      request: { op: Op.WX_CONFIRM, seq: 2, data: { ticket: TICKET } },
      responses: [{ op: Op.WX_CONFIRM, seq: 2, ok: true, data: {} }],
    },
  ],
  agentNote: '仅供微信小游戏使用，Agent 无需调用。',
};

export const REQUEST_WX_CANCEL: RequestOpDoc = {
  kind: 'request',
  name: 'WX_CANCEL',
  title: '微信小游戏取消登录 / 绑定（v43）',
  preAuth: true,
  summary: `${WX_ONLY_NOTE}玩家在小游戏确认页点【取消】后发送，只接受发出 WX_SCAN 的那条连接。ticket 作废，网页收到 PUSH_WX_QR_STATUS（canceled）。小游戏连接在确认前断开，网页同样会收到 canceled。`,
  requestFields: [{ name: 'ticket', type: 'string', desc: '必填。WX_SCAN 过的 ticket。' }],
  dataFields: [],
  errors: ['INVALID_PARAMS', 'WX_TICKET_INVALID'],
  examples: [
    {
      request: { op: Op.WX_CANCEL, seq: 2, data: { ticket: TICKET } },
      responses: [{ op: Op.WX_CANCEL, seq: 2, ok: true, data: {} }],
    },
  ],
  agentNote: '仅供微信小游戏使用，Agent 无需调用。',
};

export const REQUEST_GET_AGENT_TOKEN: RequestOpDoc = {
  kind: 'request',
  name: 'GET_AGENT_TOKEN',
  title: '查看本账号的永久 Agent 令牌（v46）',
  preAuth: false,
  summary:
    '每账号一个**永久有效**的 Agent 令牌（`sk_` 前缀，永不过期）：建号时自动生成，玩家「复制给 AI」的提示词第四行就是它，你用它以 LOGIN {token, asAgent: true} 登录，不需要玩家交出账号密码。**仅限玩家连接调用**（Agent 连接返回 AGENT_FORBIDDEN——令牌不能经 Agent 可调的协议下发）；老账号没有时自动补生成。',
  requestFields: [],
  dataFields: [
    { name: 'token', type: 'string', desc: '令牌原文（sk_ + 43 字符）。' },
    { name: 'createdAt', type: 'string', desc: '本枚令牌的生成 / 最近一次重置时间（ISO 8601）。' },
    { name: 'lastUsedAt', type: 'string | null', desc: '最近一次用它登录的时间；从未用过为 null。' },
  ],
  errors: ['AGENT_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.GET_AGENT_TOKEN, seq: 6 },
      responses: [
        {
          op: Op.GET_AGENT_TOKEN,
          seq: 6,
          ok: true,
          data: { token: SK_TOKEN, createdAt: '2026-10-04T08:00:00.000Z', lastUsedAt: '2026-10-04T09:30:00.000Z' },
        },
      ],
    },
  ],
  agentNote: `你不会调用这个协议（Agent 连接返回 AGENT_FORBIDDEN）。令牌由玩家在网页上经它查看、复制进提示词交给你；你只用 LOGIN {"token": "<令牌>", "asAgent": true, "docVersion": <本文版本>} 登录（账号 ${ACCOUNT_ID.slice(0, 8)}… 维度，与玩家同一座城）。收到 SESSION_INVALID 或被服务端断开（close code 4003）说明玩家重置了令牌——不要重试，请玩家重新发一次新提示词。不要在日志里回显令牌。`,
};

export const REQUEST_RESET_AGENT_TOKEN: RequestOpDoc = {
  kind: 'request',
  name: 'RESET_AGENT_TOKEN',
  title: '重置永久 Agent 令牌（v46）',
  preAuth: false,
  summary:
    '把本账号的 Agent 令牌换成一个新的随机值（不支持自填）：**旧令牌立即失效**，正在用它登录的连接被服务端断开（close code 4003），之后旧令牌 LOGIN 返回 SESSION_INVALID。玩家重置后要把「复制给 AI」的新提示词重新发给 Agent。**仅限玩家连接调用**；调用幂等性无特殊保证，连续重置即连续换新。',
  requestFields: [],
  dataFields: [
    { name: 'token', type: 'string', desc: '新令牌原文（sk_ + 43 字符）。' },
    { name: 'createdAt', type: 'string', desc: '重置时间（ISO 8601）。' },
    { name: 'lastUsedAt', type: 'string | null', desc: '重置后恒为 null（尚未使用）。' },
  ],
  errors: ['AGENT_FORBIDDEN'],
  examples: [
    {
      request: { op: Op.RESET_AGENT_TOKEN, seq: 7 },
      responses: [
        { op: Op.RESET_AGENT_TOKEN, seq: 7, ok: true, data: { token: SK_TOKEN, createdAt: '2026-10-04T10:00:00.000Z', lastUsedAt: null } },
      ],
    },
  ],
  agentNote: '仅玩家连接可调用。Agent 侧的感知：旧令牌的连接被断开（close code 4003）、再登录 SESSION_INVALID——此时请玩家重新发新提示词。',
};

export const PUSH_WX_QR_STATUS: PushOpDoc = {
  kind: 'push',
  name: 'PUSH_WX_QR_STATUS',
  title: '推送：微信扫码状态变化（v43）',
  summary: `${WX_ONLY_NOTE}只推给生成二维码的那条网页连接（不是账号维度的广播，也没有 eventId）。status：scanned = 已有手机扫码、等待玩家在手机上确认；confirmed = 已确认（login 带 sessionToken，网页随后用 LOGIN {token} 登录；bind 带 bound=true）；canceled = 玩家在手机上取消（或小游戏连接在确认前断开）；expired = ticket 到期。canceled / expired 之后 ticket 作废，需重新 WX_QR_CREATE。`,
  dataFields: [
    { name: 'ticket', type: 'string', desc: '对应 WX_QR_CREATE 返回的 ticket。' },
    { name: 'status', type: "'scanned' | 'confirmed' | 'canceled' | 'expired'", desc: '新状态。' },
    { name: 'sessionToken', type: 'string', desc: '仅 status=confirmed 且 purpose=login 时有：会话令牌，网页保存后走 LOGIN {token, asAgent: false}。' },
    { name: 'bound', type: 'boolean', desc: '仅 status=confirmed 且 purpose=bind 时有：恒为 true。' },
  ],
  examples: [
    { op: Op.PUSH_WX_QR_STATUS, push: true, data: { ticket: TICKET, status: 'scanned' } },
    { op: Op.PUSH_WX_QR_STATUS, push: true, data: { ticket: TICKET, status: 'confirmed', sessionToken: TOKEN } },
    { op: Op.PUSH_WX_QR_STATUS, push: true, data: { ticket: TICKET, status: 'confirmed', bound: true } },
    { op: Op.PUSH_WX_QR_STATUS, push: true, data: { ticket: TICKET, status: 'expired' } },
  ],
  agentNote: '仅供网页使用，Agent 不会收到。',
};
