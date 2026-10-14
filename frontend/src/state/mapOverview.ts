// 世界小地图会话切片（v58，AISLG-160）：全图城池点位（GET_MAP_OVERVIEW）。
// 只在小地图展开时拉取并按 30 秒低频刷新；收起或离线时停止轮询。点位较多（城池约万级），
// 所以不随地图窗口联动，视野框由 world.window 在组件里换算。展开状态也放在这里，轮询依赖它。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type MapOverviewResponseData } from '../api/protocol';

/** 展开时的刷新间隔（毫秒）：城池变化（占领 / 被占）不要求秒级 */
const OVERVIEW_REFETCH_MS = 30_000;

export interface MapOverviewSession {
  /** 最近一次拉取的全图城池点位；未展开过或离线为 null */
  overview: MapOverviewResponseData | null;
  /** 小地图是否展开（展开才拉取） */
  open: boolean;
  setOpen: (open: boolean) => void;
}

export function useMapOverview(deps: { clientRef: { current: ApiClient | null }; connected: boolean }): MapOverviewSession {
  const { clientRef, connected } = deps;
  const [overview, setOverview] = useState<MapOverviewResponseData | null>(null);
  // 默认展开仅限宽屏（与图例一致，手机等窄屏默认收起不遮地图）
  const [open, setOpen] = useState(() => window.innerWidth >= 1024);

  const fetchOverview = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_MAP_OVERVIEW, {});
      if (res.ok && Array.isArray(res.data?.cities)) {
        setOverview(res.data as unknown as MapOverviewResponseData);
      }
    } catch {
      // 拉取失败保留旧点位，下个周期再对齐
    }
  }, [clientRef]);

  useEffect(() => {
    if (!connected) {
      setOverview(null);
      return undefined;
    }
    if (!open) {
      return undefined;
    }
    void fetchOverview();
    const timer = window.setInterval(() => void fetchOverview(), OVERVIEW_REFETCH_MS);
    return () => window.clearInterval(timer);
  }, [connected, open, fetchOverview]);

  return { overview, open, setOpen };
}
