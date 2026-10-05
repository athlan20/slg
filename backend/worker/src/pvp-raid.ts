// 玩家攻打玩家城的结算（v38，AISLG-122「玩家对抗（一）」）。从 plunder-tick 拆出：
// purpose='plunder' 且目标为他人城池时由 resolvePlunderArrival 委托到本文件。设计：
// - 调用方（world-tick）已按锁序 出发城 → 目标城（settlePvpTarget 预结算并锁定）→ 地块 加锁；
// - 到达先在锁内复核目标保护 / 免战（发起后目标可能进入新手保护或免战）：不战斗，
//   部队扑空原路返程（事件 outcome='aborted' 并记原因与截止时刻）；
// - 战斗走守城战（与 NPC 袭城同引擎口径）：城墙 + 城防科技 + 箭塔 + 守方城守 + 攻方
//   随队武将全部生效；攻守双方各得一份战报（kind='pvp_raid'）；
// - 攻方胜利：可抢池 = pvpPlunderPool（仓库保护 → 单次比例上限 → 等级差衰减），
//   按幸存部队负重装填（金→粮→木→石→铁）后扣减目标城、入账出发城；目标城进入
//   被动免战 4 小时（玩家与 NPC 共用 cities.truce_until）；守方收到 pvp_raid 事件；
// - 攻方战败：幸存部队撤回出发城，守方守住计连胜（与 NPC 袭城同口径）；
// - 主城与分城同样可打；本条不改归属、不占领（占领玩家城随后续阶段）。

