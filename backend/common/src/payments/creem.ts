// Creem 渠道适配器（AISLG-251，v108）：不用 SDK，只用 Node 内置 fetch。
// - 建结账：POST {CREEM_API_BASE}/v1/checkouts，头 x-api-key，体 { product_id, request_id, success_url,
//   metadata: { orderId } }；响应取 id（结账会话 id）与 checkout_url。10 秒超时（AbortSignal.timeout）。
// - 验签：请求头 creem-signature，值是 Webhook Secret 对**原始请求体**做 HMAC-SHA256 的十六进制串，
//   所以路由必须保留 raw body（见 api/src/pay-creem-webhook.ts）。Creem 没有固定来源 IP，不能用 IP 白名单。
// - 解析：{ id, eventType, created_at, object }；只认 checkout.completed / refund.created / dispute.created。
// 密钥、商品 id 一律只从环境变量读（项目开源），这里不写任何真实值。

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { TopupProduct } from '../ingot';
import type { CheckoutRequest, CheckoutSession, PaymentEvent, PaymentProvider } from './types';

/** 默认线上地址；测试模式用 https://test-api.creem.io（环境变量 CREEM_API_BASE 覆盖） */
export const CREEM_DEFAULT_API_BASE = 'https://api.creem.io';
/** 回调签名头（小写，Fastify 的 headers 键都是小写） */
export const CREEM_SIGNATURE_HEADER = 'creem-signature';
/** 建结账会话的超时（毫秒）：回调渠道时宁可报不可用，也不让玩家等到页面超时 */
export const CREEM_TIMEOUT_MS = 10_000;

export interface CreemConfig {
  apiKey: string;
  webhookSecret: string;
  apiBase: string;
  /** 我们的商品 id → Creem 后台建的商品 id（只放 env） */
  productIds: Record<string, string>;
}

/** 对原始请求体算 HMAC-SHA256 的十六进制串（Creem 的签名算法） */
export function creemSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** 验签：等长且逐字节相等才算通过（timingSafeEqual 防时序侧信道） */
export function verifyCreemSignature(
  rawBody: Buffer | string,
  secret: string,
  header: string | string[] | undefined,
): boolean {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string' || value.length === 0) {
    return false;
  }
  const expected = creemSignature(rawBody, secret);
  const given = Buffer.from(value.trim().toLowerCase(), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  return given.length === want.length && timingSafeEqual(given, want);
}

/** 金额字段可能是数字或字符串（分），统一成整数；非法返回 null */
export function readCents(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

/**
 * 退款 / 拒付事件里找订单用的字段。request_id / metadata 只在部分事件里有（Creem 拒付文档示例里
 * object.checkout 没有它们），所以另取渠道的结账会话 id（object.checkout.id）与订单 id
 * （object.order.id，没有再取 object.transaction.order）；订单表里存的是创建结账时的 checkout id 与入账时的 order id。
 */
function readCheckoutRefs(object: Record<string, unknown>): {
  requestId: string | null;
  metadataOrderId: string | null;
  amountPaidCents: number | null;
  providerCheckoutId: string | null;
  providerOrderId: string | null;
} {
  const checkout = asRecord(object.checkout);
  const metadata = asRecord(object.metadata) ?? (checkout ? asRecord(checkout.metadata) : null);
  const transaction = asRecord(object.transaction);
  const order = asRecord(object.order);
  return {
    requestId: readString(object.request_id) ?? (checkout ? readString(checkout.request_id) : null),
    metadataOrderId: metadata ? readString(metadata.orderId) : null,
    amountPaidCents: transaction ? readCents(transaction.amount_paid) : null,
    providerCheckoutId: checkout ? readString(checkout.id) : null,
    providerOrderId: (order ? readString(order.id) : null) ?? (transaction ? readString(transaction.order) : null),
  };
}

/**
 * 把 Creem 回调体解析成我们的事件（已验签之后调用）。结构不对返回 null（调用方按 400 处理）。
 * checkout.completed：object.request_id（我们的订单 id）、object.metadata.orderId、
 * object.order.amount_paid、object.product.id、object.order.id（渠道订单 id，入账时存下，拒付 / 退款靠它兜底找单）。
 */
export function parseCreemEvent(payload: unknown): PaymentEvent | null {
  const body = asRecord(payload);
  if (!body) {
    return null;
  }
  const eventId = readString(body.id);
  const eventType = readString(body.eventType);
  if (!eventId || !eventType) {
    return null;
  }
  const object = asRecord(body.object);
  if (!object) {
    return { kind: 'ignored', eventId, eventType };
  }
  if (eventType === 'checkout.completed') {
    const order = asRecord(object.order);
    const product = asRecord(object.product);
    const metadata = asRecord(object.metadata);
    return {
      kind: 'checkout_completed',
      eventId,
      requestId: readString(object.request_id),
      metadataOrderId: metadata ? readString(metadata.orderId) : null,
      providerProductId: product ? readString(product.id) : null,
      amountPaidCents: order ? readCents(order.amount_paid) : readCents(object.amount_paid),
      providerOrderId: order ? readString(order.id) ?? readString(order.order_id) : null,
    };
  }
  if (eventType === 'refund.created') {
    const refs = readCheckoutRefs(object);
    const refundCents = readCents(object.refund_amount) ?? readCents(object.amount);
    if (refundCents === null) {
      return null;
    }
    return {
      kind: 'refund',
      eventId,
      requestId: refs.requestId,
      metadataOrderId: refs.metadataOrderId,
      providerCheckoutId: refs.providerCheckoutId,
      providerOrderId: refs.providerOrderId,
      refundCents,
      amountPaidCents: refs.amountPaidCents,
    };
  }
  if (eventType === 'dispute.created') {
    const refs = readCheckoutRefs(object);
    return {
      kind: 'dispute',
      eventId,
      requestId: refs.requestId,
      metadataOrderId: refs.metadataOrderId,
      providerCheckoutId: refs.providerCheckoutId,
      providerOrderId: refs.providerOrderId,
      amountCents: readCents(object.amount) ?? 0,
      amountPaidCents: refs.amountPaidCents,
    };
  }
  return { kind: 'ignored', eventId, eventType };
}

export class CreemProvider implements PaymentProvider {
  readonly provider = 'creem';

  constructor(private readonly config: CreemConfig) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const response = await fetch(`${this.config.apiBase.replace(/\/+$/, '')}/v1/checkouts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': this.config.apiKey },
      body: JSON.stringify({
        product_id: request.providerProductId,
        request_id: request.orderId,
        success_url: request.successUrl,
        metadata: { orderId: request.orderId },
      }),
      signal: AbortSignal.timeout(CREEM_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Creem 创建结账会话失败：HTTP ${response.status}`);
    }
    const body = (await response.json()) as { id?: unknown; checkout_url?: unknown };
    const checkoutId = readString(body.id);
    const checkoutUrl = readString(body.checkout_url);
    if (!checkoutId || !checkoutUrl) {
      throw new Error('Creem 创建结账会话的响应缺少 id / checkout_url');
    }
    return { checkoutId, checkoutUrl };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentEvent | null {
    if (!verifyCreemSignature(rawBody, this.config.webhookSecret, headers[CREEM_SIGNATURE_HEADER])) {
      return null;
    }
    return parseCreemEvent(JSON.parse(rawBody.toString('utf8')));
  }

  matchesProduct(product: TopupProduct, providerProductId: string | null): boolean {
    const expected = this.config.productIds[product.id];
    return typeof expected === 'string' && expected.length > 0 && providerProductId === expected;
  }
}
