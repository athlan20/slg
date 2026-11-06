// 野地设施（望楼）的协议载荷（v96，AISLG-232）：FACILITY_BUILD 的请求与响应。
// 视图类型在 protocol-world.ts（TileView.facility / TerritoryView.facility / TileDetailView.facilityBuilding），
// 数值与纯规则在 facility.ts。玩家与 Agent 走同一个接口，对外 Agent 文档收录。

import type { CityView } from './protocol-city';
import type { TerritoryFacilityView } from './protocol-world';

/** FACILITY_BUILD（op 152）请求载荷：目标为一块**自己已占领的野地** */
export interface FacilityBuildRequestData {
  x: number;
  y: number;
}

export interface FacilityBuildResponseData {
  /** 该地块的设施（含等级、视野半径与进行中的建造；与 GET_STATE 的 city.territory[].facility 同结构） */
  facility: TerritoryFacilityView;
  /** 扣费后的城池状态（资源从占着这块地的那座城扣） */
  city: CityView;
}
