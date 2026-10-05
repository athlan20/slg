// Worker 的战斗结算（v13 起；v15 战败幸存者撤回；v21 NPC 袭击目标池扩展到玩家
// 主城，主城袭击结算在 city-raid.ts）。出征到达的野地 / NPC 城池战斗与 NPC 被
// 袭击野地。从 world-tick.ts 拆出以控制单文件行数；共用工具见 tick-shared.ts。
// v16 起 purpose='plunder' / 'occupy' 的新出征结算在 plunder-tick.ts；本文件是
// legacy 在途 purpose='attack' 的结算路径（野地战利品含金币、NPC 全额库存并占领
// 为分城）。设计：
// - 战斗由 common/src/battle.ts 的多回合引擎结算（数值经批量模拟评审定稿）；
// - 每场战斗生成一份战报落库（battle_reports，攻方账号持有；NPC 袭击时守方账号
//   持有），经 pg_notify → API 推送 PUSH_BATTLE_REPORT；
// - 攻方战败（守方全灭攻方 / 回合耗尽）时幸存部队撤回出发城（v15：返程行军 +
//   事件 returning 字段，战报 / 事件 / 实际兵力三处一致）；
// - 事件与状态同一事务落库（与 processDueBuilds / processDueMarches 形态一致）；
// - 锁序与全栈统一：cities → world_tiles（本文件只做结算，锁由调用方持有）。

