// 分城脱离原主人的公共步骤（v40 AISLG-124 换主 / v111 AISLG-259 名城任期届满共用）：
// 抽成一处是为了让两条路径的「失城善后」不会各自漂移。调用方事务内、已按锁序（cities → world_tiles）
// 锁好城池行与地块行，本文件不再加锁。
// 共同步骤：
// - 该城名下野地全部变无主：驻军回原主人主城、望楼毁掉、写 wilderness_lost（cause 区分换主 / 任期届满）；
// - 该城在外部队改从原主人主城返程（本次到达的那条行军除外）；
// - 排队 / 在建的建造、征兵、该城发起的研究、酒馆候选作废（不退资源）；
// - 针对该城的 NPC 袭击作废，正在围攻这座城的势力围攻作废；
// - 原主人的伤兵 / 俘虏 / 逃兵池清空（池子不随城移交）。
// 差异由调用方处理：换主保留城行并改 account_id / 城防 / 保护（城守卸任），
// 任期届满删除城行并把地块恢复为无主 NPC 名城。

import type pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadTileArmy } from '../../common/src/world-db';
import { destroyFacility } from '../../common/src/facility-db';
import { cancelSiegesForCity } from '../../common/src/faction-siege-db';
import { clearCityTroopPools } from '../../common/src/troop-pools-db';
import { troopsEnterCity, type TileNotify } from './tick-shared';

export interface DetachCityArgs {
  cityId: string;
  /** 原主人主城（名下野地驻军、在外部队的落点） */
  mainCityId: string;
  prevOwnerAccountId: string;
  cityName: string;
  x: number;
  y: number;
  /** wilderness_lost 事件的原因：conquest = 被玩家换主；famous_expired = 名城任期届满 */
  cause: 'conquest' | 'famous_expired';
  /** 换主时记的进攻方用户名（任期届满为 null） */
  attackerUsername: string | null;
  /** 本次到达的那条行军不重定向（换主传当前行军 id；任期届满传 null） */
  keepMarchId: string | null;
  notifies: TileNotify[];
}

/** 执行「分城脱离原主人」的公共步骤（调用方事务内；见文件头） */
export async function detachCityFromOwner(client: pg.PoolClient, args: DetachCityArgs): Promise<void> {
  const { cityId, mainCityId, prevOwnerAccountId, cityName, cause, attackerUsername, keepMarchId, notifies } = args;
  // 该城名下野地全部变无主，驻军回原主人主城（已预锁）
  const territoryRes = await client.query(
    `SELECT x, y, terrain, level FROM world_tiles WHERE owner_city_id = $1 AND kind = 'wilderness'`,
    [cityId],
  );
  for (const row of territoryRes.rows as Array<{ x: number; y: number; terrain: string; level: number }>) {
    const garrison = await loadTileArmy(client, row.x, row.y);
    if (Object.values(garrison).some((count) => (count ?? 0) > 0)) {
      await troopsEnterCity(client, mainCityId, garrison);
    }
    await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [row.x, row.y]);
    // v97（AISLG-232）：分城失去，该城名下的望楼一并毁掉（不转给新主人、不退资源）
    await destroyFacility(client, row.x, row.y, 'city_lost');
    await client.query(
      `UPDATE world_tiles SET owner_city_id = NULL, owner_changed_until = NULL WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
      [row.x, row.y],
    );
    // 原主人收到每块野地的失地通知（与 v39 抢野地同口径）
    await insertEvent(client, {
      accountId: prevOwnerAccountId,
      cityId: mainCityId,
      type: EventType.WILDERNESS_LOST,
      initiator: null,
      detail: {
        x: row.x, y: row.y, cause, terrain: row.terrain, level: row.level,
        ...(attackerUsername ? { attacker: { username: attackerUsername } } : {}),
        withCity: { id: cityId, name: cityName },
      },
    });
    notifies.push({ reason: 'tile_changed', accountId: prevOwnerAccountId, x: row.x, y: row.y, tileReason: 'wilderness_lost' });
  }

  // 该城在外的部队：改从原主人主城返程归属（返程 / 结算落点随之回主城）
  await client.query(
    `UPDATE marches SET from_city_id = $2
     WHERE from_city_id = $1 AND status = 'marching' AND ($3::uuid IS NULL OR id <> $3::uuid)`,
    [cityId, mainCityId, keepMarchId],
  );

  // 作废：排队 / 在建的建造、征兵、该城发起的研究、酒馆候选（不退资源）；针对该城的 NPC 袭击。
  // v87（AISLG-217）：酒馆 / 书院已只在主城，分城的候选本已不存在；这里的清理作为兼容存量 / 旧数据的兵底保留。
  await client.query(`DELETE FROM builds WHERE city_id = $1`, [cityId]);
  await client.query(`DELETE FROM recruits WHERE city_id = $1`, [cityId]);
  await client.query(`DELETE FROM tech_research WHERE city_id = $1`, [cityId]);
  await client.query(`DELETE FROM tavern_candidates WHERE city_id = $1`, [cityId]);
  await client.query(
    `UPDATE npc_attacks SET resolved_at = clock_timestamp() WHERE target_city_id = $1 AND resolved_at IS NULL`,
    [cityId],
  );
  // v100（AISLG-240）：这座城已失去，正在围攻它的势力本次围攻作废（不战斗）
  await cancelSiegesForCity(client, cityId);
  // v85（AISLG-212）：原主人的伤兵 / 俘虏 / 逃兵池一并清空（城池失去，池子不随城移交）
  await clearCityTroopPools(client, cityId);
}