// 移动目标会话切片（v28 AISLG-78）：当前存在的流寇 / 运粮商队列表（含公开路线与时刻表）。
// 连接就绪时拉取，推送（刷出 / 被截获 / 消失）增量合并，另每分钟重拉一次对齐（推送可能漏收）。
// 位置由时刻表在本地按时钟推算，不需要高频轮询。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type MovingTargetPushData, type MovingTargetView } from '../api/protocol';

/** 对齐重拉间隔（毫秒） */
const REFETCH_MS = 60_000;

export interface MovingTargetsSession {
  /** 当前存在的移动目标（按截止时刻升序） */
  targets: MovingTargetView[];
  fetchTargets: () => Promise<void>;
  /** PUSH_MOVING_TARGET_STATE 到达：刷出则加入，被截获 / 消失则移除 */
  onPush: (data: MovingTargetPushData) => void;
  clear: () => void;
}

export function useMovingTargets(deps: { clientRef: { current: ApiClient | null }; connected: boolean }): MovingTargetsSession {
  const { clientRef, connected } = deps;
  const [targets, setTargets] = useState<MovingTargetView[]>([]);

  const fetchTargets = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_MOVING_TARGETS, {});
      if (res.ok && Array.isArray(res.data?.targets)) {
        setTargets(res.data.targets as unknown as MovingTargetView[]);
      }
    } catch {
      // 拉取失败保留旧列表，下个周期 / 推送再对齐
    }
  }, [clientRef]);

  useEffect(() => {
    if (!connected) {
      return undefined;
    }
    void fetchTargets();
    const timer = window.setInterval(() => void fetchTargets(), REFETCH_MS);
    return () => window.clearInterval(timer);
  }, [connected, fetchTargets]);

  const onPush = useCallback((data: MovingTargetPushData): void => {
    setTargets((prev) => {
      const rest = prev.filter((item) => item.id !== data.target.id);
      return data.reason === 'spawned'
        ? [...rest, data.target].sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
        : rest;
    });
  }, []);

  const clear = useCallback((): void => setTargets([]), []);

  return { targets, fetchTargets, onPush, clear };
}
