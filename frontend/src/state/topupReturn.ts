// 充值付款后的回跳（v108，AISLG-251）：服务端把玩家付完款跳回的地址设为 <站点>/?topup=return。
// 应用启动时解析一次，并用 history.replaceState 把参数从地址栏抹掉（与 oauthReturn 同一做法）；再调用返回 false。
// 返回 true 只表示「本次启动是从付款页回来的」，余额由登录后的 GET_STATE 刷新，不在这里改状态。

let consumed = false;

export function takeTopupReturn(): boolean {
  if (consumed || typeof window === 'undefined') {
    return false;
  }
  consumed = true;
  const url = new URL(window.location.href);
  if (url.searchParams.get('topup') !== 'return') {
    return false;
  }
  url.searchParams.delete('topup');
  const search = url.searchParams.toString();
  window.history.replaceState(null, '', `${url.pathname}${search ? `?${search}` : ''}${url.hash}`);
  return true;
}
