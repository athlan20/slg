// 设为主城（v82，AISLG-205）：分城与当前主城对调身份的规则判定（纯函数，API 与 GET_STATE 共用）。
// - 主城 = 账号名下 created_at 最早的城（约 45 处判定）；对调时把目标分城的 created_at 改成
//   「账号名下最小 created_at 减 1 秒」，所有主城判定自动生效，本文件不关心存储细节；
// - 冷却 24 小时（按全局时间缩放换算，不随官府等级变）；新号第一次不受冷却（无 capital_swaps 行）。
// 判定顺序即提示优先级：名城 → 冷却 → 被攻击 → 城防未满 → 分城数超新上限。

import { branchCityLimit } from './branch-city';
import { DURABILITY_MAX } from './protection';
import { scaledMs } from './time-scale';

/** 设为主城后的冷却基准：24 小时（随全局时间缩放） */
export const CAPITAL_SWAP_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export type CapitalSwapDenialCode =
  | 'FAMOUS_CITY_NOT_CAPITAL'
  | 'CAPITAL_SWAP_COOLDOWN'
  | 'CAPITAL_SWAP_UNDER_ATTACK'
  | 'CAPITAL_SWAP_DURABILITY_LOW'
  | 'BRANCH_LIMIT_EXCEEDED';

export interface CapitalSwapDenial {
  code: CapitalSwapDenialCode;
  /** 附加信息：冷却为 retryAfterSeconds；分城超限为 limit 与 branchCount */
  data?: Record<string, unknown>;
}

export interface CapitalSwapCheck {
  /** 目标分城是否名城（cities.famous_name 非空） */
  famous: boolean;
  /** 本账号冷却截止时刻；从未设为主城为 null */
  cooldownUntil: Date | null;
  /** 有他人玩家的出征正奔向本账号任一城或任一块野地 */
  underAttack: boolean;
  /** 目标城城防值（已惰性结算；未满即拒绝） */
  durability: number;
  /** 分城数（总城数 − 1）；对调身份前后不变 */
  branchCount: number;
  /** 新主城（目标城）的官府等级，决定换完后的分城上限 */
  newMainGovernment: number;
  now: Date;
}

/** 冷却截止时刻 = 当前时刻 + 基准时长（按全局时间缩放）；调用方传入数据库 now() */
export function capitalCooldownFrom(now: Date): Date {
  return new Date(now.getTime() + scaledMs(CAPITAL_SWAP_COOLDOWN_MS));
}

/** 设为主城的资格判定；通过返回 null，否则返回首个不满足的规则 */
export function capitalSwapDenial(check: CapitalSwapCheck): CapitalSwapDenial | null {
  if (check.famous) {
    return { code: 'FAMOUS_CITY_NOT_CAPITAL' };
  }
  if (check.cooldownUntil !== null && check.cooldownUntil.getTime() > check.now.getTime()) {
    const remainMs = check.cooldownUntil.getTime() - check.now.getTime();
    return { code: 'CAPITAL_SWAP_COOLDOWN', data: { retryAfterSeconds: Math.ceil(remainMs / 1000) } };
  }
  if (check.underAttack) {
    return { code: 'CAPITAL_SWAP_UNDER_ATTACK' };
  }
  if (check.durability < DURABILITY_MAX) {
    return { code: 'CAPITAL_SWAP_DURABILITY_LOW' };
  }
  const limit = branchCityLimit(check.newMainGovernment);
  if (check.branchCount > limit) {
    return { code: 'BRANCH_LIMIT_EXCEEDED', data: { limit, branchCount: check.branchCount } };
  }
  return null;
}
