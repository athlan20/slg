// 断粮哗变文案（v34，AISLG-107；与 copy.ts 分文件以控制单文件行数）

export const STARVE_COPY = {
  hint: '粮食耗尽且净产量为负时，每小时城内驻军每个兵种减少 10%（在外部队不召回，但耗粮 ×2 照常计入）；补粮或让部队回城减耗即可停止',
  starving: (left: string) => `已断粮 · ${left} 后哗变`,
  soon: (left: string) => `${left} 后断粮`,
  event: {
    warning: (city: string, starveAt: string) => `${city} 粮食将在 ${starveAt} 耗尽，耗尽后城内驻军每小时减员 10%`,
    mutiny: (city: string, total: number, losses: string) => `${city} 断粮哗变：城内驻军减员 ${total}（${losses}）`,
  },
  offline: {
    mutinyRow: (total: number) => `断粮哗变损兵 ${total}`,
  },
};
