// 元宝（AISLG-251，v108）：付费货币的规则与配置。元宝只能充值（Creem 代收，美元计价）获得，
// 永久保留——换季不清零、玩家自己重置账号也不动，不能转让 / 赠送 / 交易；用途与礼金相同：
// 道具商店里买便利道具（迁城令等），不买战力、不买资源。礼金（AISLG-221）的规则一个字不改。
// 表结构见 ingot-schema.ts，存取见 ingot-db.ts，订单与入账见 topup-db.ts / topup-settle.ts。

/** 元宝不足（扣除失败、余额与其他数据都不变；响应附 balance） */
export const INSUFFICIENT_INGOT = 'INSUFFICIENT_INGOT' as const;
/** 充值商品不存在（只接受 TOPUP_PRODUCTS 里的 productId，前端传的只有它） */
export const TOPUP_PRODUCT_INVALID = 'TOPUP_PRODUCT_INVALID' as const;
/** 本月（UTC 自然月）成功充值已达上限，拒绝创建订单（附 limit / used） */
export const TOPUP_MONTHLY_LIMIT = 'TOPUP_MONTHLY_LIMIT' as const;
/** 最近 1 小时创建的订单已达上限，拒绝创建（附 limit / used） */
export const TOPUP_TOO_MANY_PENDING = 'TOPUP_TOO_MANY_PENDING' as const;
/** 充值渠道不可用（没配置商户密钥 / 商品 id，或调用渠道失败）：前端把充值按钮置灰 */
export const TOPUP_UNAVAILABLE = 'TOPUP_UNAVAILABLE' as const;

/** 充值商品（代码常量，不进数据库；金额只用「分」表示，避免浮点误差） */
export interface TopupProduct {
  id: string;
  /** 中文名（前端展示用） */
  name: string;
  /** 英文名（国际站用） */
  nameEn: string;
  /** 美元金额（分）：1.99 美元 = 199 */
  usdCents: number;
  /** 到账元宝数 */
  ingot: number;
}

/**
 * 唯一的充值档位（数值已拍板）：1.99 美元 = 1000 元宝，无赠送加成。
 * 加档位只在这里加一行；金额与到账数一律以本表为准，前端传的只有 productId。
 */
export const TOPUP_PRODUCTS: readonly TopupProduct[] = [
  { id: 'topup_199', name: '1000 元宝', nameEn: '1000 Ingots', usdCents: 199, ingot: 1000 },
];

/** 商品定义（未知 id 返回 null） */
export function topupProduct(value: unknown): TopupProduct | null {
  if (typeof value !== 'string') {
    return null;
  }
  return TOPUP_PRODUCTS.find((product) => product.id === value) ?? null;
}

/** 每账号每个自然月（UTC）最多成功充值 10 次（= 19.90 美元；封异常大额与拒付敞口） */
export const TOPUP_MONTHLY_MAX = 10;
/** 每账号滚动 1 小时内最多创建 5 个订单（防刷结账会话） */
export const TOPUP_HOURLY_MAX = 5;
/** 未支付订单 24 小时后自动作废（Worker 定时任务置 expired） */
export const TOPUP_ORDER_TTL_MS = 24 * 3600 * 1000;
/** 每小时订单数的统计窗口 */
export const TOPUP_HOURLY_WINDOW_MS = 3600 * 1000;

/** 订单状态：pending 待支付 / paid 已入账 / refunded 已退款或拒付（整单回收）/ expired 已作废 */
export type TopupOrderStatus = 'pending' | 'paid' | 'refunded' | 'expired';

/** 当前自然月（UTC）的起点：月限额按它统计「本月已入账的订单」 */
export function utcMonthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}
