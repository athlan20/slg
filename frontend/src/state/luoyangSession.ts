// 洛阳争夺会话切片（v79，AISLG-200）：洛阳状态 / 窗口 / 政令，洛阳之主盟主发布政令。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type DecreeKind, type LuoyangStatusView } from '../api/protocol';
import { getCopy } from '../i18n/bundle';

const REFETCH_MS = 60_000;

export interface LuoyangSession {
  state: LuoyangStatusView | null;
  busy: boolean;
  error: string | null;
  fetchState: () => Promise<void>;
  publishDecree: (kind: DecreeKind) => Promise<boolean>;
  clearError: () => void;
  clear: () => void;
}

export function useLuoyangSession(deps: { clientRef: { current: ApiClient | null }; connected: boolean }): LuoyangSession {
  const { clientRef, connected } = deps;
  const [state, setState] = useState<LuoyangStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchState = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_LUOYANG, {});
      if (res.ok && res.data) {
        setState(res.data as unknown as LuoyangStatusView);
      }
    } catch {
      // 保留旧值，下个周期再对齐
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

  const publishDecree = useCallback(
    async (kind: DecreeKind): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.PUBLISH_DECREE, { kind });
        if (!res.ok) {
          setError(res.error?.message ?? getCopy().LUOYANG_COPY.errors.fallback);
          return false;
        }
        setState(res.data as unknown as LuoyangStatusView);
        return true;
      } catch {
        setError(getCopy().LUOYANG_COPY.errors.fallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, clientRef],
  );

  const clearError = useCallback(() => setError(null), []);
  const clear = useCallback(() => {
    setState(null);
    setError(null);
  }, []);

  return { state, busy, error, fetchState, publishDecree, clearError, clear };
}
