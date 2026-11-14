import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';

export const REQUEST_OAUTH_AUTH_START: RequestOpDoc = {
  kind: 'request', name: 'OAUTH_AUTH_START', title: '发起第三方 OAuth 授权（v110）', preAuth: true,
  summary: '仅网页使用。provider 为 linuxdo 或 github，purpose 为 login 或 bind；login 在登录前发起，bind 需已登录的玩家连接。成功后整页跳转 authUrl。Linux.do 需满足服务端最低信任等级、active 且未被禁言，资格不足回跳 ?oauth=linuxdo&error=not_eligible；失败还可能是 canceled、expired、unavailable、already_bound。登录成功回跳一次性 code，通过 OAUTH_REDEEM 兑换；绑定成功回跳 bind=ok。state 有效 10 分钟，一次性 code 有效 60 秒。GitHub 旧 op 62 继续支持。',
  requestFields: [
    { name: 'provider', type: "'linuxdo' | 'github'", desc: '必填。第三方登录提供商。' },
    { name: 'purpose', type: "'login' | 'bind'", desc: '必填。登录或给当前账号绑定。' },
  ],
  dataFields: [{ name: 'authUrl', type: 'string', desc: 'OAuth 授权地址；网页整页跳转。' }],
  errors: ['INVALID_PARAMS', 'NOT_LOGGED_IN', 'ALREADY_LOGGED_IN', 'AGENT_FORBIDDEN', 'GITHUB_UNAVAILABLE', 'GITHUB_ALREADY_BOUND', 'LINUXDO_UNAVAILABLE', 'LINUXDO_ALREADY_BOUND', 'RATE_LIMITED'],
  examples: [{ caption: '登录前发起 Linux.do 授权', request: { op: Op.OAUTH_AUTH_START, seq: 1, data: { provider: 'linuxdo', purpose: 'login' } }, responses: [{ op: Op.OAUTH_AUTH_START, seq: 1, ok: true, data: { authUrl: 'https://connect.linux.do/oauth2/authorize?client_id=example&state=example' } }] }],
  agentNote: 'Agent 使用玩家签发的 Agent 令牌登录，不调用本协议。',
};
