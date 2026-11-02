// 计谋切片（v86，AISLG-211）：GET_STRATAGEMS 的定义 / 令持有 / 逐武将预览与对目标的判定，
// CAST_STRATAGEM 的施计动作，以及被施计推送（PUSH_STRATAGEM）的警报队列。
// 弹窗开关也放在这里，地图 / 武将卡 / 行军列表 / 来袭预警都经 openPanel 打开同一个弹窗。
// 权威判定在服务端（HERO_* / TARGET_PROTECTED / STRATAGEM_TOKEN_*），这里只做展示用的预判。

import { useCallback, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import { Op, type CastStratagemResponseData, type CastStratagemRequestData, type GetStratagemsResponseData, type StratagemKind, type StratagemPushData } from '../api/protocol';
import { stratagemErrorText } from '../api/errorText';
import { getCopy } from '../i18n/bundle';

/** 打开弹窗时带进来的目标（来自地图上的城 / 行军列表 / 来袭预警） */
export interface StratagemTargetRef {
  cityId?: string;
  marchId?: string;
  attackId?: string;
  /** 目标城的名字与坐标：弹窗里展示，不参与请求 */
  label?: string;
  /** 只能施某一种计时（快捷入口用，如返程部队只给金蝉脱壳） */
  only?: StratagemKind[];
}

export interface StratagemPanelState {
  heroId: string | null;
  target: StratagemTargetRef | null;
}

export interface StratagemCastResult {
  ok: boolean;
  /** 结果文案（成功 / 免疫 / 判定失败 / 错误码） */
  text: string;
  /** 成功后按计谋给的效果（蛛丝马迹的情报列表在这里） */
  response: CastStratagemResponseData | null;
}

export interface StratagemSession {
  state: GetStratagemsResponseData | null;
  error: string | null;
  busy: boolean;
  panel: StratagemPanelState | null;
  /** 打开施计弹窗；heroId 缺省时用第一名在家武将 */
  openPanel: (init?: { heroId?: string | null; target?: StratagemTargetRef | null }) => void;
  closePanel: () => void;
  /** 拉取定义 / 令 / 武将 / 对目标判定（打开弹窗时调用；target 变化时重拉判定） */
  fetch: (target?: StratagemTargetRef | null, heroId?: string | null, kind?: StratagemKind) => Promise<void>;
  cast: (request: CastStratagemRequestData) => Promise<StratagemCastResult>;
  /** 被施计警报（推送到达即入队，弹窗逐条确认） */
  alerts: StratagemPushData[];
  dismissAlert: () => void;
  onPush: (data: StratagemPushData) => void;
  clear: () => void;
}

export function useStratagemSession(
  clientRef: { current: ApiClient | null },
  options: { scheduleSync: () => void },
): StratagemSession {
  const { scheduleSync } = options;
  const [state, setState] = useState<GetStratagemsResponseData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<StratagemPanelState | null>(null);
  const [alerts, setAlerts] = useState<StratagemPushData[]>([]);
  // 标记弹窗是否还在（异步回包时弹窗可能已被关掉）
  const panelOpenRef = useRef(false);

  const fetch = useCallback(
    async (target?: StratagemTargetRef | null, heroId?: string | null, kind?: StratagemKind) => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      const requestTarget =
        target && (target.cityId || target.marchId || target.attackId) && heroId
          ? {
              stratagem: (kind ?? target.only?.[0] ?? 'phantom_army') as StratagemKind,
              heroId,
              ...(target.cityId ? { cityId: target.cityId } : {}),
              ...(target.marchId ? { marchId: target.marchId } : {}),
              ...(target.attackId ? { attackId: target.attackId } : {}),
            }
          : undefined;
      setError(null);
      try {
        const res = await client.request(Op.GET_STRATAGEMS, requestTarget ? { target: requestTarget } : {});
        if (res.ok) {
          setState(res.data as unknown as GetStratagemsResponseData);
        } else {
          setError(stratagemErrorText(res.error?.code, res.error?.message));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : getCopy().STRATAGEM_COPY.errors.fallback);
      }
    },
    [clientRef],
  );

  const openPanel = useCallback(
    (init?: { heroId?: string | null; target?: StratagemTargetRef | null }) => {
      panelOpenRef.current = true;
      setPanel({ heroId: init?.heroId ?? null, target: init?.target ?? null });
      void fetch(init?.target ?? null, init?.heroId ?? null);
    },
    [fetch],
  );

  const closePanel = useCallback(() => {
    panelOpenRef.current = false;
    setPanel(null);
    setError(null);
  }, []);

  /** 施计：成功失败都按服务端结果给文案；成功后重拉一次（令数 / 冷却变了） */
  const cast = useCallback(
    async (request: CastStratagemRequestData): Promise<StratagemCastResult> => {
      const { STRATAGEM_COPY } = getCopy();
      const client = clientRef.current;
      if (!client?.connected) {
        return { ok: false, text: STRATAGEM_COPY.errors.fallback, response: null };
      }
      setBusy(true);
      try {
        const res = await client.request(Op.CAST_STRATAGEM, request as unknown as Record<string, unknown>);
        if (res.ok) {
          const data = res.data as unknown as CastStratagemResponseData;
          if (panelOpenRef.current) {
            void fetch(panel?.target ?? null, request.heroId, request.stratagem);
          }
          scheduleSync();
          const name = (STRATAGEM_COPY.name as Record<string, string>)[request.stratagem] ?? request.stratagem;
          const text = data.success
            ? STRATAGEM_COPY.panel.resultSuccess(name)
            : data.failedReason === 'immune'
              ? STRATAGEM_COPY.panel.resultImmune
              : STRATAGEM_COPY.panel.resultRoll;
          return { ok: true, text, response: data };
        }
        scheduleSync();
        return { ok: false, text: stratagemErrorText(res.error?.code, res.error?.message, res.data), response: null };
      } catch (err) {
        return { ok: false, text: err instanceof Error ? err.message : STRATAGEM_COPY.errors.fallback, response: null };
      } finally {
        setBusy(false);
      }
    },
    [clientRef, fetch, panel, scheduleSync],
  );

  const onPush = useCallback((data: StratagemPushData) => {
    setAlerts((prev) => [...prev, data]);
  }, []);

  const dismissAlert = useCallback(() => {
    setAlerts((prev) => prev.slice(1));
  }, []);

  const clear = useCallback(() => {
    panelOpenRef.current = false;
    setState(null);
    setError(null);
    setPanel(null);
    setAlerts([]);
    setBusy(false);
  }, []);

  return useMemo(
    () => ({ state, error, busy, panel, openPanel, closePanel, fetch, cast, alerts, dismissAlert, onPush, clear }),
    [state, error, busy, panel, openPanel, closePanel, fetch, cast, alerts, dismissAlert, onPush, clear],
  );
}
