// 错误码 → 人读提示的映射（从 api/mapping.ts 拆出以控制单文件行数）：
// 静态字面文案在 src/copy*.ts 的 ERRORS 等分组；本文件管「错误码 + 响应数据 → 哪条文案、
// 怎么拼缺口」。INSUFFICIENT_* 类失败响应附带的 shortfall / retryAfterSeconds
// 在这里拼成「还缺多少、多久攒够」（AISLG-69）。
// 文案按界面语言取用（AISLG-137）：每个函数体内经 getCopy() 取当前语言包并沿用原名
// 解构——严禁在模块顶层取用（语言切换后会过期）。

import {
  ALLIANCE_CREATE_COST_GOLD,
  ALLIANCE_CREATE_MIN_GOVERNMENT,
  ALLIANCE_MARK_MAX,
  ALLIANCE_MAX_VICES,
  type ErrorCode,
  type Resources,
} from './protocol';
import { getCopy } from '../i18n/bundle';
import { formatDurationText } from './format';

/**
 * 资源缺口后缀（AISLG-69）：INSUFFICIENT_RESOURCES 失败响应附带的 shortfall（每资源缺口）
 * 与 retryAfterSeconds（按当前净产量补齐所需秒数，净产量 ≤ 0 时为 null）拼成
 * 「，还缺 粮 200 / 石 50（约 3 分攒够）」；响应未带缺口数据时返回空串，退回静态文案。
 */
export function shortfallSuffix(data: Record<string, unknown> | undefined): string {
  const { RESOURCE_LABEL, COPY, EXTRA_STATE } = getCopy();
  const shortfall = data?.shortfall as Partial<Resources> | undefined;
  if (!shortfall) {
    return '';
  }
  const parts: string[] = [];
  for (const key of Object.keys(RESOURCE_LABEL) as Array<keyof Resources>) {
    const missing = shortfall[key];
    if (typeof missing === 'number' && missing > 0) {
      parts.push(`${RESOURCE_LABEL[key]} ${missing}`);
    }
  }
  if (parts.length === 0) {
    return '';
  }
  const retry = data?.retryAfterSeconds;
  const eta =
    typeof retry === 'number' && retry > 0
      ? COPY.errors.shortfall.eta(formatDurationText(retry))
      : COPY.errors.shortfall.noRate;
  return EXTRA_STATE.errorText.shortfall(parts.join(' / '), eta);
}

/**
 * 人口缺口后缀（AISLG-69，征兵 INSUFFICIENT_POPULATION）：shortfall 为单一数字，
 * retryAfterSeconds 按当前人口增速推导（无民房增速为 0 → null）。
 */
export function populationShortfallSuffix(data: Record<string, unknown> | undefined): string {
  const { COPY, EXTRA_STATE } = getCopy();
  const missing = data?.shortfall;
  if (typeof missing !== 'number' || missing <= 0) {
    return '';
  }
  const retry = data?.retryAfterSeconds;
  const eta =
    typeof retry === 'number' && retry > 0
      ? COPY.errors.shortfall.eta(formatDurationText(retry))
      : COPY.errors.shortfall.populationNoGrowth;
  return EXTRA_STATE.errorText.populationShortfall(missing, eta);
}

export function loginErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { COPY } = getCopy();
  switch (code) {
    case 'INVALID_CREDENTIALS':
      return COPY.errors.login.invalidCredentials;
    case 'SIGNUP_CLOSED':
      return COPY.errors.login.signupClosed;
    case 'INVALID_PARAMS':
      return COPY.errors.login.invalidParams;
    case 'SESSION_INVALID':
      return COPY.errors.login.sessionInvalid;
    case 'AGENT_PASSWORD_FORBIDDEN':
      return COPY.errors.login.agentPasswordLogin;
    case 'PASSWORD_LOGIN_CLOSED':
      return COPY.errors.login.passwordLoginDisabled;
    default:
      return message ?? COPY.errors.login.fallback;
  }
}

