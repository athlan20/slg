// 导航与界面级状态（页面切换 / 当前选中的建筑 / 地图图层）：跨页面共享。

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { BuildingKind } from '../api/protocol';
import { usePage, type PageKey } from './usePage';

export interface MapLayers {
  /** 流寇 · 商队（移动目标标记与路线） */
  moving: boolean;
  /** 黄巾营地 / 老巢 */
  yt: boolean;
  /** 领地（四种关系的铺色与外圈边界；关掉后只剩三角旗） */
  territory: boolean;
  /** 行军（本方行军的线、图标与视野外箭头；敌人来袭红标不受它控制） */
  marches: boolean;
  /** 产出（野地的资源图标与每小时产量、自己的地储量条） */
  yield: boolean;
}

/** 外部请求打开集市（侧栏账号菜单 / 资源缺口浮层）：id 变化即打开，neededGold 用于按缺口预填 */
export interface ExchangeAsk {
  id: number;
  neededGold?: number;
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
  /** 最近一次打开集市的请求（顶栏监听 id 变化） */
  exchangeAsk: ExchangeAsk;
  /** 打开集市；缺口浮层可带 neededGold，按还缺的金预填兑换数量 */
  requestExchange: (neededGold?: number) => void;
  /** 打开剧本战场（商店）：施计弹窗里「令不够 → 去战场商店兑换」用，id 变化即打开 */
  battlefieldAsk: { id: number };
  requestBattlefield: () => void;
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
  const [layers, setLayers] = useState<MapLayers>({ moving: true, yt: true, territory: true, marches: true, yield: false });
  const [seenReportId, setSeen] = useState<number>(readSeen);
  const [exchangeAsk, setExchangeAsk] = useState<ExchangeAsk>({ id: 0 });
  const requestExchange = useCallback((neededGold?: number) => {
    setExchangeAsk((prev) => ({ id: prev.id + 1, neededGold }));
  }, []);

  const [battlefieldAsk, setBattlefieldAsk] = useState<{ id: number }>({ id: 0 });
  const requestBattlefield = useCallback(() => {
    setBattlefieldAsk((prev) => ({ id: prev.id + 1 }));
  }, []);

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
      exchangeAsk,
      requestExchange,
      battlefieldAsk,
      requestBattlefield,
    }),
    [page, go, building, layers, toggleLayer, seenReportId, markReportsSeen, exchangeAsk, requestExchange, battlefieldAsk, requestBattlefield],
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
