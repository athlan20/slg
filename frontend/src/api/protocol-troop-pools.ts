// 全账号伤兵营（GET_TROOP_POOLS，op 147，v88，AISLG-218）的请求与响应类型。
// 「全部城池一键处理」的只读数据源：一次拿回账号全部城的伤兵 / 俘虏 / 逃兵三池，
// 处理仍逐城带 cityId 调 RESTORE_TROOPS / RELEASE_TROOPS（不新增批量协议）。
// 池子视图（TroopPoolView）与 CityView.wounded / captives / deserters 同一类型。

import type { TroopPoolView } from './protocol';

/** 全账号伤兵营里的一座城：三个池子结构与 CityView 的 wounded / captives / deserters 完全相同 */
export interface AccountTroopPoolsCityView {
  cityId: string;
  name: string;
  /** 是否账号主城（创建时间最早的城） */
  isMain: boolean;
  /** 断粮开始时刻（ISO 8601；未断粮为 null），与 CityView.starveAt 同口径 */
  starveAt: string | null;
  wounded: TroopPoolView;
  captives: TroopPoolView;
  deserters: TroopPoolView;
}

/** GET_TROOP_POOLS（op 147，v88）响应载荷：账号全部城的池子，主城在前、其余按创建时间 */
export interface GetTroopPoolsResponseData {
  cities: AccountTroopPoolsCityView[];
}
