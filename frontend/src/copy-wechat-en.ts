// 英文文案孪生（AISLG-137）：copy-wechat.ts，逐成员 satisfies 对应中文对象的类型。
// 微信扫码登录、绑定微信与 Agent 令牌的界面文案（v43，docs/wechat-qr-login.md；与 copy.ts 分文件以控制单文件行数）

import { WECHAT_COPY } from './copy-wechat';
import type { ErrorCode } from './api/protocol';

export const WECHAT_COPY_EN = {
  login: {
    tabPassword: 'Username & password',
    tabWechat: 'WeChat QR login',
    tabsLabel: 'Login method',
  },
  qr: {
    alt: 'WeChat minigame QR code',
    loading: 'Generating QR code…',
    ready: 'Scan with WeChat and confirm the login on your phone',
    readyBind: 'Scan with WeChat and confirm the binding on your phone',
    scanned: 'Scanned — please confirm on your phone',
    confirmed: 'Confirmed, logging in…',
    confirmedBind: 'Confirmed, binding succeeded',
    countdown: (seconds: number) => `Expires in ${seconds}s`,
    retrying: 'QR code expired, regenerating…',
    refresh: 'QR code expired, click to refresh',
    refreshButton: 'Refresh QR code',
    safety: 'Only confirm on a web page you opened yourself; if you did not start this, tap "Cancel" on your phone.',
    newAccountNote: 'If this WeChat account has never been bound, the first scan creates a new account automatically (with a random username).',
  },
  bind: {
    title: 'Bind WeChat',
    desc: 'Once bound, you can log in to this account with a WeChat QR scan. Unbinding is not supported yet.',
    bound: 'Bound to WeChat',
    unbound: 'Not bound to WeChat',
    start: 'Bind WeChat',
    cancel: 'Cancel binding',
    done: 'Binding succeeded — you can now log in with a WeChat QR scan',
  },
  token: {
    title: 'Agent Token',
    desc: 'One permanent token per account. It is included automatically in the "Copy for AI" prompt, and your Agent uses it to log in — no username or password needed. If it leaks, reset it to get a new one; the old token becomes invalid immediately.',
    masked: (token: string) => `${token.slice(0, 3)}••••••${token.slice(-4)}`,
    show: 'Show',
    hide: 'Hide',
    copy: 'Copy Token',
    copied: 'Copied',
    copyFailed: 'Copy failed — please select the token and copy it manually',
    reset: 'Reset Token',
    resetting: 'Resetting…',
    resetConfirmTitle: 'After reset the old token becomes invalid immediately and any Agent using it will be disconnected; you will need to send it the new prompt afterwards. Reset now?',
    resetConfirm: 'Confirm Reset',
    resetCancel: 'Cancel',
    resetDone: 'Reset complete — please send the new prompt to your Agent again',
    lastUsed: (text: string) => `Last used ${text}`,
    neverUsed: 'Never used',
    createdAt: (text: string) => `Created at ${text}`,
    loadFailed: 'Failed to load the token, please retry',
    retry: 'Retry',
  },
  settings: {
    title: 'Account Settings',
  },
  errors: {
    fallback: 'Operation failed, please retry',
    connect: 'Could not connect to the server, please try again later',
    byCode: {
      WX_UNAVAILABLE: 'WeChat QR login is unavailable right now — use username and password instead',
      RATE_LIMITED: 'Too many QR code requests — please wait a minute and try again',
      WX_ALREADY_BOUND: 'This account is already bound to WeChat',
      WX_TICKET_INVALID: 'The QR code has expired — please refresh',
      AGENT_FORBIDDEN: 'Only player logins can perform this action',
      INVALID_PARAMS: 'Invalid parameters, please check and retry',
    } as Partial<Record<ErrorCode, string>>,
  },
  session: {
    wechatLoginSuccess: (username: string) => `Logged in via WeChat QR scan (${username})`,
  },
} satisfies typeof WECHAT_COPY;
