// 剧本战场会话切片（v75，AISLG-198）：拉取战场状态、报名、入场、拆队、行军 / 攻打、商店兑换。
// 推送只带事件摘要，收到后一律重拉权威状态；页面打开期间每分钟兜底重拉一次。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type BuyBattlefieldItemResponseData,
  type BattlefieldCamp,
  type BattlefieldPushData,
  type BattlefieldShopItem,
  type GetBattlefieldResponseData,
  type TroopKind,
} from '../api/protocol';
import { getCopy } from '../i18n/bundle';

const REFETCH_MS = 60_000;

export interface BattlefieldSession {
  state: GetBattlefieldResponseData | null;
  error: string | null;
  busy: boolean;
  fetchState: () => Promise<void>;
  signup: (camp: BattlefieldCamp) => Promise<boolean>;
  enter: (troops: Partial<Record<TroopKind, number>>) => Promise<boolean>;
  split: (squadId: string, troops: Partial<Record<TroopKind, number>>) => Promise<boolean>;
  march: (squadId: string, target: { strongholdId?: string; x?: number; y?: number }) => Promise<boolean>;
  buy: (item: BattlefieldShopItem, heroId?: string) => Promise<boolean>;
  onPush: (data: BattlefieldPushData) => void;
  clearError: () => void;
  clear: () => void;
}

/** 战场错误文案：优先按错误码取本地化文案，没有对应码时回退服务端文案 */
export function battlefieldErrorText(code: string | undefined, message: string | undefined): string {
  const { BATTLEFIELD_COPY } = getCopy();
  const errors = BATTLEFIELD_COPY.errors as Record<string, string>;
  if (code && code in errors) {
    return errors[code];
  }
  return message ?? BATTLEFIELD_COPY.errors.fallback;
}

export function useBattlefieldSession(deps: {
  clientRef: { current: ApiClient | null };
  connected: boolean;
}): BattlefieldSession {
  const { clientRef, connected } = deps;
  const [state, setState] = useState<GetBattlefieldResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchState = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_BATTLEFIELD, {});
      if (res.ok && res.data) {
        setState(res.data as unknown as GetBattlefieldResponseData);
      }
    } catch {
      // 拉取失败保留旧值，推送 / 下个周期再对齐
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

  const run = useCallback(
    async (op: number, data?: Record<string, unknown>): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(op, data);
        if (!res.ok) {
          setError(battlefieldErrorText(res.error?.code, res.error?.message));
          return false;
        }
        if (op === Op.GET_BATTLEFIELD) {
          setState(res.data as unknown as GetBattlefieldResponseData);
        } else if (res.data && 'event' in res.data) {
          setState(res.data as unknown as GetBattlefieldResponseData);
        } else {
          // 商店兑换只回执余额：重拉一次状态，让商店 / 军功同步
          await fetchState();
        }
        return true;
      } catch {
        setError(getCopy().BATTLEFIELD_COPY.errors.fallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [busy, clientRef, fetchState],
  );

  const signup = useCallback((camp: BattlefieldCamp) => run(Op.SIGNUP_BATTLEFIELD, { camp }), [run]);
  const enter = useCallback(
    (troops: Partial<Record<TroopKind, number>>) => run(Op.ENTER_BATTLEFIELD, { troops }),
    [run],
  );
  const split = useCallback(
    (squadId: string, troops: Partial<Record<TroopKind, number>>) =>
      run(Op.SPLIT_BATTLEFIELD_SQUAD, { squadId, troops }),
    [run],
  );
  const march = useCallback(
    (squadId: string, target: { strongholdId?: string; x?: number; y?: number }) =>
      run(Op.MARCH_BATTLEFIELD_SQUAD, { squadId, ...target }),
    [run],
  );
  const buy = useCallback(
    (item: BattlefieldShopItem, heroId?: string) => run(Op.BUY_BATTLEFIELD_ITEM, { item, ...(heroId ? { heroId } : {}) }),
    [run],
  );

  const onPush = useCallback((): void => {
    void fetchState();
  }, [fetchState]);

  const clearError = useCallback((): void => setError(null), []);
  const clear = useCallback((): void => {
    setState(null);
    setError(null);
  }, []);

  return { state, error, busy, fetchState, signup, enter, split, march, buy, onPush, clearError, clear };
}

export type { BuyBattlefieldItemResponseData };