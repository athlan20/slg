// 联盟会话切片（v66 起，AISLG-186 F1）：我的联盟状态（GET_ALLIANCE）、联盟列表（LIST_ALLIANCES）、
// 公开信息（GET_ALLIANCE 带 allianceId）、各管理操作，以及面板开合与侧栏 / 底栏红点。
// 连接建立（登录 / 重连）时拉一次，PUSH_ALLIANCE_STATE 到达时重拉；管理操作成功或失败后都重拉一次，
// 以服务端为准对齐状态。权限、冷却与名额的权威判定在服务端，界面上的禁用只是预判。
// 从 useGameSession 拆出以控制单文件行数（写法照 arenaSession）。

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiClient } from '../api/client';
import {
  Op,
  type AllianceDetailView,
  type AllianceRole,
  type GetAllianceResponseData,
  type AllianceBriefView,
  type ListAlliancesResponseData,
  type PushAllianceStateData,
  type ErrorCode,
  type GetAllianceDiplomacyResponseData,
} from '../api/protocol';
import { getCopy } from '../i18n/bundle';

/** 最近一次失败的操作：保存原始码与数据，显示时再翻译（切换语言与冷却倒计时都能跟上） */
export interface AllianceError {
  code?: ErrorCode;
  message?: string;
  data?: Record<string, unknown>;
  /** 出错的场景（邀请 / 申请），用于覆盖个别错误码的文案 */
  scene?: 'invite' | 'apply';
}

/** 联盟列表：已加载的服务端页依次拼接（PagedList 在它之上按高度分页，「更多」再向服务端要下一页） */
export interface AllianceListState {
  alliances: AllianceBriefView[];
  total: number;
  /** 已加载到的服务端页码（从 1 起） */
  page: number;
}

/** 我的联盟：一个 slice，三种状态（没有联盟 / 有联盟 / 冷却中）由 state 派生 */
export interface AllianceSession {
  /** 我的联盟视图（GET_ALLIANCE 缺省参数）；null = 尚未拉取 */
  state: GetAllianceResponseData | null;
  /** 面板是否打开 */
  open: boolean;
  openPanel: () => void;
  closePanel: () => void;
  /** 红点数：盟主 / 副盟主的待审批申请 + 自己收到的待处理邀请 */
  badge: number;
  error: AllianceError | null;
  /** 最近一次成功操作的提示（下一次操作前保留） */
  done: string | null;
  busy: boolean;
  refresh: () => Promise<void>;
  /** 联盟列表（LIST_ALLIANCES，已加载的页）；null = 尚未拉取 */
  list: AllianceListState | null;
  listLoading: boolean;
  /** 重新拉第一页（打开列表页签时） */
  loadList: () => Promise<void>;
  /** 向服务端要下一页并接在后面 */
  loadMoreList: () => Promise<void>;
  /** 查看某个联盟的公开信息（公告、成员）；失败返回 null */
  fetchPublic: (allianceId: string) => Promise<AllianceDetailView | null>;
  create: (name: string) => Promise<boolean>;
  apply: (allianceId: string, cancel?: boolean) => Promise<boolean>;
  invite: (username: string, cancel?: boolean) => Promise<boolean>;
  respondRequest: (accountId: string, accept: boolean) => Promise<boolean>;
  respondInvite: (allianceId: string, accept: boolean) => Promise<boolean>;
  leave: () => Promise<boolean>;
  disband: () => Promise<boolean>;
  kick: (accountId: string) => Promise<boolean>;
  setRole: (accountId: string, role: AllianceRole) => Promise<boolean>;
  setNotice: (notice: string) => Promise<boolean>;
  /** 外交全貌（v77，AISLG-195）；null = 尚未拉取 */
  diplomacy: GetAllianceDiplomacyResponseData | null;
  refreshDiplomacy: () => Promise<void>;
  inviteFriendly: (allianceId: string) => Promise<boolean>;
  respondFriendly: (inviteId: string, accept: boolean) => Promise<boolean>;
  endRelation: (allianceId: string) => Promise<boolean>;
  declareHostile: (allianceId: string) => Promise<boolean>;
  onPush: (data: PushAllianceStateData) => void;
  /** 登出 / 切换账号时清空 */
  clear: () => void;
}

interface CallResult {
  ok: boolean;
  data?: Record<string, unknown>;
  error?: AllianceError;
}

/** 盟主 / 副盟主可以审批、邀请与改公告，红点也只对她们计待审批数 */
export function isAllianceManager(role: AllianceRole | null | undefined): boolean {
  return role === 'leader' || role === 'vice';
}

