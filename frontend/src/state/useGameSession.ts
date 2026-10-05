// 真实游戏会话：密码/令牌登录、令牌持久化与自动登录、断线自动重连、
// 按需查询与服务端推送同步。协议语义见 docs/agent-api.md（协议版本 11）。
// 网页端固定以玩家（player）身份登录；Agent 由玩家另行用协议接入，不经本界面。

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiClient } from '../api/client';
import {
  Op,
  type AgentInfoView,
  type AgentPlanPushData,
  type BattleReportCommentPushData,
  type BattleReportView,
  type GetOfflineReportResponseData,
  type ServerBroadcastPushData,
  type ServerBroadcastView,
  type LeaderboardKind,
  type LeaderboardView,
  type BuildStatePushData,
  type BuildView,
  type BuildingKind,
  type CityStatePushData,
  type CityView,
  type EventView,
  type LoginResultData,
  type MarchStatePushData,
  type NpcAttackWarningPushData,
  type PlayerAttackWarningPushData,
  type PushFrame,
  type RecruitStatePushData,
  type RenameCityResponseData,
  type MovingTargetPushData,
  type TechStatePushData,
  type HeroStatePushData,
  type TileStatePushData,
  type TroopKind,
} from '../api/protocol';
import { buildErrorText, formatClock, loginErrorText, renameErrorText, toSessionEvent } from '../api/mapping';
import { useAccountSecurity, type AccountSecurity } from './useAccountSecurity';
import { getCopy } from '../i18n/bundle';
import { githubErrorText } from '../api/errorText';
import { takeOauthReturn } from './oauthReturn';
import {
  clearStoredToken,
  readLastUsername,
  readStoredToken,
  saveLastUsername,
  saveStoredToken,
} from '../api/session-storage';
import type { Actor, SessionEvent } from '../types';
import { applyBuildPush, applyBuildResult, applyCancelResult, applyMarchPush, applyRecruitPush } from './cityUpdates';
import { createRecruitActions } from './recruitActions';
import { createExchangeAction, type ExchangeResource } from './exchangeAction';
import { createTruceAction } from './truceAction';
import { useWorldSession, type WorldSession } from './worldSession';
import { useTechSession, type TechSession } from './techSession';
import { useHeroSession, type HeroSession } from './heroSession';
import { useMovingTargets, type MovingTargetsSession } from './movingTargets';
import { useYellowTurban, type YellowTurbanSession } from './yellowTurban';
import { useSessionExtras } from './session-extras';
import { emitBattleCommentPatched } from './battleReportModal';
import { useCityList, type CityList } from './useCityList';

/** 断线自动重连间隔（毫秒） */
const RECONNECT_DELAY_MS = 3000;
/** 推送触发按需查询的防抖间隔（毫秒） */
const SYNC_DEBOUNCE_MS = 300;
/** 在线时的定期状态刷新（毫秒）：资源随产量持续增长，服务端不推送产量变化 */
const AUTO_REFRESH_MS = 10_000;
/** 事件分页大小：首屏条数，也是「加载更早」每页条数 */
const EVENTS_PAGE_SIZE = 10;
  /** 本地事件窗口上限（服务端 + 本地合计）：超出丢弃最早条目，更早历史仍可按需翻页重拉 */
  const MAX_EVENTS = 200;

export type ConnectionStatus = 'idle' | 'connecting' | 'online' | 'reconnecting';

export interface AccountInfo {
  accountId: string;
  username: string;
}

