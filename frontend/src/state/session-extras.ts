// 会话扩展切片（v23，从 useGameSession 拆出以控制单文件行数）：
// - 离线日报（AISLG-54）：GET_OFFLINE_REPORT 拉取 + 离线 ≥ 30 分钟自动弹出；
//   checkOfflineReportRef 是「最新回调」桥——登录 / 重连流程先于本 hook 声明使用。
// - 全服播报（AISLG-60）：GET_SERVER_BROADCASTS 拉取 + PUSH_SERVER_BROADCAST 实时置顶。
// - 排行榜（AISLG-61）：GET_LEADERBOARD 按榜单拉取。
// - NPC 来袭预警（v23 AISLG-57 推送，AISLG-66 前端消费）：PUSH_NPC_ATTACK_WARNING
//   到达即进待弹列表，逐条弹窗直至玩家确认。
// 全部只依赖 clientRef；游戏状态（城池 / 事件 / 地图）仍由 useGameSession 主理。

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type GetLeaderboardResponseData,
  type GetOfflineReportResponseData,
  type LeaderboardKind,
  type LeaderboardView,
  type NpcAttackWarningPushData,
  type ServerBroadcastView,
} from '../api/protocol';
import { COPY } from '../copy';

/** 离线日报自动弹出的门槛（秒；占位值 30 分钟，随需求「已定」标注可调） */
const OFFLINE_REPORT_THRESHOLD_SECONDS = 30 * 60;

function field<T>(data: Record<string, unknown> | undefined, key: string): T | undefined {
  return (data?.[key] as T | undefined) ?? undefined;
}

export interface SessionExtras {
  /** 离线日报（非 null 时弹窗展示：上线自动弹出 / 手动打开） */
  offlineReport: GetOfflineReportResponseData | null;
  /** 拉取离线日报并弹窗（Agent 面板「离线日报」按钮） */
  openOfflineReport: () => Promise<void>;
  /** 关闭离线日报弹窗 */
  closeOfflineReport: () => void;
  /** 离线日报拉取失败的人读提示 */
  offlineReportError: string | null;
  /** 最近一次拉到的离线日报（Agent 页摘要用；不弹窗） */
  offlineSummary: GetOfflineReportResponseData | null;
  /** 拉取日报摘要（进入 Agent 页时调用，不弹窗） */
  loadOfflineSummary: () => Promise<void>;
  /** 上线自动检查的「最新回调」桥（登录 / 重连流程经 .current() 调用） */
  checkOfflineReportRef: RefObject<() => Promise<void>>;
  /** 全服播报：最近 20 条（新→旧） */
  broadcasts: ServerBroadcastView[];
  /** 拉取最近全服播报（登录 / 重连后与点击展开时调用） */
  fetchServerBroadcasts: () => Promise<void>;
  /** 全服播报推送到达：置顶最新一条（保留最近 20 条） */
  onBroadcastPush: (broadcast: ServerBroadcastView) => void;
  /** NPC 来袭预警（AISLG-66）：待确认列表（新→旧逐条弹窗）；空 = 无预警 */
  npcWarnings: NpcAttackWarningPushData[];
  /** NPC 来袭预警推送到达：加入待确认列表（同 attackId 去重，保留最近 5 条） */
  onNpcWarningPush: (warning: NpcAttackWarningPushData) => void;
  /** 确认并关闭一条预警 */
  dismissNpcWarning: (attackId: string) => void;
  /** 登出 / 切换账号时清空（预警是账号私有信息） */
  resetNpcWarnings: () => void;
  /** 排行榜：当前榜快照；null = 尚未拉取 */
  leaderboard: LeaderboardView | null;
  /** 拉取指定榜单（打开弹窗 / 切换榜 / 手动刷新） */
  fetchLeaderboard: (kind: LeaderboardKind) => Promise<void>;
  leaderboardLoading: boolean;
  leaderboardError: string | null;
  closeLeaderboard: () => void;
}

