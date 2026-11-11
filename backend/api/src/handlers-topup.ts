// 充值（AISLG-251，v108）：CREATE_TOPUP（op 155）。仅玩家连接可调用——付款必须真人在浏览器里完成，
// Agent 令牌会话返回 AGENT_FORBIDDEN（与 RESET_ACCOUNT / SET_NICKNAME 同一判定方式：conn.role 是连接
// 自报标记，拦诚实声明的 Agent，不是可独立验证的安全边界），这个 op 也不进 agent-api 文档与 MCP 清单。
// 流程：校验商品（只认服务端商品表）→ 渠道可用 → 一个事务里：作废旧 pending + 月限额 + 每小时订单数 +
// 落 pending 订单 → 事务外调渠道创建结账会话（失败把订单置 expired，不留 pending）→ 返回 { orderId, checkoutUrl }。
// 金额、元宝数、商品全部来自服务端配置，前端传的只有 productId；账号归属一律以订单行为准。

import { topupProduct, TOPUP_PRODUCT_INVALID, TOPUP_UNAVAILABLE } from '../../common/src/ingot';
import { createPendingTopupOrder, expireTopupOrder, setTopupCheckoutId } from '../../common/src/topup-db';
import type { CreateTopupResponseData } from '../../common/src/protocol';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** success_url：PUBLIC_SITE_URL 优先，其次连接的 Origin 头，都没有就空串（前端接管 ?topup=return） */
function successUrlFor(ctx: HandlerContext, conn: ConnInfo): string {
  const site = (ctx.payments?.publicSiteUrl ?? conn.origin ?? '').replace(/\/+$/, '');
  return `${site}/?topup=return`;
}

/** CREATE_TOPUP（op 155）：发起一次充值，返回渠道结账页地址 */
export async function handleCreateTopup(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  // 仅限玩家连接：Agent 不能发起充值（钱只能由真人在浏览器里付）
  if (conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const payments = ctx.payments;
  if (!payments) {
    respondError(ctx.registry, conn, op, seq, TOPUP_UNAVAILABLE);
    return;
  }
  const product = topupProduct(data?.productId);
  if (!product) {
    respondError(ctx.registry, conn, op, seq, TOPUP_PRODUCT_INVALID);
    return;
  }
  const providerProductId = payments.productIds[product.id];
  if (!providerProductId) {
    respondError(ctx.registry, conn, op, seq, TOPUP_UNAVAILABLE);
    return;
  }

  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  let orderId: string;
  try {
    await client.query('BEGIN');
    const created = await createPendingTopupOrder(client, { accountId, product, provider: payments.provider.provider });
    if (!created.ok) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, created.code, { limit: created.limit, used: created.used });
      return;
    }
    await client.query('COMMIT');
    orderId = created.orderId;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // 渠道调用放在事务外：不能拿着数据库事务等网络
  let checkoutUrl: string;
  let checkoutId: string;
  try {
    const session = await payments.provider.createCheckout({
      orderId,
      product,
      providerProductId,
      successUrl: successUrlFor(ctx, conn),
    });
    checkoutUrl = session.checkoutUrl;
    checkoutId = session.checkoutId;
  } catch (err) {
    console.error('create topup checkout failed:', err instanceof Error ? err.message : err);
    // 失败不留 pending（否则账号会被「同时最多 1 个未支付订单」卡住）
    await expireTopupOrder(ctx.pool, orderId).catch(() => undefined);
    respondError(ctx.registry, conn, op, seq, TOPUP_UNAVAILABLE);
    return;
  }
  await setTopupCheckoutId(ctx.pool, orderId, checkoutId);
  const payload: CreateTopupResponseData = {
    orderId,
    checkoutUrl,
    productId: product.id,
    usdCents: product.usdCents,
    ingot: product.ingot,
  };
  respondOk(ctx.registry, conn, op, seq, payload as unknown as Record<string, unknown>);
}
