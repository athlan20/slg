// 英文文案孪生（AISLG-137）：copy-github.ts，逐成员 satisfies 对应中文对象的类型。
// GitHub 一键登录与绑定 GitHub 的界面文案（v45，AISLG-128）

import { GITHUB_COPY } from './copy-github';
import type { ErrorCode } from './api/protocol';

export const GITHUB_COPY_EN = {
  login: {
    button: 'Log in with GitHub',
    busy: 'Redirecting…',
    note: 'Only your public GitHub profile is authorized — no extra permissions needed. If a GitHub account has never been bound, its first login creates a new account automatically (with a random username).',
  },
  bind: {
    title: 'Bind GitHub',
    desc: 'Once bound, you can log in to this account with GitHub in one click. Unbinding is not supported yet.',
    bound: (login: string) => `Bound to GitHub (@${login})`,
    unbound: 'Not bound to GitHub',
    start: 'Bind GitHub',
    busy: 'Redirecting…',
  },
  /** OAuth 回跳带回来的结果提示（code 场景走登录错误，bind 场景走本地事件） */
  return: {
    bindOk: 'GitHub bound — you can now log in with GitHub in one click',
    canceled: 'GitHub login was cancelled',
    expired: 'The GitHub login link has expired or was already used — please start again',
    unavailable: 'Cannot reach GitHub right now — please try again later or use username and password',
    alreadyBound: 'This GitHub account is already bound to another account, or this account already has a different GitHub account bound',
    unknown: 'GitHub login did not complete — please try again',
    redeemFailed: 'The GitHub login code has expired — please click GitHub login again',
  },
  session: {
    githubLoginSuccess: (username: string) => `Logged in via GitHub (${username})`,
  },
  errors: {
    fallback: 'GitHub login failed, please retry',
    connect: 'Could not connect to the server, please try again later',
    byCode: {
      GITHUB_UNAVAILABLE: 'GitHub login is unavailable right now — use username and password instead',
      OAUTH_CODE_INVALID: 'The login code is invalid or expired — please start GitHub login again',
      GITHUB_ALREADY_BOUND: 'This GitHub account is already bound to another account, or this account already has a different GitHub account bound',
      RATE_LIMITED: 'Too many requests — please wait a minute and try again',
      AGENT_FORBIDDEN: 'Only player logins can perform this action',
      NOT_LOGGED_IN: 'Please log in first',
      ALREADY_LOGGED_IN: 'This connection is already logged in — please refresh the page',
      INVALID_PARAMS: 'Invalid parameters, please retry',
    } as Partial<Record<ErrorCode, string>>,
  },
} satisfies typeof GITHUB_COPY;
