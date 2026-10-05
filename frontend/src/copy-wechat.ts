// 微信扫码登录、绑定微信与 Agent 令牌的界面文案（v43，docs/wechat-qr-login.md；与 copy.ts 分文件以控制单文件行数）

import type { ErrorCode } from './api/protocol';

export const WECHAT_COPY = {
  login: {
    tabPassword: '用户名密码',
    tabWechat: '微信扫码登录',
    tabsLabel: '登录方式',
  },
  qr: {
    alt: '微信小游戏二维码',
    loading: '正在生成二维码…',
    ready: '请用微信扫一扫，在手机上确认登录',
    readyBind: '请用微信扫一扫，在手机上确认绑定',
    scanned: '已扫码，请在手机上确认',
    confirmed: '已确认，正在登录…',
    confirmedBind: '已确认，绑定成功',
    countdown: (seconds: number) => `${seconds} 秒后过期`,
    retrying: '二维码已失效，正在重新生成…',
    refresh: '二维码已失效，点击刷新',
    refreshButton: '刷新二维码',
    safety: '只在你自己打开的网页上确认；不是你本人发起的，请在手机上点「取消」。',
    newAccountNote: '没有绑定过的微信第一次扫码，会自动创建一个新账号（用户名随机）。',
  },
  bind: {
    title: '绑定微信',
    desc: '绑定后可以直接用微信扫码登录这个账号。绑定后暂不支持解绑。',
    bound: '已绑定微信',
    unbound: '尚未绑定微信',
    start: '绑定微信',
    cancel: '取消绑定',
    done: '绑定成功，之后可用微信扫码登录',
  },
  token: {
    title: 'Agent 令牌',
    desc: '每个账号一个永久令牌，随「复制给 AI」的提示词自动带上，你的 Agent 用它登录，不需要账号密码。泄露时点重置换新的，旧令牌立刻失效。',
    masked: (token: string) => `${token.slice(0, 3)}••••••${token.slice(-4)}`,
    show: '显示',
    hide: '遮住',
    copy: '复制令牌',
    copied: '已复制',
    copyFailed: '复制失败，请手动选中复制',
    reset: '重置令牌',
    resetting: '重置中…',
    resetConfirmTitle: '重置后旧令牌立刻失效，正在用它的 Agent 会被断开，之后要把新提示词重新发给它。确定重置？',
    resetConfirm: '确认重置',
    resetCancel: '取消',
    resetDone: '已重置，请把新提示词重新发给你的 Agent',
    lastUsed: (text: string) => `最近使用 ${text}`,
    neverUsed: '尚未使用',
    createdAt: (text: string) => `生成于 ${text}`,
    loadFailed: '令牌加载失败，请重试',
    retry: '重试',
  },
  settings: {
    title: '账号设置',
  },
  errors: {
    fallback: '操作失败，请重试',
    connect: '无法连接服务，请稍后再试',
    byCode: {
      WX_UNAVAILABLE: '微信扫码登录暂不可用，请改用用户名密码登录',
      RATE_LIMITED: '生成二维码太频繁了，请稍等一分钟再试',
      WX_ALREADY_BOUND: '这个账号已经绑定过微信',
      WX_TICKET_INVALID: '二维码已失效，请刷新',
      AGENT_FORBIDDEN: '只有玩家登录才能执行这个操作',
      INVALID_PARAMS: '参数不合法，请检查后重试',
    } as Partial<Record<ErrorCode, string>>,
  },
  session: {
    wechatLoginSuccess: (username: string) => `已通过微信扫码登录（${username}）`,
  },
};
