// 协议帧层：错误文案、响应发送与请求参数读取。
// handlers 只负责业务路由，帧的构造与字段校验集中在这里。

import type { ConnInfo, ConnectionRegistry } from './connections';
import type { ErrorCode as ErrorCodeType, ResponseFrame } from '../../common/src/protocol';

export const ERROR_MESSAGES: Record<ErrorCodeType, string> = {
  INVALID_MESSAGE: '消息不是合法的协议帧',
  UNKNOWN_OP: '协议号不存在',
  NOT_LOGGED_IN: '登录前只能发送登录协议',
  ALREADY_LOGGED_IN: '连接已登录，不能重复登录',
  INVALID_PARAMS: '请求参数缺失或格式不正确',
  INVALID_CREDENTIALS: '用户名已存在或密码错误',
  SIGNUP_CLOSED: '该用户名不存在：密码登录不再支持注册，请用 Google / GitHub 登录创建账号',
  // USERNAME_TAKEN 已随 v48 移除（密码首登注册关闭后不再出现）
  // AGENT_ACCOUNT_NOT_FOUND 已随 v47 移除（Agent 禁用密码登录后不再出现）
  AGENT_PASSWORD_FORBIDDEN: 'Agent 不能用账号密码登录，请使用玩家的永久令牌（提示词里带的那种）',
  PASSWORD_LOGIN_CLOSED: '该站点不开放账号密码登录，请使用 Google / GitHub 登录',
  SESSION_INVALID: '会话令牌无效或已过期',
  INSUFFICIENT_RESOURCES: '资源不足以支付建造',
  BUILD_IN_PROGRESS: '已有在建建筑',
  QUEUE_FULL: '建造队列已满，请等待队首完成',
  BUILDING_EXISTS: '该类型建筑已存在（或已在建造/升级队列中）',
  BUILDING_NOT_BUILT: '该类型尚未建造，请先建造',
  BUILDING_LEVEL_MAX: '建筑已达等级上限',
  BUILD_NOT_CANCELLABLE: '只能取消排队中的建造任务（在建任务能否取消待设计）',
  AGENT_FORBIDDEN: '该操作不允许当前连接的登录类型调用（仅限玩家或仅限 Agent，见协议说明）',
  TROOP_NOT_AVAILABLE: '该兵种需要更高等级的军营',
  INSUFFICIENT_POPULATION: '人口不足以征募该数量',
  RECRUIT_QUEUE_FULL: '征兵队列已满，请等待队首完成',
  RECRUIT_NOT_CANCELLABLE: '只能取消排队中的征兵任务（征募中能否取消待设计）',
  TARGET_NOT_ATTACKABLE: '该目标当前不可出征（地图外、自己的出发城或他人占领的地块等）',
  INSUFFICIENT_TROOPS: '城内兵力不足以派出该编队',
  TILE_NOT_OCCUPIED: '该地块未被本账号占领，无法召回驻军',
  MARCH_NOT_RECALLABLE: '该行军不存在、不属于本账号、不在途中或已是返程，无法撤回',
  PLUNDER_COOLDOWN: '该地块处于掠夺冷却中（已被成功掠夺，冷却未结束，无法再次发起掠夺）',
  TASK_INVALID_FOR_TARGET: '该任务类型不适用于此目标（NPC 城池本期仅支持掠夺）',
  TERRITORY_LIMIT: '占领野地数已达官府等级上限（占领上限 = 官府等级，升级官府可提高上限）',
  GOVERNMENT_TOO_LOW: '占领 NPC 城需要主城官府达到 3 级',
  BRANCH_LIMIT: '分城数量已达上限（分城上限 = 主城官府等级 ÷ 3，向下取整；升级主城官府可提高上限）',
  TARGET_LEVEL_TOO_HIGH: '目标 NPC 城等级高于出发城的官府等级（只能占领不高于出发城官府等级的城）',
  OUTER_NOT_CLEARED: '名城外围驻军尚未清空，不能直接攻城守或占领；请先出征清理外围（task=plunder），外围清空后在限时内攻城',
  CARGO_OVER_CAPACITY: '运输货物总量超过所派部队的负重，请减少货物或多派部队（民夫负重最高）',
  TECH_LEVEL_MAX: '该科技已满级',
  RESEARCH_IN_PROGRESS: '已有进行中的研究，同一时间只能研究一项（可等待完成或取消）',
  ACADEMY_TOO_LOW: '发起研究的城书院等级不足：第 N 级科技要求书院 ≥ N 级（未建书院按 0 级）',
  RESEARCH_NOT_CANCELLABLE: '没有可取消的研究（不存在、不属于本账号或已完成）',
  DEPLOY_LIMIT: '校场等级不足，不能再派出部队（本城同时在外的部队数已达上限：上限 = 校场等级，未建校场按 1 支；升级校场可提高）',
  MOVING_TARGET_GONE: '该移动目标不存在、已被击败或已过时消失',
  TAVERN_NOT_BUILT: '该城尚未建造酒馆，无法招募武将',
  HERO_CANDIDATE_GONE: '该候选武将不存在或已被刷新掉，请重新查看酒馆候选',
  HERO_CAP_REACHED: '普通武将数量已达上限（上限 = ⌈酒馆最高等级 ÷ 2⌉ + 1），升级酒馆或先解雇',
  HERO_NOT_FOUND: '该武将不存在或不属于本账号',
  HERO_BUSY: '该武将正在随队出征（含返程），不能出征 / 解雇 / 任命城守',
  HERO_WOUNDED: '该武将重伤未愈，不能出征',
  HERO_ARREARS: '该武将欠饷中（主城金币不足以支付俸禄），补足金币后自动恢复',
  GUARD_ASSIGN_DENIED: '城守不能同时出征；城守只能任命未随行出征的本账号武将',
  NEWBIE_PROTECTED: '目标玩家处于新手保护期（注册后 3 天或任一城官府升到 8 级，先到为准），不能被侦察 / 攻击；data.until / retryAfterSeconds 为截止时刻与剩余秒数',
  TARGET_IN_TRUCE: '目标处于免战期（被打后免战或主动免战），玩家与 NPC 都不能再攻击；data.until / retryAfterSeconds 为截止时刻与剩余秒数',
  SELF_TRUCE_ACTIVE: '自己的主动免战生效中，不能出兵攻打玩家（打野地 / NPC 不受影响）；data.until / retryAfterSeconds 为截止时刻与剩余秒数',
  TRUCE_ALREADY_ACTIVE: '主动免战已在生效中，无需重复开启；data.until 为截止时刻',
  TRUCE_WEEKLY_USED: '本周的主动免战已用过（每周一次免费）；data.nextAvailableAt / retryAfterSeconds 为下次可开启时刻与剩余秒数',
  TILE_PROTECTED: '该野地刚换主人，处于保护期（被抢占后 1 小时基准随缩放），期间玩家与 NPC 都不能再抢；data.until / retryAfterSeconds 为截止时刻与剩余秒数',
  WX_TICKET_INVALID: '二维码不存在、已过期或已被使用，请在网页上刷新二维码',
  WX_CODE_INVALID: '微信登录凭证无效或已过期，请重新扫码',
  WX_ALREADY_BOUND: '该微信已绑定其他账号，或当前账号已绑定了别的微信',
  WX_UNAVAILABLE: '微信扫码登录暂不可用',
  GOOGLE_UNAVAILABLE: 'Google 登录暂不可用（未配置或连不上 Google）',
  GOOGLE_CREDENTIAL_INVALID: 'Google 登录凭证无效或已过期，请重新登录',
  GOOGLE_ALREADY_BOUND: '该 Google 账号已绑定其他账号，或当前账号已绑定了别的 Google 账号',
  GITHUB_UNAVAILABLE: 'GitHub 登录暂不可用（未配置或连不上 GitHub）',
  OAUTH_CODE_INVALID: '登录码无效或已过期，请重新发起登录',
  GITHUB_ALREADY_BOUND: '该 GitHub 账号已绑定其他账号，或当前账号已绑定了别的 GitHub 账号',
  RATE_LIMITED: '请求过于频繁，请稍后再试',
  // AGENT_TOKEN_LIMIT（v43 多令牌上限）已随 v46 移除
  INTERNAL: '服务端内部错误',
};

export function respondOk(
  registry: ConnectionRegistry,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown>,
): void {
  const frame: ResponseFrame = { op, ok: true, data };
  if (seq !== undefined) {
    frame.seq = seq;
  }
  registry.send(conn, frame);
}

export function respondError(
  registry: ConnectionRegistry,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  code: ErrorCodeType,
  data?: Record<string, unknown>,
): void {
  const frame: ResponseFrame = {
    op,
    ok: false,
    error: { code, message: ERROR_MESSAGES[code] ?? code },
  };
  if (seq !== undefined) {
    frame.seq = seq;
  }
  if (data) {
    frame.data = data;
  }
  registry.send(conn, frame);
}

export function readString(data: Record<string, unknown> | undefined, key: string): string | null {
  const value = data?.[key];
  return typeof value === 'string' ? value : null;
}

export function readIntInRange(
  data: Record<string, unknown> | undefined,
  key: string,
  min: number,
  max: number,
  fallback: number,
): number {
  const value = data?.[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    return fallback;
  }
  return value;
}

// sinceId / beforeId 的有效下界是 0（0 表示「从头开始」游标），因此这里只拒绝负数。
export function readOptionalNonNegativeInt(
  data: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = data?.[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}
