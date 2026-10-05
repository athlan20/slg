// 世界地图会话切片（v12 起，v13 增加侦察 / 行军撤回 / 战报）：地图窗口加载 / 地块详情
// 查询 / 出征、召回与侦察动作、行军撤回，以及 PUSH_TILE_STATE / PUSH_BATTLE_REPORT 到达时
// 的本地刷新。从 useGameSession 拆出以控制单文件行数；协议语义见 docs/agent-api.md。
// 与建造 / 征兵动作同形态：直接结果乐观更新（marches 经 cityUpdates），失败展示
// 人读错误并对齐响应附带的状态；地图与详情为按需查询，不随定期刷新轮询。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type BattleReportCommentView,
  type BattleReportView,
  type CityRefView,
  type CityView,
  type EventView,
  type MarchTask,
  type MarchView,
  type MarchStatePushData,
  type Resources,
  type ScoutIntel,
  type TileDetailView,
  type TileStatePushData,
  type TileView,
  type TroopKind,
  type WorldMapResponseData,
} from '../api/protocol';
import { cargoText, formatClock, marchErrorText } from '../api/mapping';
import { COPY } from '../copy';
import { CITY_COPY } from '../copy-cities';
import { MOVING_COPY } from '../copy-moving';
import type { Actor } from '../types';
import { applyMarchResult } from './cityUpdates';
import { clampZoom, loadSavedZoom, resizedOrigin, saveZoom } from './mapZoom';

/** 窗口边长（与服务端缺省一致：一屏 10×10；单边上限 20 见协议文档） */
/** 战报分页大小：首页条数，也是「加载更早」每页条数（协议上限 50） */
const BATTLE_REPORTS_PAGE_SIZE = 5;
/** 侦察记录的事件拉取条数（协议上限 200）：从最近事件里筛 march_completed outcome='scouted' */
const SCOUT_RECORD_EVENTS_LIMIT = 200;

/** 侦察记录（v23 AISLG-62）：事件流里 outcome='scouted' 的条目，情报快照 + 时间 */
export interface ScoutRecord {
  /** 事件 id（列表 key 与去重用） */
  id: number;
  intel: ScoutIntel;
  at: string;
}

