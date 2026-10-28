// 协议分发与账号、查询类协议的处理逻辑；城池操作（建造/升级/取消/改名）见 handlers-city.ts。
// - 登录成功前只处理 LOGIN 与微信扫码登录协议（PRE_AUTH_OPS）；登录后重复 LOGIN 报错；
// - 发起指令的直接结果回给发送连接；同账号其他在线连接收到推送；
// - 城池操作的校验在事务内加行锁后按最新状态重新校验（玩家 / Agent 同时提交按先后生效）。

import pg from 'pg';
import {
  Op,
  EventType,
  isBuildingKind,
  type ClientFrame,
} from '../../common/src/protocol';
import { listEvents, toEventView } from '../../common/src/events';
import {
  handleLogin,
  handleLogout,
  pushAgentStatus,
  recordAgentPresence,
} from './handlers-auth';
import type { ConnInfo, ConnectionRegistry } from './connections';
import { readIntInRange, readOptionalNonNegativeInt, readString, respondError, respondOk } from './frames';
import {
  handleBuild,
  handleCancelBuild,
  handleExchange,
  handleUpgrade,
} from './handlers-city';
import { handleRenameCity, handleResetAccount, handleSetNickname } from './handlers-account';
import { handleCancelRecruit, handleRecruit, readRecruitParams } from './handlers-army';
import { handleCancelDefenseCraft, handleCraftDefense } from './handlers-defense';
import { handleDismissAssist } from './handlers-assist';
import {
  handleEnterBattlefield,
  handleGetBattlefield,
  handleMarchBattlefieldSquad,
  handleSignupBattlefield,
  handleSplitBattlefieldSquad,
} from './handlers-battlefield';
import { handleBuyBattlefieldItem } from './handlers-battlefield-shop';
import { handleChainBattlefieldStronghold, handleFireBattlefieldStronghold } from './handlers-battlefield-skill';
import { handleClaimNobilitySalary, handleGetNobility } from './handlers-nobility';
import { handleAllianceDiplomacyOp } from './handlers-alliance-diplomacy';
import { handleGetLuoyang, handlePublishDecree } from './handlers-luoyang';
import {
  handleBuyMarketOrder,
  handleCancelMarketOrder,
  handleCreateMarketOrder,
  handleGetMarket,
} from './handlers-market';
import {
  handleGetTile,
  handleGetWorldMap,
  handleMarch,
} from './handlers-world';
import { handleRecallGarrison, readRecallTroops } from './handlers-recall';
import { handleGetMapOverview } from './map-overview';
import { handleAnnouncementOp } from './handlers-announcement';
import { handleAllianceOp } from './handlers-alliance';
import { handleAllianceMarkOp } from './handlers-alliance-mark';
import { readMarchParams } from './march-target';
import { handleGetMovingTargets } from './handlers-moving';
import { handleGetYellowTurban } from './handlers-yt';
import { handleCancelResearch, handleGetTechs, handleResearchTech } from './handlers-tech';
import { handleAssignHero, handleDismissHero, handleGetHeroes, handleRecruitHero } from './handlers-hero';
import { routeHeroGrowthOp } from './handlers-hero-ops';
import { handleCancelTruce, handleTruce } from './handlers-pvp';
import { handleArenaChallenge, handleGetArena, handleGetArenaReports, handleSetArenaLineup } from './handlers-arena';
import { handleGetStarTower, handleGetStarTowerReports, handleStarTowerChallenge } from './handlers-star-tower';
import {
  handleAgentCommentReport,
  handleGetBattleReports,
  handleRecallMarch,
  handleScout,
  readScoutParams,
} from './handlers-battle';
import { handleAgentReportPlan, handleGetAgentInfo } from './handlers-agent-info';
import { handleGetAgentToken, handleResetAgentToken } from './handlers-agent-token';
import { handleWechatOp, onWxConnectionClosed, type WxService } from './handlers-wechat';
import { handleGoogleBind, handleGoogleLogin, type GoogleService } from './handlers-google';
import { handleGithubAuthStart, handleOauthRedeem, type GithubService } from './handlers-github';
import { handleGetServerBroadcasts } from './handlers-server';
import { handleChatOp } from './handlers-chat';
import { handleClaimDaily, handleGetDaily, handleGetSignin, handleSignin } from './handlers-quest';
import { handleClaimActivity, handleClaimQuest, handleGetActivities, handleGetQuests } from './handlers-quests';
import { handleGetLeaderboard } from './handlers-leaderboard';
import { effectiveLevelSql } from '../../common/src/production';
import { handleAgentDailyReport, handleGetOfflineReport, markPlayerOffline } from './handlers-offline';
import { loadCityState } from './views';
import { cityTitle } from '../../common/src/nobility';
import { CITY_SCOPED_OPS, runWithCity } from './city-scope';
import { handleDiscardCity } from './handlers-discard';
import { handleSetCapital } from './handlers-capital';
import { loadCapitalSwapView } from '../../common/src/capital-swap-db';
import { BRANCH_MIN_GOVERNMENT, branchCityLimit } from '../../common/src/branch-city';
import { handleGetHallOfFame, handleGetSeason, respondMaintenance } from './handlers-season';
import { maintenanceActive } from './maintenance-gate';

