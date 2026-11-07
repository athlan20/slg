// 城被势力吞下（AISLG-240，v100）：玩家分城 → 归属该势力的 NPC 城。处理内容与「玩家换主」
// （worker/src/pvp-conquer.ts 的 transferCityOwnership）基本一致，但新主人是势力而不是账号，
// 所以按放弃分城的写法把地块转回 npc_city，**建筑与等级留在城里**（写进 npc 快照的 buildings），
// 玩家日后占下时走现有 npc-occupy 流程就能接收建筑与库存。需求第三节那张表逐项：
// - 建筑和等级：留在城里（快照 buildings + tile.level = cities.origin_level）；
// - 剩余资源：变成这座城的可掠夺库存（npc.stock）；
// - 排队中的建造 / 征兵 / 研究 / 酒馆候选：作废，不退资源；
// - 城守：卸任（city 行删除，武将自己仍在原主人名下）；
// - 名下野地：变无主，望楼按现有规则毁掉，驻军回原主人主城；
// - 驻军：回原主人主城；在外部队：改从原主人主城返程；
// - 指向这座城的运输 / 调兵：到达时按现有失效路径返回（城池行已删，坐标上已是 NPC 城）；
// - 协防部队：返回各自的城；
// - 针对这座城的 NPC 袭击与别家的围攻：作废；
// - 原主人腾出分城名额、收到失城事件、全服播报一条；**不写放弃冷却**（被吞不是放弃，
//   原主人打回来不受放弃分城冷却限制）。
// 被吞城的守军 = 围城军（发起时固定的编成与战力），不再乘势力城的 1.5 倍。
// 调用方持有事务，并按锁序（cities → world_tiles）锁住城池行与地块行。

import type pg from 'pg';
import { EventType, RESOURCE_KEYS, type BuildingKind, type Resources, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadCityNaming, troopsEnterCity, type TileNotify } from './tick-shared';
import { loadTileArmy } from '../../common/src/world-db';
import { destroyFacility } from '../../common/src/facility-db';
import { returnAssistsForCity } from '../../common/src/city-assist-db';
import { cancelSiegesForCity } from '../../common/src/faction-siege-db';
import { moveNpcLevelOf } from '../../common/src/move-city';
import { insertServerBroadcast } from '../../common/src/server-broadcast';
import { factionBannerOf } from '../../common/src/faction';
import type { NpcCitySnapshot } from '../../common/src/world';
import type { FactionKey } from '../../common/src/protocol-faction';

export interface SwallowCityResult {
  /** 原主人主城（驻军 / 在外部队改投这里；没有其他城时为 null = 账号已无城，走账号重置流程） */
  mainCityId: string | null;
  /** 城名（事件 / 播报用） */
  cityName: string;
  /** 原地块回归的 NPC 等级 */
  npcLevel: number;
  /** 被毁的望楼数 */
  facilitiesLost: number;
  /** 变无主的野地数 */
  wildernessLost: number;
  /** 归位的野地驻军兵力（合计单位数） */
  garrisonReturned: number;
}