export interface WorldSessionDeps {
  clientRef: { current: ApiClient | null };
  /** 连接在线（登录成功后自动加载主城周边窗口） */
  connected: boolean;
  setCity: (updater: (prev: CityView | null) => CityView | null) => void;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

export interface WorldSession {
  window: WorldMapResponseData | null;
  loading: boolean;
  selected: { x: number; y: number } | null;
  detail: TileDetailView | null;
  detailLoading: boolean;
  /** 出征 / 召回失败的人读提示（地图详情区内展示） */
  error: string | null;
  clearError: () => void;
  /** 重拉当前窗口与选中地块详情（推送到达 / 动作成功后调用） */
  refresh: () => Promise<void>;
  /** 以 (x, y) 为中心加载窗口 */
  centerOn: (x: number, y: number) => void;
  /** 平移窗口到指定原点（v23 AISLG-64 拖曳用；世界边界由服务端钳制） */
  panTo: (x: number, y: number) => void;
  pan: (dx: number, dy: number) => void;
  /** 当前缩放（窗口边长，格；AISLG-103）与缩放动作：size 越小放得越大；focus 为视口内比例位置（缺省中心） */
  viewSize: number;
  zoomTo: (size: number, focus?: { fx: number; fy: number }) => void;
  /** 按容器尺寸调整窗口格数（宽 / 高，格）：地图卡里的 ResizeObserver 驱动；焦点缺省取缩放时记下的焦点，否则视口中心 */
  resizeWindow: (w: number, h: number) => void;
  /** 回主城：不带坐标请求，由服务端以主城为中心取窗 */
  centerMainCity: () => void;
  selectTile: (x: number, y: number) => void;
  /** 取消选中（关闭地块详情弹窗） */
  deselectTile: () => void;
  /** 出征（v16：task 缺省 plunder；野地掠夺/占领，NPC 固定掠夺） */
  march: (
    x: number,
    y: number,
    troops: Partial<Record<TroopKind, number>>,
    task?: MarchTask,
    cargo?: Partial<Resources>,
    /** v28（AISLG-78）：截击移动目标——目标 id（(x, y) 须是其路线上的格） */
    targetId?: string,
    /** v36（AISLG-114）：随队武将 id（null / 缺省 = 不带将） */
    heroId?: string | null,
  ) => Promise<boolean>;
  recall: (x: number, y: number) => Promise<boolean>;
  /** 斥候侦察（SCOUT，v13）：城内扣减斥候、乐观插入侦察行军 */
  scout: (x: number, y: number, count: number, heroId?: string | null) => Promise<boolean>;
  /** 撤回行军途中的部队（RECALL_MARCH，v13）：行军翻转为返程 */
  recallMarch: (marchId: string) => Promise<boolean>;
  /** 战报列表（GET_BATTLE_REPORTS，v13；null = 尚未拉取） */
  battleReports: BattleReportView[] | null;
  reportsLoading: boolean;
  /** 更早的战报是否已翻完（服务端没有更多历史） */
  reportsExhausted: boolean;
  /** 「加载更早战报」翻页进行中 */
  reportsLoadingOlder: boolean;
  /** 拉取最近战报（打开战报面板 / 战报推送后调用） */
  fetchBattleReports: () => Promise<void>;
  /** 加载更早的一页战报（beforeId 游标 = 已加载的最小战报 id） */
  loadOlderBattleReports: () => Promise<void>;
  /** 按 id 取单份战报（事件流入口：战斗类事件只带 reportId；找不到 / 网络异常返回 null） */
  fetchBattleReportById: (reportId: number) => Promise<BattleReportView | null>;
  /** 侦察记录（v23 AISLG-62，GET_EVENTS 筛 outcome='scouted'；null = 尚未拉取） */
  scoutRecords: ScoutRecord[] | null;
  /** 拉取最近侦察记录（打开面板 / 侦察推送到达后调用） */
  fetchScoutRecords: () => Promise<void>;
  /** 反查某地块最近一次侦察情报（地块详情入口）：先查已加载记录，未命中再拉一轮事件 */
  findScoutIntel: (x: number, y: number) => Promise<ScoutIntel | null>;
  /** PUSH_TILE_STATE 到达：更新窗口内对应地块并刷新选中详情 */
  onTilePush: (tile: TileView) => void;
  /** PUSH_MARCH_STATE 到达（其他连接发起）：刷新窗口与详情对齐；侦察到达时另拉侦察记录 */
  onMarchPush: (scoutArrived?: boolean) => void;
  /** PUSH_BATTLE_REPORT 到达（v13）：置顶新战报 */
  onBattleReportPush: (report: BattleReportView) => void;
  /** 战报点评写入到达（v23 AISLG-53）：更新列表与缓存里对应战报的点评 */
  onBattleReportCommentPush: (reportId: number, comment: BattleReportCommentView) => void;
  clear: () => void;
}

function field<T>(data: Record<string, unknown> | undefined, key: string): T | undefined {
  return (data?.[key] as T | undefined) ?? undefined;
}

export function useWorldSession(deps: WorldSessionDeps): WorldSession {
  const { clientRef, connected, setCity, appendLocalEvent, scheduleSync } = deps;
  const [window, setWindow] = useState<WorldMapResponseData | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<{ x: number; y: number } | null>(null);
  const [detail, setDetail] = useState<TileDetailView | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [battleReports, setBattleReports] = useState<BattleReportView[] | null>(null);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [reportsExhausted, setReportsExhausted] = useState(false);
  const [reportsLoadingOlder, setReportsLoadingOlder] = useState(false);
  const [scoutRecords, setScoutRecords] = useState<ScoutRecord[] | null>(null);
  const originRef = useRef<{ x: number; y: number } | null>(null);
  /** 当前缩放（窗口边长，AISLG-103）：本地记忆；ref 供回调读最新值，state 供界面显示 */
  const viewSizeRef = useRef<number>(loadSavedZoom());
  /** 当前窗口镜像：缩放换算原点 / 世界边长时读最新值 */
  const windowRef = useRef<WorldMapResponseData | null>(null);
  const [viewSize, setViewSize] = useState<number>(viewSizeRef.current);
  /** 当前窗口格数（宽 × 高）：由容器尺寸决定，缺省先按缩放档位取方形 */
  const dimsRef = useRef<{ w: number; h: number }>({ w: viewSizeRef.current, h: viewSizeRef.current });
  /** 缩放动作记下的焦点：随后的窗口格数调整用它保持焦点下的世界格不动 */
  const zoomFocusRef = useRef<{ fx: number; fy: number } | null>(null);
  const selectedRef = useRef<{ x: number; y: number } | null>(null);
  const loadingRef = useRef(false);
  /** 在途窗口请求期间累积的最新请求（末次优先；v23 AISLG-64 拖曳连续换窗用） */
  const pendingWindowRef = useRef<{ x?: number; y?: number; w?: number; h?: number } | null>(null);
  /** 战报拉取的单飞标记（请求中不重复发起） */
  const reportsLoadingRef = useRef(false);
  const reportsLoadingOlderRef = useRef(false);
  /** 战报列表镜像：翻页游标（最小 id）在动作回调里读最新值，避免闭包拿到旧渲染快照 */
  const battleReportsRef = useRef<BattleReportView[] | null>(null);
  /** 按 id 反查到的战报小缓存：事件流重复打开同一份不再请求 */
  const reportCacheRef = useRef(new Map<number, BattleReportView>());
  /** 侦察记录镜像：反查动作里读最新值 */
  const scoutRecordsRef = useRef<ScoutRecord[] | null>(null);
  /** 侦察记录拉取的单飞标记 */
  const scoutLoadingRef = useRef(false);

  useEffect(() => {
    selectedRef.current = selected;
  }, [selected]);

  useEffect(() => {
    windowRef.current = window;
  }, [window]);

  useEffect(() => {
    battleReportsRef.current = battleReports;
  }, [battleReports]);

  useEffect(() => {
    scoutRecordsRef.current = scoutRecords;
  }, [scoutRecords]);

  const fetchWindow = useCallback(
    async (request: { x?: number; y?: number; w?: number; h?: number } = {}) => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      if (loadingRef.current) {
        // 已有窗口请求在途：记下最新请求（末次优先），完成后接着发——拖曳快速换窗不丢帧
        pendingWindowRef.current = request;
        return;
      }
      loadingRef.current = true;
      setLoading(true);
      try {
        const res = await client.request(Op.GET_WORLD_MAP, {
          w: dimsRef.current.w,
          h: dimsRef.current.h,
          ...request,
        });
        if (res.ok && Array.isArray(res.data?.tiles)) {
          const data = res.data as unknown as WorldMapResponseData;
          setWindow(data);
          originRef.current = { x: data.x, y: data.y };
        }
      } catch {
        // 网络异常：保留当前窗口，下次动作 / 推送重试
      } finally {
        loadingRef.current = false;
        setLoading(false);
        const pending = pendingWindowRef.current;
        pendingWindowRef.current = null;
        if (pending) {
          void fetchWindow(pending);
        }
      }
    },
    [clientRef],
  );

