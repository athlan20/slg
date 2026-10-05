// 城池类协议的可选 cityId 请求字段（v24，AISLG-58）：多城后同一账号有主城与分城，
// 建造 / 升级 / 改名 / 征兵 / 兑换 / 出征 / 侦察 / 查询状态都可指定操作哪座城。
// 字段说明集中在此，由 OP_DOC 聚合时统一附加，避免在各协议文档里重复手写。

import type { FieldDoc, OpDoc } from './protocol-doc';

export const CITY_ID_FIELD: FieldDoc = {
  name: 'cityId',
  type: 'string',
  desc: '可选（v24，AISLG-58）。要操作的城池 id（GET_STATE 响应的 cities[].id）；缺省 = 主城（账号创建最早的城），旧客户端不受影响。非本账号名下的城或格式不对返回 INVALID_PARAMS。每座城的资源 / 人口 / 仓储 / 建造与征兵队列 / 驻军各自独立；出征、侦察从该城出发、扣减该城驻军。取消类协议（CANCEL_BUILD / CANCEL_RECRUIT）按条目所属城池定位，无需传 cityId。',
};

/** 为请求协议文档附加可选 cityId 字段（返回新对象，不改动原清单） */
export function withCityId<T extends OpDoc>(doc: T): T {
  if (doc.kind !== 'request') {
    return doc;
  }
  return { ...doc, requestFields: [...doc.requestFields, CITY_ID_FIELD] };
}
