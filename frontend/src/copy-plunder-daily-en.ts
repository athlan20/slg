// copy-plunder-daily 的英文孪生（AISLG-270）：结构与函数签名以中文版为基准（satisfies），
// 漏译在 tsc 报错；标点一律半角。

import { PLUNDER_DAILY_COPY } from './copy-plunder-daily';

export const PLUNDER_DAILY_COPY_EN = {
  row: (count: number, percent: number) => `${count} wilderness raids today, current yield ${percent}%`,
  loading: '--',
  halfHint: (fullLimit: number) => `Past ${fullLimit} raids today, each raid now yields half; full yield returns at the next game day`,
  tailHint: (halfLimit: number) => `Past ${halfLimit} raids today, each raid yields only 20%; raiding further is not worth it`,
  explain: (fullLimit: number, halfLimit: number) =>
    `Per account each game day: raids 1-${fullLimit} yield full loot, ${fullLimit + 1}-${halfLimit} yield half, and from ${halfLimit + 1} on only 20%. Resets at the next game day.`,
  yieldBadge: (percent: number) => `Raid yield ${percent}%`,
  wasted: (amounts: string) => `Warehouse full, wasted ${amounts}`,
  wastedTail: (amounts: string) => `; warehouse full, wasted ${amounts}`,
  percentTail: (percent: number) => `, this raid yielded ${percent}%`,
} satisfies typeof PLUNDER_DAILY_COPY;