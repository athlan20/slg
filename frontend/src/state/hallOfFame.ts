// 名人堂会话切片（v65，AISLG-134）：GET_HALL_OF_FAME 的赛季列表 / 榜种 / 分页累积。
// 服务端每页 20 条；界面按可用高度分页，翻到末页时再向服务端要下一页（追加到已加载的条目后）。

import { useCallback, useRef, useState, type MutableRefObject } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type GetHallOfFameResponseData,
  type HallEntryView,
  type HallKind,
  type HallModelEntryView,
} from '../api/protocol';

export interface HallSeasonOption {
  id: number;
  name: string;
  endedAt: string | null;
}

export interface HallOfFameSession {
  /** 已结束的赛季（新 → 旧）；空 = 还没有结束的赛季 */
  seasons: HallSeasonOption[];
  seasonId: number | null;
  kind: HallKind;
  /** 个人榜已加载条目（累积） */
  entries: HallEntryView[];
  /** 模型榜已加载条目（累积） */
  modelEntries: HallModelEntryView[];
  total: number;
  /** 首屏是否已拉取过（打开名人堂页签时拉一次） */
  loaded: boolean;
  loading: boolean;
  error: boolean;
  /** 还有未加载的条目 */
  hasMore: boolean;
  /** 打开名人堂页签：首次拉取（已拉过则不重拉） */
  activate: () => void;
  selectSeason: (seasonId: number) => void;
  selectKind: (kind: HallKind) => void;
  /** 向服务端要下一页并追加 */
  loadMore: () => void;
  clear: () => void;
}

interface HallState {
  seasons: HallSeasonOption[];
  seasonId: number | null;
  kind: HallKind;
  entries: HallEntryView[];
  modelEntries: HallModelEntryView[];
  total: number;
  page: number;
  loaded: boolean;
  loading: boolean;
  error: boolean;
}

const INITIAL: HallState = {
  seasons: [],
  seasonId: null,
  kind: 'power',
  entries: [],
  modelEntries: [],
  total: 0,
  page: 0,
  loaded: false,
  loading: false,
  error: false,
};

export function useHallOfFame(clientRef: MutableRefObject<ApiClient | null>): HallOfFameSession {
  const [state, setState] = useState<HallState>(INITIAL);
  // 与渲染快照同步的镜像：动作回调里要读最新的赛季 / 榜种 / 页码
  const stateRef = useRef<HallState>(INITIAL);
  const requestSeqRef = useRef(0);

  const commit = useCallback((next: HallState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  /** 拉一页：append=false 替换列表（切赛季 / 切榜种），true 追加（翻页） */
  const fetchPage = useCallback(
    async (seasonId: number | null, kind: HallKind, page: number, append: boolean) => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      const seq = ++requestSeqRef.current;
      // 切赛季 / 切榜种：先清空旧列表并立即切换页签高亮，避免把上一榜的行留在新榜下面
      commit(
        append
          ? { ...stateRef.current, loading: true, error: false }
          : {
              ...stateRef.current,
              kind,
              seasonId: seasonId ?? stateRef.current.seasonId,
              entries: [],
              modelEntries: [],
              total: 0,
              loading: true,
              error: false,
            },
      );
      try {
        const data: Record<string, unknown> = { kind, page };
        if (seasonId !== null) {
          data.seasonId = seasonId;
        }
        const res = await client.request(Op.GET_HALL_OF_FAME, data);
        if (seq !== requestSeqRef.current) {
          return; // 已被更新的请求取代
        }
        if (!res.ok || !res.data) {
          commit({ ...stateRef.current, loading: false, error: true, loaded: true });
          return;
        }
        const view = res.data as unknown as GetHallOfFameResponseData;
        const prev = stateRef.current;
        const sameScope = append && prev.seasonId === view.seasonId && prev.kind === view.kind;
        commit({
          seasons: view.seasons ?? [],
          seasonId: view.seasonId,
          kind: view.kind as HallKind,
          entries: sameScope ? [...prev.entries, ...(view.entries ?? [])] : (view.entries ?? []),
          modelEntries: sameScope ? [...prev.modelEntries, ...(view.modelEntries ?? [])] : (view.modelEntries ?? []),
          total: view.total ?? 0,
          page,
          loaded: true,
          loading: false,
          error: false,
        });
      } catch {
        if (seq === requestSeqRef.current) {
          commit({ ...stateRef.current, loading: false, error: true, loaded: true });
        }
      }
    },
    [clientRef, commit],
  );

  const activate = useCallback(() => {
    if (stateRef.current.loaded || stateRef.current.loading) {
      return;
    }
    void fetchPage(null, stateRef.current.kind, 1, false);
  }, [fetchPage]);

  const selectSeason = useCallback(
    (seasonId: number) => {
      void fetchPage(seasonId, stateRef.current.kind, 1, false);
    },
    [fetchPage],
  );

  const selectKind = useCallback(
    (kind: HallKind) => {
      const { seasonId } = stateRef.current;
      void fetchPage(seasonId, kind, 1, false);
    },
    [fetchPage],
  );

  const loadMore = useCallback(() => {
    const cur = stateRef.current;
    const shown = cur.kind === 'model' ? cur.modelEntries.length : cur.entries.length;
    if (cur.loading || cur.seasonId === null || shown >= cur.total) {
      return;
    }
    void fetchPage(cur.seasonId, cur.kind, cur.page + 1, true);
  }, [fetchPage]);

  const clear = useCallback(() => {
    requestSeqRef.current += 1;
    commit(INITIAL);
  }, [commit]);

  const shown = state.kind === 'model' ? state.modelEntries.length : state.entries.length;
  return {
    seasons: state.seasons,
    seasonId: state.seasonId,
    kind: state.kind,
    entries: state.entries,
    modelEntries: state.modelEntries,
    total: state.total,
    loaded: state.loaded,
    loading: state.loading,
    error: state.error,
    hasMore: state.loaded && shown < state.total,
    activate,
    selectSeason,
    selectKind,
    loadMore,
    clear,
  };
}
