// 英文文案孪生（AISLG-137）：copy-google.ts，逐成员 satisfies 对应中文对象的类型。
// Google 一键登录与绑定 Google 的界面文案（v44，AISLG-127；与 copy.ts 分文件以控制单文件行数）

import { GOOGLE_COPY } from './copy-google';
import type { ErrorCode } from './api/protocol';

export const GOOGLE_COPY_EN = {
  login: {
    /** Google 官方按钮下方的一句说明 */
    note: 'If a Google account has never been bound, its first login creates a new account automatically (with a random username).',
    unavailableNote: 'Google login failed to load (a network that can reach Google is required) — you can use username and password instead.',
  },
  bind: {
    title: 'Bind Google',
    desc: 'Once bound, you can log in to this account with Google in one click. Unbinding is not supported yet.',
    bound: 'Bound to Google',
    unbound: 'Not bound to Google',
    done: 'Binding succeeded — you can now log in with Google in one click',
  },
  session: {
    googleLoginSuccess: (username: string) => `Logged in via Google (${username})`,
  },
  errors: {
    fallback: 'Google login failed, please retry',
    connect: 'Could not connect to the server, please try again later',
    byCode: {
      GOOGLE_UNAVAILABLE: 'Google login is unavailable right now — use username and password instead',
      GOOGLE_CREDENTIAL_INVALID: 'The Google credential is invalid or expired — please click Google login again',
      GOOGLE_ALREADY_BOUND: 'This Google account is already bound to another account, or this account already has a different Google account bound',
      RATE_LIMITED: 'Too many attempts — please wait a minute and try again',
      AGENT_FORBIDDEN: 'Only player logins can perform this action',
      INVALID_PARAMS: 'Invalid parameters, please retry',
    } as Partial<Record<ErrorCode, string>>,
  },
} satisfies typeof GOOGLE_COPY;