export interface HandlerContext {
  pool: pg.Pool;
  registry: ConnectionRegistry;
  /** 微信扫码登录服务（v43；单元测试可不提供，此时相关协议返回 WX_UNAVAILABLE） */
  wx?: WxService;
  /** Google 一键登录服务（v44；未配置 GOOGLE_CLIENT_ID 或单元测试不提供时，相关协议返回 GOOGLE_UNAVAILABLE） */
  google?: GoogleService;
  /** GitHub 一键登录服务（v45；未配置 GitHub OAuth App 或单元测试不提供时，相关协议返回 GITHUB_UNAVAILABLE） */
  github?: GithubService;
  /** 关闭密码登录的站点 Host（v47，AISLG-130：PASSWORD_LOGIN_DISABLED_HOSTS，如国际站
   *  slg.yuntianyou.cc）；这些 Host 上的连接发 LOGIN 密码登录返回 PASSWORD_LOGIN_DISABLED */
  passwordDisabledHosts: ReadonlySet<string>;
}

/** 登录前即可发送的协议：LOGIN、微信扫码登录一组（WX_QR_CREATE 的 bind 用途在处理器内要求已登录）、
 *  Google 登录（GOOGLE_BIND 在处理器内要求玩家已登录）与 GitHub 授权 / 一次性码兑换
 * （GITHUB_AUTH_START 的 bind 用途在处理器内要求玩家已登录） */
const PRE_AUTH_OPS: ReadonlySet<number> = new Set([Op.LOGIN, Op.WX_QR_CREATE, Op.WX_SCAN, Op.WX_CONFIRM, Op.WX_CANCEL, Op.GOOGLE_LOGIN, Op.GITHUB_AUTH_START, Op.OAUTH_REDEEM]);

/** 换季维护期间仍可发送的协议（v65）：登录相关、LOGOUT 与 GET_SEASON；其余游戏类请求返回 MAINTENANCE */
const MAINTENANCE_EXEMPT_OPS: ReadonlySet<number> = new Set([...PRE_AUTH_OPS, Op.LOGOUT, Op.GET_SEASON]);

