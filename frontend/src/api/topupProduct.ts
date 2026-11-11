// 充值商品的前端常量（v108，AISLG-251）：只有一个档位 1.99 美元 = 1000 元宝，一次性付款。
// 商品 id 必须与服务端商品表一致（backend/common/src/ingot.ts 的 TOPUP_PRODUCTS）；金额展示以这里为准，
// 元宝到账数量以服务端 CREATE_TOPUP 响应的 ingot 为准。

export const TOPUP_PRODUCT_ID = 'topup_199';
export const TOPUP_INGOT = 1000;
