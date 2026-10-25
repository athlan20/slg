// 联盟地图标记会话切片（AISLG-184，F2）：本盟有效标记（GET_ALLIANCE_MARKS）、放置 / 删除，以及 PUSH_ALLIANCE_MARK 的
// 增量合并。只随所在联盟变化：拿到联盟 id 后拉一次，断线重连（connected 由假变真）再拉，离盟 / 登出清空。
// 过期标记由服务端过滤；界面另按 expiresAt 隐藏已到期但尚未被刷新的那几条。权限与上限的权威判定在服务端。

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type AllianceMarkAddResponseData,
  type AllianceMarkKind,
  type AllianceMarkView,
  type ErrorCode,
  type GetAllianceMarksResponseData,
  type PushAllianceMarkData,
} from '../api/protocol';

/** 标记操作失败：保存原始码与数据，显示时再翻译（满员的剩余时长随时钟变化） */
export interface AllianceMarkError {
  code?: ErrorCode;
  message?: string;
  data?: Record<string, unknown>;
}

export type AllianceMarkResult = { ok: true } | { ok: false; error: AllianceMarkError };

export interface AllianceMarksSession {
  /** 本盟有效标记（服务端顺序：创建时间升序） */
  marks: AllianceMarkView[];
  /** 我能否删除别人打的标记（盟主 / 副盟主、玩家连接） */
  canRemoveAny: boolean;
  /** 是否已拉取过（区分「还没拉」与「确实没有标记」） */
  loaded: boolean;
  loading: boolean;
  /** 最近一次拉取失败 */
  loadFailed: boolean;
  /** 放置中（防重复提交） */
  busy: boolean;
  refresh: () => Promise<void>;
  add: (x: number, y: number, kind: AllianceMarkKind, text: string) => Promise<AllianceMarkResult>;
  remove: (id: number) => Promise<AllianceMarkResult>;
  /** PUSH_ALLIANCE_MARK 到达：按 reason 增量并入 / 移除 */
  onPush: (data: PushAllianceMarkData) => void;
  clear: () => void;
}

export function useAllianceMarks(
  clientRef: RefObject<ApiClient | null>,
  connected: boolean,
  allianceId: string | null,
  myRole: string | null = null,
): AllianceMarksSession {
  const [marks, setMarks] = useState<AllianceMarkView[]>([]);
  const [canRemoveAny, setCanRemoveAny] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  // 异步回调读最新的联盟 id：切换联盟后丢弃旧响应；busyRef 防连点（按钮禁用是异步生效的）
  const allianceRef = useRef<string | null>(allianceId);
  allianceRef.current = allianceId;
  const busyRef = useRef(false);
  const seqRef = useRef(0);

  const call = useCallback(
    async (op: Op, data: Record<string, unknown>): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: AllianceMarkError }> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return { ok: false, error: { message: 'offline' } };
      }
      try {
        const res = await client.request(op, data);
        if (res.ok) {
          return { ok: true, data: res.data ?? {} };
        }
        return { ok: false, error: { code: res.error?.code, message: res.error?.message, data: res.data } };
      } catch (err) {
        return { ok: false, error: { message: err instanceof Error ? err.message : undefined } };
      }
    },
    [clientRef],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const target = allianceRef.current;
    if (!target) {
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const res = await call(Op.GET_ALLIANCE_MARKS, {});
    if (seq !== seqRef.current || allianceRef.current !== target) {
      return;
    }
    if (res.ok) {
      const view = res.data as unknown as GetAllianceMarksResponseData;
      setMarks(view.marks ?? []);
      setCanRemoveAny(view.canRemoveAny === true);
      setLoadFailed(false);
    } else {
      setLoadFailed(true);
    }
    setLoaded(true);
    setLoading(false);
  }, [call]);

  const add = useCallback(
    async (x: number, y: number, kind: AllianceMarkKind, text: string): Promise<AllianceMarkResult> => {
      if (busyRef.current) {
        return { ok: false, error: {} };
      }
      busyRef.current = true;
      setBusy(true);
      const data: Record<string, unknown> = { x, y, kind };
      if (text) {
        data.text = text;
      }
      const res = await call(Op.ALLIANCE_MARK_ADD, data);
      busyRef.current = false;
      setBusy(false);
      if (!res.ok) {
        return res;
      }
      const { mark } = res.data as unknown as AllianceMarkAddResponseData;
      setMarks((prev) => (prev.some((item) => item.id === mark.id) ? prev : [...prev, mark]));
      return { ok: true };
    },
    [call],
  );

  const remove = useCallback(
    async (id: number): Promise<AllianceMarkResult> => {
      if (busyRef.current) {
        return { ok: false, error: {} };
      }
      busyRef.current = true;
      setBusy(true);
      const res = await call(Op.ALLIANCE_MARK_REMOVE, { id });
      busyRef.current = false;
      setBusy(false);
      if (!res.ok) {
        return res;
      }
      setMarks((prev) => prev.filter((item) => item.id !== id));
      return { ok: true };
    },
    [call],
  );

  const onPush = useCallback((data: PushAllianceMarkData) => {
    if (data.allianceId !== allianceRef.current) {
      return;
    }
    if (data.reason === 'added' && data.mark) {
      const incoming = data.mark;
      setMarks((prev) => (prev.some((item) => item.id === incoming.id) ? prev.map((item) => (item.id === incoming.id ? incoming : item)) : [...prev, incoming]));
    } else if (data.reason === 'removed') {
      setMarks((prev) => prev.filter((item) => item.id !== data.markId));
    }
  }, []);

  const clear = useCallback(() => {
    seqRef.current += 1;
    setMarks([]);
    setCanRemoveAny(false);
    setLoaded(false);
    setLoading(false);
    setLoadFailed(false);
  }, []);

  // 所在联盟变化 / 连接建立（含断线重连）/ 我的职位变化（被任命或撤销副盟主，canRemoveAny 随职位变）：有联盟就拉一次，没有就清空
  useEffect(() => {
    if (!allianceId) {
      clear();
      return;
    }
    if (connected) {
      void refresh();
    }
  }, [allianceId, connected, myRole, refresh, clear]);

  return { marks, canRemoveAny, loaded, loading, loadFailed, busy, refresh, add, remove, onPush, clear };
}
