// 英文文案孪生（AISLG-137）：copy-starvation.ts 的英文版；satisfies 校验结构与函数签名一致。
// 断粮哗变文案（v34，AISLG-107；与 copy.ts 分文件以控制单文件行数）

import { STARVE_COPY } from './copy-starvation';

export const STARVE_COPY_EN = {
  hint: 'When food runs out and net production is negative, each troop type in the city garrison shrinks by 10% per hour (troops away are not recalled, but their upkeep ×2 still counts); resupply food or bring troops home to cut upkeep and the losses stop',
  starving: (left: string) => `Starved · mutiny in ${left}`,
  soon: (left: string) => `Food runs out in ${left}`,
  event: {
    warning: (city: string, starveAt: string) => `Food in ${city} will run out at ${starveAt}; after that the city garrison loses 10% per hour`,
    mutiny: (city: string, total: number, losses: string) => `Starvation mutiny in ${city}: city garrison lost ${total} (${losses})`,
  },
  offline: {
    mutinyRow: (total: number) => `Starvation mutiny losses: ${total}`,
  },
} satisfies typeof STARVE_COPY;