export interface GameSession {
  /** 令牌自动登录进行中（此时不显示登录表单） */
  booting: boolean;
  account: AccountInfo | null;
  connection: ConnectionStatus;
  loginBusy: boolean;
  loginError: string | null;
  buildError: string | null;
  /** 征兵 / 取消征兵失败的人读提示（v11，征兵面板内展示） */
  recruitError: string | null;
  city: CityView | null;
  agent: AgentInfoView | null;
  events: SessionEvent[];
  /** 更早的事件是否已加载完（服务端没有更多历史） */
  eventsExhausted: boolean;
  /** 「加载更早」分页进行中 */
  eventsLoadingOlder: boolean;
  lastUsername: string;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** 按建筑类型发起建造（一期九种建筑） */
  startBuild: (kind: BuildingKind) => Promise<void>;
  /** 按建筑类型发起升级：缺省升到下一等级；toLevel（当前+2..10，v22）连续升到目标等级 */
  startUpgrade: (kind: BuildingKind, toLevel?: number) => Promise<void>;
  /** 取消排队中的建造条目（全额返还成本；在建条目不可取消） */
  cancelBuild: (buildId: string) => Promise<void>;
  /** 发起征兵（v11）：军营等级解锁兵种，发起时扣减资源与人口 */
  startRecruit: (troop: TroopKind, count: number) => Promise<void>;
  /** 取消排队中的征兵条目（v11，全额返还资源与人口；征募中条目不可取消） */
  cancelRecruit: (recruitId: string) => Promise<void>;
  /** 集市兑换（v22，AISLG-67 前端入口）：基础资源按 4:1 换金币；成功返回 null，失败返回人读错误 */
  exchangeGold: (resource: ExchangeResource, amount: number) => Promise<string | null>;
  /** 开启主动免战（v38 AISLG-122）：每周一次免费、12 小时；成功返回 null，失败返回人读错误 */
  startTruce: () => Promise<string | null>;
  /** 城池改名；成功返回 null，失败返回人读错误（弹窗内展示） */
  renameCity: (name: string) => Promise<string | null>;
  /** 一键重置账号数据（v9，不可逆）；成功返回 null，失败返回人读错误（弹窗内展示） */
  resetAccount: () => Promise<string | null>;
  /** 离线日报（v23 AISLG-54）：非 null 时弹窗展示（上线自动弹出 / 手动打开） */
  offlineReport: GetOfflineReportResponseData | null;
  /** 拉取离线日报并弹窗（Agent 面板「离线日报」按钮） */
  openOfflineReport: () => Promise<void>;
  /** 关闭离线日报弹窗 */
  closeOfflineReport: () => void;
  /** 离线日报拉取失败的人读提示 */
  offlineReportError: string | null;
  /** 最近一次拉到的离线日报（Agent 页摘要用；不弹窗）与拉取动作 */
  offlineSummary: GetOfflineReportResponseData | null;
  loadOfflineSummary: () => Promise<void>;
  /** 全服播报（v23 AISLG-60）：最近 20 条（新→旧）；登录后拉取 + 推送置顶 */
  broadcasts: ServerBroadcastView[];
  /** 打开播报列表（当前条目点击时也会刷新一次） */
  fetchServerBroadcasts: () => Promise<void>;
  /** 排行榜（v23 AISLG-61）：当前榜快照；null = 尚未拉取 */
  leaderboard: LeaderboardView | null;
  /** 拉取指定榜单（打开弹窗 / 切换榜 / 手动刷新） */
  fetchLeaderboard: (kind: LeaderboardKind) => Promise<void>;
  leaderboardLoading: boolean;
  leaderboardError: string | null;
  closeLeaderboard: () => void;
  /** NPC 来袭预警（AISLG-66）：待确认列表逐条弹窗，确认一条关一条 */
  npcWarnings: NpcAttackWarningPushData[];
  dismissNpcWarning: (attackId: string) => void;
  /** 多城（v24 AISLG-58）：全部城池 / 分城名额 / 当前操作的城池，及切换动作 */
  cityList: CityList;
  switchCity: (cityId: string) => Promise<void>;
  /** 世界地图会话（v12）：窗口 / 地块详情 / 出征与召回 */
  world: WorldSession;
  /** 科技研究会话（v27 AISLG-77）：科技表 / 进行中研究 / 发起与取消 */
  techSession: TechSession;
  /** 武将会话（v36 AISLG-114）：武将 / 酒馆候选 / 招募 / 解雇 / 城守 / 出征带将选择 */
  heroSession: HeroSession;
  /** 移动目标会话（v28 AISLG-78）：流寇 / 运粮商队列表 */
  moving: MovingTargetsSession;
  /** 黄巾之乱会话（v29 AISLG-76）：事件进度 / 营地 / 我的贡献 / 贡献榜 */
  yellowTurban: YellowTurbanSession;
  /** 加载更早的一页事件（滚动到底部触发；游标 = 已加载的最小服务端事件 id） */
  loadOlderEvents: () => Promise<void>;
  /** 账号安全（v43）：Agent 令牌签发 / 吊销、微信绑定状态刷新 */
  security: AccountSecurity;
  /** 微信扫码登录（v43）：建立未登录连接给二维码用；扫码确认后拿会话令牌走令牌登录 */
  connectForWechat: () => Promise<ApiClient>;
  loginWithWechatToken: (sessionToken: string) => Promise<void>;
  /** Google 一键登录（v44）：GOOGLE_LOGIN 换到会话令牌后走令牌登录 */
  loginWithGoogleToken: (sessionToken: string) => Promise<void>;
  /** GitHub 一键登录（v45）：OAuth 回跳带回来的一次性码换会话令牌后走令牌登录 */
  loginWithOauthCode: (code: string) => Promise<void>;
}

function field<T>(data: Record<string, unknown> | undefined, key: string): T | undefined {
  return (data?.[key] as T | undefined) ?? undefined;
}

