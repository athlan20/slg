// 战斗所得按城池储量上限作废（v118，AISLG-270，「战斗所得超出储量上限作废」）。
// 所有战斗得来的资源入账都走这里：野地 / NPC 城掠夺、截击、玩家城掠夺、黄巾营地 /
// 老巢掉落、旧版 attack 行军结算。非战斗来源（运输与撤回带回、交易所交割、活动排名
// 奖励、势力老巢击破奖励、遗迹、兑换码、充值、礼金）仍用原来的不钳上限的入账。
// 本文件只放纯计算（便于单测）；数据库侧的读数 / 落库在 worker/src/battle-loot.ts。
//
// 算法：入账城每种资源最多补到该城的储量上限（storageCaps，含储存科技与时间缩放；
// 金币上限照旧 100 万 × 缩放），超出部分作废。已经超上限的存量不扣减，只是这次的
// 战斗所得一点也进不去。

import type { Resources } from './protocol';

/** 一次战斗所得的入账结果：credited 实际进城的量，wasted 因储量上限作废的量 */
export interface LootCreditSplit {
  credited: Resources;
  wasted: Resources;
}

/** 全 0 的资源形态（金币 + 四资源） */
export function emptyResources(): Resources {
  return { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
}

/** 资源键固定顺序：金 → 粮 → 木 → 石 → 铁（与掠夺装填顺序一致，便于对账） */
export const RESOURCE_KEYS = ['gold', 'food', 'wood', 'stone', 'iron'] as const;

/** 五种资源合计（事件 / 战报判断「有没有作废」用） */
export function resourcesTotal(resources: Partial<Resources>): number {
  return RESOURCE_KEYS.reduce((sum, key) => sum + Math.max(0, Math.floor(resources[key] ?? 0)), 0);
}

/**
 * 按储量上限切分战斗所得（纯函数，不修改入参）：
 * 每种资源 = min(所得, max(0, 上限 − 当前存量))，向下取整；差额进 wasted。
 * 当前存量已达 / 超过上限 → 该资源全部作废且不扣存量；所得为 0 → 不进也不作废。
 */
export function capLootByStorage(
  current: Resources,
  caps: Resources,
  loot: Resources,
): LootCreditSplit {
  const credited = emptyResources();
  const wasted = emptyResources();
  for (const key of RESOURCE_KEYS) {
    const gain = Math.max(0, Math.floor(loot[key] ?? 0));
    const room = Math.max(0, Math.floor(caps[key] ?? 0) - Math.floor(current[key] ?? 0));
    const take = Math.min(gain, room);
    credited[key] = take;
    wasted[key] = gain - take;
  }
  return { credited, wasted };
}