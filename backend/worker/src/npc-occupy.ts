// Worker 的 NPC 城池占领结算（v24，AISLG-58）：MARCH task='occupy' 且目标为 NPC 城池时，
// 到达后按攻城战（守方据墙）结算；胜利且仍满足分城资格（官府门槛 / 分城名额 / 目标
// 等级——发起时初核过，到达时在锁内复核）则 NPC 城转为本账号分城：接收其建筑与
// 剩余库存，幸存部队进城驻守（city_army，分城可独立建造 / 征兵 / 出兵）。
// 不满足资格时与野地占领超限同形态：不转城、幸存部队返程，事件记录 occupied=false 与
// denial。战败与目标失效的处理与掠夺一致。设计上不掠夺（库存随城整体移交）。
// 名城（AISLG-56）：外围阶段先清外围（famous-outer.ts）；城守阶段打城守，转城后以名城
// 命名并带独占加成标记（cities.famous_name）。
// 调用方（world-tick）已按锁序锁出征城并锁定目标地块，本文件内不再锁 cities。

import pg from 'pg';
import { EventType, RESOURCE_KEYS, type InitiatorRole, type Resources, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, resolveBattle, wallDefensePercent } from '../../common/src/battle';
import { checkOccupyNpcCity } from '../../common/src/branch-city';
import { famousStage } from '../../common/src/famous-city';
import { DURABILITY_MAX } from '../../common/src/protection';
import { loadBranchStanding } from '../../common/src/branch-city-db';
import { loadBuildingLevels } from '../../common/src/production';
import { INITIAL_POPULATION } from '../../common/src/rules';
import { recordWinStreak, type ServerBroadcastCreated } from '../../common/src/server-broadcast';
import type { NpcCitySnapshot } from '../../common/src/world';
import type { TileRow } from '../../common/src/world-db';
import {
  abortMarchToReturn,
  completeMarchEvent,
  createReturnMarch,
  loadCityNaming,
  markMarchArrived,
  troopsEnterCity,
  type MarchRow,
  type TileNotify,
  loadMarchHeroBonus,
  settleMarchHero,
} from './tick-shared';
import { saveBattleReport } from './battle-tick';
import { armyTotal, famousHeroForCity } from '../../common/src/hero';
import { grantFamousHeroWithBroadcast } from './hero-grant';
import { resolveFamousOuterArrival } from './famous-outer';

/** NPC 城转分城：建城行、继承建筑、移交库存、地块转 city 并写入驻军；返回新城 id。
 *  v36（AISLG-115）：带 notifies 时，占领的是名城且绑定名将未被他人获得 → 授予占领者（全服播报） */
export async function convertNpcCityToBranch(
  client: pg.PoolClient,
  accountId: string,
  tile: TileRow,
  npc: NpcCitySnapshot,
  garrison: Partial<Record<TroopKind, number>>,
  cityName: string,
  notifies?: TileNotify[],
): Promise<string> {
  const stock: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const key of RESOURCE_KEYS) {
    stock[key] = Math.max(0, Math.floor(npc.stock?.[key] ?? 0));
  }
  const ins = await client.query(
    `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, population, x, y, famous_name, durability, durability_settled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()) RETURNING id`,
    [accountId, cityName, stock.gold, stock.wood, stock.food, stock.stone, stock.iron, INITIAL_POPULATION, tile.x, tile.y, npc.famous?.name ?? null, DURABILITY_MAX],
  );
  const cityId = ins.rows[0].id as string;
  // v36（AISLG-115）：名城首占发绑定名将（全服唯一；已被他人获得或本账号名将满 3 名则跳过）
  if (npc.famous && notifies) {
    const def = famousHeroForCity(npc.famous.name);
    if (def) {
      const broadcasts: ServerBroadcastCreated[] = [];
      await grantFamousHeroWithBroadcast(client, accountId, def, notifies, broadcasts);
      // 全服播报：提交后经 pg_notify 推给在线玩家（与连胜播报同通道）
      for (const broadcast of broadcasts) {
        notifies.push({ reason: 'server_broadcast', accountId: '', broadcast });
      }
    }
  }
  for (const [kind, level] of Object.entries(npc.buildings ?? {})) {
    if ((level ?? 0) > 0) {
      await client.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, $2, $3)`, [cityId, kind, level]);
    }
  }
  await troopsEnterCity(client, cityId, garrison);
  await client.query(
    `UPDATE world_tiles SET kind = 'city', level = 0, owner_city_id = $3, npc = NULL WHERE x = $1 AND y = $2`,
    [tile.x, tile.y, cityId],
  );
  return cityId;
}

export async function resolveNpcOccupyArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const npc = tile.npc as NpcCitySnapshot | null;
  if (!npc) {
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  if (npc.famous && famousStage(npc.famous, new Date()) === 'outer') {
    // 名城外围阶段：占领出征先清外围（发起时服务端已拒绝，此处兜底外围在途恢复的情形）
    await resolveFamousOuterArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  const wall = wallDefensePercent((npc.buildings?.wall as number | undefined) ?? 0);
  // v36（AISLG-114）：随队武将加成（按部队规模折算）
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, npc.garrison, { wallDefensePercent: wall, siege: true, attackerHero: hero?.engine ?? null });
  const naming = await loadCityNaming(client, march.from_city_id);
  const attackerName = naming ? `${naming.username} · ${naming.cityName}` : '出征部队';
  const reportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon,
    'npc_city', tile.x, tile.y, result, attackerName, `NPC 城池 Lv${tile.level}`, wall, notifies, hero?.report ?? null,
  );
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  const base = {
    troops,
    losses: result.attacker.losses,
    survivors: result.attacker.survivors,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(npc.garrison),
    reportId,
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  };

  if (!result.attackerWon) {
    await recordWinStreak(client, march.account_id, false, {});
    await markMarchArrived(client, march.id);
    const retreating = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_lost', { ...base, returning: retreating });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  const streak = await recordWinStreak(client, march.account_id, true, {
    username: naming?.username ?? null,
    cityName: naming?.cityName ?? null,
  });
  if (streak) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streak });
  }

  // 到达复核分城资格（发起后主城官府 / 分城数可能变化）
  const standing = await loadBranchStanding(client, march.account_id);
  const fromLevels = await loadBuildingLevels(client, march.from_city_id);
  const denial = checkOccupyNpcCity({
    mainGovernment: standing.mainGovernment,
    fromGovernment: fromLevels.government,
    branchCount: standing.branchCount,
    targetLevel: tile.level,
  });
  await markMarchArrived(client, march.id);
  if (denial) {
    const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_won', {
      ...base,
      occupied: false,
      denial,
      branchCount: standing.branchCount,
      mainGovernment: standing.mainGovernment,
      returning,
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  const cityName = npc.famous?.name ?? `分城(${tile.x},${tile.y})`;
  const newCityId = await convertNpcCityToBranch(client, march.account_id, tile, npc, result.attacker.survivors, cityName, notifies);
  await completeMarchEvent(client, march, 'battle_won', { ...base, occupied: true, cityId: newCityId });
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: newCityId,
    type: EventType.NPC_CITY_OCCUPIED,
    initiator: march.initiator as InitiatorRole,
    detail: {
      x: tile.x, y: tile.y, cityId: newCityId, name: cityName,
      buildings: npc.buildings ?? {}, stock: npc.stock ?? {}, reportId,
    },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile.x, y: tile.y, tileReason: 'npc_city_occupied' });
}
