// Linux.do 微应用登录协议的对外文档（v113，AISLG-261）：MAPP_LOGIN（op 158）。
// MAPP_LOGIN **只对玩家开放**：不进 agent-api.md / agent-api.json，MCP 也不生成对应工具
// （AGENT_HIDDEN_OPS 见下），Agent 连接调用返回 AGENT_FORBIDDEN。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { ERROR_MESSAGES } from '../../api/src/frames';

/** 不写进 Agent 文档的协议号：微应用身份来自论坛沙箱注入的平台令牌 */
export const MAPP_AGENT_HIDDEN_OPS: ReadonlySet<number> = new Set<number>([Op.MAPP_LOGIN]);

/** 不写进 Agent 文档的错误码：只有微应用登录会返回 */
export const MAPP_AGENT_HIDDEN_ERROR_CODES: ReadonlySet<string> = new Set<string>([
  'MAPP_UNAVAILABLE',
  'MAPP_TRUST_LEVEL_LOW',
  'MAPP_TOKEN_INVALID',
]);

export const REQUEST_MAPP_LOGIN: RequestOpDoc = {
  kind: 'request',
  name: 'MAPP_LOGIN',
  title: 'Linux.do 微应用登录（v113，AISLG-261；仅玩家连接）',
  preAuth: true,
  summary:
    '仅微应用环境使用。连接握手阶段通过平台令牌验签后，登录前发起换取会话令牌。成功后返回 sessionToken、username 与 created，客户端随后发 LOGIN { token: sessionToken } 完成登录。仅限玩家连接；Agent 连接返回 AGENT_FORBIDDEN。',
  requestFields: [],
  dataFields: [
    { name: 'sessionToken', type: 'string', desc: '会话令牌，用于后续发起 LOGIN 登录。' },
    { name: 'username', type: 'string', desc: '玩家账号名。' },
    { name: 'created', type: 'boolean', desc: '本次是否新建了账号。' },
  ],
  errors: ['MAPP_UNAVAILABLE', 'MAPP_TRUST_LEVEL_LOW', 'MAPP_TOKEN_INVALID', 'ALREADY_LOGGED_IN', 'AGENT_FORBIDDEN'],
  examples: [
    {
      caption: '微应用换取会话令牌成功',
      request: { op: Op.MAPP_LOGIN, seq: 1, data: {} },
      responses: [
        {
          op: Op.MAPP_LOGIN,
          seq: 1,
          ok: true,
          data: { sessionToken: 'mapp_sess_sample', username: 'ld_8f3k2a', created: false },
        },
      ],
    },
    {
      caption: '论坛信任等级不足',
      request: { op: Op.MAPP_LOGIN, seq: 2, data: {} },
      responses: [
        {
          op: Op.MAPP_LOGIN,
          seq: 2,
          ok: false,
          error: { code: 'MAPP_TRUST_LEVEL_LOW', message: ERROR_MESSAGES.MAPP_TRUST_LEVEL_LOW },
        },
      ],
    },
  ],
};
