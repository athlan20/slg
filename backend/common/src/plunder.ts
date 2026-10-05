// 掠夺、负重与仓库保护的共用规则（v16，AISLG-4「仓库防掠夺保护与掠夺结算设计」；
// v21 AISLG-31 掠夺含金、AISLG-32 方案 A 掠城消费方接入）。
// API（MARCH 发起校验：任务合法性 / 冷却 / 占领上限）与 Worker（到达结算：战斗 →
// 负重装填 → 库存扣减 → 冷却落库）共用本文件，两侧不得各自再实现一套数值。
// 全部数值均为占位决策（未经数值评审）：仓库保护量、冷却时长、装填顺序与官府
// 野地上限的调整入口只在本文件；单兵负重在 troops.ts 的 TROOP_INFO.carry。
// 评审曲线与占位值清单见 docs/battle-calibration.md 的 v16 掠夺校准一节
// （backend/scripts/plunder-calibration.ts，npm run calibrate:plunder）。
// 玩家城池掠夺的消费方（v21，AISLG-32 方案 A）：NPC 袭击主城获胜后按被掠城
// 仓库等级调用 cityPlunderPool 计算可掠量；玩家互掠仍随玩家对抗阶段接入。

import type { Resources } from './protocol';
import { scaledMs } from './time-scale';

/** 可被掠夺的资源与装填顺序（v21，AISLG-31「掠夺含金」：金币进入掠夺——
 *  野地池金 250×等级、NPC 城持久化库存与玩家城（NPC 掠城）按存量；
 *  顺序 = 金 → 粮 → 木 → 石 → 铁，先稀缺后充裕） */
export const PLUNDERABLE_KEYS = ['gold', 'food', 'wood', 'stone', 'iron'] as const;

export type PlunderableKey = (typeof PLUNDERABLE_KEYS)[number];

/** 仓库防掠夺保护总量 = 4000 × 等级（v16 决策，占位数值） */
export const WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL = 4000;

/** 四资源固定均分系数（v16 决策：先固定均分，后续再开放按资源分配比例） */
export const WAREHOUSE_PROTECTION_SPLIT = 4;

/**
 * 单资源保护额 = 4000 × 仓库等级 ÷ 4 = 1000 × 仓库等级（粮 / 木 / 石 / 铁各自
 * 独立享有该额度）。不改变储量上限（rules.ts 既定边界）。
 * 消费方（v21，AISLG-32 方案 A）：NPC 袭击玩家主城获胜后按本额结算可掠量。
 */
export function warehouseProtectionPerResource(warehouseLevel: number): number {
  return Math.max(0, Math.floor(warehouseLevel)) * (WAREHOUSE_PROTECTION_TOTAL_PER_LEVEL / WAREHOUSE_PROTECTION_SPLIT);
}

/** 可掠量 = max(0, 存量 − 保护额)；对单资源取值（金币不适用本函数） */
export function plunderableAmount(stock: number, protection: number): number {
  return Math.max(0, Math.floor(stock) - Math.max(0, protection));
}

/**
 * 仓库保护扣除后的可抢池（纯函数）：粮/木/石/铁按仓库等级保护
 * （warehouseProtectionPerResource）扣减；金币**原样透传**，口径由调用方决定
 * （NPC 袭城 × 5%、玩家互掠 × 10%——见 cityPlunderPool / pvpPlunderPool）。
 */
export function warehouseProtectedPool(
  resources: Resources,
  warehouseLevel: number,
): Record<PlunderableKey, number> {
  const protection = warehouseProtectionPerResource(warehouseLevel);
  return {
    gold: Math.max(0, Math.floor(resources.gold)),
    food: plunderableAmount(resources.food, protection),
    wood: plunderableAmount(resources.wood, protection),
    stone: plunderableAmount(resources.stone, protection),
    iron: plunderableAmount(resources.iron, protection),
  };
}

/** NPC 袭击玩家主城的金币可抢比例（v41，AISLG-125：金币不受仓库保护，但单次
 *  最多抢走存量的 5%——比玩家互掠的 10% 更轻，被 NPC 打不比被玩家打狠） */
export const NPC_CITY_GOLD_SHARE = 0.05;

