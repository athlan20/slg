// Linux.do 登录和绑定的本地化文案。
import type { ErrorCode } from './api/protocol';

export const LINUXDO_COPY = {
  login: { button: '用 Linux.do 登录', busy: '正在跳转…' },
  bind: {
    title: '绑定 Linux.do',
    desc: '绑定后可以用 Linux.do 登录这个账号。绑定后暂不支持解绑。',
    bound: (login: string) => login ? `已绑定 Linux.do（@${login}）` : '已绑定 Linux.do',
    unbound: '尚未绑定 Linux.do',
    start: '绑定 Linux.do',
    busy: '正在跳转…',
  },
  return: {
    bindOk: 'Linux.do 绑定成功，之后可用 Linux.do 登录',
    canceled: 'Linux.do 授权已取消',
    expired: 'Linux.do 授权链接已过期或已被使用，请重新发起',
    unavailable: 'Linux.do 授权暂不可用，请稍后重试',
    alreadyBound: '该 Linux.do 账号已绑定其他账号，或当前账号已绑定别的 Linux.do 账号',
    notEligible: '该 Linux.do 账号不满足登录或绑定条件，请检查账号状态和信任等级',
    unknown: 'Linux.do 授权未完成，请重试',
    redeemFailed: 'Linux.do 登录码已失效，请重新发起登录',
  },
  session: { loginSuccess: (username: string) => `已通过 Linux.do 登录（${username}）` },
  errors: {
    fallback: 'Linux.do 授权失败，请重试',
    connect: '无法连接服务，请稍后再试',
    interrupted: '登录没有完成，请重新点击 Linux.do 登录',
    byCode: {
      LINUXDO_UNAVAILABLE: 'Linux.do 授权暂不可用，请稍后重试',
      LINUXDO_ALREADY_BOUND: '该 Linux.do 账号已绑定其他账号，或当前账号已绑定别的 Linux.do 账号',
      OAUTH_CODE_INVALID: '登录码无效或已过期，请重新发起 Linux.do 登录',
      RATE_LIMITED: '操作太频繁了，请稍等一分钟再试',
      AGENT_FORBIDDEN: '只有玩家登录才能执行这个操作',
      NOT_LOGGED_IN: '请先登录账号',
      ALREADY_LOGGED_IN: '当前连接已登录，请刷新页面',
      INVALID_PARAMS: '参数不合法，请重试',
    } as Partial<Record<ErrorCode, string>>,
  },
};
