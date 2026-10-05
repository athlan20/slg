// Google 一键登录与绑定 Google 的界面文案（v44，AISLG-127；与 copy.ts 分文件以控制单文件行数）

import type { ErrorCode } from './api/protocol';

export const GOOGLE_COPY = {
  login: {
    /** Google 官方按钮下方的一句说明 */
    note: '没有绑定过的 Google 账号第一次登录，会自动创建一个新账号（用户名随机）。',
    unavailableNote: 'Google 登录加载失败（需要能访问 Google 的网络），可改用账号密码登录。',
  },
  bind: {
    title: '绑定 Google',
    desc: '绑定后可以用 Google 一键登录这个账号。绑定后暂不支持解绑。',
    bound: '已绑定 Google',
    unbound: '尚未绑定 Google',
    done: '绑定成功，之后可用 Google 一键登录',
  },
  session: {
    googleLoginSuccess: (username: string) => `已通过 Google 登录（${username}）`,
  },
  errors: {
    fallback: 'Google 登录失败，请重试',
    connect: '无法连接服务，请稍后再试',
    byCode: {
      GOOGLE_UNAVAILABLE: 'Google 登录暂不可用，请改用账号密码登录',
      GOOGLE_CREDENTIAL_INVALID: 'Google 登录凭证无效或已过期，请重新点一次 Google 登录',
      GOOGLE_ALREADY_BOUND: '这个 Google 账号已绑定了别的账号，或当前账号已绑定别的 Google 账号',
      RATE_LIMITED: '尝试太频繁了，请稍等一分钟再试',
      AGENT_FORBIDDEN: '只有玩家登录才能执行这个操作',
      INVALID_PARAMS: '参数不合法，请重试',
    } as Partial<Record<ErrorCode, string>>,
  },
};
