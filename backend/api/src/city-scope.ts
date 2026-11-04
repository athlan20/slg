// 请求级城池作用域（v24，AISLG-58）：城池类协议可选带 data.cityId 指定操作哪座城
// （缺省 = 主城，保持向后兼容）。分发层校验归属后，用 AsyncLocalStorage 把选中的城
// 带到 lockCitySnapshot / loadCityState——它们遍布各 handler 与失败响应的回读路径，
// 逐个加参数改动面过大，且并发请求各自独立、不会串城。
// 取消类协议（CANCEL_BUILD / CANCEL_RECRUIT）按条目自带的 city_id 定位，不依赖本作用域。

import { AsyncLocalStorage } from 'node:async_hooks';
import { Op } from '../../common/src/protocol';

const storage = new AsyncLocalStorage<{ cityId: string | undefined }>();

/** 当前请求选定的城池 id；缺省（undefined）= 账号主城（创建最早的城） */
export function currentCityId(): string | undefined {
  return storage.getStore()?.cityId;
}

export function runWithCity<T>(cityId: string | undefined, fn: () => Promise<T>): Promise<T> {
  return storage.run({ cityId }, fn);
}

/** 支持 data.cityId 的协议（建造 / 征兵 / 遣散（v84）/ 城防器械打造 / 出征 / 侦察 / 兑换 / 查询状态 / 改名 / 放弃分城（v57，必填）） */
export const CITY_SCOPED_OPS: ReadonlySet<number> = new Set([
  Op.GET_STATE,
  Op.BUILD,
  Op.UPGRADE,
  Op.RENAME_CITY,
  Op.RECRUIT,
  // v84（AISLG-209）：遣散按指定城扣兵、返还入该城
  Op.DISBAND_TROOPS,
  // v85（AISLG-212）：治疗 / 招降 / 劝回与放弃 / 释放按指定城的池子扣、回该城驻军
  Op.RESTORE_TROOPS,
  Op.RELEASE_TROOPS,
  Op.CRAFT_DEFENSE,
  Op.MARCH,
  Op.SCOUT,
  Op.EXCHANGE,
  Op.CREATE_MARKET_ORDER,
  Op.BUY_MARKET_ORDER,
  // v87（AISLG-217）：GET_TECHS / RESEARCH_TECH 不再带 cityId——书院只在主城，请求里的 cityId
  // 保留但忽略（不再进本作用域，也就不会因非本账号而报 INVALID_PARAMS）
  Op.BUILD_FARM,
  Op.DISCARD_CITY,
  // v91（AISLG-220）：迁城的 cityId 必填，按指定城校验归属并迁走它
  Op.MOVE_CITY,
  // v82（AISLG-205）：设为主城必须指定 cityId（分城），与放弃分城同口径
  Op.SET_CAPITAL,
]);
