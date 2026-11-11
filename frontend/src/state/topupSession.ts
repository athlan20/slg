// 充值切片（v108，AISLG-251）：道具弹窗里充值面板的开关、CREATE_TOPUP（结账页在新窗口打开）、
// 到账推送（PUSH_ACCOUNT_STATE ingot_changed）与提示、本次会话内渠道不可用的置灰。
// 只有玩家连接有这个入口：网页端固定以玩家身份登录（见 useGameSession），Agent 令牌不经本界面。
// 结账地址只接受 https，原样导航到服务端返回的地址，前端不拼接支付地址。
// 购买时先同步开一个空白窗口（避免被拦截）；失败则关掉它，被拦截则面板里给手动链接。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type CreateTopupResponseData, type ErrorCode } from '../api/protocol';
import { TOPUP_PRODUCT_ID } from '../api/topupProduct';
import { topupErrorText } from '../api/topupText';
import { getCopy } from '../i18n/bundle';
import type { ItemsUpdate } from './useCityList';

export interface TopupSession {
  /** 充值面板是否替换道具列表 */
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** 本次会话内渠道不可用（收到 TOPUP_UNAVAILABLE）：入口与购买按钮置灰 */
  unavailable: boolean;
  busy: boolean;
  error: string | null;
  notice: string | null;
  /** 已打开结账页、等待付款回来（期间回到页面时会重拉一次余额） */
  awaiting: boolean;
  /** 本次购买时浏览器拦截了新窗口：面板提示用户允许弹窗，并改用手动链接 */
  popupBlocked: boolean;
  /** 被拦截时拿到的结账地址（仅 https），面板里显示「点此打开付款页面」 */
  manualCheckoutUrl: string | null;
  buy: () => Promise<void>;
  /** PUSH_ACCOUNT_STATE（ingot_changed）：写入新余额；比旧的多时提示「元宝到账 +N」 */
  onIngotPush: (balance: number) => void;
  clear: () => void;
}

export interface TopupSessionOptions {
  /** 当前元宝余额（useCityList.ingot）；未拉到为 null（此时到账不提示，避免把首次拉取当成到账） */
  ingot: number | null;
  applyItems: (update: ItemsUpdate) => void;
  /** 重拉背包 / 余额（GET_ITEMS） */
  refreshItems: () => Promise<void>;
  /** 写一条系统提示进事件流 */
  notify: (text: string) => void;
}

/** 只接受 https 的结账地址（服务端返回的地址原样使用，前端不改写） */
export function isSafeCheckoutUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    return false;
  }
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * 点购买的同步部分里先开一个空白窗口（仍在用户点击的调用栈内，不会被当成弹窗拦截）。
 * 不带 noopener：要拿到窗口句柄，拿到地址后再 opener = null 并导航。返回 null 表示被拦截。
 */
function openPlaceholderWindow(text: string): Window | null {
  let win: Window | null;
  try {
    win = window.open('', '_blank');
  } catch {
    return null;
  }
  if (!win) {
    return null;
  }
  try {
    win.document.title = text;
    win.document.body.textContent = text;
  } catch {
    // 写不进空白页不影响后续跳转
  }
  return win;
}

export function useTopupSession(clientRef: { current: ApiClient | null }, options: TopupSessionOptions): TopupSession {
  const { ingot, applyItems, refreshItems, notify } = options;
  const [panelOpen, setPanelOpen] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [awaiting, setAwaiting] = useState(false);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [manualCheckoutUrl, setManualCheckoutUrl] = useState<string | null>(null);
  // 余额镜像：推送到达时同步读取旧值算差额（state 异步，不能直接用）
  const balanceRef = useRef<number | null>(ingot);
  const refreshRef = useRef(refreshItems);
  // notify 由调用方每次渲染新建（内联箭头），不能进 onIngotPush 的依赖：否则 handlePush 等一串回调会每次渲染换身份
  const notifyRef = useRef(notify);

  useEffect(() => {
    balanceRef.current = ingot;
  }, [ingot]);

  useEffect(() => {
    refreshRef.current = refreshItems;
  }, [refreshItems]);

  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  // 付款后回到页面：服务端推送可能丢，按可见性 / 焦点重拉一次背包与余额（只在等待付款期间）
  useEffect(() => {
    if (!awaiting) {
      return;
    }
    const onBack = () => {
      if (document.visibilityState === 'visible') {
        void refreshRef.current();
      }
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [awaiting]);

  const onIngotPush = useCallback(
    (balance: number) => {
      const prev = balanceRef.current;
      balanceRef.current = balance;
      applyItems({ ingot: balance });
      if (prev !== null && balance > prev) {
        const text = getCopy().TOPUP_COPY.arrived(balance - prev);
        setNotice(text);
        setError(null);
        setAwaiting(false);
        notifyRef.current(text);
      }
    },
    [applyItems],
  );

  const openPanel = useCallback(() => {
    setPanelOpen(true);
    setError(null);
    setNotice(null);
    setPopupBlocked(false);
    setManualCheckoutUrl(null);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
    setError(null);
    setNotice(null);
    setPopupBlocked(false);
    setManualCheckoutUrl(null);
  }, []);

  const buy = useCallback(async () => {
    const { TOPUP_COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      setError(TOPUP_COPY.errors.fallback);
      return;
    }
    // 同步部分（发请求之前）：先开空白窗口，保证仍在点击的用户激活内
    const win = openPlaceholderWindow(TOPUP_COPY.redirecting);
    setPopupBlocked(win === null);
    setManualCheckoutUrl(null);
    setBusy(true);
    setError(null);
    setNotice(null);
    let handedOff = false;
    try {
      const res = await client.request(Op.CREATE_TOPUP, { productId: TOPUP_PRODUCT_ID });
      if (!res.ok) {
        const code = res.error?.code as ErrorCode | undefined;
        if (code === 'TOPUP_UNAVAILABLE') {
          setUnavailable(true);
        }
        setError(topupErrorText(code));
        return;
      }
      const data = res.data as unknown as CreateTopupResponseData;
      if (!isSafeCheckoutUrl(data.checkoutUrl)) {
        setError(TOPUP_COPY.errors.fallback);
        return;
      }
      setAwaiting(true);
      if (win) {
        // 原样使用服务端返回的地址；先断开 opener，付款页不能反向操作本页
        win.opener = null;
        win.location.href = data.checkoutUrl;
        handedOff = true;
        setNotice(TOPUP_COPY.opened);
      } else {
        // 被拦截：面板里给手动链接（已在上面提示过允许弹窗）
        setManualCheckoutUrl(data.checkoutUrl);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : TOPUP_COPY.errors.fallback);
    } finally {
      // 任何没把窗口交给结账页的路径（失败、异常、非 https）都关掉空白窗口
      if (win && !handedOff) {
        win.close();
      }
      setBusy(false);
    }
  }, [clientRef]);

  const clear = useCallback(() => {
    setPanelOpen(false);
    setUnavailable(false);
    setBusy(false);
    setError(null);
    setNotice(null);
    setAwaiting(false);
    setPopupBlocked(false);
    setManualCheckoutUrl(null);
  }, []);

  return useMemo(
    () => ({
      panelOpen,
      openPanel,
      closePanel,
      unavailable,
      busy,
      error,
      notice,
      awaiting,
      popupBlocked,
      manualCheckoutUrl,
      buy,
      onIngotPush,
      clear,
    }),
    [panelOpen, openPanel, closePanel, unavailable, busy, error, notice, awaiting, popupBlocked, manualCheckoutUrl, buy, onIngotPush, clear],
  );
}
