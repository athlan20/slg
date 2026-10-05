// 城池类操作协议的类型镜像（v22 起）：集市兑换（EXCHANGE）。唯一事实来源是
// backend/common/src/protocol-city.ts 与 handlers；protocol.ts 原名再导出，既有 import 路径不变。
// （类型导入在编译期擦除，不构成与 protocol.ts 的运行时加载环）

import type { CityView } from './protocol';

/** EXCHANGE（op 37）请求载荷（v22 AISLG-42）：四选一基础资源 + 数量（正整数） */
export interface ExchangeRequestData {
  resource: 'food' | 'wood' | 'stone' | 'iron';
  amount: number;
}

/** EXCHANGE 响应载荷：成交明细（gold 为到手金币、rate 为服务端口径汇率）与兑换后的城池状态 */
export interface ExchangeResponseData {
  exchange: { resource: string; amount: number; gold: number; rate: number };
  city: CityView;
}
