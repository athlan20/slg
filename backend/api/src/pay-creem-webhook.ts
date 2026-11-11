// Creem 支付回调路由（AISLG-251，v108）：POST /pay/creem/webhook。与 github-callback.ts 同类，
// 注册在 API 进程；本路由必须不被 CDN 缓存（响应带 no-store，CDN 侧也要设为不缓存）。
// 职责边界：这里只做「验签 → 事件去重 → 交给 common 的结算 → 回 200」，业务规则全在
// common/src/topup-settle.ts（就地写规则会让路由和单测各写一套）。
// - 验签用**原始请求体**（creem-signature = HMAC-SHA256(raw body) 的十六进制串），所以在独立的封装
//   上下文里注册 parseAs: 'buffer' 的 JSON 解析器，只影响本路由，不碰其他路由；
// - 签名不对 / 缺签名一律 400，不处理；Creem 没有固定来源 IP，不能用 IP 白名单代替验签；
// - 先把事件的 id 写进 payment_webhook_events（联合唯一）去重，重复到达直接 200；
//   后台手动重发换了新事件 id，靠订单状态（已 paid / refunded 就忽略）兜住；
// - 15 秒内必须回 2xx（Creem 重试 5 次：立即 / 30 秒 / 5 分钟 / 30 分钟 / 6 小时），所以处理要快；
// - 没配置渠道（CREEM_WEBHOOK_SECRET 等）时回 503。
// 注意：若前面有 WAF / 机器人防护，要给这个路由加豁免（Creem 的回调不带浏览器特征）。

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { handlePaymentEvent } from '../../common/src/topup-settle';
import { Op } from '../../common/src/protocol';
import type { PaymentEvent } from '../../common/src/payments/types';
import type { HandlerContext } from './handlers';

/** 回调体上限（字节）：正常事件只有几 KB，给足余量又不让超大包占内存 */
const WEBHOOK_BODY_LIMIT = 64 * 1024;

/** 处理一个已验签的事件：事务内「事件去重 + 结算」→ 需要时推进余额变化。返回给渠道的响应体（一律 200） */
async function handleEvent(ctx: HandlerContext, event: PaymentEvent): Promise<Record<string, unknown>> {
  const provider = ctx.payments?.provider;
  if (!provider) {
    return { ok: false, reason: 'unavailable' };
  }
  const { duplicate, outcome } = await handlePaymentEvent(ctx.pool, event, provider);
  if (duplicate) {
    return { ok: true, duplicate: true };
  }
  if (outcome.status === 'credited' || outcome.status === 'refunded') {
    // 入账 / 回收成功后给在线的玩家推一次余额变化（复用 PUSH_ACCOUNT_STATE，不新增推送号）
    ctx.registry.broadcast(outcome.accountId, {
      op: Op.PUSH_ACCOUNT_STATE,
      push: true,
      data: { reason: 'ingot_changed', ingot: outcome.balance },
    });
    return { ok: true, status: outcome.status, orderId: outcome.orderId };
  }
  return { ok: true, ignored: outcome.reason, orderId: outcome.orderId };
}

export function registerPayWebhookRoute(app: FastifyInstance, options: { ctx: HandlerContext }): void {
  const ctx = options.ctx;
  // 独立封装上下文：这里的 content-type 解析只作用于本路由（原始字节留给验签）
  void app.register(async (instance) => {
    instance.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer', bodyLimit: WEBHOOK_BODY_LIMIT },
      (_request: FastifyRequest, body: Buffer, done: (err: Error | null, value?: unknown) => void) => {
        done(null, body);
      },
    );
    instance.post('/pay/creem/webhook', async (request, reply) => {
      reply.header('cache-control', 'no-store');
      const payments = ctx.payments;
      if (!payments) {
        reply.code(503);
        return { ok: false, error: 'TOPUP_UNAVAILABLE' };
      }
      const rawBody = Buffer.isBuffer(request.body) ? request.body : Buffer.from(String(request.body ?? ''), 'utf8');
      let event: PaymentEvent | null = null;
      try {
        event = payments.provider.verifyAndParseWebhook(rawBody, request.headers as Record<string, string | string[] | undefined>);
      } catch (err) {
        console.warn('pay webhook: invalid body', err instanceof Error ? err.message : err);
        reply.code(400);
        return { ok: false, error: 'INVALID_BODY' };
      }
      if (!event) {
        reply.code(400);
        return { ok: false, error: 'INVALID_SIGNATURE' };
      }
      try {
        return await handleEvent(ctx, event);
      } catch (err) {
        // 处理失败回 500：让渠道按自己的重试节奏再发一次（事件已在去重表里则下次直接 200）
        console.error('pay webhook: settle failed', err instanceof Error ? err.message : err);
        reply.code(500);
        return { ok: false, error: 'INTERNAL' };
      }
    });
  });
}
