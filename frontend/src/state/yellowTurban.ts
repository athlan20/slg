// 黄巾之乱会话切片（v29 AISLG-76）：事件进度 / 营地 / 我的贡献 / 贡献榜。连接就绪时拉取，
// 推送（起事 / 进度 / 老巢出现 / 收场）到达立即重拉，另每分钟重拉一次对齐（推送可能漏收）。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type YellowTurbanState } from '../api/protocol';

const REFETCH_MS = 60_000;

export interface YellowTurbanSession {
  /** 黄巾之乱状态（null = 尚未拉取） */
  state: YellowTurbanState | null;
  fetchState: () => Promise<void>;
  /** PUSH_YELLOW_TURBAN_STATE 到达：重拉权威状态（推送只带事件摘要，营地坐标要重查） */
  onPush: () => void;
  clear: () => void;
}

export function useYellowTurban(deps: { clientRef: { current: ApiClient | null }; connected: boolean }): YellowTurbanSession {
  const { clientRef, connected } = deps;
  const [state, setState] = useState<YellowTurbanState | null>(null);

  const fetchState = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_YELLOW_TURBAN, {});
      if (res.ok && res.data) {
        setState(res.data as unknown as YellowTurbanState);
      }
    } catch {
      // 拉取失败保留旧值，下个周期 / 推送再对齐
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

  const onPush = useCallback((): void => {
    void fetchState();
  }, [fetchState]);

  const clear = useCallback((): void => setState(null), []);

  return { state, fetchState, onPush, clear };
}
