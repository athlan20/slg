// 错误码 → 人读提示的映射（从 api/mapping.ts 拆出以控制单文件行数）：
// 静态字面文案在 src/copy*.ts 的 ERRORS 等分组；本文件管「错误码 + 响应数据 → 哪条文案、
// 怎么拼缺口」。INSUFFICIENT_* 类失败响应附带的 shortfall / retryAfterSeconds
// 在这里拼成「还缺多少、多久攒够」（AISLG-69）。
// 文案按界面语言取用（AISLG-137）：每个函数体内经 getCopy() 取当前语言包并沿用原名
// 解构——严禁在模块顶层取用（语言切换后会过期）。

import type { ErrorCode, Resources } from './protocol';
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
