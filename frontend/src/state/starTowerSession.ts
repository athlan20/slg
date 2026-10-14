// 将星塔会话切片（v55，AISLG-146）：进度（已通过层 / 下一层 / 敌方 / 奖励）的拉取、挑战下一层、
// 阵容保存（与竞技场共用 SET_ARENA_LINEUP）、战报分页。从 useGameSession 拆出以控制单文件行数。
// 层数、奖励与胜负的权威判定在服务端；按钮上的禁用只是预判，错误以服务端返回为准。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type GetStarTowerReportsResponseData,
  type StarTowerChallengeResponseData,
  type StarTowerMatchView,
  type StarTowerStateView,
} from '../api/protocol';
import { getCopy } from '../i18n/bundle';
import type { Actor } from '../types';

const REPORTS_PAGE = 20;

interface StarTowerSessionDeps {
  clientRef: { current: ApiClient | null };
  connected: boolean;
  appendLocalEvent: (actor: Actor, text: string) => void;
  scheduleSync: () => void;
  /** 阵容保存后通知竞技场切片重拉（阵容两边共用一份） */
  onLineupChanged: () => void;
}

export interface StarTowerSession {
  /** 将星塔状态（null = 尚未拉取） */
  tower: StarTowerStateView | null;
  /** 我的挑战战报（null = 尚未拉取），按时间从新到旧 */
  reports: StarTowerMatchView[] | null;
  reportsHasMore: boolean;
  error: string | null;
  busy: boolean;
  fetchTower: () => Promise<void>;
  /** 拉战报：older = true 时接在已有列表后面翻页 */
  fetchReports: (older?: boolean) => Promise<void>;
  /** 保存阵容（heroIds 三个号位，空位 null）；与竞技场共用，第一次保存即入竞技场榜 */
  saveLineup: (heroIds: Array<string | null>, formations?: import('../api/protocol-combat').FormationKind[]) => Promise<boolean>;
  /** 挑战下一层 */
  challenge: () => Promise<boolean>;
  clear: () => void;
}

/** 将星塔错误文案：优先用本地化文案（按错误码），没有对应码时回退服务端文案 */
export function starTowerErrorText(code: string | undefined, message: string | undefined): string {
  const { STAR_TOWER_COPY } = getCopy();
  if (code && code in STAR_TOWER_COPY.errors) {
    return STAR_TOWER_COPY.errors[code as keyof typeof STAR_TOWER_COPY.errors];
  }
  return message ?? STAR_TOWER_COPY.session.failedFallback;
}

export function useStarTowerSession(deps: StarTowerSessionDeps): StarTowerSession {
  const { clientRef, connected, appendLocalEvent, scheduleSync, onLineupChanged } = deps;
  const [tower, setTower] = useState<StarTowerStateView | null>(null);
  const [reports, setReportsState] = useState<StarTowerMatchView[] | null>(null);
  const [reportsHasMore, setReportsHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 翻页要读最后一条的 id：用 ref 避免 fetchReports 因列表变化而换身份，进而触发挂载 effect 循环
  const reportsRef = useRef<StarTowerMatchView[] | null>(null);
  const setReports = useCallback((next: StarTowerMatchView[] | null) => {
    reportsRef.current = next;
    setReportsState(next);
  }, []);

  const fetchTower = useCallback(async (): Promise<void> => {
    const client = clientRef.current;
    if (!client?.connected) {
      return;
    }
    try {
      const res = await client.request(Op.GET_STAR_TOWER, {});
      if (res.ok && res.data) {
        setTower(res.data as unknown as StarTowerStateView);
      }
    } catch {
      // 拉取失败保留旧值，下次进入页面 / 重连再试
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
        const res = await client.request(Op.GET_STAR_TOWER_REPORTS, {
          limit: REPORTS_PAGE,
          ...(last ? { beforeId: last.id } : {}),
        });
        if (res.ok && res.data) {
          const out = res.data as unknown as GetStarTowerReportsResponseData;
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
      void fetchTower();
      void fetchReports();
    }
  }, [connected, fetchTower, fetchReports]);

  const saveLineup = useCallback(
    async (heroIds: Array<string | null>, formations?: import('../api/protocol-combat').FormationKind[]): Promise<boolean> => {
      const client = clientRef.current;
      if (!client?.connected || busy) {
        return false;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await client.request(Op.SET_ARENA_LINEUP, { heroIds, formations });
        if (res.ok) {
          appendLocalEvent('player', getCopy().STAR_TOWER_COPY.session.lineupSaved);
          void fetchTower();
          onLineupChanged();
          return true;
        }
        setError(starTowerErrorText(res.error?.code, res.error?.message));
        return false;
      } catch (err) {
        setError(err instanceof Error ? err.message : getCopy().STAR_TOWER_COPY.session.failedFallback);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [clientRef, busy, appendLocalEvent, fetchTower, onLineupChanged],
  );

  const challenge = useCallback(async (): Promise<boolean> => {
    const { STAR_TOWER_COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected || busy) {
      return false;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await client.request(Op.STAR_TOWER_CHALLENGE, {});
      if (res.ok && res.data) {
        const out = res.data as unknown as StarTowerChallengeResponseData;
        appendLocalEvent('player', STAR_TOWER_COPY.session.challenged(out.floor, out.won));
        if (out.reward) {
          appendLocalEvent('system', STAR_TOWER_COPY.session.reward(out.floor, out.reward.gold, out.reward.exp));
        }
        for (const up of out.levelUps) {
          appendLocalEvent('system', STAR_TOWER_COPY.session.levelUp(up.name, up.leveledTo));
        }
        // 奖励在城池与武将上：对齐资源；进度与战报重拉
        scheduleSync();
        void fetchTower();
        void fetchReports();
        return true;
      }
      setError(starTowerErrorText(res.error?.code, res.error?.message));
      void fetchTower();
      return false;
    } catch (err) {
      setError(err instanceof Error ? err.message : STAR_TOWER_COPY.session.failedFallback);
      return false;
    } finally {
      setBusy(false);
    }
  }, [clientRef, busy, appendLocalEvent, scheduleSync, fetchTower, fetchReports]);

  const clear = useCallback((): void => {
    setTower(null);
    setReports(null);
    setReportsHasMore(false);
    setError(null);
    setBusy(false);
  }, [setReports]);

  return { tower, reports, reportsHasMore, error, busy, fetchTower, fetchReports, saveLineup, challenge, clear };
}
