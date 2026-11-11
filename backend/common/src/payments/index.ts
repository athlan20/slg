// 支付渠道的选择与配置（AISLG-251，v108）。所有密钥与商品 id 都只从环境变量读（项目开源，不进仓库）：
// - CREEM_API_KEY：Creem API Key（测试模式用独立的测试 Key）
// - CREEM_WEBHOOK_SECRET：回调验签用的 Webhook Secret
// - CREEM_PRODUCT_TOPUP_1000：Creem 后台建的 1.99 美元商品 id
// - CREEM_API_BASE：缺省 https://api.creem.io；测试模式 https://test-api.creem.io
// - PUBLIC_SITE_URL：拼 success_url 用（玩家付完款回游戏的站点），缺省用请求的 Origin 头
// - PAYMENT_PROVIDER：缺省 creem；只有显式写 fake 才用假渠道（测试用，见 ./fake.ts）
// 任一必需项缺失 → 返回 null，CREATE_TOPUP 回 TOPUP_UNAVAILABLE、回调路由回 503，其余功能不受影响。

import { TOPUP_PRODUCTS } from '../ingot';
import { CREEM_DEFAULT_API_BASE, CreemProvider } from './creem';
import { FakeProvider } from './fake';
import type { PaymentProvider } from './types';

export type PaymentProviderKind = 'creem' | 'fake';

export interface PaymentConfig {
  kind: PaymentProviderKind;
  apiKey: string;
  webhookSecret: string;
  apiBase: string;
  /** 我们的商品 id → 渠道商品 id */
  productIds: Record<string, string>;
  /** 拼 success_url 的站点（不带末尾斜杠）；null = 用请求的 Origin 头 */
  publicSiteUrl: string | null;
}

type Env = Record<string, string | undefined>;

function readEnv(env: Env, key: string): string | null {
  const value = env[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * 读支付配置；必需项不全或渠道未知返回 null（= 充值整体不可用）。
 * fake 渠道只需要 CREEM_WEBHOOK_SECRET（商品 id 直接用我们自己的），仍然要显式配置才生效。
 */
export function readPaymentConfig(env: Env = process.env): PaymentConfig | null {
  const raw = (readEnv(env, 'PAYMENT_PROVIDER') ?? 'creem').toLowerCase();
  if (raw !== 'creem' && raw !== 'fake') {
    return null;
  }
  const webhookSecret = readEnv(env, 'CREEM_WEBHOOK_SECRET');
  if (!webhookSecret) {
    return null;
  }
  const productIds: Record<string, string> = {};
  if (raw === 'fake') {
    for (const product of TOPUP_PRODUCTS) {
      productIds[product.id] = product.id;
    }
    return {
      kind: 'fake',
      apiKey: 'fake-api-key',
      webhookSecret,
      apiBase: CREEM_DEFAULT_API_BASE,
      productIds,
      publicSiteUrl: readEnv(env, 'PUBLIC_SITE_URL'),
    };
  }
  const apiKey = readEnv(env, 'CREEM_API_KEY');
  const productTopup1000 = readEnv(env, 'CREEM_PRODUCT_TOPUP_1000');
  if (!apiKey || !productTopup1000) {
    return null;
  }
  productIds.topup_199 = productTopup1000;
  return {
    kind: 'creem',
    apiKey,
    webhookSecret,
    apiBase: readEnv(env, 'CREEM_API_BASE') ?? CREEM_DEFAULT_API_BASE,
    productIds,
    publicSiteUrl: readEnv(env, 'PUBLIC_SITE_URL'),
  };
}

/** 按配置造渠道适配器 */
export function createPaymentProvider(config: PaymentConfig): PaymentProvider {
  if (config.kind === 'fake') {
    return new FakeProvider(config.webhookSecret);
  }
  return new CreemProvider({
    apiKey: config.apiKey,
    webhookSecret: config.webhookSecret,
    apiBase: config.apiBase,
    productIds: config.productIds,
  });
}

/**
 * success_url：PUBLIC_SITE_URL 优先，其次请求的 Origin 头（前端与 API 同站时够用），都没有就用空串。
 * 前端会接管 ?topup=return（本次后端只负责拼地址）。
 */
export function topupSuccessUrl(config: PaymentConfig | null, originHeader: string | null): string {
  const site = (config?.publicSiteUrl ?? originHeader ?? '').replace(/\/+$/, '');
  return `${site}/?topup=return`;
}

/** API 进程持有的支付服务（没配置为 null） */
export interface PaymentService {
  provider: PaymentProvider;
  /** 我们的商品 id → 渠道商品 id（创建结账会话时用） */
  productIds: Record<string, string>;
  /** 拼 success_url 的站点（PUBLIC_SITE_URL）；null = 用请求的 Origin 头 */
  publicSiteUrl: string | null;
}

/** 读环境变量造支付服务；没配齐返回 null（CREATE_TOPUP 回 TOPUP_UNAVAILABLE，回调路由回 503） */
export function createPaymentService(env: Env = process.env): PaymentService | null {
  const config = readPaymentConfig(env);
  if (!config) {
    return null;
  }
  return {
    provider: createPaymentProvider(config),
    productIds: config.productIds,
    publicSiteUrl: config.publicSiteUrl,
  };
}
