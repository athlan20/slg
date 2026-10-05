// Worker 的掠夺与占领结算（v16，AISLG-4「仓库防掠夺保护与掠夺结算设计」）。
// 处理 purpose='plunder' / 'occupy' 的出征到达；legacy 在途 purpose='attack' 仍走
// battle-tick.resolveBattleArrival（金币战利品 + NPC 全额库存并占领）。设计：
// - 调用方（world-tick）已按锁序锁出征城（生产结算到到达时刻）并锁定目标地块，
//   本文件内不再锁 cities；战斗 / 负重装填 / 库存扣减 / 冷却落库 / 返程 / 战报与
//   事件全部在同一事务内完成（提交后 pg_notify）；
// - 掠夺：胜利后从奖励池按幸存部队负重装填（v21 起金→粮→木→石→铁），立即入账
//   出发城（不钳储量上限，与取消返还同规则）；野地池 = 地形资源 750×等级 + 金
//   250×等级（金矿保持空池）、NPC 池 = 持久化库存（v21 起含金币，库存不再生）；
//   地块进入 24 小时
//   冷却（plundered_at，胜利即更新——无论收益是否为 0，实现测试固定该决策）；
//   冷却内到达的在途部队仍照常战斗但资源为零；不改归属、幸存部队返程；
// - 占领：无一次性战利品；胜利后核占领上限（该城占领野地数 < 官府等级）——
//   未超限改归属、幸存驻守并获得持续加成；超限则幸存部队返程，事件记录
//   occupied=false 与 denial=TERRITORY_LIMIT；
// - 攻方战败：幸存部队撤回出发城（v15 语义，与 battle-tick 一致）；
// - 目标失效（易主 / 转城 / 任务不再适用）：不战斗，部队原路返回（aborted）。

import { carryingPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import pg from 'pg';
import { EventType, type InitiatorRole, type Resources, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, resolveBattle, wallDefensePercent } from '../../common/src/battle';
import { clearNativeGarrison, loadNativeGarrison, saveNativeGarrison } from '../../common/src/native-garrison';
import { armyCarryCapacity } from '../../common/src/troops';
import { TERRAIN_INFO, wildernessBonusRate, wildernessGatherRate, wildernessPlunderPool } from '../../common/src/world';
import type { NpcCitySnapshot } from '../../common/src/world';
import { loadBuildingLevels } from '../../common/src/production';
import {
  inPlunderCooldown,
  loadByCarry,
  lootTotal,
  PLUNDERABLE_KEYS,
  territoryLimit,
  type PlunderableKey,
  type PlunderLoot,
} from '../../common/src/plunder';
import { insertServerBroadcast, recordWinStreak } from '../../common/src/server-broadcast';
import { addTileArmy, type TileRow } from '../../common/src/world-db';
import {
  abortMarchToReturn,
  completeMarchEvent,
  createReturnMarch,
  creditLoot,
  loadCityNaming,
  loadMarchHeroBonus,
  markMarchArrived,
  reinforceTile,
  settleMarchHero,
  type MarchRow,
  type TileNotify,
} from './tick-shared';
import { saveBattleReport } from './battle-tick';
import { armyTotal } from '../../common/src/hero';
import { resolveNpcOccupyArrival } from './npc-occupy';
import { resolveFamousOuterArrival } from './famous-outer';
import { famousStage } from '../../common/src/famous-city';
import { resolvePvpPlunderArrival } from './pvp-raid';
import { resolvePvpOccupyArrival } from './pvp-tile';
import { resolvePvpConquestArrival } from './pvp-conquer';

/** 城池是否属于该账号（野地归属复核用） */
async function isOwnCity(client: pg.PoolClient, cityId: string, accountId: string): Promise<boolean> {
  const res = await client.query(`SELECT 1 FROM cities WHERE id = $1 AND account_id = $2`, [cityId, accountId]);
  return res.rowCount === 1;
}

/** 数据库当前时刻（事务内统一时间源：冷却复核 / 落库 / 事件时间一致） */
async function dbNow(client: pg.PoolClient): Promise<Date> {
  const res = await client.query(`SELECT now() AS now`);
  return res.rows[0].now as Date;
}

/** 出发城的官府等级（占领上限 = 官府等级；每城注册自带 1 级官府，异常缺行时按 1 兜底） */
async function governmentLevel(client: pg.PoolClient, cityId: string): Promise<number> {
  const levels = await loadBuildingLevels(client, cityId);
  return Math.max(1, levels.government);
}

/** 战利品转完整资源形态（v21 起金币参与掠夺，原样透传） */
function toResources(loot: PlunderLoot): Resources {
  return { gold: loot.gold, food: loot.food, wood: loot.wood, stone: loot.stone, iron: loot.iron };
}

/** NPC 城池的可掠池：持久化库存（v21 起含金币，AISLG-31） */
function npcStockPool(npc: NpcCitySnapshot): Partial<Record<PlunderableKey, number>> {
  const pool: Partial<Record<PlunderableKey, number>> = {};
  for (const key of PLUNDERABLE_KEYS) {
    pool[key] = Math.max(0, Math.floor(npc.stock[key] ?? 0));
  }
  return pool;
}

/**
 * 掠夺到达（v16，task='plunder'）：野地 → 奖励池 = 地形资源 × 250 × 等级；NPC 城 →
 * 持久化库存。目标在途易主为本账号野地时转增援；其余失效按原路返回。战斗结构与
 * legacy attack 相同（野地遭遇战 / NPC 攻城战含城墙减伤）。
 */
export async function resolvePlunderArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow | null,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  // 自有野地：掠夺语义失效（发起后被本账号占领）→ 增援驻军，不战斗
  if (tile?.kind === 'wilderness' && tile.owner_city_id && (await isOwnCity(client, tile.owner_city_id, march.account_id))) {
    await reinforceTile(client, march, troops, tile, notifies);
    return;
  }
  // v38（AISLG-122）：他人城池 → 玩家攻城结算（守城战 + 掠夺 + 免战；委托 pvp-raid）
  if (tile?.kind === 'city' && tile.owner_city_id && !(await isOwnCity(client, tile.owner_city_id, march.account_id))) {
    await resolvePvpPlunderArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  const npc = tile?.kind === 'npc_city' ? (tile.npc as NpcCitySnapshot | null) : null;
  const wildernessTarget = tile?.kind === 'wilderness' && !tile.owner_city_id;
  if (!wildernessTarget && !npc) {
    // 目标失效（他人占领 / 转为城池 / 快照缺失 / 地块消失）：不战斗，原路返回
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  const target = tile as TileRow;
  if (npc?.famous && famousStage(npc.famous, new Date()) === 'outer') {
    // v24（AISLG-56）名城外围阶段：出征打外围驻军（清空后进入城守阶段），无战利品
    await resolveFamousOuterArrival(client, march, troops, target, settled, notifies);
    return;
  }

  // 战斗（结构同 legacy attack：野地遭遇战 / NPC 攻城战）
  const defender: Partial<Record<TroopKind, number>> = npc ? npc.garrison : await loadNativeGarrison(client, target);
  const wall = npc ? wallDefensePercent((npc.buildings?.wall as number | undefined) ?? 0) : 0;
  // v36（AISLG-114）：随队武将加成（按部队规模折算）
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, defender, {
    wallDefensePercent: wall,
    siege: npc !== null,
    attackerHero: hero?.engine ?? null,
  });
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  if (!npc) {
    // 野地原住守军战后存量落库，之后按小时恢复（v24 AISLG-48）
    await saveNativeGarrison(client, target, result.defender.survivors);
  }
  const naming = await loadCityNaming(client, march.from_city_id);
  const attackerName = naming ? `${naming.username} · ${naming.cityName}` : '出征部队';
  const defenderName = npc ? `NPC 城池 Lv${target.level}` : `野地 Lv${target.level}（${TERRAIN_INFO[target.terrain].label}）`;
  const reportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon,
    npc ? 'npc_city' : 'wilderness',
    target.x, target.y, result, attackerName, defenderName, wall, notifies, hero?.report ?? null,
  );

  if (!result.attackerWon) {
    // 战败：幸存部队撤回出发城（v15 语义）；连胜计数清零（v23 AISLG-60）
    await recordWinStreak(client, march.account_id, false, {});
    await markMarchArrived(client, march.id);
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

  // 连胜计数（v23 AISLG-60）：达到 5 的整数倍时写一条全服播报（限频内）
  const streakBroadcast = await recordWinStreak(client, march.account_id, true, {
    username: naming?.username ?? null,
    cityName: naming?.cityName ?? null,
  });
  if (streakBroadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streakBroadcast });
  }

  // 胜利：按幸存部队的负重从奖励池装填（冷却内到达 → 收益为零，战斗照常结算）
  const now = await dbNow(client);
  const carry = armyCarryCapacity(result.attacker.survivors, carryingPercent(await loadTechLevels(client, march.account_id)));
  const pool = npc ? npcStockPool(npc) : wildernessPlunderPool(target.terrain, target.level);
  const loot = inPlunderCooldown(target.plundered_at, now)
    ? { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 }
    : loadByCarry(carry, pool);
  const lootView = toResources(loot);
  if (settled.row && lootTotal(loot) > 0) {
    await creditLoot(client, march.from_city_id, lootView);
    // 累计掠夺台账（v23 AISLG-61）：四资源合计（金不计），记在账号上
    await client.query(`UPDATE accounts SET plunder_total = plunder_total + $2 WHERE id = $1`, [
      march.account_id,
      loot.food + loot.wood + loot.stone + loot.iron,
    ]);
  }
  if (npc) {
    // 持久化扣减库存（防负值：装填量 ≤ 库存；v21 起金币随库存一并可掠）
    const stock: Resources = { ...npc.stock };
    for (const key of PLUNDERABLE_KEYS) {
      stock[key] = Math.max(0, Math.floor((npc.stock[key] ?? 0) - loot[key]));
    }
    await client.query(
      `UPDATE world_tiles SET npc = $3::jsonb, plundered_at = $4 WHERE x = $1 AND y = $2`,
      [target.x, target.y, JSON.stringify({ ...npc, stock }), now],
    );
    // 掠空播报（v23 AISLG-60）：库存四资源 + 金币全部归零
    const emptied = PLUNDERABLE_KEYS.every((key) => (stock[key] ?? 0) <= 0);
    if (emptied) {
      const broadcast = await insertServerBroadcast(client, 'npc_city_emptied', {
        username: naming?.username ?? null,
        cityName: naming?.cityName ?? null,
        x: target.x,
        y: target.y,
        level: target.level,
      });
      if (broadcast) {
        notifies.push({ reason: 'server_broadcast', accountId: '', broadcast });
      }
    }
  } else {
    // 冷却：胜利即更新（无论收益是否为 0，占位决策见 plunder.ts）
    await client.query(
      `UPDATE world_tiles SET plundered_at = $3 WHERE x = $1 AND y = $2`,
      [target.x, target.y, now],
    );
  }
  await markMarchArrived(client, march.id);
  // 幸存部队返程（掠夺不改归属、不留驻军）；全灭胜（幸存 0）无返程
  const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
  await completeMarchEvent(client, march, 'plunder_won', {
    troops,
    survivors: result.attacker.survivors,
    losses: result.attacker.losses,
    loot: lootView,
    carry,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(defender),
    reportId,
    returning,
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}

/**
 * 占领到达（v16，task='occupy'）：仅无主野地。胜利且该城占领野地数低于官府等级时
 * 改归属、幸存驻守并获得持续加成；超限（发起后经增援 / 占领他块抬升）则不改归属、
 * 幸存部队返程并记录 occupied=false / denial=TERRITORY_LIMIT。无一次性战利品。
 * 战败与目标失效的处理与掠夺一致。
 */
export async function resolveOccupyArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow | null,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  // 自有野地：占领语义失效（发起后被本账号占领）→ 增援驻军，不战斗
  if (tile?.kind === 'wilderness' && tile.owner_city_id && (await isOwnCity(client, tile.owner_city_id, march.account_id))) {
    await reinforceTile(client, march, troops, tile, notifies);
    return;
  }
  // v39（AISLG-123）：他人占领的野地 → 抢占结算（野地战 + 易主 / 名额 / 换主保护；委托 pvp-tile）
  if (tile?.kind === 'wilderness' && tile.owner_city_id && !(await isOwnCity(client, tile.owner_city_id, march.account_id))) {
    await resolvePvpOccupyArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  // v40（AISLG-124）：他人分城 → 攻城结算（守城战 + 城防值 + 归零换主；委托 pvp-conquer）
  if (tile?.kind === 'city' && tile.owner_city_id && !(await isOwnCity(client, tile.owner_city_id, march.account_id))) {
    await resolvePvpConquestArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  if (tile?.kind === 'npc_city' && tile.npc) {
    // v24（AISLG-58）：占领 NPC 城池变分城
    await resolveNpcOccupyArrival(client, march, troops, tile, settled, notifies);
    return;
  }
  if (!(tile?.kind === 'wilderness' && !tile.owner_city_id)) {
    // 目标失效（他人占领 / 转为城池 / 地块消失）：不战斗，原路返回
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  const target = tile;

  // 战斗（野地遭遇战：守方为按等级推导的原住守军）
  const defender = await loadNativeGarrison(client, target);
  // v36（AISLG-114）：随队武将加成（按部队规模折算）
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, defender, { wallDefensePercent: 0, siege: false, attackerHero: hero?.engine ?? null });
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  await saveNativeGarrison(client, target, result.defender.survivors);
  const naming = await loadCityNaming(client, march.from_city_id);
  const attackerName = naming ? `${naming.username} · ${naming.cityName}` : '出征部队';
  const defenderName = `野地 Lv${target.level}（${TERRAIN_INFO[target.terrain].label}）`;
  const reportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon,
    'wilderness', target.x, target.y, result, attackerName, defenderName, 0, notifies, hero?.report ?? null,
  );

  if (!result.attackerWon) {
    await recordWinStreak(client, march.account_id, false, {});
    await markMarchArrived(client, march.id);
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

  // 连胜计数（v23 AISLG-60）
  const occupyStreak = await recordWinStreak(client, march.account_id, true, {
    username: naming?.username ?? null,
    cityName: naming?.cityName ?? null,
  });
  if (occupyStreak) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: occupyStreak });
  }
  // 金矿首占（v23 AISLG-60）：全服一次性（settings 占位键，占下第一块金矿才写入）
  if (target.terrain === 'gold_mine') {
    const first = await client.query(
      `INSERT INTO settings (key, value) VALUES ('gold_mine_first_occupied', 'true'::jsonb)
       ON CONFLICT (key) DO NOTHING RETURNING key`,
    );
    if (first.rowCount === 1) {
      const broadcast = await insertServerBroadcast(client, 'gold_mine_first', {
        username: naming?.username ?? null,
        cityName: naming?.cityName ?? null,
        x: target.x,
        y: target.y,
      });
      if (broadcast) {
        notifies.push({ reason: 'server_broadcast', accountId: '', broadcast });
      }
    }
  }

  // 胜利：到达复核占领上限（官府等级；发起时已初核，期间可能经他块占领 / 增援变化）
  const limit = territoryLimit(await governmentLevel(client, march.from_city_id));
  const ownedRes = await client.query(
    `SELECT count(*)::int AS n FROM world_tiles WHERE owner_city_id = $1 AND kind = 'wilderness'`,
    [march.from_city_id],
  );
  const owned = (ownedRes.rows[0] as { n: number }).n;
  if (owned >= limit) {
    // 超限：不改归属，幸存部队返程（事件记录拒绝原因）
    await markMarchArrived(client, march.id);
    const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_won', {
      troops,
      survivors: result.attacker.survivors,
      losses: result.attacker.losses,
      occupied: false,
      denial: 'TERRITORY_LIMIT',
      territory: owned,
      limit,
      rounds: result.rounds,
      endReason: result.endReason,
      attackerPower: armyPower(troops),
      defenderPower: armyPower(defender),
      reportId,
      returning,
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 未超限：改归属、幸存驻守、持续加成生效（无一次性战利品）；原住守军存量作废
  await clearNativeGarrison(client, target);
  await addTileArmy(client, target.x, target.y, result.attacker.survivors);
  await client.query(
    `UPDATE world_tiles SET owner_city_id = $3 WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
    [target.x, target.y, march.from_city_id],
  );
  await markMarchArrived(client, march.id);
  const survivorTotal = Object.values(result.attacker.survivors).reduce((sum, n) => sum + n, 0);
  await completeMarchEvent(client, march, 'battle_won', {
    troops,
    survivors: result.attacker.survivors,
    losses: result.attacker.losses,
    occupied: true,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(defender),
    reportId,
  });
  await insertEvent(client, {
    accountId: march.account_id,
    cityId: march.from_city_id,
    type: EventType.WILDERNESS_OCCUPIED,
    initiator: march.initiator as InitiatorRole,
    detail: {
      x: target.x,
      y: target.y,
      terrain: target.terrain,
      level: target.level,
      resource: TERRAIN_INFO[target.terrain].resource,
      bonusRate: wildernessBonusRate(target.terrain, target.level),
      gatherRate: wildernessGatherRate(target.terrain, target.level, survivorTotal),
    },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: target.x, y: target.y, tileReason: 'wilderness_occupied' });
}