import pg from 'pg';
import { EventType, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, resolveBattle, wallDefensePercent } from '../../common/src/battle';
import { armyCarryCapacity } from '../../common/src/troops';
import { carryingPercent, defenseExtraPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { towerStats } from '../../common/src/building-effects';
import { loadBuildingLevels } from '../../common/src/production';
import { loadByCarry } from '../../common/src/plunder';
import {
  PVP_CITY_TRUCE_MS,
  inNewbieProtection,
  inTruce,
  pvpPlunderPool,
} from '../../common/src/protection';
import { scaledMs } from '../../common/src/time-scale';
import { insertServerBroadcast, recordWinStreak } from '../../common/src/server-broadcast';
import { battleBonusOf, grantHeroExp, loadCityGuard } from '../../common/src/hero-db';
import { armyTotal } from '../../common/src/hero';
import { type TileRow } from '../../common/src/world-db';
import {
  abortMarchToReturn,
  completeMarchEvent,
  createReturnMarch,
  creditLoot,
  heroBattleView,
  loadCityNaming,
  loadMarchHeroBonus,
  markMarchArrived,
  saveBattleReport,
  settleMarchHero,
  type MarchRow,
  type TileNotify,
} from './tick-shared';

/** 事务内统一时间源 */
async function dbNow(client: pg.PoolClient): Promise<Date> {
  const res = await client.query(`SELECT now() AS now`);
  return res.rows[0].now as Date;
}

/** 出发城 / 目标城的官府等级（等级差衰减用；每城注册自带 1 级官府，异常缺行按 1 兜底） */
async function governmentLevel(client: pg.PoolClient, cityId: string): Promise<number> {
  const levels = await loadBuildingLevels(client, cityId);
  return Math.max(1, levels.government);
}

/**
 * 玩家掠夺玩家城的到达结算。tile 为 kind='city' 且城主非本账号（plunder-tick 已判定）。
 * 目标城的生产已由 world-tick 的 settlePvpTarget 结算到到达时刻并锁定（锁序）。
 */
export async function resolvePvpPlunderArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const now = await dbNow(client);
  const cityRes = await client.query(
    `SELECT c.id, c.account_id, c.truce_until, c.gold, c.wood, c.food, c.stone, c.iron,
            a.username, a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1 AND c.x = $2 AND c.y = $3`,
    [tile.owner_city_id, tile.x, tile.y],
  );
  const city = cityRes.rows[0] as
    | {
        id: string; account_id: string; truce_until: Date | null;
        gold: number; wood: number; food: number; stone: number; iron: number;
        username: string; newbie_until: Date | null; self_truce_until: Date | null;
      }
    | undefined;
  if (!city || city.account_id === march.account_id) {
    // 城已删（重置）或发起后转为本账号分城：目标失效，原路返回
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  // 锁内复核保护 / 免战（同一城多支部队先后到达：前一支攻破触发免战后，后到的扑空返程）
  if (inNewbieProtection(city.newbie_until, now)) {
    await abortProtected(client, march, troops, settled, notifies, 'NEWBIE_PROTECTED', city.newbie_until);
    return;
  }
  if (inTruce(city.truce_until, city.self_truce_until, now)) {
    const until = city.truce_until && city.truce_until > now ? city.truce_until : city.self_truce_until;
    await abortProtected(client, march, troops, settled, notifies, 'TARGET_IN_TRUCE', until);
    return;
  }

  // 守城战（引擎口径与 NPC 袭城一致）：守军贴墙，城墙 + 城防科技 + 箭塔 + 城守加成；
  // 攻方带随队武将
  const levels = await loadBuildingLevels(client, city.id);
  const armyRes = await client.query(
    `SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`,
    [city.id],
  );
  const garrison: Partial<Record<TroopKind, number>> = {};
  for (const row of armyRes.rows as { troop: TroopKind; count: number }[]) {
    garrison[row.troop] = row.count;
  }
  const wall = wallDefensePercent(levels.wall ?? 0, await defenseBonusOfDefender(client, city.account_id));
  const guard = await loadCityGuard(client, city.id);
  const garrisonTotal = Object.values(garrison).reduce((sum, n) => sum + (n ?? 0), 0);
  const guardBonus = battleBonusOf(guard, garrisonTotal);
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, garrison, {
    wallDefensePercent: wall,
    siege: true,
    tower: towerStats(levels.arrow_tower ?? 0),
    attackerHero: hero?.engine ?? null,
    defenderHero: guardBonus,
  });

  // 双方战报（每账号一份，各自视角）与命名
  const attackerNaming = await loadCityNaming(client, march.from_city_id);
  const attackerName = attackerNaming ? `${attackerNaming.username} · ${attackerNaming.cityName}` : '出征部队';
  const cityNameRes = await client.query(`SELECT name FROM cities WHERE id = $1`, [city.id]);
  const targetCityName = (cityNameRes.rows[0] as { name: string } | undefined)?.name ?? '城池';
  const defenderName = `${city.username} 的守军（${targetCityName}${guard ? ` · 城守 ${guard.name}` : ''}）`;
  const guardView = guard ? heroBattleView(guard, garrisonTotal) : null;
  const attackerReportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon, 'pvp_raid',
    tile.x, tile.y, result, attackerName, defenderName, wall, notifies, hero?.report ?? null, guardView,
  );
  const defenderReportId = await saveBattleReport(
    client, city.account_id, 'defender', !result.attackerWon, 'pvp_raid',
    tile.x, tile.y, result, attackerName, defenderName, wall, notifies, hero?.report ?? null, guardView,
  );

  // 攻方随队武将结算（经验 / 战败重伤）；守方城守获得经验（守不住减半）
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  if (guard) {
    const gained = Math.floor(armyPower(result.attacker.losses) * (result.attackerWon ? 0.5 : 1));
    const exp = await grantHeroExp(client, guard.id, gained);
    if (exp?.leveledTo) {
      await insertEvent(client, {
        accountId: city.account_id, cityId: city.id, buildId: guard.id,
        type: EventType.HERO_LEVEL_UP, initiator: null,
        detail: { heroId: guard.id, heroName: guard.name, level: exp.leveledTo },
      });
    }
    notifies.push({
      reason: 'hero_state', accountId: city.account_id,
      data: { reason: 'exp_gained', heroId: guard.id, exp: { gained, level: exp?.level ?? guard.level, leveledTo: exp?.leveledTo ?? null } },
    });
  }

  // 驻军按战斗结果回写（全灭即清空；守住按幸存数）
  await client.query(`DELETE FROM city_army WHERE city_id = $1`, [city.id]);
  for (const kind of Object.keys(result.defender.survivors) as TroopKind[]) {
    const count = result.defender.survivors[kind] ?? 0;
    if (count > 0) {
      await client.query(
        `INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`,
        [city.id, kind, count],
      );
    }
  }

  const attackerPower = armyPower(troops);
  const defenderPower = armyPower(garrison);

  if (!result.attackerWon) {
    // 攻方战败：幸存部队撤回出发城；守方守住计连胜 + 播报（连胜满 5 场才出，与 NPC 袭城同口径）
    await recordWinStreak(client, march.account_id, false, {});
    const streak = await recordWinStreak(client, city.account_id, true, {
      username: city.username,
      cityName: targetCityName,
    });
    if (streak) {
      notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streak });
    }
    await markMarchArrived(client, march.id);
    const retreating = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_lost', {
      troops,
      losses: result.attacker.losses,
      survivors: result.attacker.survivors,
      returning: retreating,
      rounds: result.rounds,
      endReason: result.endReason,
      attackerPower,
      defenderPower,
      reportId: attackerReportId,
      target: { username: city.username, cityId: city.id, cityName: targetCityName },
      ...(heroSettle ? { heroExp: heroSettle } : {}),
    });
    await insertEvent(client, {
      accountId: city.account_id,
      cityId: city.id,
      type: EventType.PVP_RAID,
      initiator: null,
      detail: {
        x: tile.x, y: tile.y, target: 'city',
        outcome: 'repelled',
        attacker: { username: attackerNaming?.username ?? null, cityId: march.from_city_id, cityName: attackerNaming?.cityName ?? null },
        losses: result.defender.losses,
        rounds: result.rounds,
        attackerPower, defenderPower,
        reportId: defenderReportId,
      },
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 攻方胜利：连胜计数 + 清零守方连胜
  const streakBroadcast = await recordWinStreak(client, march.account_id, true, {
    username: attackerNaming?.username ?? null,
    cityName: attackerNaming?.cityName ?? null,
  });
  if (streakBroadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streakBroadcast });
  }
  await recordWinStreak(client, city.account_id, false, {});

  // 掠夺：可抢池 = 仓库保护 → 单次比例上限（四资源 30% / 金币 10%）→ 等级差衰减，
  // 再按幸存部队负重装填；一次性扣减、不改归属
  const attackerGov = await governmentLevel(client, march.from_city_id);
  const defenderGov = await governmentLevel(client, city.id);
  const pool = pvpPlunderPool(
    { gold: city.gold, wood: city.wood, food: city.food, stone: city.stone, iron: city.iron },
    levels.warehouse ?? 0,
    attackerGov,
    defenderGov,
  );
  const carry = armyCarryCapacity(result.attacker.survivors, carryingPercent(await loadTechLevels(client, march.account_id)));
  const loot = loadByCarry(carry, pool);
  const truceUntil = new Date(now.getTime() + scaledMs(PVP_CITY_TRUCE_MS));
  await client.query(
    `UPDATE cities SET gold = gold - $2, wood = wood - $3, food = food - $4,
            stone = stone - $5, iron = iron - $6, truce_until = $7 WHERE id = $1`,
    [city.id, loot.gold, loot.wood, loot.food, loot.stone, loot.iron, truceUntil],
  );
  if (settled.row) {
    await creditLoot(client, march.from_city_id, loot);
  }
  // 累计掠夺台账（排行榜「比掠夺」）：四资源合计（金不计），玩家互掠同样计入
  await client.query(`UPDATE accounts SET plunder_total = plunder_total + $2 WHERE id = $1`, [
    march.account_id,
    loot.food + loot.wood + loot.stone + loot.iron,
  ]);

  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
  await completeMarchEvent(client, march, 'plunder_won', {
    troops,
    survivors: result.attacker.survivors,
    losses: result.attacker.losses,
    loot,
    carry,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower,
    defenderPower,
    reportId: attackerReportId,
    returning,
    target: { username: city.username, cityId: city.id, cityName: targetCityName },
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  });
  await insertEvent(client, {
    accountId: city.account_id,
    cityId: city.id,
    type: EventType.PVP_RAID,
    initiator: null,
    detail: {
      x: tile.x, y: tile.y, target: 'city',
      outcome: 'garrison_lost',
      attacker: { username: attackerNaming?.username ?? null, cityId: march.from_city_id, cityName: attackerNaming?.cityName ?? null },
      loot,
      truceUntil: truceUntil.toISOString(),
      losses: result.defender.losses,
      rounds: result.rounds,
      attackerPower, defenderPower,
      reportId: defenderReportId,
    },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}

/** 目标受保护 / 免战：不战斗，部队扑空原路返程并记录原因与截止时刻 */
async function abortProtected(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  reason: 'NEWBIE_PROTECTED' | 'TARGET_IN_TRUCE',
  until: Date | null,
): Promise<void> {
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, troops, settled, march.initiator);
  await completeMarchEvent(client, march, 'aborted', {
    troops,
    returning,
    cause: reason,
    ...(until ? { until: until.toISOString() } : {}),
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}

/** 守方的城墙减伤（城墙等级 + 城防科技） */
async function defenseBonusOfDefender(client: pg.PoolClient, accountId: string): Promise<number> {
  return defenseExtraPercent(await loadTechLevels(client, accountId));
}
