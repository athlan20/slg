// 集市兑换的参考汇率（从 rules.ts 拆出为叶子模块）：4 资源 = 1 金币。
// rules.ts 与 market.ts 都引用它；放在叶子模块避免 protocol → market → rules → protocol 的循环依赖。

export const EXCHANGE_INPUT_PER_GOLD = 4;

/** 兑换所得金币 = floor(amount ÷ 汇率)；不足 1 金返回 0（协议层按 INVALID_PARAMS 拒绝） */
export function exchangeGoldFor(amount: number): number {
  return Math.floor(Math.max(0, amount) / EXCHANGE_INPUT_PER_GOLD);
}
