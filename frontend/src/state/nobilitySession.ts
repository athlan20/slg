// 声望与爵位会话切片（v76，AISLG-197）：爵位 / 今日俸禄状态、领取俸禄。
// 声望由服务端战斗结算自动入账，客户端只读；领俸禄后重拉状态（金币由城池自动刷新周期对齐）。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type ClaimNobilitySalaryResponseData, type NobilityStatusView } from '../api/protocol';
import { getCopy } from '../i18n/bundle';

export interface NobilitySession {
  state: NobilityStatusView | null;
  busy: boolean;
  error: string | null;
  fetchState: () => Promise<void>;
  claim: () => Promise<boolean>;
  clear: () => void;
}

const REFETCH_MS = 60_000;

export function useNobilitySession(deps: { clientRef: { current: ApiClient | null }; connected: boolean }): NobilitySession {
  const { clientRef, connected } = deps;
  const [state, setState] = useState<NobilityStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_NOBILITY, {});
      if (res.ok && res.data) {
        setState(res.data as unknown as NobilityStatusView);
      }
    } catch {
      // 拉取失败保留旧值，下次重连 / 操作再对齐
    }
  }, [clientRef]);

  useEffect(() => {
    if (!connected) {
      return undefined;
    }
    void fetchState();
    const timer = window.setInterval(() => void fetchState(), REFETCH_MS);
    return () => window.clearInterval(timer);
  }, [connected, fetchState]);

  const claim = useCallback(async (): Promise<boolean> => {
    const client = clientRef.current;
    if (!client?.connected || busy) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await client.request(Op.CLAIM_NOBILITY_SALARY, {});
      if (!res.ok) {
        setError(res.error?.message ?? getCopy().CITY_COPY.nobility.claimFailed);
        return false;
      }
      const data = res.data as unknown as ClaimNobilitySalaryResponseData;
      await fetchState();
      return data.gold > 0;
    } catch {
      setError(getCopy().CITY_COPY.nobility.claimFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }, [busy, clientRef, fetchState]);

  const clear = useCallback((): void => {
    setState(null);
    setError(null);
  }, []);

  return { state, busy, error, fetchState, claim, clear };
}
