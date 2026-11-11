// 登录页页脚文案（AISLG-252）：隐私政策 / 服务条款 / 定价 / 客服邮箱四个入口。
// 英文孪生见 copy-legal-en.ts，逐成员 satisfies 对应中文对象的类型。
// 法务页面本身是静态 HTML（src/legal/），文案不走这里；这里只管登录页上能看到的入口。

export const LEGAL_COPY = {
  /** 页脚导航的无障碍标签 */
  footerLabel: '隐私与条款',
  privacy: '隐私政策',
  terms: '服务条款',
  pricing: '定价',
  /** 客服邮箱链接文字前缀（邮箱地址本身来自 PUBLIC_SUPPORT_EMAIL，不写在仓库里） */
  support: '客服邮箱',
  /** 登录页底部的价格一行：与 AISLG-251、/pricing.html 保持一致 */
  priceNote: '1.99 美元 = 1000 元宝，一次性付款，无订阅。游戏免费，元宝只买便利道具。',
};