  const fetchDetail = useCallback(
    async (x: number, y: number) => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      setDetailLoading(true);
      try {
        const res = await client.request(Op.GET_TILE, { x, y });
        if (res.ok) {
          const tile = field<TileDetailView>(res.data, 'tile');
          if (tile) {
            setDetail(tile);
          }
        }
      } catch {
        // 网络异常：保留旧详情
      } finally {
        setDetailLoading(false);
      }
    },
    [clientRef],
  );

  // 登录在线后自动加载主城周边窗口（无窗口时）
  useEffect(() => {
    if (connected && originRef.current === null) {
      void fetchWindow();
    }
  }, [connected, fetchWindow]);

  const refresh = useCallback(async () => {
    const origin = originRef.current;
    await fetchWindow(origin ? { x: origin.x, y: origin.y } : {});
    const sel = selectedRef.current;
    if (sel) {
      await fetchDetail(sel.x, sel.y);
    }
  }, [fetchWindow, fetchDetail]);

  const centerOn = useCallback(
    (x: number, y: number) => {
      void fetchWindow({
        x: Math.max(0, x - Math.floor(dimsRef.current.w / 2)),
        y: Math.max(0, y - Math.floor(dimsRef.current.h / 2)),
      });
    },
    [fetchWindow],
  );

  /** 平移窗口到指定原点（v23 AISLG-64 拖曳换窗用；世界边界由服务端钳制） */
  const panTo = useCallback(
    (x: number, y: number) => {
      void fetchWindow({ x: Math.max(0, Math.floor(x)), y: Math.max(0, Math.floor(y)) });
    },
    [fetchWindow],
  );

  const pan = useCallback(
    (dx: number, dy: number) => {
      const origin = originRef.current ?? { x: 0, y: 0 };
      void fetchWindow({ x: Math.max(0, origin.x + dx), y: Math.max(0, origin.y + dy) });
    },
    [fetchWindow],
  );

  /**
   * 缩放（AISLG-103）：切换缩放档位（钳在 MAP_ZOOM_MIN..MAX，决定单格目标像素），窗口格数随后由容器尺寸推出
   * （resizeWindow）；焦点（视口内比例位置）下的世界格保持不动。越界（已在上下限）直接忽略，不发请求、不抖。
   */
  const zoomTo = useCallback((size: number, focus: { fx: number; fy: number } = { fx: 0.5, fy: 0.5 }) => {
    const next = clampZoom(size);
    if (next === viewSizeRef.current) {
      return;
    }
    viewSizeRef.current = next;
    zoomFocusRef.current = focus;
    setViewSize(next);
    saveZoom(next);
  }, []);

  /** 窗口格数调整（容器尺寸 / 缩放档位变化）：原点按焦点换算后乐观更新，窗口请求按末次优先合并 */
  const resizeWindow = useCallback(
    (w: number, h: number) => {
      const old = dimsRef.current;
      if (old.w === w && old.h === h) {
        return;
      }
      const focus = zoomFocusRef.current ?? { fx: 0.5, fy: 0.5 };
      zoomFocusRef.current = null;
      dimsRef.current = { w, h };
      const origin = originRef.current ?? (windowRef.current ? { x: windowRef.current.x, y: windowRef.current.y } : null);
      if (origin === null) {
        // 还没有窗口：由首次加载按主城取窗（带上新格数）
        void fetchWindow();
        return;
      }
      const target = resizedOrigin(origin, old, { w, h }, focus, windowRef.current?.size ?? 1000);
      originRef.current = target;
      void fetchWindow({ x: target.x, y: target.y, w, h });
    },
    [fetchWindow],
  );

  const centerMainCity = useCallback(() => {
    originRef.current = null;
    void fetchWindow();
  }, [fetchWindow]);

  const selectTile = useCallback(
    (x: number, y: number) => {
      setSelected({ x, y });
      setDetail(null);
      void fetchDetail(x, y);
    },
    [fetchDetail],
  );

  const deselectTile = useCallback(() => {
    setSelected(null);
    setDetail(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  /** 出征（MARCH，v16 task 缺省 plunder）：成功乐观插入行军列表；失败附带回的城池状态立即对齐 */
  const march = useCallback(
    async (
      x: number,
      y: number,
      troops: Partial<Record<TroopKind, number>>,
      task?: MarchTask,
      cargo?: Partial<Resources>,
      targetId?: string,
      heroId?: string | null,
    ): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return false;
      }
      setError(null);
      try {
        const res = await client.request(Op.MARCH, { x, y, troops, ...(task ? { task } : {}), ...(cargo ? { cargo } : {}), ...(targetId ? { targetId } : {}), ...(heroId ? { heroId } : {}) });
        if (res.ok) {
          const marchView = field<MarchView>(res.data, 'march');
          if (marchView) {
            setCity((prev) => (prev ? applyMarchResult(prev, marchView) : prev));
            appendLocalEvent(
              'player',
              marchView.purpose === 'transport'
                ? CITY_COPY.transport.startedLog(x, y, cargoText(marchView.cargo), formatClock(marchView.arriveAt))
                : marchView.purpose === 'intercept'
                  ? MOVING_COPY.march.started(x, y, formatClock(marchView.arriveAt))
                  : COPY.session.marchStarted(x, y, formatClock(marchView.arriveAt)),
            );
          }
          scheduleSync();
          void refresh();
          return true;
        }
        setError(marchErrorText(res.error?.code, res.error?.message));
        const cityNow = field<CityView>(res.data, 'city');
        if (cityNow) {
          setCity(() => cityNow);
        }
        appendLocalEvent('player', COPY.session.marchRejected(res.error?.message ?? '失败'));
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : COPY.session.marchFailedFallback);
        return false;
      }
    },
    [clientRef, setCity, appendLocalEvent, scheduleSync, refresh],
  );

  /** 召回驻军（RECALL_GARRISON）：撤回即放弃占领；领地与产量随按需查询对齐 */
  const recall = useCallback(
    async (x: number, y: number): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return false;
      }
      setError(null);
      try {
        const res = await client.request(Op.RECALL_GARRISON, { x, y });
        if (res.ok) {
          const marchView = field<MarchView>(res.data, 'march');
          if (marchView) {
            setCity((prev) => (prev ? applyMarchResult(prev, marchView) : prev));
            appendLocalEvent('player', COPY.session.recallStarted(x, y, formatClock(marchView.arriveAt)));
          } else {
            appendLocalEvent('player', `召回 (${x},${y})：地块已无驻军，占领已清除`);
          }
          scheduleSync();
          void refresh();
          return true;
        }
        setError(marchErrorText(res.error?.code, res.error?.message));
        appendLocalEvent('player', COPY.session.recallRejected(res.error?.message ?? '失败'));
        void refresh();
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : COPY.session.recallFailedFallback);
        return false;
      }
    },
    [clientRef, setCity, appendLocalEvent, scheduleSync, refresh],
  );

  /** 斥候侦察（SCOUT，v13）：城内扣减斥候、乐观插入侦察行军（purpose=scout） */
  const scout = useCallback(
    async (x: number, y: number, count: number, heroId?: string | null): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return false;
      }
      setError(null);
      try {
        const res = await client.request(Op.SCOUT, { x, y, count, ...(heroId ? { heroId } : {}) });
        if (res.ok) {
          const marchView = field<MarchView>(res.data, 'march');
          if (marchView) {
            setCity((prev) => {
              if (!prev) {
                return prev;
              }
              // 斥候已从城内扣减（服务端权威），本地乐观对齐（army 在 march 合并后覆盖）
              return { ...applyMarchResult(prev, marchView), army: { ...prev.army, scout: Math.max(0, prev.army.scout - count) } };
            });
            appendLocalEvent('player', COPY.session.scoutStarted(x, y, count, formatClock(marchView.arriveAt)));
          }
          scheduleSync();
          void refresh();
          return true;
        }
        setError(marchErrorText(res.error?.code, res.error?.message));
        const cityNow = field<CityView>(res.data, 'city');
        if (cityNow) {
          setCity(() => cityNow);
        }
        appendLocalEvent('player', res.error?.message ?? '侦察发起失败');
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : '侦察发起失败');
        return false;
      }
    },
    [clientRef, setCity, appendLocalEvent, scheduleSync, refresh],
  );

  /** 撤回行军途中的部队（RECALL_MARCH，v13）：行军翻转为返程 */
  const recallMarch = useCallback(
    async (marchId: string): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return false;
      }
      setError(null);
      try {
        const res = await client.request(Op.RECALL_MARCH, { marchId });
        if (res.ok) {
          const marchView = field<MarchView>(res.data, 'march');
          if (marchView) {
            setCity((prev) => (prev ? applyMarchResult(prev, marchView) : prev));
            appendLocalEvent('player', COPY.session.marchRecalled(formatClock(marchView.arriveAt)));
          }
          scheduleSync();
          void refresh();
          return true;
        }
        setError(marchErrorText(res.error?.code, res.error?.message));
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : '行军撤回失败');
        return false;
      }
    },
    [clientRef, setCity, appendLocalEvent, scheduleSync, refresh],
  );

  /** 拉取最近战报（GET_BATTLE_REPORTS，v13；首页，重置翻页游标） */
  const fetchBattleReports = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected || reportsLoadingRef.current) {
      return;
    }
    reportsLoadingRef.current = true;
    setReportsLoading(true);
    try {
      const res = await client.request(Op.GET_BATTLE_REPORTS, { limit: BATTLE_REPORTS_PAGE_SIZE });
      if (res.ok) {
        const reports = field<BattleReportView[]>(res.data, 'reports');
        if (reports) {
          setBattleReports(reports);
          // 不足一页说明服务端没有更早的战报
          setReportsExhausted(reports.length < BATTLE_REPORTS_PAGE_SIZE);
        }
      }
    } catch {
      // 网络异常：保留现有列表，下次动作重试
    } finally {
      reportsLoadingRef.current = false;
      setReportsLoading(false);
    }
  }, [clientRef]);

  /** 加载更早的一页战报（beforeId 游标 = 已加载的最小战报 id，按 id 去重合并） */
  const loadOlderBattleReports = useCallback(async () => {
    const client = clientRef.current;
    const current = battleReportsRef.current;
    if (!client?.connected || reportsLoadingOlderRef.current || !current || current.length === 0) {
      return;
    }
    reportsLoadingOlderRef.current = true;
    setReportsLoadingOlder(true);
    try {
      const beforeId = Math.min(...current.map((report) => report.id));
      const res = await client.request(Op.GET_BATTLE_REPORTS, { limit: BATTLE_REPORTS_PAGE_SIZE, beforeId });
      if (res.ok) {
        const reports = field<BattleReportView[]>(res.data, 'reports');
        if (reports) {
          if (reports.length < BATTLE_REPORTS_PAGE_SIZE) {
            setReportsExhausted(true);
          }
          setBattleReports((prev) => {
            const known = new Set((prev ?? []).map((report) => report.id));
            const fresh = reports.filter((report) => !known.has(report.id));
            return [...(prev ?? []), ...fresh];
          });
        }
      }
    } catch {
      // 网络异常：保持现状，下次点击重试
    } finally {
      reportsLoadingOlderRef.current = false;
      setReportsLoadingOlder(false);
    }
  }, [clientRef]);

  /** 按 id 取单份战报（v13）：协议没有按 id 单查的 op，用 beforeId「id 小于它的最新一条」
   *  游标语义恰好取回该 id（docs/battle-report-api.md 第 6 节）。先查已加载列表与小缓存。 */
  const fetchBattleReportById = useCallback(
    async (reportId: number): Promise<BattleReportView | null> => {
      const local =
        battleReportsRef.current?.find((report) => report.id === reportId) ??
        reportCacheRef.current.get(reportId);
      if (local) {
        return local;
      }
      const client = clientRef.current;
      if (!client?.connected) {
        return null;
      }
      try {
        const res = await client.request(Op.GET_BATTLE_REPORTS, { beforeId: reportId + 1, limit: 1 });
        if (!res.ok) {
          return null;
        }
        const reports = field<BattleReportView[]>(res.data, 'reports') ?? [];
        const report = reports.find((item) => item.id === reportId) ?? null;
        if (report) {
          // 缓存设上限：超出丢最早条目（Map 按插入序迭代）
          if (reportCacheRef.current.size >= 50) {
            const oldest = reportCacheRef.current.keys().next().value;
            if (oldest !== undefined) {
              reportCacheRef.current.delete(oldest);
            }
          }
          reportCacheRef.current.set(reportId, report);
        }
        return report;
      } catch {
        return null;
      }
    },
    [clientRef],
  );

  /** 拉取最近侦察记录（v23 AISLG-62）：GET_EVENTS 筛 march_completed outcome='scouted'，
   *  情报快照在 detail.intel；服务端按 id 倒序返回，记录按时间新→旧存放 */
  const fetchScoutRecords = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected || scoutLoadingRef.current) {
      return;
    }
    scoutLoadingRef.current = true;
    try {
      const res = await client.request(Op.GET_EVENTS, { limit: SCOUT_RECORD_EVENTS_LIMIT });
      if (res.ok) {
        const views = (field<EventView[]>(res.data, 'events') ?? []) as EventView[];
        const records: ScoutRecord[] = [];
        for (const view of views) {
          if (view.type !== 'march_completed' || view.detail.outcome !== 'scouted') {
            continue;
          }
          const intel = view.detail.intel as ScoutIntel | undefined;
          if (intel && Number.isFinite(Date.parse(intel.scoutedAt ?? ''))) {
            records.push({ id: view.id, intel, at: view.createdAt });
          }
        }
        setScoutRecords(records);
      }
    } catch {
      // 网络异常：保留现有记录，下次动作重试
    } finally {
      scoutLoadingRef.current = false;
    }
  }, [clientRef]);

  /** 反查某地块最近一次侦察情报（地块详情「查看侦察报告」入口）：
   *  先查已加载记录；未命中时再拉一轮事件（记录未加载或超出窗口）后返回 */
  const findScoutIntel = useCallback(
    async (x: number, y: number): Promise<ScoutIntel | null> => {
      const pickLatest = (records: ScoutRecord[] | null): ScoutIntel | null => {
        let best: ScoutRecord | null = null;
        for (const record of records ?? []) {
          if (record.intel.x === x && record.intel.y === y && (!best || record.id > best.id)) {
            best = record;
          }
        }
        return best?.intel ?? null;
      };
      const local = pickLatest(scoutRecordsRef.current);
      if (local) {
        return local;
      }
      await fetchScoutRecords();
      return pickLatest(scoutRecordsRef.current);
    },
    [fetchScoutRecords],
  );

  const onTilePush = useCallback(
    (tile: TileView) => {
      setWindow((prev) => {
        if (!prev) {
          return prev;
        }
        const inWindow =
          tile.x >= prev.x && tile.x < prev.x + prev.w && tile.y >= prev.y && tile.y < prev.y + prev.h;
        if (!inWindow) {
          return prev;
        }
        const tiles = prev.tiles.map((item) => (item.x === tile.x && item.y === tile.y ? tile : item));
        return { ...prev, tiles };
      });
      const sel = selectedRef.current;
      if (sel && sel.x === tile.x && sel.y === tile.y) {
        void fetchDetail(tile.x, tile.y);
      }
    },
    [fetchDetail],
  );

  const onMarchPush = useCallback(
    (scoutArrived?: boolean) => {
      void refresh();
      if (scoutArrived) {
        void fetchScoutRecords();
      }
    },
    [refresh, fetchScoutRecords],
  );

  /** PUSH_BATTLE_REPORT 到达（v13）：置顶新战报（列表未加载时不预取，按需拉取覆盖） */
  const onBattleReportPush = useCallback((report: BattleReportView) => {
    setBattleReports((prev) => (prev ? [report, ...prev.filter((r) => r.id !== report.id)].slice(0, 50) : prev));
  }, []);

  /** PUSH_BATTLE_REPORT_COMMENT 到达（v23 AISLG-53）：就地更新列表与缓存中该战报的点评 */
  const onBattleReportCommentPush = useCallback((reportId: number, comment: BattleReportCommentView) => {
    const patch = (report: BattleReportView): BattleReportView =>
      report.id === reportId ? { ...report, comment } : report;
    setBattleReports((prev) => (prev ? prev.map(patch) : prev));
    const cached = reportCacheRef.current.get(reportId);
    if (cached) {
      reportCacheRef.current.set(reportId, { ...cached, comment });
    }
  }, []);

  const clear = useCallback(() => {
    originRef.current = null;
    battleReportsRef.current = null;
    reportCacheRef.current.clear();
    scoutRecordsRef.current = null;
    setWindow(null);
    setSelected(null);
    setDetail(null);
    setError(null);
    setBattleReports(null);
    setReportsExhausted(false);
    setReportsLoadingOlder(false);
    setScoutRecords(null);
  }, []);

  // 返回对象 memo 化：全部动作回调均为稳定引用，对象身份只在自身状态变化时更新。
  // 会话钩子（useGameSession）以这些回调为依赖项，非稳定对象会令其启动 Effect 反复重建。
  return useMemo(
    () => ({
      window,
      loading,
      selected,
      detail,
      detailLoading,
      error,
      clearError,
      refresh,
      centerOn,
      panTo,
      pan,
      centerMainCity,
      viewSize,
      zoomTo,
      resizeWindow,
      selectTile,
      deselectTile,
      march,
      recall,
      scout,
      recallMarch,
      battleReports,
      reportsLoading,
      reportsExhausted,
      reportsLoadingOlder,
      fetchBattleReports,
      loadOlderBattleReports,
      fetchBattleReportById,
      scoutRecords,
      fetchScoutRecords,
      findScoutIntel,
      onTilePush,
      onMarchPush,
      onBattleReportPush,
      onBattleReportCommentPush,
      clear,
    }),
    [
      window,
      loading,
      selected,
      detail,
      detailLoading,
      error,
      battleReports,
      reportsLoading,
      reportsExhausted,
      reportsLoadingOlder,
      scoutRecords,
      clearError,
      refresh,
      centerOn,
      panTo,
      pan,
      centerMainCity,
      viewSize,
      zoomTo,
      resizeWindow,
      selectTile,
      deselectTile,
      march,
      recall,
      scout,
      recallMarch,
      fetchBattleReports,
      loadOlderBattleReports,
      fetchBattleReportById,
      fetchScoutRecords,
      findScoutIntel,
      onTilePush,
      onMarchPush,
      onBattleReportPush,
      onBattleReportCommentPush,
      clear,
    ],
  );
}

/** PUSH_MARCH_STATE 的载荷形状（重导出避免组件直接依赖内联类型） */
export type { MarchStatePushData, TileStatePushData, CityRefView };
