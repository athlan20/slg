// 战斗所得按城池储量上限入账（v118，AISLG-270）。原 creditLoot（tick-shared.ts）保持
// 不变，留给非战斗来源（运输与撤回带回、交易所交割、活动排名奖励、势力老巢击破奖励、
// 遗迹、兑换码等）；本文件的 creditBattleLoot 只给战斗得来的资源用：
// 野地 / NPC 城掠夺、截击、玩家城掠夺、黄巾营地 / 老巢掉落、旧版 attack 行军结算。
//
// 顺序：先把城池生产懒结算到当前时刻（调用方通常已结算过，这里幂等；行锁在同一事务
// 内复用），再按 storageCaps（含储存科技与时间缩放）算每种资源的剩余空间，装不下的
// 部分作废（已经超上限的存量不扣减）。纯计算在 common/src/loot-cap.ts。

import pg from 'pg';
import type { Resources } from '../../common/src/protocol';
import { loadBuildingLevels, storageCaps } from '../../common/src/production';
import { loadTechLevelsByCity } from '../../common/src/tech-db';
import { capLootByStorage, emptyResources, resourcesTotal, type LootCreditSplit } from '../../common/src/loot-cap';
import { settleOwnerCity } from './tick-shared';

interface CityResourcesRow {
  gold: number;
  wood: number;
  food: number;
  stone: number;
  iron: number;
}

function toResources(row: CityResourcesRow): Resources {
  return {
    gold: Number(row.gold),
    food: Number(row.food),
    wood: Number(row.wood),
    stone: Number(row.stone),
    iron: Number(row.iron),
  };
}

/**
 * 战斗所得入账（钳储量上限）：返回实际进城量（credited）与因满仓作废的量（wasted）。
 * 调用方在自己的事务内调用，cityId 行锁由本函数通过 settleOwnerCity 取（同一事务可重入）。
 * 城池不存在时不入账、全部记为作废（数据异常的兜底，正常流程不会发生）。
 */
export async function creditBattleLoot(
  client: pg.PoolClient,
  cityId: string,
  loot: Resources,
): Promise<LootCreditSplit> {
  const { row } = await settleOwnerCity(client, cityId);
  if (!row) {
    return { credited: emptyResources(), wasted: { ...loot } };
  }
  // settleCityProduction 已把结算结果落库，这里读结算后的存量（行仍在同一事务的行锁内）
  const res = await client.query(`SELECT gold, wood, food, stone, iron FROM cities WHERE id = $1`, [cityId]);
  const current = toResources(res.rows[0] as CityResourcesRow);
  const caps = storageCaps(await loadBuildingLevels(client, cityId), await loadTechLevelsByCity(client, cityId));
  const split = capLootByStorage(current, caps, loot);
  if (resourcesTotal(split.credited) > 0) {
    await client.query(
      `UPDATE cities SET gold = gold + $2, wood = wood + $3, food = food + $4,
              stone = stone + $5, iron = iron + $6 WHERE id = $1`,
      [cityId, split.credited.gold, split.credited.wood, split.credited.food, split.credited.stone, split.credited.iron],
    );
  }
  return split;
}

/**
 * 战报落库后再补战利品字段（v118）：掠夺 / 截击的战报在战斗结算时就写了，战利品要到
 * 负重装填后才知道——这里用 jsonb 合并追加 lootPercent / wasted（已有键不删）。
 */
export async function patchBattleReportLoot(
  client: pg.PoolClient,
  reportId: number,
  patch: { lootPercent?: number; wasted?: Resources },
): Promise<void> {
  const hasWasted = patch.wasted !== undefined && resourcesTotal(patch.wasted) > 0;
  const fields: Record<string, unknown> = {};
  if (patch.lootPercent !== undefined && patch.lootPercent !== 100) {
    fields.lootPercent = patch.lootPercent;
  }
  if (hasWasted) {
    fields.wasted = patch.wasted;
  }
  if (Object.keys(fields).length === 0) {
    return;
  }
  await client.query(`UPDATE battle_reports SET detail = detail || $2::jsonb WHERE id = $1`, [reportId, JSON.stringify(fields)]);
}