export function useAllianceSession(clientRef: { current: ApiClient | null }, connected: boolean): AllianceSession {
  const [state, setState] = useState<GetAllianceResponseData | null>(null);
  const [open, setOpen] = useState(false);
  const [list, setListState] = useState<AllianceListState | null>(null);
  const [diplomacy, setDiplomacy] = useState<GetAllianceDiplomacyResponseData | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState<AllianceError | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // 防重复提交用 ref：按钮禁用是异步生效的，连点时闭包里的 busy 可能还是旧值
  const busyRef = useRef(false);
  // 列表的同步镜像：异步回调里要读最新的已加载页数，不能用闭包里的旧值
  const listRef = useRef<AllianceListState | null>(null);

  /** 发一条请求，统一成 { ok, data, error }；断线或抛错都按失败处理 */
  const call = useCallback(
    async (op: Op, data: Record<string, unknown>): Promise<CallResult> => {
      const client = clientRef.current;
      if (!client?.connected) {
        return { ok: false, error: { message: getCopy().ALLIANCE_COPY.errors.fallback } };
      }
      try {
        const res = await client.request(op, data);
        if (res.ok) {
          return { ok: true, data: res.data ?? {} };
        }
        return {
          ok: false,
          error: { code: res.error?.code, message: res.error?.message, data: res.data },
        };
      } catch (err) {
        return { ok: false, error: { message: err instanceof Error ? err.message : undefined } };
      }
    },
    [clientRef],
  );

  const refreshDiplomacy = useCallback(async (): Promise<void> => {
    const res = await call(Op.GET_ALLIANCE_DIPLOMACY, {});
    if (res.ok && res.data) {
      setDiplomacy(res.data as unknown as GetAllianceDiplomacyResponseData);
    }
  }, [call]);

  const refresh = useCallback(async (): Promise<void> => {
    const res = await call(Op.GET_ALLIANCE, {});
    if (res.ok && res.data) {
      const next = res.data as unknown as GetAllianceResponseData;
      setState(next);
      if (next.alliance) {
        void refreshDiplomacy();
      } else {
        setDiplomacy(null);
      }
    }
  }, [call, refreshDiplomacy]);

  const setList = useCallback((next: AllianceListState | null) => {
    listRef.current = next;
    setListState(next);
  }, []);

  const fetchListPage = useCallback(
    async (page: number): Promise<ListAlliancesResponseData | null> => {
      const res = await call(Op.LIST_ALLIANCES, { page });
      return res.ok && res.data ? (res.data as unknown as ListAlliancesResponseData) : null;
    },
    [call],
  );

  const loadList = useCallback(async (): Promise<void> => {
    setListLoading(true);
    const data = await fetchListPage(1);
    setListLoading(false);
    if (data) {
      setList({ alliances: data.alliances, total: data.total, page: 1 });
    }
  }, [fetchListPage, setList]);

  const loadMoreList = useCallback(async (): Promise<void> => {
    const cur = listRef.current;
    if (!cur || listLoading) {
      return;
    }
    setListLoading(true);
    const data = await fetchListPage(cur.page + 1);
    setListLoading(false);
    if (data) {
      setList({ alliances: [...cur.alliances, ...data.alliances], total: data.total, page: cur.page + 1 });
    }
  }, [fetchListPage, listLoading, setList]);

  /** 操作后对齐：重拉已加载的每一页（保持用户已翻到的长度，不跳回第一页） */
  const refreshList = useCallback(async (): Promise<void> => {
    const cur = listRef.current;
    if (!cur) {
      return;
    }
    let alliances: AllianceBriefView[] = [];
    let total = 0;
    for (let page = 1; page <= cur.page; page += 1) {
      const data = await fetchListPage(page);
      if (!data) {
        return;
      }
      alliances = [...alliances, ...data.alliances];
      total = data.total;
    }
    setList({ alliances, total, page: cur.page });
  }, [fetchListPage, setList]);

  /** 操作成功 / 失败后对齐：我的联盟 +（若已加载）列表已加载的页 */
  const refreshAll = useCallback(async (): Promise<void> => {
    await refresh();
    if (clientRef.current?.connected) {
      await refreshList();
    }
  }, [refresh, refreshList, clientRef]);

  /** 管理操作的统一出口：防重复、成功给提示、失败留错误，之后都对齐一次服务端状态 */
  const act = useCallback(
    async (op: Op, data: Record<string, unknown>, opts: { done?: string; scene?: 'invite' | 'apply' } = {}): Promise<boolean> => {
      if (busyRef.current) {
        return false;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      setDone(null);
      const res = await call(op, data);
      busyRef.current = false;
      setBusy(false);
      if (res.ok) {
        setDone(opts.done ?? null);
        const data = res.data as unknown as Record<string, unknown>;
        if (Array.isArray(data?.friends) && Array.isArray(data?.hostiles)) {
          setDiplomacy(data as unknown as GetAllianceDiplomacyResponseData);
        }
      } else {
        setError({ ...res.error, scene: opts.scene });
      }
      void refreshAll();
      return res.ok;
    },
    [call, refreshAll],
  );

  // 连接建立（登录 / 重连）后拉一次；断线时保留旧值，重连会再拉
  useEffect(() => {
    if (connected) {
      void refresh();
    }
  }, [connected, refresh]);

  const fetchPublic = useCallback(
    async (allianceId: string): Promise<AllianceDetailView | null> => {
      const res = await call(Op.GET_ALLIANCE, { allianceId });
      if (!res.ok || !res.data) {
        return null;
      }
      return (res.data as unknown as GetAllianceResponseData).alliance;
    },
    [call],
  );

  const create = useCallback(
    (name: string) => act(Op.CREATE_ALLIANCE, { name }, { done: getCopy().ALLIANCE_COPY.action.created }),
    [act],
  );

  const apply = useCallback(
    (allianceId: string, cancel = false) =>
      act(
        Op.ALLIANCE_APPLY,
        cancel ? { allianceId, cancel: true } : { allianceId },
        { done: cancel ? getCopy().ALLIANCE_COPY.action.withdrawn : getCopy().ALLIANCE_COPY.action.applied, scene: 'apply' },
      ),
    [act],
  );

  const invite = useCallback(
    (username: string, cancel = false) =>
      act(Op.ALLIANCE_INVITE, cancel ? { username, cancel: true } : { username }, {
        done: cancel ? getCopy().ALLIANCE_COPY.action.withdrawn : getCopy().ALLIANCE_COPY.recruit.inviteSent,
        scene: 'invite',
      }),
    [act],
  );

  const respondRequest = useCallback(
    (accountId: string, accept: boolean) =>
      act(Op.ALLIANCE_RESPOND, { kind: 'request', accountId, accept }, { done: getCopy().ALLIANCE_COPY.action.responded }),
    [act],
  );

  const respondInvite = useCallback(
    (allianceId: string, accept: boolean) =>
      act(Op.ALLIANCE_RESPOND, { kind: 'invite', allianceId, accept }, { done: accept ? getCopy().ALLIANCE_COPY.action.joined : getCopy().ALLIANCE_COPY.action.responded }),
    [act],
  );

  const leave = useCallback(() => act(Op.ALLIANCE_LEAVE, {}, { done: getCopy().ALLIANCE_COPY.action.left }), [act]);

  const disband = useCallback(() => act(Op.ALLIANCE_DISBAND, {}, { done: getCopy().ALLIANCE_COPY.action.disbanded }), [act]);

  const kick = useCallback((accountId: string) => act(Op.ALLIANCE_KICK, { accountId }, { done: getCopy().ALLIANCE_COPY.action.kicked }), [act]);

  const setRole = useCallback(
    (accountId: string, role: AllianceRole) =>
      act(Op.ALLIANCE_SET_ROLE, { accountId, role }, {
        done: role === 'leader' ? getCopy().ALLIANCE_COPY.action.leaderChanged : getCopy().ALLIANCE_COPY.action.roleSet,
      }),
    [act],
  );

  const setNotice = useCallback((notice: string) => act(Op.ALLIANCE_SET_NOTICE, { notice }, { done: getCopy().ALLIANCE_COPY.notice.saved }), [act]);

  const inviteFriendly = useCallback(
    (allianceId: string) => act(Op.ALLIANCE_DIPLOMACY_INVITE, { allianceId }, { done: getCopy().ALLIANCE_COPY.action.friendInvited }),
    [act],
  );
  const respondFriendly = useCallback(
    (inviteId: string, accept: boolean) =>
      act(Op.ALLIANCE_DIPLOMACY_RESPOND, { inviteId, accept }, { done: accept ? getCopy().ALLIANCE_COPY.action.friendly : getCopy().ALLIANCE_COPY.action.responded }),
    [act],
  );
  const endRelation = useCallback(
    (allianceId: string) => act(Op.ALLIANCE_DIPLOMACY_END, { allianceId }, { done: getCopy().ALLIANCE_COPY.action.neutral }),
    [act],
  );
  const declareHostile = useCallback(
    (allianceId: string) => act(Op.ALLIANCE_DIPLOMACY_HOSTILE, { allianceId }, { done: getCopy().ALLIANCE_COPY.action.hostile }),
    [act],
  );

  const onPush = useCallback(
    (_data: PushAllianceStateData) => {
      // 推送只说明「联盟状态变了」，具体内容一律重拉，不在推送里做增量合并
      void refreshAll();
    },
    [refreshAll],
  );

  const openPanel = useCallback(() => {
    setOpen(true);
    void refresh();
  }, [refresh]);

  const closePanel = useCallback(() => setOpen(false), []);

  const clear = useCallback(() => {
    setState(null);
    setDiplomacy(null);
    setOpen(false);
    setList(null);
    setListLoading(false);
    setError(null);
    setDone(null);
    busyRef.current = false;
    setBusy(false);
  }, []);

  const badge = state ? (isAllianceManager(state.myRole) ? state.requests.length : 0) + state.myInvites.length : 0;

  return {
    state,
    open,
    openPanel,
    closePanel,
    badge,
    error,
    done,
    busy,
    refresh,
    list,
    listLoading,
    loadList,
    loadMoreList,
    fetchPublic,
    create,
    apply,
    invite,
    respondRequest,
    respondInvite,
    leave,
    disband,
    kick,
    setRole,
    setNotice,
    diplomacy,
    refreshDiplomacy,
    inviteFriendly,
    respondFriendly,
    endRelation,
    declareHostile,
    onPush,
    clear,
  };
}