/** 消息入口：解析帧并路由；任何处理异常都转成错误响应，不让连接中断。 */
export async function handleMessage(ctx: HandlerContext, conn: ConnInfo, raw: string): Promise<void> {
  let frame: unknown;
  try {
    frame = JSON.parse(raw);
  } catch {
    respondError(ctx.registry, conn, 0, undefined, 'INVALID_MESSAGE');
    return;
  }
  if (frame === null || typeof frame !== 'object') {
    respondError(ctx.registry, conn, 0, undefined, 'INVALID_MESSAGE');
    return;
  }
  const clientFrame = frame as ClientFrame;
  // seq 在 op 校验前取出：帧非法也原样回带，客户端才能把错误对回请求（v17；原 op
  // 无法安全回显——非数字或非整数，恒回 0）
  const seq = typeof clientFrame.seq === 'number' ? clientFrame.seq : undefined;
  // op 必须是整数协议号：非整数（如 21.5）按非法帧拒绝，不再原样回显（v17）
  if (typeof clientFrame.op !== 'number' || !Number.isInteger(clientFrame.op)) {
    respondError(ctx.registry, conn, 0, seq, 'INVALID_MESSAGE');
    return;
  }
  const op = clientFrame.op;
  const data =
    clientFrame.data !== null && typeof clientFrame.data === 'object'
      ? (clientFrame.data as Record<string, unknown>)
      : undefined;

  if (conn.accountId && op === Op.LOGIN) {
    respondError(ctx.registry, conn, op, seq, 'ALREADY_LOGGED_IN');
    return;
  }
  if (!conn.accountId && !PRE_AUTH_OPS.has(op)) {
    respondError(ctx.registry, conn, op, seq, 'NOT_LOGGED_IN');
    return;
  }

  try {
    // v65（AISLG-134）：换季维护态下拒绝游戏类协议（维护态缓存约 2 秒，见 maintenance-gate.ts）
    if (!MAINTENANCE_EXEMPT_OPS.has(op) && (await maintenanceActive(ctx.pool))) {
      respondMaintenance(ctx, conn, op, seq);
      return;
    }
    // v24（AISLG-58）：城池类协议可选带 cityId（缺省 = 主城）；归属校验失败按参数错误拒绝
    let cityId: string | undefined;
    if (CITY_SCOPED_OPS.has(op) && data?.cityId !== undefined && data?.cityId !== null) {
      const owned = typeof data.cityId === 'string' ? await ownCityId(ctx, conn.accountId as string, data.cityId) : null;
      if (owned === null) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        return;
      }
      cityId = owned;
    }
    await runWithCity(cityId, () => dispatchOp(ctx, conn, op, seq, data));
  } catch (err) {
    console.error('handleMessage error op=%d:', op, err);
    respondError(ctx.registry, conn, op, seq, 'INTERNAL');
  }
}

/** 校验 cityId 属于该账号（格式非法或非本账号的城返回 null） */
async function ownCityId(ctx: HandlerContext, accountId: string, cityId: string): Promise<string | null> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(cityId)) {
    return null;
  }
  const res = await ctx.pool.query(`SELECT id FROM cities WHERE id = $1 AND account_id = $2`, [cityId, accountId]);
  return res.rowCount ? cityId : null;
}