import { degradeGarrison } from '../../common/src/scout-detail';
import type { TechLevels } from '../../common/src/tech';
import pg from 'pg';
import { EventType, RESOURCE_KEYS, type InitiatorRole, type Resources, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { recordWinStreak } from '../../common/src/server-broadcast';
import {
  resolveBattle,
  resolveNpcRaid,
  npcRaidArmy,
  armyPower,
  wallDefensePercent,
  type BattleResult,
} from '../../common/src/battle';
import type { ScoutIntel } from '../../common/src/protocol-battle';
import { famousEncounter } from '../../common/src/famous-city';
import { clearNativeGarrison, loadNativeGarrison, saveNativeGarrison } from '../../common/src/native-garrison';
import { addTileArmy, clearTileOccupation, type TileRow } from '../../common/src/world-db';
import type { NpcCitySnapshot } from '../../common/src/world';
import { TERRAIN_INFO, wildernessBonusRate, wildernessGatherRate, wildernessLoot } from '../../common/src/world';
import { INITIAL_POPULATION } from '../../common/src/rules';
import {
  creditLoot,
  createReturnMarch,
  loadCityNaming,
  completeMarchEvent,
  markMarchArrived,
  sideView,
  saveBattleReport,
  troopsEnterCity,
  loadMarchHeroBonus,
  settleMarchHero,
  type MarchRow,
  type TileNotify,
} from './tick-shared';
import { armyTotal } from '../../common/src/hero';
import { resolveNpcCityRaid } from './city-raid';

/** plunder-tick 共用（实现已下沉 tick-shared；v21 起另供 city-raid 引用） */
export { sideView, saveBattleReport };

/**
 * 出征到达的战斗结算（野地原住守军 / NPC 城池驻防）。调用方（world-tick）已按
 * 锁序锁出征城并结算生产、锁定目标地块；守方编成与城墙加成在此确定：
 * 野地为遭遇战（守方迎面推进、无墙），NPC 城池为攻城战（守方贴墙布阵、城墙位
 * 受击减免、近战可出城迎击）。攻方战败时幸存部队撤回出发城（v15）；获胜后由
 * 调用方的上层语义（占领野地 / 掠夺占领分城）在 result 之外继续结算。
 */
export async function resolveBattleArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const npc = tile.kind === 'npc_city' ? (tile.npc as NpcCitySnapshot | null) : null;
  const defender: Partial<Record<TroopKind, number>> = npc ? npc.garrison : await loadNativeGarrison(client, tile);
  const wall = npc ? wallDefensePercent((npc.buildings?.wall as number | undefined) ?? 0) : 0;
  // v36（AISLG-114）：随队武将加成（按部队规模折算，见 heroBattleBonus）
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, defender, {
    wallDefensePercent: wall,
    siege: tile.kind === 'npc_city',
    attackerHero: hero?.engine ?? null,
  });
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  if (!npc) {
    await saveNativeGarrison(client, tile, result.defender.survivors);
  }
  const naming = await loadCityNaming(client, march.from_city_id);
  const attackerName = naming ? `${naming.username} · ${naming.cityName}` : '出征部队';
  const defenderName = npc ? `NPC 城池 Lv${tile.level}` : `野地 Lv${tile.level}（${TERRAIN_INFO[tile.terrain].label}）`;
  const reportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon,
    tile.kind === 'npc_city' ? 'npc_city' : 'wilderness',
    tile.x, tile.y, result, attackerName, defenderName, wall, notifies, hero?.report ?? null,
  );

  if (!result.attackerWon) {
    await recordWinStreak(client, march.account_id, false, {});
    await markMarchArrived(client, march.id);
    // v15：战败幸存部队撤回出发城（不再凭空消失）——攻方全灭时幸存为 0、不产生
    // 返程行军（createReturnMarch 对空编队返回 null）；事件 returning = 返程行军 id
    const retreating = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_lost', {
      troops,
      losses: result.attacker.losses,
      survivors: result.attacker.survivors,
      returning: retreating,
      rounds: result.rounds,
      endReason: result.endReason,
      attackerPower: armyPower(troops),
      defenderPower: armyPower(defender),
      reportId,
      ...(heroSettle ? { heroExp: heroSettle } : {}),
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 连胜计数（v23 AISLG-60；legacy attack 路径同样计入）
  const streakBroadcast = await recordWinStreak(client, march.account_id, true, {
    username: naming?.username ?? null,
    cityName: naming?.cityName ?? null,
  });
  if (streakBroadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streakBroadcast });
  }

  if (tile.kind === 'wilderness') {
    const loot = wildernessLoot(tile.terrain, tile.level);
    if (settled.row) {
      await creditLoot(client, march.from_city_id, loot);
    }
    await clearNativeGarrison(client, tile);
    await addTileArmy(client, tile.x, tile.y, result.attacker.survivors);
    await client.query(
      `UPDATE world_tiles SET owner_city_id = $3 WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
      [tile.x, tile.y, march.from_city_id],
    );
    await markMarchArrived(client, march.id);
    const survivorTotal = Object.values(result.attacker.survivors).reduce((sum, n) => sum + n, 0);
    await completeMarchEvent(client, march, 'battle_won', {
      troops,
      survivors: result.attacker.survivors,
      losses: result.attacker.losses,
      loot,
      rounds: result.rounds,
      attackerPower: armyPower(troops),
      defenderPower: armyPower(defender),
      reportId,
      ...(heroSettle ? { heroExp: heroSettle } : {}),
    });
    await insertEvent(client, {
      accountId: march.account_id,
      cityId: march.from_city_id,
      type: EventType.WILDERNESS_OCCUPIED,
      initiator: march.initiator as InitiatorRole,
      detail: {
        x: tile.x,
        y: tile.y,
        terrain: tile.terrain,
        level: tile.level,
        resource: TERRAIN_INFO[tile.terrain].resource,
        bonusRate: wildernessBonusRate(tile.terrain, tile.level),
        gatherRate: wildernessGatherRate(tile.terrain, tile.level, survivorTotal),
      },
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile.x, y: tile.y, tileReason: 'wilderness_occupied' });
    return;
  }

  // NPC 城池：掠夺全部库存 + 占领为分城（建筑随快照继承；NPC 城池有限存量，不补充）
  const loot: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  for (const key of RESOURCE_KEYS) {
    loot[key] = npc?.stock?.[key] ?? 0;
  }
  if (settled.row) {
    await creditLoot(client, march.from_city_id, loot);
  }
  const cityName = `分城(${tile.x},${tile.y})`;
  const cityIns = await client.query(
    `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, population, x, y)
     VALUES ($1, $2, 0, 0, 0, 0, 0, $3, $4, $5) RETURNING id`,
    [march.account_id, cityName, INITIAL_POPULATION, tile.x, tile.y],
  );
  const newCityId = cityIns.rows[0].id as string;
  for (const [kind, level] of Object.entries(npc?.buildings ?? {})) {
    if ((level ?? 0) > 0) {
      await client.query(
        `INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, $2, $3)`,
        [newCityId, kind, level],
      );
    }
  }
  // v24（AISLG-58）：分城驻军即该城 city_army
  await troopsEnterCity(client, newCityId, result.attacker.survivors);
  await client.query(
    `UPDATE world_tiles SET kind = 'city', level = 0, owner_city_id = $3, npc = NULL WHERE x = $1 AND y = $2`,
    [tile.x, tile.y, newCityId],
  );
  await markMarchArrived(client, march.id);
  await completeMarchEvent(client, march, 'battle_won', {
    troops,
    survivors: result.attacker.survivors,
    losses: result.attacker.losses,
    loot,
    rounds: result.rounds,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(defender),
    reportId,
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  });
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: newCityId,
    type: EventType.NPC_CITY_OCCUPIED,
    initiator: march.initiator as InitiatorRole,
    detail: { x: tile.x, y: tile.y, cityId: newCityId, name: cityName, buildings: npc?.buildings ?? {}, loot, reportId },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile.x, y: tile.y, tileReason: 'npc_city_occupied' });
}

/**
 * NPC 袭击（v12 确认规则，v13 换多回合引擎；v21 AISLG-32 目标池扩展；v23 AISLG-57
 * 改为两阶段——目标选择与编成固定在 npc-attack.ts 的 createNpcAttack（预警先行），
 * 本文件保留野地袭击的到达结算：预警期间增援的部队已并入 garrison，一并参战。
 * 守方（玩家）账号获得守方视角战报（kind='npc_raid'）。
 */
export interface NpcWildernessRaidTarget {
  accountId: string;
  /** 被袭击野地归属的城（事件 cityId 与生产结算用） */
  cityId: string;
  /** 目标地块（调用方已 FOR UPDATE 锁定并复核归属） */
  tile: TileRow;
  /** 袭击强度等级（发起时固定；编成 = npcRaidArmy(level)） */
  level: number;
  /** 到达时刻的地块驻军（含预警期间增援的部队） */
  garrison: Partial<Record<TroopKind, number>>;
  /** 战报守方展示名 */
  defenderName: string;
  notifies: TileNotify[];
}

export async function resolveNpcWildernessRaid(
  client: pg.PoolClient,
  target: NpcWildernessRaidTarget,
): Promise<void> {
  const { tile, level, garrison, accountId, cityId } = target;
  const raid = resolveNpcRaid(garrison, level);
  const npcPower = armyPower(npcRaidArmy(level));
  const garrisonPower = armyPower(garrison);
  const reportId = await saveBattleReport(
    client, accountId, 'defender', raid.defended, 'npc_raid',
    tile.x, tile.y, raid.result, 'NPC 袭击部队', target.defenderName, 0, target.notifies,
  );
  // 连胜计数（v23 AISLG-60）：守方视角的胜负同样计入（击退 +1、失守清零；与主城守城同口径）
  const naming = await loadCityNaming(client, cityId);
  const streakBroadcast = await recordWinStreak(client, accountId, raid.defended, {
    username: naming?.username ?? null,
    cityName: naming?.cityName ?? null,
  });
  if (streakBroadcast) {
    target.notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streakBroadcast });
  }

  if (raid.defended) {
    const survivors = raid.result.defender.survivors;
    for (const kind of Object.keys(survivors) as TroopKind[]) {
      const count = survivors[kind] ?? 0;
      if (count > 0) {
        await client.query(
          `UPDATE tile_army SET count = $3, updated_at = now() WHERE x = $1 AND y = $2 AND troop = $4`,
          [tile.x, tile.y, count, kind],
        );
      } else {
        await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2 AND troop = $3`, [tile.x, tile.y, kind]);
      }
    }
    await insertEvent(client, {
      accountId,
      cityId,
      type: EventType.NPC_RAID,
      initiator: null,
      detail: {
        x: tile.x, y: tile.y, target: 'wilderness', level,
        outcome: 'repelled',
        npcPower, garrisonPower, rounds: raid.result.rounds,
        losses: raid.result.defender.losses, reportId,
      },
    });
    target.notifies.push({ reason: 'tile_changed', accountId, x: tile.x, y: tile.y, tileReason: 'npc_attack_repelled' });
    return;
  }
  await clearTileOccupation(client, tile.x, tile.y);
  await insertEvent(client, {
    accountId,
    cityId,
    type: EventType.NPC_RAID,
    initiator: null,
    detail: {
      x: tile.x, y: tile.y, target: 'wilderness', level,
      outcome: 'garrison_lost',
      npcPower, garrisonPower, rounds: raid.result.rounds,
      losses: raid.result.defender.losses, reportId,
    },
  });
  await insertEvent(client, {
    accountId,
    cityId,
    type: EventType.WILDERNESS_LOST,
    initiator: null,
    detail: { x: tile.x, y: tile.y, cause: 'npc_attack', terrain: tile.terrain, level: tile.level },
  });
  target.notifies.push({ reason: 'tile_changed', accountId, x: tile.x, y: tile.y, tileReason: 'wilderness_lost' });
}

