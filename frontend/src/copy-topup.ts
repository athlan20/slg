// 充值文案（AISLG-251，v108）：道具商店里的「充值」入口、商品卡、到账与回跳提示、错误提示。英文孪生见 copy-topup-en.ts。
// 金额与元宝数来自 api/topupProduct.ts 的常量（1.99 美元 = 1000 元宝）；到账数量以服务端为准。

export const TOPUP_COPY = {
  entry: '充值',
  entryUnavailable: '充值暂不可用',
  /** 余额条：元宝（永久保留） */
  balanceIngot: (balance: number) => `元宝 ${balance}（永久）`,
  backToShop: '返回商店',
  productName: (ingot: number) => `${ingot} 元宝`,
  productPrice: 'US$1.99',
  productNote: '一次性付款，不是订阅',
  buy: '购买',
  buying: '正在创建订单…',
  /** 购买时先开的空白窗口里显示的一行字（结账地址到达后再跳转） */
  redirecting: '正在跳转到付款页面…',
  /** 浏览器拦截了新窗口：购买前就提示，并改为面板内手动打开链接 */
  popupBlocked: '浏览器拦截了新窗口，请允许本站弹出窗口后重试',
  manualLink: '点此打开付款页面',
  unavailableBadge: '充值暂不可用：支付渠道还没配置好或暂时连不上，请稍后再试',
  opened: '请在新打开的页面完成付款，付完回到这里，余额会自动更新',
  /** 到账提示（PUSH_ACCOUNT_STATE ingot_changed，新余额 > 旧余额时） */
  arrived: (amount: number) => `元宝到账 +${amount}`,
  /** 从付款页跳回（?topup=return）后的提示 */
  returnPending: '付款处理中，元宝到账后会自动更新',
  note: '元宝只能在游戏内买便利道具，不可转让、不可提现。',
  noteLinks: { prefix: '详见', terms: '服务条款', pricing: '定价说明', joiner: '、', end: '。' },
  errors: {
    TOPUP_MONTHLY_LIMIT: '本月充值次数已达上限，下个月再来',
    TOPUP_TOO_MANY_PENDING: '订单太多了，请稍后再试',
    TOPUP_UNAVAILABLE: '充值暂不可用，请稍后再试',
    TOPUP_PRODUCT_INVALID: '充值商品无效，请刷新页面后再试',
    AGENT_FORBIDDEN: '充值只能由玩家本人发起',
    fallback: '充值失败，请稍后再试',
  },
};