async function dispatchOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  switch (op) {
    case Op.LOGIN:
      await handleLogin(ctx, conn, data, op, seq);
      break;
    case Op.LOGOUT:
      await handleLogout(ctx, conn, op, seq);
      break;
    case Op.GET_STATE:
      await handleGetState(ctx, conn, op, seq);
      break;
    case Op.GET_EVENTS:
      await handleGetEvents(ctx, conn, data, op, seq);
      break;
    case Op.GET_AGENT_INFO:
      await handleGetAgentInfo(ctx, conn, op, seq);
      break;
    case Op.GET_WORLD_MAP:
      await handleGetWorldMap(ctx, conn, op, seq, data);
      break;
    case Op.GET_MAP_OVERVIEW:
      await handleGetMapOverview(ctx, conn, op, seq);
      break;
    case Op.GET_ANNOUNCEMENTS:
    case Op.GET_ANNOUNCEMENT:
    case Op.READ_ANNOUNCEMENT:
      await handleAnnouncementOp(ctx, conn, op, seq, data);
      break;
    case Op.CREATE_ALLIANCE:
    case Op.GET_ALLIANCE:
    case Op.LIST_ALLIANCES:
    case Op.ALLIANCE_APPLY:
    case Op.ALLIANCE_INVITE:
    case Op.ALLIANCE_RESPOND:
    case Op.ALLIANCE_LEAVE:
    case Op.ALLIANCE_DISBAND:
    case Op.ALLIANCE_KICK:
    case Op.ALLIANCE_SET_ROLE:
    case Op.ALLIANCE_SET_NOTICE:
      await handleAllianceOp(ctx, conn, op, seq, data);
      break;
    case Op.ALLIANCE_MARK_ADD:
    case Op.ALLIANCE_MARK_REMOVE:
    case Op.GET_ALLIANCE_MARKS:
      await handleAllianceMarkOp(ctx, conn, op, seq, data);
      break;
    case Op.GET_TILE: {
      const x = data?.x;
      const y = data?.y;
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleGetTile(ctx, conn, op, seq, data);
      break;
    }
    case Op.MARCH: {
      const params = readMarchParams(data);
      if (!params) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleMarch(ctx, conn, op, seq, params.x, params.y, params.troops, params.task, params.cargo, params.targetId, params.heroId);
      break;
    }
    case Op.RECALL_GARRISON: {
      const x = data?.x;
      const y = data?.y;
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      // v83（AISLG-207）：troops 缺省 = 全撤；带 troops 按兵种部分撤回，非法返回 INVALID_PARAMS
      const recall = readRecallTroops(data);
      if (!recall) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleRecallGarrison(ctx, conn, op, seq, x as number, y as number, recall.troops);
      break;
    }
    case Op.SCOUT: {
      const params = readScoutParams(data);
      if (!params) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleScout(ctx, conn, op, seq, params.x, params.y, params.count, params.heroId);
      break;
    }
    case Op.RECALL_MARCH: {
      const marchId = readString(data, 'marchId');
      if (marchId === null || marchId.length < 1) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleRecallMarch(ctx, conn, op, seq, marchId);
      break;
    }
    case Op.GET_BATTLE_REPORTS:
      await handleGetBattleReports(ctx, conn, op, seq, data);
      break;
    case Op.GET_YELLOW_TURBAN:
      await handleGetYellowTurban(ctx, conn, op, seq);
      break;
    case Op.GET_MOVING_TARGETS:
      await handleGetMovingTargets(ctx, conn, op, seq);
      break;
    case Op.GET_HEROES:
      await handleGetHeroes(ctx, conn, op, seq, data);
      break;
    case Op.RECRUIT_HERO:
      await handleRecruitHero(ctx, conn, op, seq, data);
      break;
    case Op.DISMISS_HERO:
      await handleDismissHero(ctx, conn, op, seq, data);
      break;
    case Op.ASSIGN_HERO:
      await handleAssignHero(ctx, conn, op, seq, data);
      break;
    case Op.ALLOCATE_HERO_POINTS:
    case Op.RESET_HERO_POINTS:
    case Op.TRAIN_HERO:
    case Op.CANCEL_TRAINING:
    case Op.GIFT_HERO:
    case Op.BEFRIEND_HERO:
    case Op.RECRUIT_FAMOUS_HERO:
      await routeHeroGrowthOp(ctx, conn, op, seq, data);
      break;
    case Op.TRUCE:
      await handleTruce(ctx, conn, op, seq);
      break;
    case Op.CANCEL_TRUCE:
      await handleCancelTruce(ctx, conn, op, seq);
      break;
    case Op.GET_ARENA:
      await handleGetArena(ctx, conn, op, seq);
      break;
    case Op.SET_ARENA_LINEUP:
      await handleSetArenaLineup(ctx, conn, op, seq, data);
      break;
    case Op.ARENA_CHALLENGE:
      await handleArenaChallenge(ctx, conn, op, seq, data);
      break;
    case Op.GET_ARENA_REPORTS:
      await handleGetArenaReports(ctx, conn, op, seq, data);
      break;
    case Op.GET_STAR_TOWER:
      await handleGetStarTower(ctx, conn, op, seq);
      break;
    case Op.STAR_TOWER_CHALLENGE:
      await handleStarTowerChallenge(ctx, conn, op, seq);
      break;
    case Op.GET_STAR_TOWER_REPORTS:
      await handleGetStarTowerReports(ctx, conn, op, seq, data);
      break;
    case Op.GET_TECHS:
      await handleGetTechs(ctx, conn, op, seq);
      break;
    case Op.RESEARCH_TECH:
      await handleResearchTech(ctx, conn, op, seq, data);
      break;
    case Op.CANCEL_RESEARCH:
      await handleCancelResearch(ctx, conn, op, seq, data);
      break;
    case Op.AGENT_COMMENT_REPORT:
      await handleAgentCommentReport(ctx, conn, op, seq, data);
      break;
    case Op.AGENT_DAILY_REPORT:
      await handleAgentDailyReport(ctx, conn, op, seq, data);
      break;
    case Op.GET_OFFLINE_REPORT:
      await handleGetOfflineReport(ctx, conn, op, seq);
      break;
    case Op.GET_SERVER_BROADCASTS:
      await handleGetServerBroadcasts(ctx, conn, op, seq, data);
      break;
    case Op.GET_LEADERBOARD:
      await handleGetLeaderboard(ctx, conn, op, seq, data);
      break;
    case Op.AGENT_REPORT_PLAN:
      await handleAgentReportPlan(ctx, conn, op, seq, data);
      break;
    case Op.WX_QR_CREATE:
    case Op.WX_SCAN:
    case Op.WX_CONFIRM:
    case Op.WX_CANCEL:
      await handleWechatOp(ctx, conn, op, seq, data);
      break;
    case Op.GET_AGENT_TOKEN:
      await handleGetAgentToken(ctx, conn, op, seq);
      break;
    case Op.RESET_AGENT_TOKEN:
      await handleResetAgentToken(ctx, conn, op, seq);
      break;
    case Op.GOOGLE_LOGIN:
      await handleGoogleLogin(ctx, conn, op, seq, data);
      break;
    case Op.GOOGLE_BIND:
      await handleGoogleBind(ctx, conn, op, seq, data);
      break;
    case Op.GITHUB_AUTH_START:
      await handleGithubAuthStart(ctx, conn, op, seq, data);
      break;
    case Op.OAUTH_REDEEM:
      await handleOauthRedeem(ctx, conn, op, seq, data);
      break;
    case Op.RECRUIT: {
      const params = readRecruitParams(data);
      if (!params) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleRecruit(ctx, conn, op, seq, params.troop, params.count);
      break;
    }
    case Op.CANCEL_RECRUIT: {
      const recruitId = readString(data, 'recruitId');
      if (recruitId === null || recruitId.length < 1) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleCancelRecruit(ctx, conn, op, seq, recruitId);
      break;
    }
    case Op.CRAFT_DEFENSE:
      // 参数校验在 handler 内（kind 枚举 + count 正整数），失败附当前城池状态
      await handleCraftDefense(ctx, conn, op, seq, data);
      break;
    case Op.CANCEL_DEFENSE_CRAFT:
      await handleCancelDefenseCraft(ctx, conn, op, seq, data);
      break;
    case Op.DISMISS_ASSIST:
      await handleDismissAssist(ctx, conn, op, seq, data);
      break;
    case Op.GET_BATTLEFIELD:
      await handleGetBattlefield(ctx, conn, op, seq);
      break;
    case Op.SIGNUP_BATTLEFIELD:
      await handleSignupBattlefield(ctx, conn, op, seq, data);
      break;
    case Op.ENTER_BATTLEFIELD:
      await handleEnterBattlefield(ctx, conn, op, seq, data);
      break;
    case Op.SPLIT_BATTLEFIELD_SQUAD:
      await handleSplitBattlefieldSquad(ctx, conn, op, seq, data);
      break;
    case Op.MARCH_BATTLEFIELD_SQUAD:
      await handleMarchBattlefieldSquad(ctx, conn, op, seq, data);
      break;
    case Op.BUY_BATTLEFIELD_ITEM:
      await handleBuyBattlefieldItem(ctx, conn, op, seq, data);
      break;
    case Op.FIRE_BATTLEFIELD_STRONGHOLD:
      await handleFireBattlefieldStronghold(ctx, conn, op, seq, data);
      break;
    case Op.CHAIN_BATTLEFIELD_STRONGHOLD:
      await handleChainBattlefieldStronghold(ctx, conn, op, seq, data);
      break;
    case Op.ALLIANCE_DIPLOMACY_INVITE:
    case Op.ALLIANCE_DIPLOMACY_RESPOND:
    case Op.ALLIANCE_DIPLOMACY_END:
    case Op.ALLIANCE_DIPLOMACY_HOSTILE:
    case Op.GET_ALLIANCE_DIPLOMACY:
      await handleAllianceDiplomacyOp(ctx, conn, op, seq, data);
      break;
    case Op.GET_LUOYANG:
      await handleGetLuoyang(ctx, conn, op, seq);
      break;
    case Op.PUBLISH_DECREE:
      await handlePublishDecree(ctx, conn, op, seq, data);
      break;
    case Op.GET_MARKET:
      await handleGetMarket(ctx, conn, op, seq, data);
      break;
    case Op.CREATE_MARKET_ORDER:
      await handleCreateMarketOrder(ctx, conn, op, seq, data);
      break;
    case Op.BUY_MARKET_ORDER:
      await handleBuyMarketOrder(ctx, conn, op, seq, data);
      break;
    case Op.CANCEL_MARKET_ORDER:
      await handleCancelMarketOrder(ctx, conn, op, seq, data);
      break;
    case Op.GET_NOBILITY:
      await handleGetNobility(ctx, conn, op, seq);
      break;
    case Op.CLAIM_NOBILITY_SALARY:
      await handleClaimNobilitySalary(ctx, conn, op, seq);
      break;
    case Op.BUILD: {
      const kind = readString(data, 'kind');
      if (!isBuildingKind(kind)) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleBuild(ctx, conn, op, seq, kind);
      break;
    }
    case Op.UPGRADE: {
      const kind = readString(data, 'kind');
      if (!isBuildingKind(kind)) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      // v22（AISLG-43）：可选 toLevel 连续升级到目标等级（当前+2 .. 10）；
      // 非法取值（非整数 / ≤ 当前+1 之外的范围）按参数错误拒绝
      const rawToLevel = data?.toLevel;
      if (rawToLevel !== undefined && rawToLevel !== null) {
        if (typeof rawToLevel !== 'number' || !Number.isInteger(rawToLevel) || rawToLevel < 3) {
          respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
          break;
        }
        await handleUpgrade(ctx, conn, op, seq, kind, rawToLevel);
        break;
      }
      await handleUpgrade(ctx, conn, op, seq, kind, null);
      break;
    }
    case Op.EXCHANGE:
      await handleExchange(ctx, conn, op, seq, data);
      break;
    case Op.CANCEL_BUILD: {
      const buildId = readString(data, 'buildId');
      if (buildId === null || buildId.length < 1) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        break;
      }
      await handleCancelBuild(ctx, conn, op, seq, buildId);
      break;
    }
    case Op.RENAME_CITY:
      await handleRenameCity(ctx, conn, op, seq, data);
      break;
    case Op.RESET_ACCOUNT:
      await handleResetAccount(ctx, conn, op, seq, data);
      break;
    case Op.DISCARD_CITY:
      await handleDiscardCity(ctx, conn, op, seq, data);
      break;
    case Op.SET_CAPITAL:
      await handleSetCapital(ctx, conn, op, seq, data);
      break;
    case Op.SET_NICKNAME:
      await handleSetNickname(ctx, conn, op, seq, data);
      break;
    case Op.CHAT_HISTORY:
    case Op.CHAT_SEND:
    case Op.CHAT_CONVERSATIONS:
    case Op.CHAT_READ:
    case Op.CHAT_BLOCK:
    case Op.CHAT_REPORT_DETAIL:
      await handleChatOp(ctx, conn, op, seq, data);
      break;
    case Op.GET_DAILY:
      await handleGetDaily(ctx, conn, op, seq);
      break;
    case Op.CLAIM_DAILY:
      await handleClaimDaily(ctx, conn, op, seq, data);
      break;
    case Op.GET_SIGNIN:
      await handleGetSignin(ctx, conn, op, seq);
      break;
    case Op.SIGNIN:
      await handleSignin(ctx, conn, op, seq);
      break;
    case Op.GET_QUESTS:
      await handleGetQuests(ctx, conn, op, seq);
      break;
    case Op.CLAIM_QUEST:
      await handleClaimQuest(ctx, conn, op, seq, data);
      break;
    case Op.GET_ACTIVITIES:
      await handleGetActivities(ctx, conn, op, seq);
      break;
    case Op.CLAIM_ACTIVITY:
      await handleClaimActivity(ctx, conn, op, seq, data);
      break;
    case Op.GET_SEASON:
      await handleGetSeason(ctx, conn, op, seq);
      break;
    case Op.GET_HALL_OF_FAME:
      await handleGetHallOfFame(ctx, conn, op, seq, data);
      break;
    case Op.BUILD_FARM:
      // 兼容入口（协议 v2 及以前）：等价于 BUILD 且 kind='farm'，忽略请求参数
      await handleBuild(ctx, conn, op, seq, 'farm');
      break;
    default:
      respondError(ctx.registry, conn, op, seq, 'UNKNOWN_OP');
  }
}

