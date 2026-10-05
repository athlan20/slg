// 侦察报告弹窗的全局宿主（v23，AISLG-62）：Provider 挂在 App 根部，任意组件经
// useScoutReportModal() 拿到打开句柄即可弹出同一份侦察报告弹窗（展示组件见
// components/ScoutReportModal）。打开入口：事件流（SessionEvent.scoutIntel）、
// 战报 / 侦察合并列表（worldSession.scoutRecords）与地块详情（findScoutIntel 反查）。
// 我方城内驻军经 provider 的 city 注入，用于「打不打得过」的战力对比行。

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { CityView, ScoutIntel } from '../api/protocol';
import { ScoutReportModal } from '../components/ScoutReportModal';

export interface ScoutReportModalApi {
  openScoutReport: (intel: ScoutIntel) => void;
  closeScoutReport: () => void;
}

interface ScoutReportModalProviderProps {
  children: ReactNode;
  /** 我方城池现状（战力对比用；未就绪时弹窗不显示对比行） */
  city: CityView | null;
}

const ScoutReportModalContext = createContext<ScoutReportModalApi | null>(null);

export function ScoutReportModalProvider({ children, city }: ScoutReportModalProviderProps) {
  const [intel, setIntel] = useState<ScoutIntel | null>(null);

  const openScoutReport = useCallback((next: ScoutIntel) => {
    setIntel(next);
  }, []);

  const closeScoutReport = useCallback(() => {
    setIntel(null);
  }, []);

  const api = useMemo(
    () => ({ openScoutReport, closeScoutReport }),
    [openScoutReport, closeScoutReport],
  );

  return (
    <ScoutReportModalContext.Provider value={api}>
      {children}
      {intel ? <ScoutReportModal intel={intel} city={city} onClose={closeScoutReport} /> : null}
    </ScoutReportModalContext.Provider>
  );
}

/** 取侦察报告弹窗的打开 / 关闭句柄（需在 ScoutReportModalProvider 内） */
export function useScoutReportModal(): ScoutReportModalApi {
  const api = useContext(ScoutReportModalContext);
  if (!api) {
    throw new Error('useScoutReportModal 需在 ScoutReportModalProvider 内使用');
  }
  return api;
}
