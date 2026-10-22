// 赛季会话切片（v65，AISLG-134）：当前赛季信息与我的荣誉（GET_SEASON / 登录响应）、预告弹窗、
// 换季维护遮罩（PUSH_SEASON resetting、MAINTENANCE 重试）、新赛季开始后的重连收尾与提示。
// 与连接层的衔接在 useGameSession：登录成功调用 applyLogin，断线重连成功同样调用；推送与 MAINTENANCE 直接转入。

import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type GetSeasonResponseData,
  type HonorView,
  type SeasonPushData,
} from '../api/protocol';

/** 换季维护期间轮询 GET_SEASON 的间隔（毫秒） */
const MAINTENANCE_POLL_MS = 10_000;
/** MAINTENANCE 响应没给 retryAfterSec 时的默认等待（秒） */
const DEFAULT_RETRY_SEC = 10;
/** 预告弹窗覆盖的阶段；T-3d 只在赛季胶囊上体现，不弹窗 */
const REMIND_STAGES: readonly string[] = ['T-1d', 'T-1h', 'T-10m'];

/** 当前赛季的最小视图：胶囊倒计时用（endsAt 为现实时刻，不受 timeScale 影响） */
export interface SeasonInfo {
  id: number;
  endsAt: string;
  name: string | null;
}

export interface SeasonSession {
  /** 当前赛季；未登录为 null */
  info: SeasonInfo | null;
  /** 我的荣誉称号（GET_SEASON） */
  honors: HonorView[];
  /** 全屏遮罩：换季维护中 / 新赛季开始待重连 / MAINTENANCE 等待重试 */
  masked: boolean;
  /** 服务端处于换季维护态（resetting 推送或 GET_SEASON.maintenance） */
  maintenance: boolean;
  /** 新赛季已开始、等待重连的遮罩阶段 */
  restarting: boolean;
  /** 新赛季开始提示的计数（每次开始 +1，弹出一次 toast） */
  startedToast: number;
  /** 待显示的预告弹窗（T-1d 及以后阶段；null = 不显示） */
  warning: SeasonPushData | null;
  dismissWarning: () => void;
  /** 拉取 GET_SEASON 并更新信息 / 荣誉 / 维护态 */
  refresh: () => Promise<void>;
  /** PUSH_SEASON 分发 */
  onPush: (data: SeasonPushData) => void;
  /** MAINTENANCE 响应：遮罩并按 retryAfterSec 稍后确认维护是否结束 */
  onMaintenance: (retryAfterSec: number | null) => void;
  /**
   * 登录 / 重连成功后调用。返回 true 表示赛季换了（新赛季开始后的重连，或离线期间错过了换季），
   * 调用方需要整体重新拉取游戏状态。
   */
  applyLogin: (season: { id: number; endsAt: string }) => boolean;
  /** 清空（回到登录表单） */
  clear: () => void;
}

function warnedKey(seasonId: number, stage: string): string {
  return `slg.season.warned.${seasonId}.${stage}`;
}

/** 预告阶段是否已弹过（localStorage 不可用时视为未弹过，每次都弹） */
function hasWarned(seasonId: number, stage: string): boolean {
  try {
    return window.localStorage.getItem(warnedKey(seasonId, stage)) === '1';
  } catch {
    return false;
  }
}

function markWarned(seasonId: number, stage: string): void {
  try {
    window.localStorage.setItem(warnedKey(seasonId, stage), '1');
  } catch {
    // 存储不可用（隐私模式 / 被禁用）时忽略：最多重复弹一次
  }
}

export function useSeasonSession(clientRef: MutableRefObject<ApiClient | null>, connected: boolean): SeasonSession {
  const [info, setInfo] = useState<SeasonInfo | null>(null);
  const [honors, setHonors] = useState<HonorView[]>([]);
  const [maintenance, setMaintenance] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [startedToast, setStartedToast] = useState(0);
  const [warning, setWarning] = useState<SeasonPushData | null>(null);
  /** 本连接登录过的赛季 id（applyLogin 写入，用于判断换季） */
  const loggedSeasonRef = useRef<number | null>(null);
  /** 收到 started 推送后置位：下一次登录必然是新赛季 */
  const pendingRestartRef = useRef(false);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_SEASON, {});
      if (!res.ok || !res.data) {
        return;
      }
      const data = res.data as unknown as GetSeasonResponseData;
      setInfo({ id: data.season.id, endsAt: data.season.endAt, name: data.season.name });
      setHonors(data.myHonors ?? []);
      setMaintenance(data.maintenance === true);
    } catch {
      // 断线时静默：下次登录 / 轮询会再拉
    }
  }, [clientRef]);

  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  const onPush = useCallback((data: SeasonPushData) => {
    if (data.phase === 'warning') {
      const stage = data.stage ?? '';
      if (REMIND_STAGES.includes(stage) && !hasWarned(data.seasonId, stage)) {
        markWarned(data.seasonId, stage);
        setWarning(data);
      }
      return;
    }
    if (data.phase === 'resetting') {
      setMaintenance(true);
      return;
    }
    if (data.phase === 'started') {
      // 服务端随后断开全部连接；客户端的断线重连会用令牌重新登录（applyLogin 收尾）
      pendingRestartRef.current = true;
      setMaintenance(false);
      setRestarting(true);
    }
  }, []);

  const onMaintenance = useCallback((retryAfterSec: number | null) => {
    const ms = (retryAfterSec ?? DEFAULT_RETRY_SEC) * 1000;
    setRetryAt((prev) => Math.max(prev ?? 0, Date.now() + ms));
  }, []);

  const applyLogin = useCallback((season: { id: number; endsAt: string }): boolean => {
    const previous = loggedSeasonRef.current;
    const changed = pendingRestartRef.current || (previous !== null && previous !== season.id);
    loggedSeasonRef.current = season.id;
    pendingRestartRef.current = false;
    setInfo((prev) => ({ id: season.id, endsAt: season.endsAt, name: prev?.id === season.id ? prev.name : null }));
    setRestarting(false);
    setRetryAt(null);
    if (changed) {
      setStartedToast((n) => n + 1);
    }
    return changed;
  }, []);

  const clear = useCallback(() => {
    loggedSeasonRef.current = null;
    pendingRestartRef.current = false;
    setInfo(null);
    setHonors([]);
    setMaintenance(false);
    setRestarting(false);
    setRetryAt(null);
    setWarning(null);
  }, []);

  const dismissWarning = useCallback(() => setWarning(null), []);

  // 维护期间定时确认是否已结束（推送可能丢失，或服务端回滚了换季）
  const maintenanceActive = maintenance || retryAt !== null;
  useEffect(() => {
    if (!connected || !maintenanceActive) {
      return undefined;
    }
    const timer = window.setInterval(() => void refreshRef.current(), MAINTENANCE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [connected, maintenanceActive]);

  // MAINTENANCE 的重试时刻到了：确认一次维护态
  useEffect(() => {
    if (retryAt === null) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      setRetryAt(null);
      void refreshRef.current();
    }, Math.max(0, retryAt - Date.now()));
    return () => window.clearTimeout(timer);
  }, [retryAt]);

  return {
    info,
    honors,
    masked: maintenance || restarting || retryAt !== null,
    maintenance,
    restarting,
    startedToast,
    warning,
    dismissWarning,
    refresh,
    onPush,
    onMaintenance,
    applyLogin,
    clear,
  };
}