async function handleGetState(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const city = await loadCityState(ctx.pool, accountId);
  if (!city) {
    // 登录账号没有城池属于数据异常，注册流程保证每账号一城
    respondError(ctx.registry, conn, op, seq, 'INTERNAL');
    return;
  }
  // v12：附带账号全部城池（主城在前；占领 NPC 城池后出现分城），供客户端定位与展示；
  // v24（AISLG-58）：level = 各城官府等级；branch 给出分城名额与占领门槛
  const citiesRes = await ctx.pool.query(
    `SELECT c.id, c.name, COALESCE(${effectiveLevelSql('g.level', "'government'", 'c.famous_name')}, 0)::int AS level, c.x, c.y
     FROM cities c LEFT JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government'
     WHERE c.account_id = $1 ORDER BY c.created_at`,
    [accountId],
  );
  const cities = citiesRes.rows.map((row: { id: string; name: string; level: number; x: number | null; y: number | null }, index: number) => ({
    id: row.id,
    name: row.name,
    level: row.level,
    x: row.x,
    y: row.y,
    isMain: index === 0,
    title: cityTitle(row.level, index === 0),
    nobility: city?.nobility ?? { index: 0, name: '平民' },
  }));
  const mainGovernment = cities[0]?.level ?? 0;
  const branch = {
    count: Math.max(0, cities.length - 1),
    limit: branchCityLimit(mainGovernment),
    minGovernment: BRANCH_MIN_GOVERNMENT,
  };
  // v82（AISLG-205）：设为主城的冷却 / 来袭 / 逐城不可设原因，供前端置灰
  const capitalSwap = await loadCapitalSwapView(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, { city, cities, branch, capitalSwap });
}

