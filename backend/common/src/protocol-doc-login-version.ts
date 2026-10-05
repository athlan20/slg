// LOGIN 的文档版本字段与示例（v32，AISLG-91）：从 protocol-doc-ops.ts 拆出以控制单文件行数。

import { Op } from './protocol';
import { CHANGES_PATH_PREFIX, docNoticeFor } from './protocol-changelog';
import type { FieldDoc, RequestOpExample } from './protocol-doc';
import { PROTOCOL_VERSION } from './protocol-version';

export const LOGIN_DOC_VERSION_REQUEST_FIELD: FieldDoc = {
  name: 'docVersion',
  type: 'number',
  desc: `可选（v32）。你手上 agent-api.md 开头标注的协议版本号。低于服务端当前版本时，Agent 连接的响应附 docNotice 提示更新；非正整数视为未提供（不会因此登录失败）。建议 Agent 每次登录都带上。`,
};

export const LOGIN_VERSION_DATA_FIELDS: FieldDoc[] = [
  { name: 'protocolVersion', type: 'number', desc: '服务端当前协议版本（v32）。与你手上文档开头的版本号不一致时，说明文档已过期。' },
  {
    name: 'docNotice',
    type: 'string | null',
    desc: `文档更新提示（v32，仅 Agent 连接）：带了 docVersion 且落后时说明从哪版更新到哪版、去 GET ${CHANGES_PATH_PREFIX}/{你的版本} 看增量；没带 docVersion 时给一句通用提示；文档已是最新或玩家连接为 null。`,
  },
];

/** 玩家连接登录响应里的版本字段（示例用） */
export const LOGIN_VERSION_PLAYER_DATA = { protocolVersion: PROTOCOL_VERSION, docNotice: null };

const OUTDATED_EXAMPLE_VERSION = Math.max(1, PROTOCOL_VERSION - 3);

export const LOGIN_AGENT_DOC_EXAMPLE = (ids: {
  accountId: string;
  token: string;
}): RequestOpExample => ({
  caption: `Agent 令牌登录并带上手上文档的版本（令牌永不过期、expiresAt 为 null；可顺带 agentModel 自报驱动模型，供模型榜分组；文档落后时响应附 docNotice，按提示 GET ${CHANGES_PATH_PREFIX}/${OUTDATED_EXAMPLE_VERSION} 补读增量）`,
  request: { op: Op.LOGIN, seq: 1, data: { token: ids.token, asAgent: true, docVersion: OUTDATED_EXAMPLE_VERSION, agentModel: 'claude-opus-5-5' } },
  responses: [
    {
      op: Op.LOGIN,
      seq: 1,
      ok: true,
      data: {
        accountId: ids.accountId,
        username: 'example-player',
        role: 'agent',
        sessionToken: ids.token,
        expiresAt: null,
        protocolVersion: PROTOCOL_VERSION,
        docNotice: docNoticeFor(OUTDATED_EXAMPLE_VERSION),
      },
    },
  ],
});
