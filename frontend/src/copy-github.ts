// GitHub 一键登录与绑定 GitHub 的界面文案（v45，AISLG-128）

import type { ErrorCode } from './api/protocol';

export const GITHUB_COPY = {
  login: {
    button: '用 GitHub 登录',
    busy: '正在跳转…',
    note: '授权 GitHub 公开资料即可，不需要额外权限；没绑定过的 GitHub 账号第一次登录会自动创建新账号（用户名随机）。',
  },
  bind: {
    title: '绑定 GitHub',
    desc: '绑定后可以用 GitHub 一键登录这个账号。绑定后暂不支持解绑。',
    bound: (login: string) => `已绑定 GitHub（@${login}）`,
    unbound: '尚未绑定 GitHub',
    start: '绑定 GitHub',
    busy: '正在跳转…',
  },
  /** OAuth 回跳带回来的结果提示（code 场景走登录错误，bind 场景走本地事件） */
  return: {
    bindOk: 'GitHub 绑定成功，之后可用 GitHub 一键登录',
    canceled: 'GitHub 登录已取消',
    expired: 'GitHub 登录链接已过期或已被使用，请重新发起',
    unavailable: '暂时连不上 GitHub，请稍后重试或改用账号密码登录',
    alreadyBound: '该 GitHub 账号已绑定其他账号，或当前账号已绑定别的 GitHub 账号',
    unknown: 'GitHub 登录未完成，请重试',
    redeemFailed: 'GitHub 登录码已失效，请重新点一次 GitHub 登录',
  },
  session: {
    githubLoginSuccess: (username: string) => `已通过 GitHub 登录（${username}）`,
  },
  errors: {
    fallback: 'GitHub 登录失败，请重试',
    connect: '无法连接服务，请稍后再试',
    byCode: {
      GITHUB_UNAVAILABLE: 'GitHub 登录暂不可用，请改用账号密码登录',
      OAUTH_CODE_INVALID: '登录码无效或已过期，请重新发起 GitHub 登录',
      GITHUB_ALREADY_BOUND: '这个 GitHub 账号已绑定了别的账号，或当前账号已绑定别的 GitHub 账号',
      RATE_LIMITED: '操作太频繁了，请稍等一分钟再试',
      AGENT_FORBIDDEN: '只有玩家登录才能执行这个操作',
      NOT_LOGGED_IN: '请先登录账号',
      ALREADY_LOGGED_IN: '当前连接已登录，请刷新页面',
      INVALID_PARAMS: '参数不合法，请重试',
    } as Partial<Record<ErrorCode, string>>,
  },
};
