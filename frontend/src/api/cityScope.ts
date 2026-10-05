// 当前操作的城池（v24，AISLG-58）：城池类协议可选带 data.cityId，缺省 = 主城。
// 选中的城是会话级单例（模块变量）——请求层在发送时统一注入，业务代码无需逐个传参；
// 登录 / 登出 / 重置账号时由会话层复位为主城。

import { Op } from './protocol';

/** 支持 data.cityId 的协议（与后端 CITY_SCOPED_OPS 对齐） */
const CITY_SCOPED_OPS: ReadonlySet<number> = new Set([
  Op.GET_STATE,
  Op.BUILD,
  Op.UPGRADE,
  Op.RENAME_CITY,
  Op.RECRUIT,
  Op.MARCH,
  Op.SCOUT,
  Op.EXCHANGE,
  Op.GET_TECHS,
  Op.RESEARCH_TECH,
  // v36（AISLG-114/115）：酒馆候选按城、城守任命按城
  Op.GET_HEROES,
  Op.ASSIGN_HERO,
]);

let activeCityId: string | null = null;

export function getActiveCityId(): string | null {
  return activeCityId;
}

/** 切换当前操作的城池；null = 主城 */
export function setActiveCityId(cityId: string | null): void {
  activeCityId = cityId;
}

/** 发送前注入 cityId：仅城池类协议、已选中分城且请求未自带时生效 */
export function withActiveCity(op: number, data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (activeCityId === null || !CITY_SCOPED_OPS.has(op) || data?.cityId !== undefined) {
    return data;
  }
  return { ...(data ?? {}), cityId: activeCityId };
}
