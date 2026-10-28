// 玩家交易所会话切片（v78，AISLG-196）：挂单列表 / 筛选 / 挂单 / 吃单 / 撤单 / 我的成交。
// 查询响应即权威状态；写操作成功后重新拉一次（并触发城池资源刷新）。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type MarketBuyKind,
  type MarketResource,
  type GetMarketResponseData,
} from '../api/protocol';
import { getCopy } from '../i18n/bundle';

export interface MarketFilters {
  sellResource?: MarketResource;
  buyResource?: MarketBuyKind;
}

export interface MarketSession {
  state: GetMarketResponseData | null;
  filters: MarketFilters;
  page: number;
  busy: boolean;
  error: string | null;
  fetchState: (page?: number, filters?: MarketFilters) => Promise<void>;
  setFilters: (filters: MarketFilters) => void;
  create: (input: { sellResource: MarketResource; buyResource: MarketBuyKind; amount: number; unitPrice: number; allyOnly: boolean }) => Promise<boolean>;
  buy: (orderId: string, quantity: number) => Promise<boolean>;
  cancel: (orderId: string) => Promise<boolean>;
  clearError: () => void;
  clear: () => void;
}

export function marketErrorText(code: string | undefined, message: string | undefined, data?: Record<string, unknown>): string {
  const { MARKET_COPY } = getCopy();
  const errors = MARKET_COPY.errors;
  switch (code) {
    case 'MARKET_LOCKED':
      return errors.MARKET_LOCKED;
    case 'PRICE_OUT_OF_RANGE':
      return errors.PRICE_OUT_OF_RANGE(Number(data?.min ?? 0), Number(data?.max ?? 0));
    case 'ORDER_LIMIT':
      return errors.ORDER_LIMIT;
    case 'DAILY_TRADE_LIMIT':
      return errors.DAILY_TRADE_LIMIT(Number(data?.remaining ?? 0));
    case 'ORDER_NOT_FOUND':
      return errors.ORDER_NOT_FOUND;
    case 'MARKET_ALLY_ONLY':
      return errors.MARKET_ALLY_ONLY;
    case 'ORDER_NOT_CANCELLABLE':
      return errors.ORDER_NOT_CANCELLABLE;
    case 'INSUFFICIENT_RESOURCES':
      return errors.INSUFFICIENT_RESOURCES;
    case 'INVALID_PARAMS':
      return errors.INVALID_PARAMS;
    default:
      return message ?? errors.fallback;
  }
}

export function useMarketSession(deps: {
  clientRef: { current: ApiClient | null };
  connected: boolean;
  scheduleSync: () => void;
}): MarketSession {
  const { clientRef, connected, scheduleSync } = deps;
  const [state, setState] = useState<GetMarketResponseData | null>(null);
  const [filters, setFiltersState] = useState<MarketFilters>({});
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(
    async (nextPage = 1, nextFilters: MarketFilters = {}) => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      try {
        const res = await client.request(Op.GET_MARKET, {
          page: nextPage,
          ...(nextFilters.sellResource ? { sellResource: nextFilters.sellResource } : {}),
          ...(nextFilters.buyResource ? { buyResource: nextFilters.buyResource } : {}),
        });
        if (res.ok && res.data) {
          setState(res.data as unknown as GetMarketResponseData);
          setPage(nextPage);
        }
      } catch {
        // 保留旧值，下次重连 / 操作再对齐
      }
    },
    [clientRef],
  );

  useEffect(() => {
    if (connected) {
      void fetchState(page, filters);
    }
    // 只在连接状态变化时重拉；筛选 / 翻页由界面显式触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  const setFilters = useCallback(
    (next: MarketFilters) => {
      setFiltersState(next);
      void fetchState(1, next);
    },
    [fetchState],
  );

  const run = useCallback(
    async (op: number, data: Record<string, unknown>): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(op, data);
        if (!res.ok) {
          setError(marketErrorText(res.error?.code, res.error?.message, res.data));
          return false;
        }
        await fetchState(page, filters);
        scheduleSync();
        return true;
      } catch {
        setError(getCopy().MARKET_COPY.errors.fallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, clientRef, fetchState, filters, page, scheduleSync],
  );

  const create = useCallback(
    (input: { sellResource: MarketResource; buyResource: MarketBuyKind; amount: number; unitPrice: number; allyOnly: boolean }) =>
      run(Op.CREATE_MARKET_ORDER, input),
    [run],
  );
  const buy = useCallback((orderId: string, quantity: number) => run(Op.BUY_MARKET_ORDER, { orderId, quantity }), [run]);
  const cancel = useCallback((orderId: string) => run(Op.CANCEL_MARKET_ORDER, { orderId }), [run]);

  const clearError = useCallback(() => setError(null), []);
  const clear = useCallback(() => {
    setState(null);
    setError(null);
    setFiltersState({});
    setPage(1);
  }, []);

  return { state, filters, page, busy, error, fetchState, setFilters, create, buy, cancel, clearError, clear };
}
