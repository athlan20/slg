// 导航与界面级状态（页面切换 / 当前选中的建筑 / 地图图层）：跨页面共享。

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { BuildingKind } from '../api/protocol';
import { usePage, type PageKey } from './usePage';

export interface MapLayers {
  /** 流寇 · 商队（移动目标标记与路线） */
  moving: boolean;
  /** 黄巾营地 / 老巢 */
  yt: boolean;
  /** 我的领地（连片描边） */
  mine: boolean;
}

export interface NavState {
  page: PageKey;
  go: (page: PageKey) => void;
  /** 城池页选中的建筑 */
  building: BuildingKind | null;
  selectBuilding: (kind: BuildingKind | null) => void;
  layers: MapLayers;
  toggleLayer: (key: keyof MapLayers) => void;
  /** 情报页已看到的最大战报 id（本地记忆，角标 = 比它新的战报数） */
  seenReportId: number;
  markReportsSeen: (maxId: number) => void;
}

const NavContext = createContext<NavState | null>(null);

const SEEN_KEY = 'slg.seenReportId';

function readSeen(): number {
  try {
    const raw = window.localStorage.getItem(SEEN_KEY);
    const value = raw === null ? 0 : Number(raw);
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [page, go] = usePage();
  const [building, setBuilding] = useState<BuildingKind | null>(null);
  const [layers, setLayers] = useState<MapLayers>({ moving: true, yt: true, mine: true });
  const [seenReportId, setSeen] = useState<number>(readSeen);

  const toggleLayer = useCallback((key: keyof MapLayers) => setLayers((prev) => ({ ...prev, [key]: !prev[key] })), []);
  const markReportsSeen = useCallback((maxId: number) => {
    setSeen((prev) => {
      if (maxId <= prev) {
        return prev;
      }
      try {
        window.localStorage.setItem(SEEN_KEY, String(maxId));
      } catch {
        // 记忆失败不影响角标本次清零
      }
      return maxId;
    });
  }, []);

  const value = useMemo<NavState>(
    () => ({
      page,
      go,
      building,
      selectBuilding: setBuilding,
      layers,
      toggleLayer,
      seenReportId,
      markReportsSeen,
    }),
    [page, go, building, layers, toggleLayer, seenReportId, markReportsSeen],
  );

  return <NavContext.Provider value={value}>{children}</NavContext.Provider>;
}

export function useNav(): NavState {
  const value = useContext(NavContext);
  if (!value) {
    throw new Error('useNav 需在 NavProvider 内使用');
  }
  return value;
}
