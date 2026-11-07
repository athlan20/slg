// 五方势力会话切片（v99，AISLG-239）：连接就绪时拉一次 GET_FACTIONS，之后每分钟重拉（半径按真实天数变化，
// 没有推送；每分钟一次足够让第 8 / 15 / 22 天的半径变化及时上图）。开关关闭时服务端返回 enabled=false、
// factions 为空数组，地图与面板随之什么都不画。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op } from '../api/protocol';
import type { GetFactionsResponseData } from '../api/protocol-faction';

const REFETCH_MS = 60_000;

export interface FactionSession {
  /** 五方势力（null = 尚未拉取） */
  state: GetFactionsResponseData | null;
  fetchState: () => Promise<void>;
  clear: () => void;
}

export function useFactionSession(deps: { clientRef: { current: ApiClient | null }; connected: boolean }): FactionSession {
  const { clientRef, connected } = deps;
  const [state, setState] = useState<GetFactionsResponseData | null>(null);

  const fetchState = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_FACTIONS, {});
      if (res.ok && res.data) {
        setState(res.data as unknown as GetFactionsResponseData);
      }
    } catch {
      // 拉取失败保留旧值，下个周期再对齐
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

  const clear = useCallback((): void => setState(null), []);

  return { state, fetchState, clear };
}
