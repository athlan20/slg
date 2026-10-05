// GitHub 一键登录协议的对外文档（v45，AISLG-128）：GITHUB_AUTH_START / OAUTH_REDEEM。
// 仅供网页前端使用（与 WX_* / GOOGLE_* 同类），Agent 无需调用——纯 GitHub 账号（无密码）
// 的 Agent 接入走 v43 的「Agent 令牌」。HTTP 回调（GET /auth/github/callback）不属于
// WebSocket 协议，说明写在 GITHUB_AUTH_START 的 summary 里。

import { Op } from './protocol';
import type { RequestOpDoc } from './protocol-doc';
import { TOKEN } from './protocol-doc-shared';

const GITHUB_ONLY_NOTE = '**仅供网页前端使用，Agent 无需调用。**';
const AUTH_URL = 'https://github.com/login/oauth/authorize?client_id=Iv1.fake-client-id&redirect_uri=https%3A%2F%2Fslg.yuntianyou.cc%2Fauth%2Fgithub%2Fcallback&state=3YtKq9vZmXcA2LbN8wEr5tHf';
const ONE_TIME_CODE = 'cEfzKv7rYw2mLbQn8xTqA3dN6sHj9pV4';

export const REQUEST_GITHUB_AUTH_START: RequestOpDoc = {
  kind: 'request',
  name: 'GITHUB_AUTH_START',
  title: '发起 GitHub 授权（v45）',
  preAuth: true,
  summary: `${GITHUB_ONLY_NOTE}OAuth 授权码模式的第一步（整页跳转，不用弹窗——手机浏览器常拦弹窗）。purpose=login 登录前即可发送；purpose=bind 需玩家连接已登录（给当前账号绑定 GitHub）。服务端生成随机 state（存内存，10 分钟有效、一次性，bind 时记下账号），响应返回 GitHub 授权地址，网页随后整页跳转过去（不带 scope：只读公开资料）。玩家在 GitHub 授权后，GitHub 会把浏览器回跳到 API 的 GET /auth/github/callback：login 路径服务端生成 60 秒一次性登录码并 302 回前端（?oauth=github&code=…，会话令牌不进 URL——地址会进浏览器历史与服务器日志，一次性短时效码泄露风险小得多）；bind 路径直接写绑定后 302 回前端（?bind=ok 或 ?error=already_bound）。玩家在 GitHub 点「取消」回跳 error=canceled；state 过期 / 被重复使用 / 回调参数被篡改回跳 error=expired。同一 IP 每分钟最多发起 20 次（RATE_LIMITED）。没绑定过的 GitHub 账号第一次授权登录自动建号（随机用户名如 gh_8f3k2a、无密码、初始城池与新手保护同普通注册）。服务端没配置 GitHub OAuth App 凭证时整体关闭，返回 GITHUB_UNAVAILABLE。`,
  requestFields: [
    { name: 'purpose', type: "'login' | 'bind'", desc: '必填。login = 授权后登录（登录前可发）；bind = 给当前账号绑定 GitHub（须玩家连接已登录；Agent 连接返回 AGENT_FORBIDDEN）。' },
  ],
  dataFields: [
    { name: 'authUrl', type: 'string', desc: 'GitHub 授权地址（https://github.com/login/oauth/authorize?…&state=…），网页 window.location 整页跳转过去。' },
  ],
  errors: ['INVALID_PARAMS', 'NOT_LOGGED_IN', 'ALREADY_LOGGED_IN', 'AGENT_FORBIDDEN', 'GITHUB_UNAVAILABLE', 'GITHUB_ALREADY_BOUND', 'RATE_LIMITED'],
  examples: [
    {
      caption: '登录前发起 GitHub 授权',
      request: { op: Op.GITHUB_AUTH_START, seq: 1, data: { purpose: 'login' } },
      responses: [{ op: Op.GITHUB_AUTH_START, seq: 1, ok: true, data: { authUrl: AUTH_URL } }],
    },
    {
      caption: '服务端未配置 GitHub OAuth App',
      request: { op: Op.GITHUB_AUTH_START, seq: 2, data: { purpose: 'login' } },
      responses: [{ op: Op.GITHUB_AUTH_START, seq: 2, ok: false, error: { code: 'GITHUB_UNAVAILABLE', message: 'GitHub 登录暂不可用（未配置或连不上 GitHub）' } }],
    },
  ],
  agentNote: 'Agent 不会调用这个协议。纯 GitHub 账号没有密码，让玩家在网页「Agent 令牌」里签发一个令牌，你用 LOGIN {token, asAgent: true} 登录即可。',
};

export const REQUEST_OAUTH_REDEEM: RequestOpDoc = {
  kind: 'request',
  name: 'OAUTH_REDEEM',
  title: '用一次性登录码换会话令牌（v45）',
  preAuth: true,
  summary: `${GITHUB_ONLY_NOTE}OAuth 回跳的第二步：GitHub 授权成功后浏览器被 302 回前端（?oauth=github&code=…），网页解析出 code 经本协议换成会话令牌，保存后走 LOGIN {token, asAgent: false}，再用 history.replaceState 把 code 从地址栏抹掉。code 由回调时生成：60 秒有效、一次性（OAUTH_CODE_INVALID = 无效 / 过期 / 已用过），承载的账号信息由服务端持有。已登录连接调用返回 ALREADY_LOGGED_IN。`,
  requestFields: [
    { name: 'code', type: 'string', desc: '必填。回跳地址里的一次性登录码（1..128 字符）。' },
  ],
  dataFields: [
    { name: 'sessionToken', type: 'string', desc: '会话令牌，网页保存后走 LOGIN {token, asAgent: false} 登录。' },
    { name: 'username', type: 'string', desc: '登录的账号用户名（自动建号时为随机用户名，如 gh_8f3k2a）。' },
    { name: 'created', type: 'boolean', desc: '本次 GitHub 授权是否自动创建了新账号。' },
  ],
  errors: ['INVALID_PARAMS', 'ALREADY_LOGGED_IN', 'GITHUB_UNAVAILABLE', 'OAUTH_CODE_INVALID'],
  examples: [
    {
      caption: '兑换回跳带回来的一次性码',
      request: { op: Op.OAUTH_REDEEM, seq: 1, data: { code: ONE_TIME_CODE } },
      responses: [
        { op: Op.OAUTH_REDEEM, seq: 1, ok: true, data: { sessionToken: TOKEN, username: 'gh_8f3k2a', created: true } },
      ],
    },
    {
      caption: '码已过期 / 已被使用（例如刷新页面重放地址栏里的旧码）',
      request: { op: Op.OAUTH_REDEEM, seq: 2, data: { code: ONE_TIME_CODE } },
      responses: [
        { op: Op.OAUTH_REDEEM, seq: 2, ok: false, error: { code: 'OAUTH_CODE_INVALID', message: '登录码无效或已过期，请重新发起登录' } },
      ],
    },
  ],
  agentNote: '仅网页登录流程使用，Agent 无需调用。',
};