/**
 * 玩家城池被 NPC 攻破（v21，AISLG-32 方案 A）的可掠池（纯函数）：粮/木/石/铁按
 * 仓库等级保护（不加比例上限）；金币不受仓库保护，但单次最多抢走存量的 5%
 * （v41，AISLG-125；此前为全额）。实际带走仍受 NPC 幸存部队负重限制。
 * 玩家互掠的可抢池见 protection.ts 的 pvpPlunderPool（金币 10%、四资源 30%、
 * 等级差衰减），不复用本函数的金币口径。
 */
export function cityPlunderPool(
  resources: Resources,
  warehouseLevel: number,
): Record<PlunderableKey, number> {
  const pool = warehouseProtectedPool(resources, warehouseLevel);
  return { ...pool, gold: Math.floor(pool.gold * NPC_CITY_GOLD_SHARE) };
}

/**
 * 掠夺冷却时长：同一目标地块成功掠夺（攻方胜利）后 24 小时内不可再掠（v16 决策）。
 * 记录在 world_tiles.plundered_at，按目标地块统一生效（野地与 NPC 城）；玩家城的
 * 冷却列留待 PvP 阶段。冷却内到达的在途部队仍照常战斗，但资源收益为零。
 */
export const PLUNDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** 掠夺冷却时长（小时，文档展示用）：与 PLUNDER_COOLDOWN_MS 同一决策来源 */
export const PLUNDER_COOLDOWN_HOURS = PLUNDER_COOLDOWN_MS / (60 * 60 * 1000);

/** 实际生效的冷却时长：基准受全局时间缩放 ÷ scale（AISLG-38），判定时刻取当前值 */
export function plunderCooldownMs(): number {
  return scaledMs(PLUNDER_COOLDOWN_MS);
}

/** 冷却判定：plunderedAt 距 now 不足冷却时长 → 仍在冷却内；空值为未掠夺过 */
export function inPlunderCooldown(plunderedAt: Date | string | null, now: Date): boolean {
  if (plunderedAt === null || plunderedAt === undefined) {
    return false;
  }
  const at = plunderedAt instanceof Date ? plunderedAt : new Date(plunderedAt);
  const ts = at.getTime();
  return Number.isFinite(ts) && now.getTime() - ts < plunderCooldownMs();
}

/**
 * 官府等级 = 该城可占领的野地数上限（v16 决策，占位）：占领以「该城占领野地数
 * 低于官府等级」为前提，MARCH 发起时初核、Worker 到达时在锁内复核（超限则胜利
 * 后不改变归属，幸存部队返程并记录 denial=TERRITORY_LIMIT）。
 */
export function territoryLimit(governmentLevel: number): number {
  return Math.max(0, Math.floor(governmentLevel));
}

/** 负重装填顺序：金 → 粮 → 木 → 石 → 铁（v21 AISLG-31；v16 为 粮→木→石→铁） */
export const PLUNDER_LOAD_ORDER: readonly PlunderableKey[] = PLUNDERABLE_KEYS;

/** 战利品形态：金币 + 四基础资源（v21 起金币参与掠夺） */
export type PlunderLoot = Pick<Resources, PlunderableKey>;

/**
 * 按负重的战利品装填（纯函数，不修改入参）：从可掠池按 金→粮→木→石→铁 顺序装满
 * carry，逐项取整、不超额。carry 为 0 或池空时返回全 0。
 */
export function loadByCarry(carry: number, pool: Partial<Record<PlunderableKey, number>>): PlunderLoot {
  let remaining = Math.max(0, Math.floor(carry));
  const loot: PlunderLoot = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
  for (const key of PLUNDER_LOAD_ORDER) {
    if (remaining <= 0) {
      break;
    }
    const available = Math.max(0, Math.floor(pool[key] ?? 0));
    const take = Math.min(remaining, available);
    loot[key] = take;
    remaining -= take;
  }
  return loot;
}

/** 战利品合计（事件 / 校准统计用） */
export function lootTotal(loot: Partial<PlunderLoot>): number {
  return PLUNDERABLE_KEYS.reduce((sum, key) => sum + Math.max(0, Math.floor(loot[key] ?? 0)), 0);
}
