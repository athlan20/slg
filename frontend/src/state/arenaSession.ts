// 竞技场会话切片（v53，AISLG-145）：我的状态（名次 / 阵容 / 对手 / 榜单）的拉取、保存阵容、
// 发起挑战、战报分页，以及 PUSH_ARENA_STATE 到达时的联动。从 useGameSession 拆出以控制单文件行数。
// 次数、冷却与名次的权威判定在服务端；按钮上的禁用只是预判，错误以服务端返回为准。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type ArenaChallengeResponseData,
  type ArenaMatchView,
  type ArenaStatePushData,
  type ArenaStateView,
  type GetArenaReportsResponseData,
} from '../api/protocol';
import { getCopy } from '../i18n/bundle';
import type { Actor } from '../types';

const REPORTS_PAGE = 20;

interface ArenaSessionDeps {
  clientRef: { current: ApiClient | null };
  connected: boolean;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
}

export interface ArenaSession {
  /** 竞技场状态（null = 尚未拉取） */
  arena: ArenaStateView | null;
  /** 我的战报（null = 尚未拉取），按时间从新到旧 */
  reports: ArenaMatchView[] | null;
  reportsHasMore: boolean;
  error: string | null;
  busy: boolean;
  fetchArena: () => Promise<void>;
  /** 保存阵容（heroIds 三个号位，空位 null）；第一次保存即入榜 */
  saveLineup: (heroIds: Array<string | null>) => Promise<boolean>;
  challenge: (entryId: string) => Promise<boolean>;
  /** 拉战报：older = true 时接在已有列表后面翻页 */
  fetchReports: (older?: boolean) => Promise<void>;
  onArenaPush: (data: ArenaStatePushData) => void;
  clear: () => void;
}

/** 竞技场错误文案：优先用本地化文案（按错误码），没有对应码时回退服务端文案 */
export function arenaErrorText(code: string | undefined, message: string | undefined): string {
  const { ARENA_COPY } = getCopy();
  if (code && code in ARENA_COPY.errors) {
    return ARENA_COPY.errors[code as keyof typeof ARENA_COPY.errors];
  }
  return message ?? ARENA_COPY.session.failedFallback;
}

export function useArenaSession(deps: ArenaSessionDeps): ArenaSession {
  const { clientRef, connected, appendLocalEvent, scheduleSync } = deps;
  const [arena, setArena] = useState<ArenaStateView | null>(null);
  const [reports, setReportsState] = useState<ArenaMatchView[] | null>(null);
  const [reportsHasMore, setReportsHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 翻页要读最后一条的 id：用 ref 避免 fetchReports 因列表变化而换身份，进而触发挂载 effect 循环
  const reportsRef = useRef<ArenaMatchView[] | null>(null);
  const setReports = useCallback((next: ArenaMatchView[] | null) => {
    reportsRef.current = next;
    setReportsState(next);
  }, []);

  const fetchArena = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_ARENA, {});
      if (res.ok && res.data) {
        setArena(res.data as unknown as ArenaStateView);
      }
    } catch {
      // 拉取失败保留旧值，下次推送 / 重连再试
    }
  }, [clientRef]);

  const fetchReports = useCallback(
    async (older = false): Promise<void> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      const prev = reportsRef.current;
      const last = older && prev && prev.length > 0 ? prev[prev.length - 1] : null;
      try {
        const res = await client.request(Op.GET_ARENA_REPORTS, {
          limit: REPORTS_PAGE,
          ...(last ? { beforeId: last.id } : {}),
        });
        if (res.ok && res.data) {
          const out = res.data as unknown as GetArenaReportsResponseData;
          setReports(last && prev ? [...prev, ...out.reports] : out.reports);
          setReportsHasMore(out.hasMore);
        }
      } catch {
        // 拉取失败保留旧值
      }
    },
    [clientRef, setReports],
  );

  useEffect(() => {
    if (connected) {
      void fetchArena();
      void fetchReports();
    }
  }, [connected, fetchArena, fetchReports]);

  const saveLineup = useCallback(
    async (heroIds: Array<string | null>): Promise<boolean> => {
      const { ARENA_COPY } = getCopy();
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.SET_ARENA_LINEUP, { heroIds });
        if (res.ok && res.data) {
          const state = res.data as unknown as ArenaStateView;
          setArena(state);
          appendLocalEvent('player', state.rank !== null ? ARENA_COPY.session.joined(state.rank) : ARENA_COPY.session.saved);
          return true;
        }
        setError(arenaErrorText(res.error?.code, res.error?.message));
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : getCopy().ARENA_COPY.session.failedFallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, appendLocalEvent],
  );

  const challenge = useCallback(
    async (entryId: string): Promise<boolean> => {
      const { ARENA_COPY } = getCopy();
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.ARENA_CHALLENGE, { entryId });
        if (res.ok && res.data) {
          const out = res.data as unknown as ArenaChallengeResponseData;
          appendLocalEvent('player', ARENA_COPY.session.challenged(out.match.defender.username, out.match.challengerWon, out.rank));
          if (out.milestoneGold > 0) {
            appendLocalEvent('system', ARENA_COPY.session.milestone(out.milestoneGold));
          }
          // 奖励与战败扣款都在城池上：对齐资源；名次、次数与战报重拉
          scheduleSync();
          void fetchArena();
          void fetchReports();
          return true;
        }
        setError(arenaErrorText(res.error?.code, res.error?.message));
        // 名次可能已变化：重拉对手列表
        void fetchArena();
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : ARENA_COPY.session.failedFallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, appendLocalEvent, scheduleSync, fetchArena, fetchReports],
  );

  const onArenaPush = useCallback(
    (data: ArenaStatePushData): void => {
      const { ARENA_COPY } = getCopy();
      if (data.reason === 'challenged') {
        appendLocalEvent('system', ARENA_COPY.session.challengedBy(data.challenger ?? '', data.defeated === true, data.rank ?? 0));
        void fetchReports();
      } else if (data.reason === 'daily_reward') {
        appendLocalEvent('system', ARENA_COPY.session.daily(data.gold ?? 0, data.rank ?? 0));
        scheduleSync();
      } else if (data.reason === 'milestone') {
        appendLocalEvent('system', ARENA_COPY.session.milestone(data.gold ?? 0));
        scheduleSync();
      }
      void fetchArena();
    },
    [appendLocalEvent, scheduleSync, fetchArena, fetchReports],
  );

  const clear = useCallback((): void => {
    setArena(null);
    setReports(null);
    setReportsHasMore(false);
    setError(null);
    setBusy(false);
  }, [setReports]);

  return { arena, reports, reportsHasMore, error, busy, fetchArena, saveLineup, challenge, fetchReports, onArenaPush, clear };
}