export function buildErrorText(
  code: ErrorCode | undefined,
  message: string | undefined,
  data?: Record<string, unknown>,
): string {
  const { COPY } = getCopy();
  switch (code) {
    case 'INSUFFICIENT_RESOURCES':
      // AISLG-69：失败响应附带 shortfall / retryAfterSeconds，拼出「还缺多少、多久攒够」
      return COPY.errors.build.insufficientResources + shortfallSuffix(data);
    case 'QUEUE_FULL':
      return COPY.errors.build.queueFull;
    case 'BUILDING_EXISTS':
      return COPY.errors.build.buildingExists;
    case 'BUILDING_NOT_BUILT':
      return COPY.errors.build.buildingNotBuilt;
    case 'BUILDING_LEVEL_MAX':
      return COPY.errors.build.buildingLevelMax;
    case 'BUILD_NOT_CANCELLABLE':
      return COPY.errors.build.buildNotCancellable;
    case 'INVALID_PARAMS':
      return COPY.errors.build.invalidParams;
    default:
      return message ?? COPY.errors.build.fallback;
  }
}

/** 改名失败的人读提示（改名弹窗内显示） */
export function renameErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { COPY } = getCopy();
  switch (code) {
    case 'INVALID_PARAMS':
      return COPY.errors.rename.invalidParams;
    default:
      return message ?? COPY.errors.rename.fallback;
  }
}

/** 昵称保存失败的人读提示（账号设置弹窗内显示，v52 AISLG-142） */
export function nicknameErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { WECHAT_COPY } = getCopy();
  switch (code) {
    case 'NICKNAME_TAKEN':
      return WECHAT_COPY.nickname.taken;
    case 'INVALID_PARAMS':
      return WECHAT_COPY.nickname.invalidParams;
    default:
      return message ?? WECHAT_COPY.nickname.fallback;
  }
}

/** 征兵 / 取消征兵失败的人读提示（征兵面板内显示，v11） */
export function recruitErrorText(
  code: ErrorCode | undefined,
  message: string | undefined,
  data?: Record<string, unknown>,
): string {
  const { COPY } = getCopy();
  switch (code) {
    case 'TROOP_NOT_AVAILABLE':
      return COPY.errors.recruit.troopNotAvailable;
    case 'ELITE_TROOP_LOCKED':
      return COPY.errors.recruit.eliteTroopLocked;
    case 'INSUFFICIENT_RESOURCES':
      return COPY.errors.recruit.insufficientResources + shortfallSuffix(data);
    case 'INSUFFICIENT_POPULATION':
      // 人口缺口是单一数字（insufficientPopulationDetail），与资源缺口分开拼
      return COPY.errors.recruit.insufficientPopulation + populationShortfallSuffix(data);
    case 'RECRUIT_QUEUE_FULL':
      return COPY.errors.recruit.queueFull;
    case 'RECRUIT_NOT_CANCELLABLE':
      return COPY.errors.recruit.notCancellable;
    case 'INVALID_PARAMS':
      return COPY.errors.recruit.invalidParams;
    default:
      return message ?? COPY.errors.recruit.fallback;
  }
}

/** 集市兑换失败的人读提示（兑换弹窗内显示，AISLG-67） */
export function exchangeErrorText(
  code: ErrorCode | undefined,
  message: string | undefined,
  data?: Record<string, unknown>,
): string {
  const { COPY } = getCopy();
  switch (code) {
    case 'INSUFFICIENT_RESOURCES':
      return COPY.errors.exchange.insufficientResources + shortfallSuffix(data);
    case 'INVALID_PARAMS':
      return COPY.errors.exchange.invalidParams;
    default:
      return message ?? COPY.errors.exchange.fallback;
  }
}

/** 科技研究失败的人读提示（科技面板内显示，v27 AISLG-77）；资源不足附缺口后缀不适用（服务端未推导，面板按钮已预判） */
export function techErrorText(
  code: ErrorCode | undefined,
  message: string | undefined,
  data?: Record<string, unknown>,
): string {
  const { TECH_COPY } = getCopy();
  switch (code) {
    case 'TECH_LEVEL_MAX':
      return TECH_COPY.errors.levelMax;
    case 'RESEARCH_IN_PROGRESS':
      return TECH_COPY.errors.inProgress;
    case 'ACADEMY_TOO_LOW':
      return TECH_COPY.errors.academyTooLow(Number(data?.academyRequired ?? 0), Number(data?.academyLevel ?? 0));
    case 'INSUFFICIENT_RESOURCES':
      return TECH_COPY.errors.insufficient;
    case 'RESEARCH_NOT_CANCELLABLE':
      return TECH_COPY.errors.notCancellable;
    default:
      return message ?? TECH_COPY.errors.fallback;
  }
}

