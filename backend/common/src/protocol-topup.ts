// 充值协议的类型（AISLG-251，v108）：CREATE_TOPUP（op 155，仅玩家连接）与充值成功后的元宝推送
// （复用 PUSH_ACCOUNT_STATE（op 2020），reason = ingot_changed，不新增推送号）。
// 商品与限额在 common/src/ingot.ts，订单与入账在 topup-db.ts / topup-settle.ts，
// 渠道适配器在 common/src/payments/，回调路由在 api/src/pay-creem-webhook.ts。

/** CREATE_TOPUP（op 155）请求：只接受服务端商品表里的 id（目前只有 topup_199） */
export interface CreateTopupRequestData {
  productId: string;
}

/** CREATE_TOPUP（op 155）响应：玩家用 checkoutUrl 在新窗口打开渠道结账页 */
export interface CreateTopupResponseData {
  /** 服务端订单 id（topup_orders.id；回调以此为准，客户端不需要回传） */
  orderId: string;
  /** 渠道结账页地址 */
  checkoutUrl: string;
  productId: string;
  /** 美元金额（分）——1.99 美元 = 199 */
  usdCents: number;
  /** 付款成功后到账的元宝数 */
  ingot: number;
}

/** 商品展示（GET_STATE / GET_ITEMS 暂不下发，前端按商品档位硬编码文案；这里留给后续扩展与文档） */
export interface TopupProductView {
  id: string;
  name: string;
  nameEn: string;
  usdCents: number;
  ingot: number;
}

/** PUSH_ACCOUNT_STATE（op 2020）的元宝推送载荷（reason = ingot_changed，发给该账号全部在线连接） */
export interface IngotStatePushData {
  reason: 'ingot_changed';
  ingot: number;
}
