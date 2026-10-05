// 连升整链的本地预估（v22 UPGRADE toLevel 的前端入口，AISLG-68）：建筑详情弹窗在
// 发起前展示整链成本与时长用。服务端 UPGRADE 响应里的 chain 才是权威计划；此处按
// 镜像的线性公式从 city.costs 的「下一级成本」锚点推导：
// - 升级成本 = 建造成本 × 升级倍数（rules.ts upgradeCost / upgradeLevelFactor：1~9 级倍数 = 等级，
//   10 级以后 = 9 × 1.3^(L−9)，v31 AISLG-85），锚点 nextCost = 基准 × 倍数(L)，
//   每级成本由锚点按 倍数(l) / 倍数(L) 还原（成本逐项四舍五入，与服务端取整口径一致）；
// - 升级时长 = max(1, floor(基准秒 60 × 升级倍数 ÷ timeScale))（rules.ts upgradeSeconds）。
// 数值评审若调整这两条公式，需同步本文件。

import type { Resources } from './protocol';

/** 建造时长基准秒数：镜像 backend/common/src/rules.ts 的 DEFAULT_BUILD_SECONDS。
 *  验证环境用 BUILD_SECONDS 环境变量覆盖时预估会有偏差——权威时长以服务端 chain 为准。 */
const BUILD_SECONDS_BASIS = 60;

/** 升级倍数：镜像 backend/common/src/rules.ts 的 upgradeLevelFactor（1~9 级线性，10 级以后每级 ×1.3） */
export function upgradeLevelFactor(currentLevel: number): number {
  const level = Math.max(1, Math.floor(currentLevel));
  return level <= 9 ? level : 9 * 1.3 ** (level - 9);
}

export interface ChainPreview {
  /** 连升级数（目标 − 当前，≥ 2） */
  levels: number;
  /** 整链总成本（各级成本之和） */
  totalCost: Resources;
  /** 整链总时长（秒，各级单级时长之和；排队时段长由 Worker 按同公式重算） */
  totalSeconds: number;
}

/** 从「当前等级 → 目标等级」的整链预估；currentLevel ≥ 1、toLevel ≥ 当前 + 2 */
export function upgradeChainPreview(opts: {
  currentLevel: number;
  toLevel: number;
  /** city.costs[kind].upgrade（当前级的下一级成本，服务端下发） */
  nextCost: Resources;
  /** 城池当前的全局时间缩放（city.timeScale） */
  timeScale: number;
}): ChainPreview {
  const { currentLevel: from, toLevel, nextCost, timeScale } = opts;
  const totalCost: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  let totalSeconds = 0;
  for (let level = from; level <= toLevel - 1; level += 1) {
    // 锚点比例还原该级成本：nextCost = 基准 × 倍数(from)，本级成本 = 基准 × 倍数(level)
    const ratio = upgradeLevelFactor(level) / upgradeLevelFactor(from);
    for (const key of Object.keys(totalCost) as Array<keyof Resources>) {
      totalCost[key] += Math.round(nextCost[key] * ratio);
    }
    totalSeconds += Math.max(1, Math.floor((BUILD_SECONDS_BASIS * upgradeLevelFactor(level)) / Math.max(1, timeScale)));
  }
  return { levels: toLevel - from, totalCost, totalSeconds };
}