/** 武将操作（招募 / 解雇 / 任命城守）失败的人读提示（武将面板内显示，v36 AISLG-114） */
export function heroErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { HERO_COPY, EXTRA_STATE } = getCopy();
  if (code === 'INSUFFICIENT_RESOURCES') {
    return EXTRA_STATE.errorText.heroGoldInsufficient;
  }
  return (code && HERO_COPY.errors.byCode[code]) || message || HERO_COPY.errors.fallback;
}

/** 出征 / 召回失败的人读提示（世界地图视图内显示，v12 起、v16 新增任务类错误码） */
export function marchErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { COPY, CITY_COPY, DEFENSE_COPY, HERO_COPY, EXTRA_STATE } = getCopy();
  switch (code) {
    case 'TARGET_NOT_ATTACKABLE':
      return COPY.errors.world.targetNotAttackable;
    case 'INSUFFICIENT_TROOPS':
      return COPY.errors.world.insufficientTroops;
    case 'TILE_NOT_OCCUPIED':
      return COPY.errors.world.tileNotOccupied;
    case 'GARRISON_WOULD_EMPTY':
      return COPY.errors.world.garrisonWouldEmpty;
    case 'INSUFFICIENT_GARRISON':
      return COPY.errors.world.insufficientGarrison;
    case 'INVALID_PARAMS':
      return COPY.errors.world.invalidParams;
    case 'PLUNDER_COOLDOWN':
      return COPY.errors.world.plunderCooldown;
    case 'TASK_INVALID_FOR_TARGET':
      return COPY.errors.world.taskInvalidForTarget;
    case 'NEWBIE_PROTECTED':
      return EXTRA_STATE.errorText.newbieProtected;
    case 'TARGET_IN_TRUCE':
      return EXTRA_STATE.errorText.targetInTruce;
    case 'SELF_TRUCE_ACTIVE':
      return EXTRA_STATE.errorText.selfTruceActive;
    case 'TILE_PROTECTED':
      return EXTRA_STATE.errorText.tileProtected;
    case 'ALLY_NOT_ATTACKABLE':
      return EXTRA_STATE.errorText.allyNotAttackable;
    case 'DEPLOY_LIMIT':
      return DEFENSE_COPY.deploy.hint;
    case 'TERRITORY_LIMIT':
      return COPY.errors.world.territoryLimit;
    case 'MOVING_TARGET_GONE':
      return EXTRA_STATE.errorText.movingTargetGone;
    case 'HERO_NOT_FOUND':
    case 'HERO_BUSY':
    case 'HERO_WOUNDED':
    case 'HERO_ARREARS':
    case 'GUARD_ASSIGN_DENIED':
      return HERO_COPY.errors.byCode[code] ?? HERO_COPY.errors.fallback;
    case 'CARGO_OVER_CAPACITY':
      return CITY_COPY.transport.overCapacity;
    case 'INSUFFICIENT_RESOURCES':
      return CITY_COPY.errors.transportInsufficient;
    // 分城资格类拒绝：服务端 message 已带具体门槛，缺省时用本地兜底文案
    case 'OUTER_NOT_CLEARED':
      return message ?? CITY_COPY.errors.outerNotCleared;
    case 'GOVERNMENT_TOO_LOW':
      return message ?? CITY_COPY.errors.governmentTooLow;
    case 'BRANCH_LIMIT':
      return message ?? CITY_COPY.errors.branchLimit;
    case 'TARGET_LEVEL_TOO_HIGH':
      return message ?? CITY_COPY.errors.targetLevelTooHigh;
    default:
      return message ?? COPY.errors.world.fallback;
  }
}

/** 微信扫码 / 绑定 / Agent 令牌相关失败的人读提示（v43）：已知错误码用本地文案，其余退回服务端 message */
export function wechatErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { WECHAT_COPY } = getCopy();
  return (code ? WECHAT_COPY.errors.byCode[code] : undefined) ?? message ?? WECHAT_COPY.errors.fallback;
}

/** Google 登录 / 绑定失败的人读提示（v44）：已知错误码用本地文案，其余退回服务端 message */
export function googleErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { GOOGLE_COPY } = getCopy();
  return (code ? GOOGLE_COPY.errors.byCode[code] : undefined) ?? message ?? GOOGLE_COPY.errors.fallback;
}

