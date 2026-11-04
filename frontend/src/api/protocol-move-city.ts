// 城池迁移的协议类型（v91，AISLG-220）：MOVE_CITY（op 150）与 GET_STATE 的 moveCity 视图。镜像后端 common/src/protocol-move-city.ts。

import type { ItemId } from './protocol-items';

/** 迁城方式 */
export type MoveCityMode = 'random' | 'pointing';

/** 迁城请求载荷（preview = true 只预览；执行须 confirm = true） */
export interface MoveCityRequestData {
  cityId: string;
  mode: MoveCityMode;
  x?: number;
  y?: number;
  confirm?: boolean;
  preview?: boolean;
}

/** 迁城执行结果 */
export interface MoveCityResponseData {
  cityId: string;
  mode: MoveCityMode;
  from: { x: number; y: number };
  to: { x: number; y: number };
  distance: number;
  itemId: ItemId;
  left: number;
  oldTile: 'wilderness' | 'npc_city';
  moveLockUntil: string | null;
}

/** 迁城预览（条件全部满足时返回；不满足返回错误码） */
export interface MoveCityPreviewData {
  preview: true;
  cityId: string;
  mode: MoveCityMode;
  itemId: ItemId;
  count: number;
  need: 1;
  from: { x: number; y: number };
  to: { x: number; y: number } | null;
  distance: number | null;
  oldTile: 'wilderness' | 'npc_city';
  attackLockSeconds: number | null;
}

/** GET_STATE 的 moveCity 视图 */
export interface MoveCityView {
  cities: Array<{
    cityId: string;
    reasons: Array<'MOVE_CITY_FAMOUS' | 'MOVE_CITY_ARMY_OUTSIDE' | 'MOVE_CITY_HAS_ALLY_FORCE' | 'MOVE_CITY_IN_BATTLE'>;
    moveLockUntil?: string;
  }>;
  items: {
    random: { itemId: 'city_order'; count: number };
    pointing: { itemId: 'city_order_adv'; count: number };
  };
}