/** 侦察情报的到达组装（world-tick 的 settleScoutArrival 用；独立导出便于阅读） */
export function buildScoutIntel(
  tile: TileRow,
  garrison: Partial<Record<TroopKind, number>>,
  owner: { username: string; cityName: string } | null,
  at: string,
  techs?: TechLevels,
  /** v38（AISLG-122）：玩家城目标的城墙减伤（城墙 + 守方城防科技，守城战同口径）；其余目标不传 */
  pvpWallPercent?: number,
): ScoutIntel {
  const npc = tile.kind === 'npc_city' ? (tile.npc as NpcCitySnapshot | null) : null;
  // 名城：情报即当前阶段口径（外围 = 野战无城墙，城守 = 攻城战含城墙）
  const encounter = npc?.famous ? famousEncounter(npc, new Date(at)) : null;
  const seen = degradeGarrison(garrison, tile.x, tile.y, techs);
  return {
    x: tile.x,
    y: tile.y,
    kind: tile.kind,
    terrain: tile.terrain,
    level: tile.level,
    owner,
    // v27（AISLG-77）：侦察科技决定报告详细度（rough 只给总数范围 / kinds 兵种近似 / exact 精确）
    garrison: seen.garrison,
    detail: seen.detail,
    garrisonTotal: seen.total,
    wallDefensePercent: tile.kind === 'city' && pvpWallPercent !== undefined
      ? pvpWallPercent
      : npc && (!encounter || encounter.siege) ? wallDefensePercent((npc.buildings?.wall as number | undefined) ?? 0) : 0,
    npcStock: npc ? npc.stock ?? null : null,
    scoutedAt: at,
    ...(encounter && npc?.famous ? { famous: { name: npc.famous.name, stage: encounter.stage } } : {}),
  };
}
