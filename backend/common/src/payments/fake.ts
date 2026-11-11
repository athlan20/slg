// 假支付渠道（AISLG-251，v108，**只给测试用**）：PAYMENT_PROVIDER=fake 时才被选中（见 ./index.ts）。
// 验签算法与 Creem 完全一致（头 creem-signature、值是对原始请求体做 HMAC-SHA256 的十六进制串），
// 所以 test/pay/ 的联调测试与 backend/test 的单测都能用真实路由、真实解析、真实入账，
// 只有「建结账会话」这一步不发网络请求：直接返回一个假的 checkout_url。
// 生产不配 PAYMENT_PROVIDER=fake 就走 Creem，这条路不会打开。

import type { TopupProduct } from '../ingot';
import { CREEM_SIGNATURE_HEADER, parseCreemEvent, verifyCreemSignature } from './creem';
import type { CheckoutRequest, CheckoutSession, PaymentEvent, PaymentProvider } from './types';

export const FAKE_CHECKOUT_BASE = 'https://fake.creem.local/checkout';

export class FakeProvider implements PaymentProvider {
  readonly provider = 'fake';

  constructor(
    private readonly webhookSecret: string,
    private readonly checkoutBase: string = FAKE_CHECKOUT_BASE,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    return {
      checkoutId: `fake_checkout_${request.orderId}`,
      checkoutUrl: `${this.checkoutBase.replace(/\/+$/, '')}/${request.orderId}`,
    };
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): PaymentEvent | null {
    if (!verifyCreemSignature(rawBody, this.webhookSecret, headers[CREEM_SIGNATURE_HEADER])) {
      return null;
    }
    return parseCreemEvent(JSON.parse(rawBody.toString('utf8')));
  }

  /** 假渠道直接拿我们的商品 id 当渠道商品 id（联调测试里回调就用 product.id） */
  matchesProduct(product: TopupProduct, providerProductId: string | null): boolean {
    return providerProductId === product.id;
  }
}
