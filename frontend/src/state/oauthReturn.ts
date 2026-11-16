// OAuth 回跳的一次性解析：整页授权后被 302 回
// /?oauth=github|linuxdo&code=…（或 &bind=ok / &error=…）。本模块在应用启动时解析一次并立即用
// history.replaceState 把参数从地址栏抹掉——一次性码不留在浏览器历史里，刷新页面
// 也不会重放（验收 6）。再调用返回 null。

export type OauthProvider = 'github' | 'linuxdo';
export type OauthReturn =
  | { provider: OauthProvider; kind: 'code'; code: string }
  | { provider: OauthProvider; kind: 'bindOk' }
  | { provider: OauthProvider; kind: 'error'; reason: 'canceled' | 'expired' | 'unavailable' | 'already_bound' | 'not_eligible' | 'unknown' };

let consumed = false;

export function takeOauthReturn(): OauthReturn | null {
  if ((typeof __MAPP__ !== 'undefined' && __MAPP__) || consumed || typeof window === 'undefined') {
    return null;
  }
  consumed = true;
  const url = new URL(window.location.href);
  const provider = url.searchParams.get('oauth');
  if (provider !== 'github' && provider !== 'linuxdo') {
    return null;
  }
  const code = url.searchParams.get('code');
  const bind = url.searchParams.get('bind');
  const error = url.searchParams.get('error');
  // 无论识别出什么，本流程的参数都立即抹掉（只保留其余无关查询串）
  url.searchParams.delete('oauth');
  url.searchParams.delete('code');
  url.searchParams.delete('bind');
  url.searchParams.delete('error');
  const search = url.searchParams.toString();
  window.history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);

  if (code) {
    return { provider, kind: 'code', code };
  }
  if (bind === 'ok') {
    return { provider, kind: 'bindOk' };
  }
  if (error === 'canceled' || error === 'expired' || error === 'unavailable' || error === 'already_bound' || error === 'not_eligible') {
    return { provider, kind: 'error', reason: error };
  }
  return { provider, kind: 'error', reason: 'unknown' };
}
