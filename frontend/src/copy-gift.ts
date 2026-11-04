// 礼金文案（AISLG-221，v89）：账号菜单的礼金行、礼金扣除的事件流文字。英文孪生见 copy-gift-en.ts。
// 礼金只用于便利功能，每个赛季发 1000，换季清零，不能转让或兑换。

export const GIFT_COPY = {
  label: '礼金',
  loading: '—',
  /** 余额 / 本季额度，如「800 / 1000」 */
  value: (balance: number, grant: number) => `${balance} / ${grant}`,
  /** 说明（点开行或悬停时显示） */
  explain: (grant: number) => `每个赛季发 ${grant.toLocaleString('en-US')}，换季清零，只用于便利功能`,
  event: {
    spent: (reason: string, amount: number, balance: number) => `消耗礼金 ${amount}（${reason}），余 ${balance}`,
  },
};