async function handleGetEvents(
  ctx: HandlerContext,
  conn: ConnInfo,
  data: Record<string, unknown> | undefined,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const limit = readIntInRange(data, 'limit', 1, 200, 50);
  const beforeId = readOptionalNonNegativeInt(data, 'beforeId');
  const sinceId = readOptionalNonNegativeInt(data, 'sinceId');
  if (beforeId !== undefined && sinceId !== undefined) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const rows = await listEvents(ctx.pool, conn.accountId as string, {
    limit,
    beforeId,
    sinceId,
  });
  respondOk(ctx.registry, conn, op, seq, { events: rows.map(toEventView) });
}

/** 连接关闭时调用：Agent 离线写事件并推送最新 Agent 在线状态；玩家的最后一条
 *  玩家连接断开时记录离线时刻（离线日报的统计起点，v23 AISLG-54） */
export async function handleConnectionClosed(ctx: HandlerContext, conn: ConnInfo): Promise<void> {
  onWxConnectionClosed(ctx, conn);
  const accountId = ctx.registry.peekAccountId(conn);
  if (!accountId) {
    ctx.registry.remove(conn);
    return;
  }
  if (conn.role !== 'agent') {
    ctx.registry.remove(conn);
    const playerLeft = ctx.registry
      .connectionsOf(accountId)
      .every((c) => c.role !== 'player');
    if (playerLeft) {
      try {
        await markPlayerOffline(ctx.pool, accountId);
      } catch (err) {
        console.error('mark player offline failed:', err);
      }
    }
    return;
  }
  const wasOnline = ctx.registry.agentConnections(accountId).length > 0;
  ctx.registry.remove(conn);
  const isOnline = ctx.registry.agentConnections(accountId).length > 0;
  try {
    await recordAgentPresence(ctx, accountId, EventType.AGENT_DISCONNECTED);
  } catch (err) {
    console.error('write agent_disconnected failed:', err);
  }
  if (wasOnline !== isOnline) {
    pushAgentStatus(ctx, accountId, isOnline);
  }
}