function nowClock(): string {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

export function useGameSession(): GameSession {
  const [booting, setBooting] = useState(false);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [connection, setConnection] = useState<ConnectionStatus>('idle');
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [recruitError, setRecruitError] = useState<string | null>(null);
  const [city, setCity] = useState<CityView | null>(null);
  const cityList = useCityList(setCity);
  const { applyState: applyCityList, reset: resetCityList } = cityList;
  const [agent, setAgent] = useState<AgentInfoView | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [eventsExhausted, setEventsExhausted] = useState(false);
  const [eventsLoadingOlder, setEventsLoadingOlder] = useState(false);
  const [lastUsername, setLastUsername] = useState(readLastUsername);

  const clientRef = useRef<ApiClient | null>(null);
  const accountRef = useRef<AccountInfo | null>(null);
  const lastEventIdRef = useRef(0);
  const localIdRef = useRef(0);
  // 事件列表的 ref 镜像：翻页游标要在动作回调里读最新值，避免闭包拿到旧渲染快照
  const eventsRef = useRef<SessionEvent[]>([]);
  const loadingOlderRef = useRef(false);
  const logoutIntentRef = useRef(false);
  const reconnectTimerRef = useRef<number | null>(null);
  const syncTimerRef = useRef<number | null>(null);
  const aliveRef = useRef(true);
  // GitHub 授权回跳的绑定 / 失败结果（v45）：登录成功后作为本地事件补显（见 tokenLogin）
  const oauthNoticeRef = useRef<string | null>(null);
  // 「最新回调」桥：让连接关闭回调与重连定时器引用每次渲染后的函数而不产生依赖环
  const attemptReconnectRef = useRef<() => void>(() => undefined);
  const reconnectTriggerRef = useRef<() => void>(() => undefined);

  const appendLocalEvent = useCallback((actor: Actor, text: string) => {
    localIdRef.current -= 1;
    const event: SessionEvent = { id: localIdRef.current, at: nowClock(), actor, text };
    setEvents((prev) => {
      const next = [...prev, event];
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
  }, []);

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (syncTimerRef.current !== null) {
      window.clearTimeout(syncTimerRef.current);
      syncTimerRef.current = null;
    }
  }, []);

  /** 按需同步：当前城池、Agent 信息与事件（initial 全量重拉，incremental 走 sinceId 增量） */
  const syncAll = useCallback(async (mode: 'initial' | 'incremental') => {
    const client = clientRef.current;
    if (!client?.connected || !accountRef.current) {
      return;
    }
    const pullEvents = async (): Promise<void> => {
      const initial = mode === 'initial' || lastEventIdRef.current === 0;
      const data = initial ? { limit: EVENTS_PAGE_SIZE } : { sinceId: lastEventIdRef.current };
      const res = await client.request(Op.GET_EVENTS, data);
      if (!res.ok) {
        return;
      }
      const views = (field<EventView[]>(res.data, 'events') ?? []) as EventView[];
      if (initial) {
        // 不足一页说明服务端没有更早的历史
        setEventsExhausted(views.length < EVENTS_PAGE_SIZE);
      }
      if (views.length === 0) {
        return;
      }
      lastEventIdRef.current = Math.max(lastEventIdRef.current, ...views.map((v) => v.id));
      if (initial) {
        // 服务端按 id 倒序返回；界面按时间正序存放，渲染时再倒转
        setEvents(views.slice().reverse().map(toSessionEvent));
      } else {
        setEvents((prev) => {
          const next = [...prev, ...views.map(toSessionEvent)];
          return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
        });
      }
    };
    await Promise.allSettled([
      (async () => {
        const res = await client.request(Op.GET_STATE);
        const view = field<CityView>(res.data, 'city');
        if (res.ok && view) {
          setCity(view);
          applyCityList(res.data);
        }
      })(),
      (async () => {
        const res = await client.request(Op.GET_AGENT_INFO);
        if (res.ok && res.data) {
          setAgent(res.data as unknown as AgentInfoView);
        }
      })(),
      pullEvents(),
    ]);
  }, [applyCityList]);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current !== null) {
      return;
    }
    syncTimerRef.current = window.setTimeout(() => {
      syncTimerRef.current = null;
      void syncAll('incremental');
    }, SYNC_DEBOUNCE_MS);
  }, [syncAll]);

  // 世界地图会话切片（v12）：窗口 / 详情 / 出征 / 召回；推送到达时在 handlePush 里联动。
  // 只解构稳定回调作依赖项：world 对象身份会随其状态变化，直接依赖会令下方
  // applyLoginResult → tokenLogin → 启动 Effect 的链条反复重建（把连接 close 掉）。
  const world = useWorldSession({
    clientRef,
    connected: connection === 'online',
    setCity,
    appendLocalEvent,
    scheduleSync,
  });
  const { clear: worldClear, onMarchPush, onTilePush, onBattleReportPush, onBattleReportCommentPush } = world;

  // 科技研究会话切片（v27 AISLG-77）：科技表 / 研究 / 取消，推送到达时联动
  const techSession = useTechSession({
    clientRef,
    connected: connection === 'online',
    setCity,
    appendLocalEvent,
    scheduleSync,
  });
  const { clear: techClear, onTechPush } = techSession;

  // 武将会话切片（v36 AISLG-114）：武将 / 酒馆候选（按当前城）/ 招募解雇 / 城守，推送到达重拉
  const heroSession = useHeroSession({
    clientRef,
    connected: connection === 'online',
    cityId: city?.id ?? null,
    scheduleSync,
    setCity,
  });
  const { clear: heroClear, onHeroPush } = heroSession;

  // 移动目标会话切片（v28 AISLG-78）：流寇 / 运粮商队列表，推送增量合并
  const moving = useMovingTargets({ clientRef, connected: connection === 'online' });
  const { clear: movingClear, onPush: onMovingPush } = moving;

  // 黄巾之乱会话切片（v29 AISLG-76）：事件进度 / 营地 / 贡献，推送到达重拉
  const yellowTurban = useYellowTurban({ clientRef, connected: connection === 'online' });
  const { clear: ytClear, onPush: onYtPush } = yellowTurban;

  // 会话扩展切片（v23）：离线日报 / 全服播报 / 排行榜——状态与动作拆在 session-extras
  const extras = useSessionExtras(clientRef);
  const { checkOfflineReportRef, fetchServerBroadcasts, onBroadcastPush, onNpcWarningPush, resetNpcWarnings } = extras;

  /** 推送先做乐观更新，再防抖走一轮按需查询对齐权威状态 */
  const handlePush = useCallback(
    (frame: PushFrame) => {
      if (frame.op === Op.PUSH_BUILD_STATE) {
        const data = frame.data as unknown as BuildStatePushData;
        setCity((prev) => (prev && data.build.cityId === prev.id ? applyBuildPush(prev, data.reason, data.build) : prev));
      } else if (frame.op === Op.PUSH_RECRUIT_STATE) {
        // v11：征兵状态变化（开始 / 排队 / 完成入城 / 取消）乐观合并，随后防抖对齐
        const data = frame.data as unknown as RecruitStatePushData;
        setCity((prev) => (prev && data.recruit.cityId === prev.id ? applyRecruitPush(prev, data.reason, data.recruit) : prev));
      } else if (frame.op === Op.PUSH_MARCH_STATE) {
        // v12：行军状态变化（其他连接发起的出征 / 到达结算 / 返程回城）乐观合并 + 地图刷新；
        // 侦察行军到达时另拉一轮侦察记录（v23 AISLG-62）
        const data = frame.data as unknown as MarchStatePushData;
        setCity((prev) => (prev && data.march.fromCityId === prev.id ? applyMarchPush(prev, data.reason, data.march) : prev));
        onMarchPush(data.reason === 'march_arrived' && data.march?.purpose === 'scout');
      } else if (frame.op === Op.PUSH_TILE_STATE) {
        // v12：地块归属 / 驻军变化 → 更新地图窗口并刷新选中详情
        const data = frame.data as unknown as TileStatePushData;
        onTilePush(data.tile);
      } else if (frame.op === Op.PUSH_BATTLE_REPORT) {
        // v13：战斗战报生成 → 置顶战报列表（列表未加载时不预取，按需拉取覆盖）
        const data = frame.data as unknown as { report: BattleReportView };
        onBattleReportPush(data.report);
      } else if (frame.op === Op.PUSH_BATTLE_REPORT_COMMENT) {
        // v23（AISLG-53）：Agent 点评写入 → 更新战报列表/缓存，弹窗开着则就地补显
        const data = frame.data as unknown as BattleReportCommentPushData;
        onBattleReportCommentPush(data.reportId, data.comment);
        emitBattleCommentPatched(data.reportId, data.comment);
        return;
      } else if (frame.op === Op.PUSH_TECH_STATE) {
        // v27（AISLG-77）：研究发起 / 完成 / 取消 → 重拉科技表并对齐城池（产量 / 储量随等级变化）
        onTechPush(frame.data as unknown as TechStatePushData);
        return;
      } else if (frame.op === Op.PUSH_HERO_STATE) {
        // v36（AISLG-114）：招募 / 解雇 / 城守变更 / 欠饷 / 重伤 / 经验升级 / 获得名将——重拉武将并对齐城池；
        // 对应的服务端事件随下方增量查询补齐，不重复记本地事件
        onHeroPush(frame.data as unknown as HeroStatePushData);
      } else if (frame.op === Op.PUSH_MOVING_TARGET_STATE) {
        // v28（AISLG-78）：移动目标刷出 / 被截获 / 消失（全服广播，与账号状态无关，不触发按需查询）
        onMovingPush(frame.data as unknown as MovingTargetPushData);
        return;
      } else if (frame.op === Op.PUSH_STARVATION_STATE) {
        // v34（AISLG-107）：断粮预警 / 哗变——不记本地事件（服务端事件 starvation_warning / mutiny 随下方增量查询补齐，
        // 避免重复）；增量查询同时对齐驻军减员与 starveAt / mutinyNextAt，顶栏红色提示随之出现
      } else if (frame.op === Op.PUSH_YELLOW_TURBAN_STATE) {
        // v29（AISLG-76）：黄巾之乱起事 / 进度 / 老巢出现 / 收场（全服广播，与账号状态无关）
        onYtPush();
        return;
      } else if (frame.op === Op.PUSH_SERVER_BROADCAST) {
        // v23（AISLG-60）：全服播报实时置顶（不触发按需查询，播报与账号状态无关）
        const data = frame.data as unknown as ServerBroadcastPushData;
        onBroadcastPush(data.broadcast);
        return;
      } else if (frame.op === Op.PUSH_NPC_ATTACK_WARNING) {
        // v23（AISLG-57）推送 / AISLG-66 前端消费：NPC 来袭立即弹窗预警；
        // 事件流的等价文案随后由下方增量查询补齐，不重复记本地事件
        const data = frame.data as unknown as NpcAttackWarningPushData;
        onNpcWarningPush(data);
      } else if (frame.op === Op.PUSH_ATTACK_WARNING) {
        // v38（AISLG-122）玩家来袭预警：归一化进同一预警队列（attackId = marchId 去重），
        // 弹窗按 attacker 有无显示「玩家来袭」；事件流等价文案由增量查询补齐
        const data = frame.data as unknown as PlayerAttackWarningPushData;
        onNpcWarningPush({
          attackId: data.marchId,
          x: data.x,
          y: data.y,
          target: data.target,
          terrain: data.terrain ?? null,
          level: data.level ?? 0,
          ...(data.attacker ? { attacker: data.attacker } : {}),
          armyMin: data.armyMin,
          armyMax: data.armyMax,
          ...(data.intel ? { intel: data.intel } : {}),
          ...(data.beaconLevel !== undefined ? { beaconLevel: data.beaconLevel } : {}),
          ...(data.armyKinds ? { armyKinds: data.armyKinds } : {}),
          ...(data.army ? { army: data.army } : {}),
          arriveAt: data.arriveAt,
        });
      } else if (frame.op === Op.PUSH_AGENT_STATUS) {
        const data = frame.data as unknown as { online: boolean };
        setAgent((prev) => (prev ? { ...prev, agentOnline: data.online } : prev));
      } else if (frame.op === Op.PUSH_AGENT_PLAN) {
        // v10：Agent 上报计划，推送携带完整快照；不触发额外查询（计划与游戏状态无关）
        const data = frame.data as unknown as AgentPlanPushData;
        setAgent((prev) => (prev ? { ...prev, plan: data } : prev));
        return;
      } else if (frame.op === Op.PUSH_CITY_STATE) {
        const data = frame.data as unknown as CityStatePushData;
        if (data.reason === 'city_renamed') {
          setCity((prev) => (prev && data.name && data.cityId === prev.id ? { ...prev, name: data.name } : prev));
        } else if (data.reason === 'account_reset') {
          // 账号被其他连接重置：服务端事件流已清空，本地缓存全部失效，全量重拉
          lastEventIdRef.current = 0;
          setEvents([]);
          setBuildError(null);
          setRecruitError(null);
          void syncAll('initial');
          return;
        }
      }
      scheduleSync();
    },
    [scheduleSync, syncAll, onMarchPush, onTilePush, onBattleReportPush, onBattleReportCommentPush, onBroadcastPush, onNpcWarningPush, onTechPush, onHeroPush, onMovingPush, onYtPush],
  );

  const ensureClient = useCallback((): ApiClient => {
    if (clientRef.current) {
      return clientRef.current;
    }
    const client = new ApiClient();
    client.onPush(handlePush);
    client.onClose = () => {
      if (!aliveRef.current || logoutIntentRef.current || !accountRef.current) {
        return;
      }
      setConnection('reconnecting');
      appendLocalEvent('system', getCopy().COPY.session.disconnected);
      reconnectTriggerRef.current();
    };
    clientRef.current = client;
    return client;
  }, [handlePush, appendLocalEvent]);

  /** 回到未登录表单；可选地清掉连接并给出提示 */
  const resetToLoginForm = useCallback(
    (message: string | null) => {
      clearTimers();
      accountRef.current = null;
      setAccount(null);
      setConnection('idle');
      setCity(null);
      resetCityList();
      setAgent(null);
      setEvents([]);
      setEventsExhausted(false);
      setEventsLoadingOlder(false);
      loadingOlderRef.current = false;
      setBuildError(null);
      setRecruitError(null);
      setLoginError(message);
      lastEventIdRef.current = 0;
      resetNpcWarnings();
      worldClear();
      techClear();
      heroClear();
      movingClear();
      ytClear();
      clientRef.current?.close();
      clientRef.current = null;
    },
    [clearTimers, worldClear, techClear, heroClear, movingClear, ytClear, resetCityList],
  );

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimerRef.current !== null || !aliveRef.current) {
      return;
    }
    reconnectTimerRef.current = window.setTimeout(() => {
      reconnectTimerRef.current = null;
      attemptReconnectRef.current();
    }, RECONNECT_DELAY_MS);
  }, []);

  /** 用保存的令牌重连：失败（非会话失效）时按间隔重试 */
  const attemptReconnect = useCallback(async () => {
    if (!aliveRef.current || logoutIntentRef.current || !accountRef.current) {
      return;
    }
    const { COPY } = getCopy();
    const token = readStoredToken();
    if (!token) {
      resetToLoginForm(COPY.session.tokenLost);
      return;
    }
    const client = ensureClient();
    try {
      await client.connect();
      const res = await client.request(Op.LOGIN, { token, asAgent: false });
      if (!res.ok) {
        if (res.error?.code === 'SESSION_INVALID') {
          clearStoredToken();
          resetToLoginForm(COPY.session.sessionExpired);
        } else {
          scheduleReconnect();
        }
        return;
      }
      const data = res.data as unknown as LoginResultData;
      saveStoredToken(data.sessionToken);
      setConnection('online');
      appendLocalEvent('system', COPY.session.reconnected);
      await syncAll('incremental');
      void checkOfflineReportRef.current();
      void fetchServerBroadcasts();
    } catch {
      scheduleReconnect();
    }
  }, [ensureClient, scheduleReconnect, resetToLoginForm, appendLocalEvent, syncAll]);

  useEffect(() => {
    attemptReconnectRef.current = attemptReconnect;
    reconnectTriggerRef.current = scheduleReconnect;
  });

  // 事件列表镜像：翻页/增量动作在回调里读最新值，避免闭包拿到旧渲染快照
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);

  /** 在线时定期刷新：资源随产量持续增长，服务端不推送产量变化，客户端按需查询 */
  useEffect(() => {
    if (connection !== 'online' || account === null) {
      return;
    }
    const timer = window.setInterval(() => {
      void syncAll('incremental');
    }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [connection, account, syncAll]);

  const applyLoginResult = useCallback((data: LoginResultData) => {
    const info: AccountInfo = { accountId: data.accountId, username: data.username };
    accountRef.current = info;
    setAccount(info);
    setConnection('online');
    setLoginError(null);
    setCity(null);
    setAgent(null);
    setEvents([]);
    setEventsExhausted(false);
    setEventsLoadingOlder(false);
    loadingOlderRef.current = false;
    setBuildError(null);
    setRecruitError(null);
    lastEventIdRef.current = 0;
    resetNpcWarnings();
    worldClear();
    techClear();
    heroClear();
    movingClear();
    ytClear();
  }, [worldClear, techClear, heroClear, movingClear, ytClear, resetNpcWarnings]);

  const login = useCallback(
    async (username: string, password: string) => {
      setLoginBusy(true);
      setLoginError(null);
      const { COPY } = getCopy();
      try {
        setConnection('connecting');
        const client = ensureClient();
        await client.connect();
        const res = await client.request(Op.LOGIN, { username, password, asAgent: false });
        if (!res.ok) {
          setConnection('idle');
          setLoginError(loginErrorText(res.error?.code, res.error?.message));
          return;
        }
        const data = res.data as unknown as LoginResultData;
        saveStoredToken(data.sessionToken);
        saveLastUsername(username);
        setLastUsername(username);
        applyLoginResult(data);
        await syncAll('initial');
        void checkOfflineReportRef.current();
        void fetchServerBroadcasts();
        appendLocalEvent('player', COPY.session.loginSuccess);
      } catch (err) {
        setConnection('idle');
        setLoginError(err instanceof Error ? err.message : COPY.errors.login.fallback);
      } finally {
        setLoginBusy(false);
      }
    },
    [ensureClient, applyLoginResult, syncAll, appendLocalEvent],
  );

  /** 页面加载时的令牌自动登录；网络失败保留令牌，会话失效则清除并回落表单 */
  const tokenLogin = useCallback(
    async (token: string, source: 'auto' | 'wechat' | 'google' | 'github' = 'auto') => {
      const { COPY, WECHAT_COPY, GOOGLE_COPY, GITHUB_COPY } = getCopy();
      try {
        setConnection('connecting');
        const client = ensureClient();
        await client.connect();
        const res = await client.request(Op.LOGIN, { token, asAgent: false });
        if (!res.ok) {
          clearStoredToken();
          setConnection('idle');
          setLoginError(loginErrorText(res.error?.code, res.error?.message));
          return;
        }
        const data = res.data as unknown as LoginResultData;
        saveStoredToken(data.sessionToken);
        applyLoginResult(data);
        await syncAll('initial');
        void checkOfflineReportRef.current();
        void fetchServerBroadcasts();
        const loginText =
          source === 'wechat'
            ? WECHAT_COPY.session.wechatLoginSuccess(data.username)
            : source === 'google'
              ? GOOGLE_COPY.session.googleLoginSuccess(data.username)
              : source === 'github'
                ? GITHUB_COPY.session.githubLoginSuccess(data.username)
                : COPY.session.autoLoginSuccess(data.username);
        appendLocalEvent('system', loginText);
        // GitHub 授权回跳的绑定 / 失败结果（v45）：自动登录成功后补进事件流（未登录场景在登录页由 loginError 显示）
        if (oauthNoticeRef.current) {
          appendLocalEvent('system', oauthNoticeRef.current);
          oauthNoticeRef.current = null;
        }
      } catch (err) {
        setConnection('idle');
        setLoginError(
          COPY.session.autoLoginFailed(err instanceof Error ? err.message : COPY.session.connectFailed),
        );
      }
    },
    [ensureClient, applyLoginResult, syncAll, appendLocalEvent],
  );

  // 微信扫码登录（v43）：二维码需要一条已连接但尚未登录的连接；扫码确认后拿到的会话令牌走原有令牌登录
  const connectForWechat = useCallback(async (): Promise<ApiClient> => {
    const client = ensureClient();
    await client.connect();
    return client;
  }, [ensureClient]);
  const loginWithWechatToken = useCallback(
    async (sessionToken: string) => {
      setLoginBusy(true);
      setLoginError(null);
      try {
        await tokenLogin(sessionToken, 'wechat');
      } finally {
        setLoginBusy(false);
      }
    },
    [tokenLogin],
  );
  // Google 一键登录（v44）：GSI 回调拿到 credential 后才建连接发 GOOGLE_LOGIN（用户选账号可能
  // 超过登录超时时限，不能先连着等）；换到的会话令牌走原有令牌登录。连接的建立在 GoogleLoginSection。
  const loginWithGoogleToken = useCallback(
    async (sessionToken: string) => {
      setLoginBusy(true);
      setLoginError(null);
      try {
        await tokenLogin(sessionToken, 'google');
      } finally {
        setLoginBusy(false);
      }
    },
    [tokenLogin],
  );
  // GitHub 一键登录（v45）：OAuth 回跳带回一次性码（地址栏已由 oauthReturn.ts 抹掉），
  // 建未登录连接发 OAUTH_REDEEM 换会话令牌，再走令牌登录；失败提示留在登录页。
  const loginWithOauthCode = useCallback(
    async (code: string) => {
      setLoginBusy(true);
      setLoginError(null);
      const { COPY, GITHUB_COPY } = getCopy();
      try {
        const client = ensureClient();
        await client.connect();
        const res = await client.request(Op.OAUTH_REDEEM, { code });
        if (!res.ok) {
          setConnection('idle');
          setLoginError(
            res.error?.code === 'OAUTH_CODE_INVALID'
              ? GITHUB_COPY.return.redeemFailed
              : githubErrorText(res.error?.code, res.error?.message),
          );
          return;
        }
        const sessionToken = res.data?.sessionToken;
        if (typeof sessionToken !== 'string') {
          setConnection('idle');
          setLoginError(GITHUB_COPY.errors.fallback);
          return;
        }
        await tokenLogin(sessionToken, 'github');
      } catch (err) {
        setConnection('idle');
        setLoginError(err instanceof Error ? err.message : COPY.errors.login.fallback);
      } finally {
        setLoginBusy(false);
      }
    },
    [ensureClient, tokenLogin],
  );
  const security = useAccountSecurity({ clientRef, setAgent });

  useEffect(() => {
    aliveRef.current = true;
    // GitHub OAuth 回跳（v45）：地址栏带一次性码 / 绑定结果（oauthReturn.ts 已顺手把参数抹掉）。
    // code 优先于本地保存的令牌——用户刚授权的是哪个号就进哪个号；绑定 / 失败结果在登录
    // 成功后进事件流，未登录场景由登录页的 loginError 显示。
    const oauthReturn = takeOauthReturn();
    if (oauthReturn?.kind === 'code') {
      setBooting(true);
      void loginWithOauthCode(oauthReturn.code).finally(() => {
        setBooting(false);
      });
      return () => {
        aliveRef.current = false;
        clearTimers();
        clientRef.current?.close();
        clientRef.current = null;
      };
    }
    if (oauthReturn) {
      const { GITHUB_COPY } = getCopy();
      const notice =
        oauthReturn.kind === 'bindOk'
          ? GITHUB_COPY.return.bindOk
          : oauthReturn.reason === 'canceled'
            ? GITHUB_COPY.return.canceled
            : oauthReturn.reason === 'expired'
              ? GITHUB_COPY.return.expired
              : oauthReturn.reason === 'already_bound'
                ? GITHUB_COPY.return.alreadyBound
                : oauthReturn.reason === 'unavailable'
                  ? GITHUB_COPY.return.unavailable
                  : GITHUB_COPY.return.unknown;
      oauthNoticeRef.current = notice;
      setLoginError(notice);
    }
    const stored = readStoredToken();
    if (stored) {
      setBooting(true);
      void tokenLogin(stored).finally(() => {
        setBooting(false);
      });
    }
    return () => {
      aliveRef.current = false;
      clearTimers();
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, [tokenLogin, clearTimers, loginWithOauthCode]);

  const logout = useCallback(async () => {
    logoutIntentRef.current = true;
    const client = clientRef.current;
    try {
      if (client?.connected) {
        await client.request(Op.LOGOUT);
      }
    } catch {
      // 网络异常时同样完成本地登出；令牌已随服务端关闭失效与否不可知，直接清除
    }
    clearStoredToken();
    resetToLoginForm(null);
    logoutIntentRef.current = false;
  }, [resetToLoginForm]);

  /** 建造 / 升级共用提交：直接结果乐观更新 + 本地事件，失败附状态刷新；
   *  toLevel（v22 AISLG-43 / AISLG-68）为连续升级目标（当前+2..10），单级不传 */
  const submitBuildAction = useCallback(
    async (kind: BuildingKind, op: number, toLevel?: number) => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      setBuildError(null);
      const { COPY, BUILDING_LABEL, buildActionText, EXTRA_STATE } = getCopy();
      const name = BUILDING_LABEL[kind].name;
      try {
        // 服务端分发层要求 toLevel 为 ≥3 的整数；仅在确实连升时携带
        const chainTarget = typeof toLevel === 'number' && Number.isInteger(toLevel) && toLevel >= 3 ? toLevel : undefined;
        const res = await client.request(op, chainTarget === undefined ? { kind } : { kind, toLevel: chainTarget });
        if (res.ok) {
          const build = field<BuildView>(res.data, 'build');
          if (build) {
            setCity((prev) => (prev ? applyBuildResult(prev, build) : prev));
            if (build.toLevel !== null) {
              const chain = (field<unknown[]>(res.data, 'chain') ?? []) as Array<{ seconds: number }>;
              const totalSeconds = chain.reduce((sum, step) => sum + (step.seconds ?? 0), 0);
              const count = build.toLevel - build.level + 1;
              appendLocalEvent(
                'player',
                build.status === 'queued'
                  ? COPY.session.buildChainQueued(name, build.toLevel, count)
                  : COPY.session.buildChainStarted(name, build.toLevel, count, totalSeconds, formatClock(build.dueAt as string)),
              );
            } else {
              const action = buildActionText(build.level);
              appendLocalEvent(
                'player',
                build.status === 'queued'
                  ? COPY.session.buildQueued(name, action)
                  : COPY.session.buildStarted(name, action, formatClock(build.dueAt as string)),
              );
            }
          }
          // build_started / build_queued 推送只发给同账号其他连接，发起方拿不到；
          // 服务端已扣资源，防抖走一轮按需查询对齐资源与产量
          scheduleSync();
        } else {
          setBuildError(buildErrorText(res.error?.code, res.error?.message, res.data));
          const cityNow = field<CityView>(res.data, 'city');
          if (cityNow) {
            setCity(cityNow);
          }
          appendLocalEvent('player', COPY.session.buildRejected(res.error?.message ?? EXTRA_STATE.state.rejectedFallback));
        }
      } catch (err) {
        setBuildError(err instanceof Error ? err.message : COPY.session.buildFailedFallback);
      }
    },
    [appendLocalEvent, scheduleSync],
  );

  const startBuild = useCallback(
    (kind: BuildingKind) => submitBuildAction(kind, Op.BUILD),
    [submitBuildAction],
  );

  const startUpgrade = useCallback(
    (kind: BuildingKind, toLevel?: number) => submitBuildAction(kind, Op.UPGRADE, toLevel),
    [submitBuildAction],
  );

  /** 取消排队条目：直接结果乐观移出队列，返还成本随防抖查询对齐 */
  const cancelBuild = useCallback(
    async (buildId: string) => {
      const client = clientRef.current;
      if (!client?.connected) {
        return;
      }
      setBuildError(null);
      const { COPY, BUILDING_LABEL, buildActionText, EXTRA_STATE } = getCopy();
      try {
        const res = await client.request(Op.CANCEL_BUILD, { buildId });
        if (res.ok) {
          const build = field<BuildView>(res.data, 'build');
          if (build) {
            setCity((prev) => (prev ? applyCancelResult(prev, build) : prev));
            appendLocalEvent(
              'player',
              COPY.session.buildCancelled(BUILDING_LABEL[build.kind].name, buildActionText(build.level)),
            );
          }
          scheduleSync();
        } else {
          setBuildError(buildErrorText(res.error?.code, res.error?.message));
          appendLocalEvent('player', COPY.session.cancelRejected(res.error?.message ?? EXTRA_STATE.state.rejectedFallback));
          // 取消被拒说明本地队列可能已过时被改动（如条目已被激活），立即对齐
          scheduleSync();
        }
      } catch (err) {
        setBuildError(err instanceof Error ? err.message : COPY.session.cancelFailedFallback);
      }
    },
    [appendLocalEvent, scheduleSync],
  );

  // 征兵动作（v11）拆到独立模块；依赖均为稳定引用（useCallback/ ref / setState）
  const { startRecruit, cancelRecruit } = useMemo(
    () => createRecruitActions({ clientRef, setCity, setRecruitError, appendLocalEvent, scheduleSync }),
    [appendLocalEvent, scheduleSync],
  );

  // 集市兑换（AISLG-67）同形态拆出；错误由弹窗侧接收展示，不走面板级 error 状态
  const { exchangeGold } = useMemo(
    () => createExchangeAction({ clientRef, setCity, appendLocalEvent, scheduleSync }),
    [appendLocalEvent, scheduleSync],
  );

  // 主动免战（v38 AISLG-122）：成功后 shield 随防抖按需查询对齐
  const { startTruce } = useMemo(
    () => createTruceAction({ clientRef, appendLocalEvent, scheduleSync }),
    [appendLocalEvent, scheduleSync],
  );

  /** 城池改名：发起连接收不到 PUSH_CITY_STATE，直接按响应更新名称 */
  const renameCity = useCallback(
    async (name: string): Promise<string | null> => {
      const { COPY } = getCopy();
      const client = clientRef.current;
      if (!client?.connected) {
        return COPY.session.connectFailed;
      }
      try {
        const res = await client.request(Op.RENAME_CITY, { name });
        if (res.ok) {
          const data = res.data as unknown as RenameCityResponseData;
          setCity((prev) => (prev ? { ...prev, name: data.name } : prev));
          // city_renamed 事件由防抖后的增量查询补进事件流
          scheduleSync();
          return null;
        }
        return renameErrorText(res.error?.code, res.error?.message);
      } catch (err) {
        return err instanceof Error ? err.message : COPY.errors.rename.fallback;
      }
    },
    [scheduleSync],
  );

  /** 一键重置账号数据（v9，仅玩家连接）：响应带回重置后的城池现状；
   *  服务端已清空事件流，本地同步清空并全量重拉（只剩 account_reset 审计事件）；
   *  世界数据（行军 / 领地 / 分城）一并重置，地图与详情清空重新加载 */
  const resetAccount = useCallback(async (): Promise<string | null> => {
    const { COPY } = getCopy();
    const client = clientRef.current;
    if (!client?.connected) {
      return COPY.session.connectFailed;
    }
    try {
      const res = await client.request(Op.RESET_ACCOUNT, { confirm: true });
      if (res.ok) {
        const city = field<CityView>(res.data, 'city');
        lastEventIdRef.current = 0;
        setEvents([]);
        setBuildError(null);
        setRecruitError(null);
        resetCityList();
        if (city) {
          setCity(city);
        }
        worldClear();
        techClear();
        heroClear();
        movingClear();
        ytClear();
        await syncAll('initial');
        return null;
      }
      return res.error?.message ?? COPY.errors.reset.fallback;
    } catch (err) {
      return err instanceof Error ? err.message : COPY.errors.reset.fallback;
    }
  }, [syncAll, worldClear, techClear, heroClear, movingClear, ytClear, resetCityList]);

  /** 加载更早的一页事件（beforeId 游标分页；本地临时事件 id 为负，不作为游标） */
  const loadOlderEvents = useCallback(async () => {
    const client = clientRef.current;
    if (!client?.connected || !accountRef.current || loadingOlderRef.current || eventsExhausted) {
      return;
    }
    const serverIds = eventsRef.current.map((event) => event.id).filter((id) => id > 0);
    if (serverIds.length === 0) {
      return;
    }
    loadingOlderRef.current = true;
    setEventsLoadingOlder(true);
    try {
      const res = await client.request(Op.GET_EVENTS, {
        limit: EVENTS_PAGE_SIZE,
        beforeId: Math.min(...serverIds),
      });
      if (!res.ok) {
        return;
      }
      const views = (field<EventView[]>(res.data, 'events') ?? []) as EventView[];
      if (views.length < EVENTS_PAGE_SIZE) {
        setEventsExhausted(true);
      }
      if (views.length === 0) {
        return;
      }
      // 返回为倒序（本页内新→旧）；内部按时间正序存放，渲染时再倒转
      const page = views.slice().reverse().map(toSessionEvent);
      setEvents((prev) => {
        const known = new Set(prev.map((event) => event.id));
        const fresh = page.filter((event) => !known.has(event.id));
        const next = [...fresh, ...prev];
        return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
      });
    } catch {
      // 网络异常：保持现状，下次滚动到底再试
    } finally {
      loadingOlderRef.current = false;
      setEventsLoadingOlder(false);
    }
  }, [eventsExhausted]);

  /** 切换当前操作的城池（v24）：请求层随之给城池类协议注入 cityId；清掉旧城状态后立即重拉 */
  const { select: selectCity } = cityList;
  const switchCity = useCallback(
    async (cityId: string) => {
      if (selectCity(cityId)) {
        await syncAll('incremental');
      }
    },
    [selectCity, syncAll],
  );

  return {
    booting,
    account,
    connection,
    loginBusy,
    loginError,
    buildError,
    recruitError,
    city,
    agent,
    events,
    eventsExhausted,
    eventsLoadingOlder,
    lastUsername,
    login,
    logout,
    startBuild,
    startUpgrade,
    cancelBuild,
    startRecruit,
    cancelRecruit,
    exchangeGold,
    startTruce,
    renameCity,
    resetAccount,
    ...extras,
    cityList,
    switchCity,
    world,
    techSession,
    heroSession,
    moving,
    yellowTurban,
    loadOlderEvents,
    security,
    connectForWechat,
    loginWithWechatToken,
    loginWithGoogleToken,
    loginWithOauthCode,
  };
}
