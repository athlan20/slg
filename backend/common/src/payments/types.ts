// 支付渠道抽象（AISLG-251，v108）：以后加别家渠道只加一个适配器，不动订单与入账。
// 渠道只负责两件事——创建结账会话、验签并解析回调；账号归属、金额、元宝数、限额、幂等
// 全在 common/src/topup-db.ts / topup-settle.ts 里按服务端订单判定，绝不采信回调里的其他字段。

import type { TopupProduct } from '../ingot';

/** 创建结账会话的入参（orderId 是我们的订单 uuid，同时填进渠道的 request_id 与 metadata） */
export interface CheckoutRequest {
  orderId: string;
  product: TopupProduct;
  /** 渠道侧商品 id（只放环境变量，不进仓库） */
  providerProductId: string;
  /** 玩家付完款回游戏的地址 */
  successUrl: string;
}

/** 渠道返回的结账会话：checkoutId 存进 topup_orders.provider_checkout_id */
export interface CheckoutSession {
  checkoutId: string;
  checkoutUrl: string;
}

/** 已验签、已解析的回调事件。ignored = 我们不关心的类型（照旧回 200，避免渠道重试） */
export type PaymentEvent =
  | {
      kind: 'checkout_completed';
      eventId: string;
      /** 创建结账时填的我们的订单 id（request_id） */
      requestId: string | null;
      /** metadata.orderId 兜底 */
      metadataOrderId: string | null;
      providerProductId: string | null;
      /** 实付金额（分，含税会浮动，只用于退款按比例回收，不用来校验商品） */
      amountPaidCents: number | null;
      providerOrderId: string | null;
    }
  | {
      kind: 'refund';
      eventId: string;
      requestId: string | null;
      metadataOrderId: string | null;
      /** 渠道结账会话 id（object.checkout.id），request_id 缺失时用它找订单；缺省视为 null */
      providerCheckoutId?: string | null;
      /** 渠道订单 id（object.order.id / object.transaction.order），前两者都对不上时兜底；缺省视为 null */
      providerOrderId?: string | null;
      /** 本次退款金额（分），可能是部分退款 */
      refundCents: number;
      amountPaidCents: number | null;
    }
  | {
      kind: 'dispute';
      eventId: string;
      requestId: string | null;
      metadataOrderId: string | null;
      /** 同 refund 事件：拒付回调里没有 request_id / metadata 时靠它们找订单（缺省视为 null） */
      providerCheckoutId?: string | null;
      providerOrderId?: string | null;
      /** 拒付金额（分） */
      amountCents: number;
      amountPaidCents: number | null;
    }
  | { kind: 'ignored'; eventId: string | null; eventType: string };

export interface PaymentProvider {
  /** 订单行的 provider 列取值 */
  readonly provider: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  /** 验签 + 解析；签名不对返回 null（调用方回 400 且不处理） */
  verifyAndParseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): PaymentEvent | null;
  /** 回调里的渠道商品 id 是否就是这个商品（需求单要求用商品 id 校验，不用金额） */
  matchesProduct(product: TopupProduct, providerProductId: string | null): boolean;
}
