// 科技研究会话切片（v27，AISLG-77）：科技表 / 进行中研究的拉取、发起、取消，
// 以及 PUSH_TECH_STATE 到达时的联动。从 useGameSession 拆出以控制单文件行数。
// 科技账号共享；书院等级按当前操作的城判定（cityId 由请求层按活动城注入），客户端按钮
// 直接用 city.levels.academy 预判，权威判定在服务端（ACADEMY_TOO_LOW 等）。

import { useCallback, useEffect, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type CityView,
  type ResearchView,
  type TechKind,
  type TechStatePushData,
  type TechStateView,
} from '../api/protocol';
import { techErrorText } from '../api/errorText';
import { TECH_COPY } from '../copy-tech';
import type { Actor } from '../types';

interface TechSessionDeps {
  clientRef: { current: ApiClient | null };
  connected: boolean;
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

export interface TechSession {
  /** 科技状态（null = 尚未拉取） */
  tech: TechStateView | null;
  error: string | null;
  busy: boolean;
  fetchTechs: () => Promise<void>;
  startResearch: (tech: TechKind) => Promise<boolean>;
  cancelResearch: () => Promise<boolean>;
  /** PUSH_TECH_STATE 到达：完成时重拉科技表并让城池状态对齐（产量 / 储量随等级变化） */
  onTechPush: (data: TechStatePushData) => void;
  clear: () => void;
}

export function useTechSession(deps: TechSessionDeps): TechSession {
  const { clientRef, connected, setCity, appendLocalEvent, scheduleSync } = deps;
  const [tech, setTech] = useState<TechStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const fetchTechs = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_TECHS, {});
      if (res.ok && res.data) {
        setTech(res.data as unknown as TechStateView);
      }
    } catch {
      // 拉取失败保留旧值，下次推送 / 重连再试
    }
  }, [clientRef]);

  useEffect(() => {
    if (connected) {
      void fetchTechs();
    }
  }, [connected, fetchTechs]);

  const label = (kind: TechKind) => TECH_COPY.names[kind];

  const startResearch = useCallback(
    async (kind: TechKind): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.RESEARCH_TECH, { tech: kind });
        if (res.ok) {
          const research = res.data?.research as ResearchView | undefined;
          if (research) {
            setTech((prev) => (prev ? { ...prev, research } : prev));
            appendLocalEvent('player', TECH_COPY.session.started(label(kind), research.level));
          }
          // 成本已扣：让城池资源对齐；科技表也重拉（下一级门槛 / 当前研究）
          scheduleSync();
          void fetchTechs();
          return true;
        }
        setError(techErrorText(res.error?.code, res.error?.message, res.data));
        const cityNow = res.data?.city as CityView | undefined;
        if (cityNow) {
          setCity(() => cityNow);
        }
        appendLocalEvent('player', TECH_COPY.session.rejected(res.error?.message ?? '失败'));
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : TECH_COPY.session.failedFallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, setCity, appendLocalEvent, scheduleSync, fetchTechs],
  );

  const cancelResearch = useCallback(async (): Promise<boolean> => {
    const client = clientRef.current;
    if (!client?.connected || busy) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await client.request(Op.CANCEL_RESEARCH, {});
      if (res.ok) {
        const research = res.data?.research as ResearchView | undefined;
        setTech((prev) => (prev ? { ...prev, research: null } : prev));
        if (research) {
          appendLocalEvent('player', TECH_COPY.session.cancelled(label(research.tech), research.level));
        }
        scheduleSync();
        void fetchTechs();
        return true;
      }
      setError(techErrorText(res.error?.code, res.error?.message, res.data));
      void fetchTechs();
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : TECH_COPY.session.failedFallback);
      return false;
    } finally {
      setBusy(false);
    }
  }, [clientRef, busy, appendLocalEvent, scheduleSync, fetchTechs]);

  const onTechPush = useCallback(
    (_data: TechStatePushData): void => {
      // 三种 reason 都以权威查询对齐：完成 → 等级与产量变化；发起 / 取消 → 成本扣除 / 返还
      void fetchTechs();
      scheduleSync();
    },
    [fetchTechs, scheduleSync],
  );

  const clear = useCallback((): void => {
    setTech(null);
    setError(null);
    setBusy(false);
  }, []);

  return { tech, error, busy, fetchTechs, startResearch, cancelResearch, onTechPush, clear };
}