export function useSessionExtras(clientRef: RefObject<ApiClient | null>): SessionExtras {
  const [offlineReport, setOfflineReport] = useState<GetOfflineReportResponseData | null>(null);
  const [offlineReportError, setOfflineReportError] = useState<string | null>(null);
  const [offlineSummary, setOfflineSummary] = useState<GetOfflineReportResponseData | null>(null);
  const [broadcasts, setBroadcasts] = useState<ServerBroadcastView[]>([]);
  const [npcWarnings, setNpcWarnings] = useState<NpcAttackWarningPushData[]>([]);
  const [leaderboard, setLeaderboard] = useState<GetLeaderboardResponseData | null>(null);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [leaderboardError, setLeaderboardError] = useState<string | null>(null);
  /** 离线日报自动检查的最新回调桥：登录 / 重连处先于声明使用，经 ref 解依赖环 */
  const checkOfflineReportRef = useRef<() => Promise<void>>(async () => undefined);

  /** 拉取离线日报（GET_OFFLINE_REPORT，op 41）：弹出与否由调用方按离线秒数判定 */
  const fetchOfflineReport = useCallback(async (): Promise<GetOfflineReportResponseData | null> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return null;
    }
    try {
      const res = await client.request(Op.GET_OFFLINE_REPORT, {});
      if (res.ok && res.data) {
        const data = res.data as unknown as GetOfflineReportResponseData;
        setOfflineSummary(data);
        return data;
      }
    } catch {
      // 网络异常：按无数据处理
    }
    return null;
  }, []);

  /** 上线自动检查：离线 ≥ 30 分钟（触发门槛占位值）时自动弹出日报 */
  const checkOfflineReport = useCallback(async () => {
    const data = await fetchOfflineReport();
    if (data && data.offline.seconds >= OFFLINE_REPORT_THRESHOLD_SECONDS) {
      setOfflineReport(data);
    }
  }, [fetchOfflineReport]);

  /** 手动打开离线日报（Agent 面板按钮） */
  const openOfflineReport = useCallback(async () => {
    setOfflineReportError(null);
    const data = await fetchOfflineReport();
    if (data) {
      setOfflineReport(data);
    } else {
      setOfflineReportError(COPY.session.connectFailed);
    }
  }, [fetchOfflineReport]);

  const closeOfflineReport = useCallback(() => setOfflineReport(null), []);

  const loadOfflineSummary = useCallback(async () => {
    await fetchOfflineReport();
  }, [fetchOfflineReport]);

  /** 拉取最近全服播报（登录 / 重连后与点击展开时调用） */
  const fetchServerBroadcasts = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_SERVER_BROADCASTS, { limit: 20 });
      if (res.ok) {
        const list = field<ServerBroadcastView[]>(res.data, 'broadcasts');
        if (list) {
          setBroadcasts(list);
        }
      }
    } catch {
      // 网络异常：保留现有列表
    }
  }, []);

  useEffect(() => {
    checkOfflineReportRef.current = checkOfflineReport;
  }, [checkOfflineReport]);

  /** 拉取指定榜单快照（GET_LEADERBOARD，op 43） */
  const fetchLeaderboard = useCallback(
    async (kind: LeaderboardKind) => {
      const client = clientRef.current;
      if (!client?.connected) {
        setLeaderboardError(COPY.session.connectFailed);
        return;
      }
      setLeaderboardLoading(true);
      setLeaderboardError(null);
      try {
        const res = await client.request(Op.GET_LEADERBOARD, { kind });
        if (res.ok && res.data) {
          setLeaderboard(res.data as unknown as GetLeaderboardResponseData);
        } else {
          setLeaderboardError(COPY.leaderboard.loadFailed);
        }
      } catch {
        setLeaderboardError(COPY.leaderboard.loadFailed);
      } finally {
        setLeaderboardLoading(false);
      }
    },
    [],
  );

  const closeLeaderboard = useCallback(() => setLeaderboardError(null), []);

  useEffect(() => {
    checkOfflineReportRef.current = checkOfflineReport;
  }, [checkOfflineReport]);

  /** 全服播报推送到达（v23 AISLG-60）：置顶最新一条，保留最近 20 条 */
  const onBroadcastPush = useCallback((broadcast: ServerBroadcastView) => {
    setBroadcasts((prev) => [broadcast, ...prev].slice(0, 20));
  }, []);

  /** NPC 来袭预警推送到达（AISLG-66）：进待确认列表（尾部 = 下一条弹出）；同一次袭击只留一条 */
  const onNpcWarningPush = useCallback((warning: NpcAttackWarningPushData) => {
    setNpcWarnings((prev) => [...prev.filter((item) => item.attackId !== warning.attackId), warning].slice(-5));
  }, []);

  const dismissNpcWarning = useCallback((attackId: string) => {
    setNpcWarnings((prev) => prev.filter((item) => item.attackId !== attackId));
  }, []);

  const resetNpcWarnings = useCallback(() => setNpcWarnings([]), []);

  return {
    offlineReport,
    onBroadcastPush,
    onNpcWarningPush,
    npcWarnings,
    dismissNpcWarning,
    resetNpcWarnings,
    openOfflineReport,
    closeOfflineReport,
    offlineReportError,
    offlineSummary,
    loadOfflineSummary,
    checkOfflineReportRef,
    broadcasts,
    fetchServerBroadcasts,
    leaderboard,
    fetchLeaderboard,
    leaderboardLoading,
    leaderboardError,
    closeLeaderboard,
  };
}
