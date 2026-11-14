// English counterpart to copy-linuxdo.ts.
import type { ErrorCode } from './api/protocol';
import { LINUXDO_COPY } from './copy-linuxdo';

export const LINUXDO_COPY_EN = {
  login: { button: 'Log in with Linux.do', busy: 'Redirecting…' },
  bind: {
    title: 'Bind Linux.do',
    desc: 'Once bound, you can log in to this account with Linux.do. Unbinding is not supported yet.',
    bound: (login: string) => login ? `Bound to Linux.do (@${login})` : 'Bound to Linux.do',
    unbound: 'Not bound to Linux.do',
    start: 'Bind Linux.do',
    busy: 'Redirecting…',
  },
  return: {
    bindOk: 'Linux.do bound — you can now log in with Linux.do',
    canceled: 'Linux.do authorization was cancelled',
    expired: 'The Linux.do authorization link has expired or was already used — please start again',
    unavailable: 'Linux.do authorization is unavailable right now — please try again later',
    alreadyBound: 'This Linux.do account is already bound to another account, or this account already has a different Linux.do account bound',
    notEligible: 'This Linux.do account does not meet the login or binding requirements; check its account status and trust level',
    unknown: 'Linux.do authorization did not complete — please try again',
    redeemFailed: 'The Linux.do login code has expired — please start login again',
  },
  session: { loginSuccess: (username: string) => `Logged in via Linux.do (${username})` },
  errors: {
    fallback: 'Linux.do authorization failed, please retry',
    connect: 'Could not connect to the server, please try again later',
    interrupted: 'The login did not finish — please click Linux.do login again',
    byCode: {
      LINUXDO_UNAVAILABLE: 'Linux.do authorization is unavailable right now — please try again later',
      LINUXDO_ALREADY_BOUND: 'This Linux.do account is already bound to another account, or this account already has a different Linux.do account bound',
      OAUTH_CODE_INVALID: 'The login code is invalid or expired — please start Linux.do login again',
      RATE_LIMITED: 'Too many requests — please wait a minute and try again',
      AGENT_FORBIDDEN: 'Only player logins can perform this action',
      NOT_LOGGED_IN: 'Please log in first',
      ALREADY_LOGGED_IN: 'This connection is already logged in — please refresh the page',
      INVALID_PARAMS: 'Invalid parameters, please retry',
    } as Partial<Record<ErrorCode, string>>,
  },
} satisfies typeof LINUXDO_COPY;
