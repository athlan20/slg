// 城池迁移的协议类型（AISLG-220，v91）：MOVE_CITY（op 150）与 GET_STATE 的 moveCity 视图。
// 规则见 common/src/move-city.ts，数据库读取见 move-city-db.ts，事务见 api/src/handlers-move-city.ts。

import type { ItemId } from './items';
import type { MoveCityDenialCode, MoveCityMode } from './move-city';

/** MOVE_CITY（op 150）请求载荷 */
export interface MoveCityRequestData {
  /** 要迁的城（主城或分城），必填；名下没有该城返回 INVALID_PARAMS */
  cityId: string;
  /** random 随机迁（迁城令）/ pointing 指定坐标迁（高级迁城令） */
  mode: MoveCityMode;
  /** pointing 必填：目标坐标 */
  x?: number;
  y?: number;
  /** 执行时必填且必须为 true；preview = true 时不需要 */
  confirm?: boolean;
  /** true = 只预览：不改任何数据，返回消耗、目标与拦截原因 */
  preview?: boolean;
}

/** 旧格去向 */
export type MoveCityOldTile = 'wilderness' | 'npc_city';

/** MOVE_CITY 执行成功的响应载荷 */
export interface MoveCityResponseData {
  cityId: string;
  mode: MoveCityMode;
  from: { x: number; y: number };
  to: { x: number; y: number };
  /** 旧坐标到新坐标的 Chebyshev 距离（不影响消耗） */
  distance: number;
  /** 消耗的道具 id（random = city_order，pointing = city_order_adv） */
  itemId: ItemId;
  /** 消耗后该道具的剩余数量 */
  left: number;
  /** 旧格去向：主城 → wilderness（空野地）；分城 → npc_city（回归 NPC 城） */
  oldTile: MoveCityOldTile;
  /** pointing 迁后出征限制截止时刻（ISO 8601）；random 为 null */
  moveLockUntil: string | null;
}

/** MOVE_CITY 预览成功的响应载荷（preview = true 且条件全部满足；不满足时返回对应错误码） */
export interface MoveCityPreviewData {
  preview: true;
  cityId: string;
  mode: MoveCityMode;
  itemId: ItemId;
  /** 预览时已有的数量 */
  count: number;
  /** 需要消耗的数量（恒为 1） */
  need: 1;
  from: { x: number; y: number };
  /** pointing 为目标坐标；random 为 null（系统选址，确认后才定） */
  to: { x: number; y: number } | null;
  /** pointing 为旧坐标到新坐标的距离；random 为 null */
  distance: number | null;
  oldTile: MoveCityOldTile;
  /** pointing 迁后的出征限制时长（秒，已按时间缩放）；random 为 null */
  attackLockSeconds: number | null;
}

/** GET_STATE 的 moveCity 视图（v91）：逐城的不可迁原因与出限截止时刻，两种令的持有数 */
export interface MoveCityView {
  cities: Array<{
    cityId: string;
    /** 全部不满足的前四条规则（判定顺序：MOVE_CITY_FAMOUS → ARMY_OUTSIDE → HAS_ALLY_FORCE → IN_BATTLE）；空数组 = 前四条都通过 */
    reasons: MoveCityDenialCode[];
    /** 指定坐标迁后的出征限制截止时刻（ISO 8601），仅未结束时给出 */
    moveLockUntil?: string;
  }>;
  items: {
    random: { itemId: 'city_order'; count: number };
    pointing: { itemId: 'city_order_adv'; count: number };
  };
}

/** PUSH_CITY_STATE（reason = city_moved）携带的新旧坐标 */
export interface CityMovedPushMeta {
  from: { x: number; y: number };
  to: { x: number; y: number };
}
