// 掠夺战利品的完整结算（v118，AISLG-270）：从本文件统一走
// 装填（loadByCarry）→ 野地每日递减（账号当日第 N 次 → 100 / 50 / 20%）→ 钳城池储量上限入账
// （creditBattleLoot：装不下的作废）→ 补写战报字段 → 累计掠夺台账。
// 从 plunder-tick.ts 拆出，避免该文件继续膨胀；调用方（plunder-tick）只负责池子 / 储量 /
// 冷却与库存扣减、事件与返程。

import pg from 'pg';
import type { Resources } from '../../common/src/protocol';
import { emptyResources, resourcesTotal } from '../../common/src/loot-cap';
import {
  loadByCarry,
  lootTotal,
  scaleLoot,
  type PlunderableKey,
  type PlunderLoot,
} from '../../common/src/plunder';
import { consumeWildernessPlunder } from '../../common/src/plunder-daily-db';
import { creditBattleLoot, patchBattleReportLoot } from './battle-loot';

const EMPTY_LOOT: PlunderLoot = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };

function toResources(loot: PlunderLoot): Resources {
  return { gold: loot.gold, food: loot.food, wood: loot.wood, stone: loot.stone, iron: loot.iron };
}

export interface SettlePlunderLootArgs {
  accountId: string;
  /** 出发城（入账城） */
  cityId: string;
  /** 幸存部队负重（含负重科技） */
  carry: number;
  /** 可掠池（野地已按地块储量钳制过） */
  pool: Partial<Record<PlunderableKey, number>>;
  /** 目标是否在掠夺冷却内：冷却内收益为零、不计次数 */
  inCooldown: boolean;
  /** 是否 NPC 城掠夺：不计数、不打折（库存另按装车量扣减，见 carried） */
  npc: boolean;
  /** 出征城行是否取到（取不到时不入账，但仍返回装车量供库存扣减） */
  hasCity: boolean;
  /** 本场战斗的战报 id（补写 lootPercent / wasted） */
  reportId: number;
}

export interface PlunderLootOutcome {
  /** 实际装上车的量（已乘倍数、未钳上限）：野地储量与 NPC 库存都按它扣减 */
  carried: Resources;
  /** 实际进城量 */
  credited: Resources;
  /** 因仓库满作废的量 */
  wasted: Resources;
  /** 本次收益倍数（100 / 50 / 20） */
  lootPercent: number;
}

/**
 * 掠夺战利品结算（调用方已锁出征城并结算生产、已锁目标地块；全程在同一事务内）。
 * 返回装车量 / 入账量 / 作废量与本次倍数，供事件 detail 与库存、储量扣减使用。
 */
export async function settlePlunderLoot(
  client: pg.PoolClient,
  args: SettlePlunderLootArgs,
  now: Date,
): Promise<PlunderLootOutcome> {
  const loaded = args.inCooldown ? EMPTY_LOOT : loadByCarry(args.carry, args.pool);
  // v118：野地掠夺按账号每日递减——先记账再打折；NPC 城掠夺 / 冷却内不计数
  const daily = !args.npc && !args.inCooldown
    ? await consumeWildernessPlunder(client, args.accountId, now)
    : null;
  const lootPercent = daily ? daily.lootPercent : 100;
  const carried = scaleLoot(loaded, lootPercent);
  const carriedView = toResources(carried);
  let credited = emptyResources();
  let wasted = emptyResources();
  if (args.hasCity && resourcesTotal(carriedView) > 0) {
    const split = await creditBattleLoot(client, args.cityId, carriedView);
    credited = split.credited;
    wasted = split.wasted;
    if (lootTotal(carried) > 0) {
      // 累计掠夺台账（v23 AISLG-61）：四资源合计（金不计），记在账号上
      await client.query(`UPDATE accounts SET plunder_total = plunder_total + $2 WHERE id = $1`, [
        args.accountId,
        carried.food + carried.wood + carried.stone + carried.iron,
      ]);
    }
  }
  // 战报在战斗结算时已落库，战利品相关的倍数与作废量在这里补写
  await patchBattleReportLoot(client, args.reportId, { lootPercent, wasted });
  return { carried: carriedView, credited, wasted, lootPercent };
}