/** 城被吞时的一整串清理与改写；调用方负责事务与锁，返回 null 表示这座城已不存在 */
export async function swallowFactionCity(
  client: pg.PoolClient,
  args: {
    cityId: string;
    faction: FactionKey;
    /** 围城军编成（成为这座 NPC 城的新守军，不再乘 1.5） */
    army: Partial<Record<TroopKind, number>>;
    siegeId: string;
    reportId: number | null;
    notifies: TileNotify[];
  },
): Promise<SwallowCityResult | null> {
  const cityRes = await client.query(
    `SELECT id, account_id, name, x, y, gold, wood, food, stone, iron, origin_level
     FROM cities WHERE id = $1`,
    [args.cityId],
  );
  const city = cityRes.rows[0] as
    | {
        id: string;
        account_id: string;
        name: string;
        x: number;
        y: number;
        gold: number;
        wood: number;
        food: number;
        stone: number;
        iron: number;
        origin_level: number | null;
      }
    | undefined;
  if (!city) {
    return null;
  }
  const ownerAccountId = city.account_id;
  const accountId = ownerAccountId;

  // 原主人主城（驻军落点 / 在外部队的新出发点）：排除即将消失的这一座
  const mainRes = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 AND id <> $2 ORDER BY created_at LIMIT 1`,
    [accountId, args.cityId],
  );
  const mainCityId = (mainRes.rows[0] as { id: string } | undefined)?.id ?? null;
  const naming = await loadCityNaming(client, args.cityId);

  // 建筑与等级留在城里：建筑等级写进 NPC 快照，地块等级回到这座分城的来源等级（占城门槛用）
  const buildingsRes = await client.query(`SELECT kind, level FROM city_buildings WHERE city_id = $1`, [args.cityId]);
  const buildings: Partial<Record<BuildingKind, number>> = {};
  for (const row of buildingsRes.rows as Array<{ kind: BuildingKind; level: number }>) {
    if (row.level > 0) {
      buildings[row.kind] = row.level;
    }
  }
  const stock: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const key of RESOURCE_KEYS) {
    stock[key] = Math.max(0, Math.floor(city[key]));
  }
  // 挂单里托管的资源跟城走：删城时挂单会级联消失，不把余量并进库存就凭空没了
  const ordersRes = await client.query(
    `SELECT sell_resource, remaining FROM market_orders WHERE city_id = $1 AND status = 'open' AND remaining > 0`,
    [args.cityId],
  );
  for (const row of ordersRes.rows as Array<{ sell_resource: keyof Resources; remaining: string }>) {
    stock[row.sell_resource] += Number(row.remaining);
  }
  const npcLevel = moveNpcLevelOf(city.origin_level);

  // 1) 名下野地变无主：驻军回原主人主城、望楼毁掉、地块清空归属
  const territoryRes = await client.query(
    `SELECT x, y, terrain, level FROM world_tiles WHERE owner_city_id = $1 AND kind = 'wilderness'`,
    [args.cityId],
  );
  let facilitiesLost = 0;
  let garrisonReturned = 0;
  for (const row of territoryRes.rows as Array<{ x: number; y: number; terrain: string; level: number }>) {
    const garrison = await loadTileArmy(client, row.x, row.y);
    const units = Object.values(garrison).reduce((sum, count) => sum + Math.max(0, count ?? 0), 0);
    if (units > 0 && mainCityId) {
      await troopsEnterCity(client, mainCityId, garrison);
      garrisonReturned += units;
    }
    await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [row.x, row.y]);
    // v97（AISLG-232）：分城易主（这里是被势力吞下），该城名下的望楼一并毁掉，不转给新主人、不退资源
    if (await destroyFacility(client, row.x, row.y, 'city_lost')) {
      facilitiesLost += 1;
    }
    await client.query(
      `UPDATE world_tiles SET owner_city_id = NULL, owner_changed_until = NULL WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
      [row.x, row.y],
    );
    await insertEvent(client, {
      accountId,
      cityId: mainCityId,
      type: EventType.WILDERNESS_LOST,
      initiator: null,
      detail: {
        x: row.x,
        y: row.y,
        cause: 'conquest',
        terrain: row.terrain,
        level: row.level,
        faction: factionBannerOf(args.faction),
        withCity: { id: args.cityId, name: city.name },
      },
    });
    args.notifies.push({ reason: 'tile_changed', accountId, x: row.x, y: row.y, tileReason: 'wilderness_lost' });
  }

  // 2) 该城在外的部队改从原主人主城返程（返程 / 结算落点随之回主城）
  if (mainCityId) {
    await client.query(
      `UPDATE marches SET from_city_id = $2 WHERE from_city_id = $1 AND status = 'marching'`,
      [args.cityId, mainCityId],
    );
  }

  // 3) 排队中的建造 / 征兵 / 研究 / 酒馆候选作废（不退资源）；针对这座城的 NPC 袭击作废
  await client.query(`DELETE FROM builds WHERE city_id = $1`, [args.cityId]);
  await client.query(`DELETE FROM recruits WHERE city_id = $1`, [args.cityId]);
  await client.query(`DELETE FROM tech_research WHERE city_id = $1`, [args.cityId]);
  await client.query(`DELETE FROM tavern_candidates WHERE city_id = $1`, [args.cityId]);
  await client.query(
    `UPDATE npc_attacks SET resolved_at = clock_timestamp() WHERE target_city_id = $1 AND resolved_at IS NULL`,
    [args.cityId],
  );
  // 别家势力正围这座城的也一并作废（同一座城可能被两家同时盯上）
  await cancelSiegesForCity(client, args.cityId);

  // 4) 协防部队返回各自的城（决战里打光的已在守城战后删除，这里处理还有残部的）
  await returnAssistsForCity(client, args.cityId, 'city_lost');
  // 这座城派去别处协防的部队继续驻防，出发城改成主城：否则删城时级联消失，部队凭空没了
  if (mainCityId) {
    await client.query(`UPDATE city_assist SET from_city_id = $2 WHERE from_city_id = $1`, [args.cityId, mainCityId]);
  }

  // 5) 驻军回原主人主城（被吞前刚打过守城战，通常已全灭，这里兜住残部）
  const armyRes = await client.query(`SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`, [args.cityId]);
  const garrison: Partial<Record<TroopKind, number>> = {};
  for (const row of armyRes.rows as Array<{ troop: TroopKind; count: number }>) {
    garrison[row.troop] = row.count;
  }
  if (mainCityId && Object.keys(garrison).length > 0) {
    await troopsEnterCity(client, mainCityId, garrison);
  }
  await client.query(`DELETE FROM city_army WHERE city_id = $1`, [args.cityId]);

  // 6) 地块变成该势力的 NPC 城：建筑 / 库存 / 围城军守军（不再乘 1.5），留势力归属
  const npc: NpcCitySnapshot = {
    level: npcLevel,
    garrison: { ...args.army },
    stock,
    buildings,
    faction: args.faction,
  };
  await client.query(
    `UPDATE world_tiles SET kind = 'npc_city', level = $3, owner_city_id = NULL, npc = $4::jsonb
     WHERE x = $1 AND y = $2`,
    [city.x, city.y, npcLevel, JSON.stringify(npc)],
  );

  // 7) 删城池行：建筑、城内驻军、队列、城守任命与三池随外键级联清理；分城名额随之腾出。
  //    不写 city_discards —— 被吞不是放弃，原主人打回来不受放弃冷却限制。
  await client.query(`DELETE FROM cities WHERE id = $1`, [args.cityId]);

  // 8) 失城事件 + 全服播报（必达）
  await insertEvent(client, {
    accountId,
    cityId: mainCityId,
    type: EventType.FACTION_CITY_LOST,
    initiator: null,
    detail: {
      cityId: args.cityId,
      cityName: city.name,
      x: city.x,
      y: city.y,
      faction: factionBannerOf(args.faction),
      mainCityId,
      wildernessLost: territoryRes.rowCount ?? 0,
      facilitiesLost,
      reportId: args.reportId,
      siegeId: args.siegeId,
    },
  });
  const broadcast = await insertServerBroadcast(
    client,
    'faction_city_swallowed',
    {
      username: naming?.username ?? null,
      cityName: city.name,
      faction: args.faction,
      factionName: factionBannerOf(args.faction)?.name ?? null,
      x: city.x,
      y: city.y,
    },
    { force: true },
  );
  if (broadcast) {
    args.notifies.push({ reason: 'server_broadcast', accountId: '', broadcast });
  }
  args.notifies.push({ reason: 'tile_changed', accountId, x: city.x, y: city.y, tileReason: 'faction_city_swallowed' });
  return {
    mainCityId,
    cityName: city.name,
    npcLevel,
    facilitiesLost,
    wildernessLost: territoryRes.rowCount ?? 0,
    garrisonReturned,
  };
}
