// Google 一键登录协议的对外文档（v44，AISLG-127）：GOOGLE_LOGIN / GOOGLE_BIND。
// 仅供网页前端使用（与 WX_* 同类），Agent 无需调用——纯 Google 账号（无密码）的 Agent
// 接入走 v43 的「Agent 令牌」。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { TOKEN } from './protocol-doc-shared';

const GOOGLE_ONLY_NOTE = '**仅供网页前端使用，Agent 无需调用。**';
const CREDENTIAL = 'eyJhbGciOiJSUzI1NiIsImtpZCI6ImZhbGVfZXhhbXBsZSJ9.eyJpc3MiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20iLCJhdWQiOiJ0ZXN0LWNsaWVudC1pZC5hcHBzLmdvb2dsZXVzZXJjb250ZW50LmNvbSIsInN1YiI6Imdvb2dsZS1zdWItMTIzNDU2Nzg5MCIsImVtYWlsIjoicGxheWVyQGV4YW1wbGUuY29tIiwiZXhwIjoxNzc3NTQyNDAwfQ.（省略签名段）';

export const REQUEST_GOOGLE_LOGIN: RequestOpDoc = {
  kind: 'request',
  name: 'GOOGLE_LOGIN',
  title: '用 Google ID Token 换会话令牌（v44）',
  preAuth: true,
  summary: `${GOOGLE_ONLY_NOTE}网页用 Google Identity Services（accounts.google.com/gsi/client）渲染「用 Google 登录」按钮，拿到 ID Token（JWT）后经本协议换会话令牌：成功响应带 sessionToken，网页保存后走 LOGIN {token, asAgent: false}，与微信扫码登录的路子一致。这个 Google 账号已绑定过游戏号 → 直接签发该账号的会话；从没绑定过 → 自动创建新账号（随机用户名如 g_8f3k2a、无密码、初始城池与新手保护同普通注册）。服务端校验 ID Token（RS256 签名对 Google 公钥、iss、aud = 本应用 Client ID、exp 允许约 60 秒时钟误差）。同一 IP 每分钟最多 20 次登录尝试（RATE_LIMITED）。服务端没配置 GOOGLE_CLIENT_ID 时整体关闭，返回 GOOGLE_UNAVAILABLE。`,
  requestFields: [
    { name: 'credential', type: 'string', desc: '必填。Google Identity Services 回调给的 ID Token（JWT，1..8192 字符）。一次性使用，不要重放。' },
  ],
  dataFields: [
    { name: 'sessionToken', type: 'string', desc: '会话令牌，网页保存后走 LOGIN {token, asAgent: false} 登录。' },
    { name: 'created', type: 'boolean', desc: '本次是否自动创建了新账号（true = 新号，false = 登录已有账号）。' },
  ],
  errors: ['INVALID_PARAMS', 'ALREADY_LOGGED_IN', 'GOOGLE_UNAVAILABLE', 'GOOGLE_CREDENTIAL_INVALID', 'RATE_LIMITED'],
  examples: [
    {
      caption: '新 Google 账号第一次登录（自动建号）',
      request: { op: Op.GOOGLE_LOGIN, seq: 1, data: { credential: CREDENTIAL } },
      responses: [
        { op: Op.GOOGLE_LOGIN, seq: 1, ok: true, data: { sessionToken: TOKEN, created: true } },
      ],
    },
    {
      caption: '凭证无效（伪造 / 过期 / 不是发给本应用的）',
      request: { op: Op.GOOGLE_LOGIN, seq: 2, data: { credential: CREDENTIAL } },
      responses: [
        { op: Op.GOOGLE_LOGIN, seq: 2, ok: false, error: { code: 'GOOGLE_CREDENTIAL_INVALID', message: 'Google 登录凭证无效或已过期，请重新登录' } },
      ],
    },
  ],
  agentNote: 'Agent 不会调用这个协议。纯 Google 账号没有密码，让玩家在网页「Agent 令牌」里签发一个令牌，你用 LOGIN {token, asAgent: true} 登录即可。',
};

export const REQUEST_GOOGLE_BIND: RequestOpDoc = {
  kind: 'request',
  name: 'GOOGLE_BIND',
  title: '给当前账号绑定 Google（v44）',
  preAuth: false,
  summary: `${GOOGLE_ONLY_NOTE}已登录的玩家在「账号设置 → 绑定 Google」里点按钮完成 Google 授权后，网页把拿到的 ID Token 经本协议绑到当前账号；之后可直接用 Google 一键登录这个号。**仅限玩家连接调用**（Agent 连接返回 AGENT_FORBIDDEN）。一个游戏号只能绑一个 Google 账号，一个 Google 账号也只能绑一个游戏号，违反返回 GOOGLE_ALREADY_BOUND；暂不支持解绑。绑定成功后 GET_AGENT_INFO 的 googleBound 变为 true。`,
  requestFields: [
    { name: 'credential', type: 'string', desc: '必填。Google Identity Services 回调给的 ID Token（JWT，1..8192 字符）。' },
  ],
  dataFields: [
    { name: 'bound', type: 'boolean', desc: '恒为 true，表示绑定成功。' },
  ],
  errors: ['INVALID_PARAMS', 'AGENT_FORBIDDEN', 'GOOGLE_UNAVAILABLE', 'GOOGLE_CREDENTIAL_INVALID', 'GOOGLE_ALREADY_BOUND'],
  examples: [
    {
      caption: '绑定成功',
      request: { op: Op.GOOGLE_BIND, seq: 3, data: { credential: CREDENTIAL } },
      responses: [{ op: Op.GOOGLE_BIND, seq: 3, ok: true, data: { bound: true } }],
    },
    {
      caption: '该 Google 账号已绑了别的号 / 当前账号已绑了别的 Google',
      request: { op: Op.GOOGLE_BIND, seq: 4, data: { credential: CREDENTIAL } },
      responses: [
        { op: Op.GOOGLE_BIND, seq: 4, ok: false, error: { code: 'GOOGLE_ALREADY_BOUND', message: '该 Google 账号已绑定其他账号，或当前账号已绑定了别的 Google 账号' } },
      ],
    },
  ],
  agentNote: '仅玩家连接可调用，Agent 无需关注。',
};