/** GitHub 登录 / 绑定失败的人读提示（v45）：已知错误码用本地文案，其余退回服务端 message */
export function githubErrorText(code: ErrorCode | undefined, message: string | undefined): string {
  const { GITHUB_COPY } = getCopy();
  return (code ? GITHUB_COPY.errors.byCode[code] : undefined) ?? message ?? GITHUB_COPY.errors.fallback;
}

/**
 * 联盟操作失败的人读提示（AISLG-186）：冷却类按服务端下发的 retryAfterSeconds（缺省时由 until 推算）拼剩余时长；
 * scene 为邀请 / 申请时，个别错误码（如 ALLIANCE_NOT_FOUND 在邀请里指昵称对不上）用场景文案覆盖。
 */
/**
 * 联盟地图标记操作失败的人读提示（AISLG-184 / F2）：满员时按服务端下发的 retryAfterSeconds 拼出最早一个到期的剩余时长；
 * 其余码直接用本地文案，未知码退回服务端 message。
 */
export function allianceMarkErrorText(code: ErrorCode | undefined, message: string | undefined, data?: Record<string, unknown>): string {
  const { ALLIANCE_COPY } = getCopy();
  const { markErrors } = ALLIANCE_COPY;
  switch (code) {
    case 'ALLIANCE_MARK_LIMIT': {
      const retry = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 0;
      return markErrors.ALLIANCE_MARK_LIMIT(ALLIANCE_MARK_MAX, formatDurationText(retry));
    }
    case 'ALLIANCE_MARK_EXISTS':
    case 'ALLIANCE_NOT_IN':
    case 'ALLIANCE_NOT_FOUND':
    case 'ALLIANCE_FORBIDDEN':
    case 'AGENT_FORBIDDEN':
    case 'INVALID_PARAMS':
      return markErrors[code];
    default:
      return message ?? markErrors.fallback;
  }
}

export function allianceErrorText(
  code: ErrorCode | undefined,
  message: string | undefined,
  data?: Record<string, unknown>,
  scene?: 'invite' | 'apply',
): string {
  const { ALLIANCE_COPY } = getCopy();
  const { errors, sceneErrors } = ALLIANCE_COPY;
  const sceneMap = scene ? (sceneErrors[scene] as Record<string, string>) : undefined;
  if (code && sceneMap && code in sceneMap) {
    return sceneMap[code];
  }
  switch (code) {
    case 'ALLIANCE_GOVERNMENT_TOO_LOW':
      return errors.ALLIANCE_GOVERNMENT_TOO_LOW(ALLIANCE_CREATE_MIN_GOVERNMENT);
    case 'ALLIANCE_COOLDOWN': {
      const retry = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : null;
      const until = typeof data?.until === 'string' ? Date.parse(data.until) : NaN;
      const seconds = retry ?? (Number.isNaN(until) ? 0 : Math.ceil((until - Date.now()) / 1000));
      return errors.ALLIANCE_COOLDOWN(formatDurationText(seconds));
    }
    case 'ALLIANCE_ROLE_FULL':
      return errors.ALLIANCE_ROLE_FULL(ALLIANCE_MAX_VICES);
    case 'DIPLOMACY_COOLDOWN': {
      const retry = typeof data?.retryAfterSeconds === 'number' ? data.retryAfterSeconds : 0;
      return retry > 0 ? `${errors.DIPLOMACY_COOLDOWN}（${formatDurationText(retry)}）` : errors.DIPLOMACY_COOLDOWN;
    }
    case 'INSUFFICIENT_RESOURCES':
      return errors.INSUFFICIENT_RESOURCES(ALLIANCE_CREATE_COST_GOLD.toLocaleString());
    case 'ALLIANCE_NAME_INVALID':
    case 'ALLIANCE_NAME_TAKEN':
    case 'ALLIANCE_ALREADY_IN':
    case 'ALLIANCE_NOT_IN':
    case 'ALLIANCE_NOT_FOUND':
    case 'ALLIANCE_FULL':
    case 'ALLIANCE_FORBIDDEN':
    case 'ALLIANCE_LEADER_MUST_TRANSFER':
    case 'ALLIANCE_REQUEST_EXISTS':
    case 'AGENT_FORBIDDEN':
    case 'INVALID_PARAMS':
      return errors[code];
    default:
      return message ?? errors.fallback;
  }
}
