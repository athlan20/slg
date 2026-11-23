// 野地掠夺每日递减与「仓库已满作废」的界面文案（v118，AISLG-270）。
// 数值（门槛 200 / 400、倍数 100 / 50 / 20）来自服务端 GET_STATE 的 plunderDaily 与
// 事件 / 战报的 lootPercent / wasted，界面不写死。英文孪生见 copy-plunder-daily-en.ts。

export const PLUNDER_DAILY_COPY = {
  /** 出征面板（野地掠夺页签）的一行摘要，如「今日野地掠夺 214 次，当前收益 50%」 */
  row: (count: number, percent: number) => `今日野地掠夺 ${count} 次，当前收益 ${percent}%`,
  /** 未拉到 GET_STATE 前不凭空造数 */
  loading: '——',
  /** 达到 50% 档后的提示 */
  halfHint: (fullLimit: number) => `今日已超过 ${fullLimit} 次，每次收益减半，明日 0 点恢复全额`,
  /** 达到 20% 档后的提示 */
  tailHint: (halfLimit: number) => `今日已超过 ${halfLimit} 次，每次只剩两成收益，再刷不划算`,
  /** 悬停说明 */
  explain: (fullLimit: number, halfLimit: number) =>
    `同一账号每天第 1~${fullLimit} 次野地掠夺全额，第 ${fullLimit + 1}~${halfLimit} 次减半，第 ${halfLimit + 1} 次起只剩两成；跨游戏日回到全额`,
  /** 战报头部：本次掠夺的收益倍数（只有野地掠夺会低于 100） */
  yieldBadge: (percent: number) => `掠夺收益 ${percent}%`,
  /** 战报：因仓库满作废的资源，如「仓库已满，作废 粮 1,200、木 300」 */
  wasted: (amounts: string) => `仓库已满，作废 ${amounts}`,
  /** 事件文本里的同一句（前置逗号，接在掠得资源之后） */
  wastedTail: (amounts: string) => `，仓库已满，作废${amounts}`,
  /** 野地掠夺收益打折的事件后缀，如「（按 50% 收益计算）」 */
  percentTail: (percent: number) => `，本次收益 ${percent}%`,
};