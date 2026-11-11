// 充值协议的类型（v108，AISLG-251）：CREATE_TOPUP（op 155，仅玩家连接）；充值到账复用 PUSH_ACCOUNT_STATE（op 2020），
// reason = ingot_changed。与后端 backend/common/src/protocol-topup.ts 同构。商品 id 与展示金额见 topupProduct.ts。

/** CREATE_TOPUP 请求：只传商品 id（金额与元宝数都由服务端决定） */
export interface CreateTopupRequestData {
  productId: string;
}

/** CREATE_TOPUP 响应：玩家在新窗口打开 checkoutUrl 完成付款 */
export interface CreateTopupResponseData {
  orderId: string;
  checkoutUrl: string;
  productId: string;
  usdCents: number;
  ingot: number;
}

/** PUSH_ACCOUNT_STATE（reason = ingot_changed）载荷：ingot 为新的元宝余额 */
export interface IngotStatePushData {
  reason: 'ingot_changed';
  ingot: number;
}
