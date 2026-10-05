// LOGIN / LOGOUT 的协议文档（从 protocol-doc-ops.ts 拆出以控制单文件行数；v32 起含文档版本字段）。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { ACCOUNT_ID, TOKEN, TOKEN_EXPIRES_AT } from './protocol-doc-shared';
import { LOGIN_AGENT_DOC_EXAMPLE, LOGIN_DOC_VERSION_REQUEST_FIELD, LOGIN_VERSION_DATA_FIELDS, LOGIN_VERSION_PLAYER_DATA } from './protocol-doc-login-version';

export const REQUEST_LOGIN: RequestOpDoc = {
  kind: 'request',
  name: 'LOGIN',
  title: '登录',
  preAuth: true,
  summary:
    '以用户名 + 密码登录（**仅玩家、仅已有账号**），或以令牌（token）免密登录（玩家与 Agent 均可用）。**v48 起关闭密码通道的自动注册**：密码登录不存在的用户名返回 SIGNUP_CLOSED，不再建号——新账号只能经第三方登录创建（Google / GitHub / 微信扫码，玩家在网页上完成）。**v47：Agent 一律不能用账号密码登录**（哪个站都一样，返回 AGENT_PASSWORD_FORBIDDEN），只能用玩家的永久 Agent 令牌 LOGIN {token, asAgent: true}——令牌来自玩家「复制给 AI」的提示词；账号必须先由玩家建立。游戏有两个站、共用同一套服务与数据库、账号通用：国际站只开放 Google / GitHub 登录（**该站点发密码登录返回 PASSWORD_LOGIN_CLOSED**），国内站才有账号密码。登录类型由本次 asAgent 声明并绑定到连接，两种方式均如此。',
  requestFields: [
    { name: 'username', type: 'string', desc: '密码方式必填（仅玩家）。用户名，1..32 字符，账号唯一登录键；令牌方式可省略。' },
    { name: 'password', type: 'string', desc: '密码方式必填（仅玩家；国际站不开放密码登录）。密码，6..64 字符；与 token 互斥（同时提供返回 INVALID_PARAMS）。Agent 用密码登录返回 AGENT_PASSWORD_FORBIDDEN。用户名不存在返回 SIGNUP_CLOSED（v48 起不再自动注册）。' },
    { name: 'asAgent', type: 'boolean', desc: '必填。本次是否以 Agent 身份登录，决定绑定到连接的 role；两种方式都要提供。Agent 只能用令牌方式（asAgent=true + token）。' },
    { name: 'token', type: 'string', desc: '可选。令牌登录方式：提供时不校验用户名密码，账号由服务端从令牌解析（先按会话令牌、再按永久 Agent 令牌），用于持久保存后的自动登录。Agent 用玩家的永久令牌（sk_ 前缀）走这条路径。' },
    LOGIN_DOC_VERSION_REQUEST_FIELD,
  ],
  dataFields: [
    { name: 'accountId', type: 'string', desc: '账号 UUID。' },
    { name: 'username', type: 'string', desc: '账号用户名。' },
    { name: 'role', type: "'player' | 'agent'", desc: '本次连接绑定的登录类型（即 asAgent 声明结果）。' },
    { name: 'sessionToken', type: 'string', desc: '会话令牌。密码登录返回新签发的令牌；令牌登录原样返回。客户端可持久保存，下次用它免密登录。' },
    { name: 'expiresAt', type: 'string', desc: '会话过期时间（ISO 8601）。有效期 30 天、滑动续期：每次令牌登录成功都会刷新为当时起算的 30 天。' },
    ...LOGIN_VERSION_DATA_FIELDS,
  ],
  errors: ['INVALID_PARAMS', 'INVALID_CREDENTIALS', 'SIGNUP_CLOSED', 'SESSION_INVALID', 'AGENT_PASSWORD_FORBIDDEN', 'PASSWORD_LOGIN_CLOSED'],
  examples: [
    {
      caption: '密码登录（仅已有账号）',
      request: {
        op: Op.LOGIN,
        seq: 1,
        data: { username: 'example-player', password: 'example-pass-123', asAgent: false },
      },
      responses: [
        {
          op: Op.LOGIN,
          seq: 1,
          ok: true,
          data: {
            accountId: ACCOUNT_ID,
            username: 'example-player',
            role: 'player',
            sessionToken: TOKEN,
            expiresAt: TOKEN_EXPIRES_AT,
            ...LOGIN_VERSION_PLAYER_DATA,
          },
        },
        {
          op: Op.LOGIN,
          seq: 2,
          ok: false,
          error: { code: 'INVALID_CREDENTIALS', message: '用户名已存在或密码错误' },
        },
        {
          op: Op.LOGIN,
          seq: 3,
          ok: false,
          error: { code: 'SIGNUP_CLOSED', message: '该用户名不存在：密码登录不再支持注册，请用 Google / GitHub 登录创建账号' },
        },
      ],
    },
    {
      caption: '令牌登录（自动登录）',
      request: { op: Op.LOGIN, seq: 1, data: { token: TOKEN, asAgent: false } },
      responses: [
        {
          op: Op.LOGIN,
          seq: 1,
          ok: true,
          data: {
            accountId: ACCOUNT_ID,
            username: 'example-player',
            role: 'player',
            sessionToken: TOKEN,
            expiresAt: TOKEN_EXPIRES_AT,
            ...LOGIN_VERSION_PLAYER_DATA,
          },
        },
        {
          op: Op.LOGIN,
          seq: 2,
          ok: false,
          error: { code: 'SESSION_INVALID', message: '会话令牌无效或已过期' },
        },
      ],
    },
    LOGIN_AGENT_DOC_EXAMPLE({ accountId: ACCOUNT_ID, token: TOKEN }),
    {
      caption: 'Agent 用账号密码登录被拒（v47：任何站都一样，请改用玩家的永久令牌）',
      request: {
        op: Op.LOGIN,
        seq: 1,
        data: { username: 'example-player', password: 'example-pass-123', asAgent: true },
      },
      responses: [
        {
          op: Op.LOGIN,
          seq: 1,
          ok: false,
          error: {
            code: 'AGENT_PASSWORD_FORBIDDEN',
            message: 'Agent 不能用账号密码登录，请使用玩家的永久令牌（提示词里带的那种）',
          },
        },
      ],
    },
    {
      caption: '国际站发账号密码登录被拒（v47：该站只有 Google / GitHub）',
      request: {
        op: Op.LOGIN,
        seq: 1,
        data: { username: 'example-player', password: 'example-pass-123', asAgent: false },
      },
      responses: [
        {
          op: Op.LOGIN,
          seq: 1,
          ok: false,
          error: {
            code: 'PASSWORD_LOGIN_CLOSED',
            message: '该站点不开放账号密码登录，请使用 Google / GitHub 登录',
          },
        },
      ],
    },
  ],
  agentNote:
    '接入步骤：① 向用户索取「Agent 令牌」——玩家在本站网页「复制给 AI」的提示词里自带，形如 sk_ 开头的一长串；**不要索取账号密码**：Agent 用账号密码登录在任何站都会被拒（AGENT_PASSWORD_FORBIDDEN）；② 用 LOGIN {token, asAgent: true} 登录玩家的账号，登录的是同一座城（令牌永不过期，响应 expiresAt 为 null）；③ 保存该令牌供后续免密登录，收到 SESSION_INVALID 或 close code 4003（玩家重置了令牌）时不要重试，请玩家重新发一次新提示词；④ 不要保存或回显令牌；⑤ 每次 LOGIN 带上 docVersion（本文开头的协议版本号），响应里 docNotice 非空就按提示补读增量变更或重新下载本文（v32）。**无法自行创建账号**（v48 起密码登录不存在的用户名返回 SIGNUP_CLOSED，不再自动注册）：没有真实用户的自动化自测 / 黑盒回归场景，需要运维方预先提供测试账号（用户名 + 密码或 Agent 令牌）。',
};

export const REQUEST_LOGOUT: RequestOpDoc = {
  kind: 'request',
  name: 'LOGOUT',
  title: '登出（吊销会话令牌）',
  preAuth: false,
  summary:
    '吊销本连接登录所用的会话令牌，成功响应后服务端关闭连接（close code 1000）。吊销影响使用同一令牌的所有连接：它们下次用该令牌登录会收到 SESSION_INVALID。',
  requestFields: [],
  dataFields: [],
  errors: [],
  examples: [
    {
      request: { op: Op.LOGOUT, seq: 4 },
      responses: [{ op: Op.LOGOUT, seq: 4, ok: true, data: {} }],
    },
  ],
  agentNote:
    '「退出登录」应调用本协议（服务端吊销令牌）并同时清除本地保存的令牌；只清本地存储不足以让令牌失效。登出后重新连接须重新登录：Agent 用玩家的永久令牌（token 登录的 LOGOUT 只断连接、不吊销永久令牌），玩家用该站支持的登录方式（国内站可账号密码，国际站用 Google / GitHub）。',
};
