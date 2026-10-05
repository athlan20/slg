// 玩家占领玩家分城的结算（v40，AISLG-124「玩家对抗（三）」）。从 plunder-tick 拆出：
// purpose='occupy' 且目标为他人分城（主城发起时已被拒）时由 resolveOccupyArrival 委托。
// 设计：
// - 守城战与掠夺同口径（城墙 + 城防科技 + 箭塔 + 守方城守 + 攻方随队武将）；
// - 打赢（守军全灭）不掠夺资源：按 settleDurability 结算回涨后扣城防伤害
//   （基础 35 + 冲车占比加成最多 +15），城防 > 0 时只降值并进入 4 小时被动免战
//   （免战期内不回涨，结束后每小时回涨 10——占一座分城至少打 3 次隔 8 小时）；
// - 城防归零且攻方名额仍有空：当场换主（transferCityOwnership）；名额没了照打、
//   只降城防值不换主（occupied=false / denial=TERRITORY_LIMIT）；城防是城自己的，
//   补刀者得城；打输：守方续占、攻方残部返程；
// - 换主事务（单函数，锁序沿用 cities → world_tiles）：建筑（含等级）与剩余资源
//   归新主人、城防回满并进入 6 小时保护；排队中的建造 / 征兵 / 该城的研究与酒馆
//   候选作废不退资源；城守卸任（武将仍归原主人）；该城野地全部变无主、驻军回
//   原主人主城；该城在外的部队改从原主人主城返程；原主人指向该城的在途运输 /
//   调兵到达时按既有失效路径原路返回；针对该城的 NPC 袭击作废；原主人失城通知、
//   新主人得城通知、全服播报一条；名城加成（famous_name）跟着城走。

import pg from 'pg';
import { EventType, type InitiatorRole, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, resolveBattle, wallDefensePercent } from '../../common/src/battle';
import { defenseExtraPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { towerStats } from '../../common/src/building-effects';
import { loadBuildingLevels } from '../../common/src/production';
import { checkOccupyNpcCity } from '../../common/src/branch-city';
import { loadBranchStanding } from '../../common/src/branch-city-db';
import {
  CITY_CONQUEST_PROTECTION_MS,
  DURABILITY_MAX,
  PVP_CITY_TRUCE_MS,
  inNewbieProtection,
  inTruce,
  siegeDamage,
  settleDurability,
} from '../../common/src/protection';
import { scaledMs } from '../../common/src/time-scale';
import { insertServerBroadcast, recordWinStreak } from '../../common/src/server-broadcast';
import { battleBonusOf, grantHeroExp, loadCityGuard } from '../../common/src/hero-db';
import { armyTotal } from '../../common/src/hero';
import { loadTileArmy } from '../../common/src/world-db';
import type { TileRow } from '../../common/src/world-db';
import {
  completeMarchEvent,
  createReturnMarch,
  heroBattleView,
  loadMarchHeroBonus,
  markMarchArrived,
  saveBattleReport,
  settleMarchHero,
  troopsEnterCity,
  type MarchRow,
  type TileNotify,
} from './tick-shared';

/** 事务内统一时间源 */
async function dbNow(client: pg.PoolClient): Promise<Date> {
  const res = await client.query(`SELECT now() AS now`);
  return res.rows[0].now as Date;
}

/** 攻城到达结算：tile 为 kind='city' 且城主非本账号（plunder-tick 已判定）。
 *  目标城与守方主城已由 world-tick 的 settleConquestTargets 在地块加锁前锁定并结算生产。 */
export async function resolvePvpConquestArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const now = await dbNow(client);
  const cityRes = await client.query(
    `SELECT c.id, c.account_id, c.truce_until, a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1 AND c.x = $2 AND c.y = $3`,
    [tile.owner_city_id, tile.x, tile.y],
  );
  const city = cityRes.rows[0] as
    | { id: string; account_id: string; truce_until: Date | null; newbie_until: Date | null; self_truce_until: Date | null }
    | undefined;
  if (!city || city.account_id === march.account_id) {
    // 城已删（重置）或发起后转为本账号分城：目标失效，原路返回
    await abortConquest(client, march, troops, settled, notifies, 'target_gone', null);
    return;
  }
  // 锁内复核保护 / 免战（与掠夺同规则：新手保护 / 被动免战 / 主动免战）
  if (inNewbieProtection(city.newbie_until, now)) {
    await abortConquest(client, march, troops, settled, notifies, 'NEWBIE_PROTECTED', city.newbie_until);
    return;
  }
  if (inTruce(city.truce_until, city.self_truce_until, now)) {
    const until = city.truce_until && city.truce_until > now ? city.truce_until : city.self_truce_until;
    await abortConquest(client, march, troops, settled, notifies, 'TARGET_IN_TRUCE', until);
    return;
  }

  // 守城战（与掠夺玩家城同口径）
  const levels = await loadBuildingLevels(client, city.id);
  const armyRes = await client.query(
    `SELECT troop, count FROM city_army WHERE city_id = $1 AND count > 0`,
    [city.id],
  );
  const garrison: Partial<Record<TroopKind, number>> = {};
  for (const row of armyRes.rows as { troop: TroopKind; count: number }[]) {
    garrison[row.troop] = row.count;
  }
  const wall = wallDefensePercent(levels.wall ?? 0, defenseExtraPercent(await loadTechLevels(client, city.account_id)));
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

  const attackerNaming = await loadNaming(client, march.from_city_id);
  const defenderNaming = await loadNaming(client, city.id);
  const attackerName = attackerNaming ? `${attackerNaming.username} · ${attackerNaming.cityName}` : '出征部队';
  const defenderName = defenderNaming
    ? `${defenderNaming.username} 的守军（${defenderNaming.cityName}${guard ? ` · 城守 ${guard.name}` : ''}）`
    : '守军';
  const guardView = guard ? heroBattleView(guard, garrisonTotal) : null;
  const attackerReportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon, 'pvp_conquest',
    tile.x, tile.y, result, attackerName, defenderName, wall, notifies, hero?.report ?? null, guardView,
  );
  const defenderReportId = await saveBattleReport(
    client, city.account_id, 'defender', !result.attackerWon, 'pvp_conquest',
    tile.x, tile.y, result, attackerName, defenderName, wall, notifies, hero?.report ?? null, guardView,
  );
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  // 守方城守经验（守不住减半；与守城战同口径）
  if (guard) {
    const gained = Math.floor(armyPower(result.attacker.losses) * (result.attackerWon ? 0.5 : 1));
    const exp = await grantGuardExp(client, city.account_id, city.id, guard.id, guard.name, gained);
    notifies.push({
      reason: 'hero_state', accountId: city.account_id,
      data: { reason: 'exp_gained', heroId: guard.id, exp },
    });
  }

  // 驻军按战斗结果回写（全灭即清空；守住按幸存数）
  await client.query(`DELETE FROM city_army WHERE city_id = $1`, [city.id]);
  for (const kind of Object.keys(result.defender.survivors) as TroopKind[]) {
    const count = result.defender.survivors[kind] ?? 0;
    if (count > 0) {
      await client.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`, [city.id, kind, count]);
    }
  }

  const attackerPower = armyPower(troops);
  const defenderPower = armyPower(garrison);
  const base = {
    troops,
    losses: result.attacker.losses,
    survivors: result.attacker.survivors,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower,
    defenderPower,
    reportId: attackerReportId,
    target: { username: defenderNaming?.username ?? null, cityId: city.id, cityName: defenderNaming?.cityName ?? null },
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  };

  if (!result.attackerWon) {
    await recordWinStreak(client, march.account_id, false, {});
    const streak = await recordWinStreak(client, city.account_id, true, {
      username: defenderNaming?.username ?? null,
      cityName: defenderNaming?.cityName ?? null,
    });
    if (streak) {
      notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streak });
    }
    await markMarchArrived(client, march.id);
    const retreating = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_lost', { ...base, returning: retreating });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 攻方胜利：连胜计攻方、清零守方
  const streakBroadcast = await recordWinStreak(client, march.account_id, true, {
    username: attackerNaming?.username ?? null,
    cityName: attackerNaming?.cityName ?? null,
  });
  if (streakBroadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streakBroadcast });
  }
  await recordWinStreak(client, city.account_id, false, {});

  // 城防结算：先惰性回涨再扣伤害（冲车按幸存占比加成）；占领不掠夺资源
  const durabilityRow = await client.query(
    `SELECT durability, durability_settled_at, truce_until FROM cities WHERE id = $1`,
    [city.id],
  );
  const dRow = durabilityRow.rows[0] as { durability: number | null; durability_settled_at: Date | null; truce_until: Date | null };
  const before = settleDurability(dRow.durability, dRow.durability_settled_at, dRow.truce_until, now);
  let survivorTotal = 0;
  let ramCount = 0;
  for (const [kind, count] of Object.entries(result.attacker.survivors)) {
    survivorTotal += count ?? 0;
    if (kind === 'siege_ram') {
      ramCount += count ?? 0;
    }
  }
  const { damage, ramBonus } = siegeDamage(ramCount, survivorTotal);
  const after = Math.max(0, before - damage);

  // 到达复核攻方名额（发起后可能经他城占领 / 失守变化）：名额没了照打、只降城防值
  const standing = await loadBranchStanding(client, march.account_id);
  const fromLevels = await loadBuildingLevels(client, march.from_city_id);
  const targetGovRes = await client.query(
    `SELECT COALESCE(g.level, 0)::int AS level FROM city_buildings g WHERE g.city_id = $1 AND g.kind = 'government'`,
    [city.id],
  );
  const targetLevel = targetGovRes.rowCount ? (targetGovRes.rows[0] as { level: number }).level : 0;
  const denial = checkOccupyNpcCity({
    mainGovernment: standing.mainGovernment,
    fromGovernment: fromLevels.government,
    branchCount: standing.branchCount,
    targetLevel,
  });

  if (after > 0) {
    // 只降城防值：写新值与结算时刻，城进入 4 小时被动免战（免战期内不回涨）
    const truceUntil = new Date(now.getTime() + scaledMs(PVP_CITY_TRUCE_MS));
    await client.query(
      `UPDATE cities SET durability = $2, durability_settled_at = $3, truce_until = $4 WHERE id = $1`,
      [city.id, after, now, truceUntil],
    );
    await markMarchArrived(client, march.id);
    const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_won', {
      ...base,
      occupied: false,
      ...(denial ? { denial } : {}),
      conquest: { before, damage, ramBonus, after, protectedUntil: truceUntil.toISOString() },
      returning,
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
        conquest: { before, damage, ramBonus, after, protectedUntil: truceUntil.toISOString() },
        losses: result.defender.losses,
        rounds: result.rounds,
        attackerPower, defenderPower,
        reportId: defenderReportId,
      },
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    notifies.push({ reason: 'tile_changed', accountId: city.account_id, x: tile.x, y: tile.y, tileReason: 'city_durability_hit' });
    return;
  }

  // 城防归零：名额没了只降到 0（下一次可打时回涨后仍为 0 起），有名额当场换主
  await markMarchArrived(client, march.id);
  if (denial) {
    const truceUntil = new Date(now.getTime() + scaledMs(PVP_CITY_TRUCE_MS));
    await client.query(
      `UPDATE cities SET durability = 0, durability_settled_at = $2, truce_until = $3 WHERE id = $1`,
      [city.id, now, truceUntil],
    );
    const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_won', {
      ...base,
      occupied: false,
      denial,
      conquest: { before, damage, ramBonus, after: 0, protectedUntil: truceUntil.toISOString() },
      returning,
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
        conquest: { before, damage, ramBonus, after: 0, protectedUntil: truceUntil.toISOString() },
        losses: result.defender.losses,
        rounds: result.rounds,
        attackerPower, defenderPower,
        reportId: defenderReportId,
      },
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // ---- 换主 ----
  const conquest = await transferCityOwnership(client, march, city.id, result.attacker.survivors, tile, now, notifies);
  await completeMarchEvent(client, march, 'battle_won', {
    ...base,
    occupied: true,
    conquest: {
      before, damage, ramBonus, after: 0,
      durability: DURABILITY_MAX,
      protectedUntil: conquest.protectedUntil.toISOString(),
      transferred: true,
    },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile.x, y: tile.y, tileReason: 'city_conquered' });
  notifies.push({ reason: 'tile_changed', accountId: city.account_id, x: tile.x, y: tile.y, tileReason: 'city_conquered' });
}

/** 换主事务（调用方事务内）：资产移交 + 清理 + 双方通知 + 全服播报。
 *  前置：目标城与守方主城已在地块加锁前由 settleConquestTargets 锁定。 */
async function transferCityOwnership(
  client: pg.PoolClient,
  march: MarchRow,
  cityId: string,
  survivors: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  now: Date,
  notifies: TileNotify[],
): Promise<{ protectedUntil: Date }> {
  const cityRes = await client.query(
    `SELECT c.account_id, c.name, a.username FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [cityId],
  );
  const cityRow = cityRes.rows[0] as { account_id: string; name: string; username: string };
  const prevOwnerAccountId = cityRow.account_id;
  const mainRes = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
    [prevOwnerAccountId],
  );
  const prevOwnerMainCityId = (mainRes.rows[0] as { id: string }).id;
  const prevOwnerAccountIdFinal = prevOwnerAccountId;
  const attackerNaming = await loadNaming(client, march.from_city_id);
  const attackerUsername = attackerNaming?.username ?? null;

  // 该城野地全部变无主，驻军回原主人主城（已预锁）
  const territoryRes = await client.query(
    `SELECT x, y, terrain, level FROM world_tiles WHERE owner_city_id = $1 AND kind = 'wilderness'`,
    [cityId],
  );
  for (const row of territoryRes.rows as Array<{ x: number; y: number; terrain: string; level: number }>) {
    const garrison = await loadTileArmy(client, row.x, row.y);
    if (Object.values(garrison).some((count) => (count ?? 0) > 0)) {
      await troopsEnterCity(client, prevOwnerMainCityId, garrison);
    }
    await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [row.x, row.y]);
    await client.query(
      `UPDATE world_tiles SET owner_city_id = NULL, owner_changed_until = NULL WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
      [row.x, row.y],
    );
    // 原主人收到每块野地的失地通知（与 v39 抢野地同口径）
    await insertEvent(client, {
      accountId: prevOwnerAccountIdFinal,
      cityId: prevOwnerMainCityId,
      type: EventType.WILDERNESS_LOST,
      initiator: null,
      detail: {
        x: row.x, y: row.y, cause: 'conquest', terrain: row.terrain, level: row.level,
        attacker: { username: attackerUsername },
        withCity: { id: cityId, name: cityRow.name },
      },
    });
    notifies.push({ reason: 'tile_changed', accountId: prevOwnerAccountIdFinal, x: row.x, y: row.y, tileReason: 'wilderness_lost' });
  }

  // 该城在外的部队：改从原主人主城返程归属（返程 / 结算落点随之回主城）
  await client.query(
    `UPDATE marches SET from_city_id = $2 WHERE from_city_id = $1 AND status = 'marching' AND id <> $3`,
    [cityId, prevOwnerMainCityId, march.id],
  );

  // 作废：排队 / 在建的建造、征兵、该城发起的研究、酒馆候选（不退资源）；针对该城的 NPC 袭击
  await client.query(`DELETE FROM builds WHERE city_id = $1`, [cityId]);
  await client.query(`DELETE FROM recruits WHERE city_id = $1`, [cityId]);
  await client.query(`DELETE FROM tech_research WHERE city_id = $1`, [cityId]);
  await client.query(`DELETE FROM tavern_candidates WHERE city_id = $1`, [cityId]);
  await client.query(
    `UPDATE npc_attacks SET resolved_at = clock_timestamp() WHERE target_city_id = $1 AND resolved_at IS NULL`,
    [cityId],
  );

  // 城行：换主 + 城守卸任（武将仍归原主人）+ 城防回满 + 6 小时保护；建筑 / 资源 / 名城名保留
  const protectedUntil = new Date(now.getTime() + scaledMs(CITY_CONQUEST_PROTECTION_MS));
  await client.query(
    `UPDATE cities SET account_id = $2, guard_hero_id = NULL, durability = $3, durability_settled_at = $4,
            truce_until = $5, settled_at = $6, mutiny_next_at = NULL, starve_warned_at = NULL
     WHERE id = $1`,
    [cityId, march.account_id, DURABILITY_MAX, now, protectedUntil, now],
  );
  // 攻方幸存部队进城驻守
  await troopsEnterCity(client, cityId, survivors);

  // 原主人失城 / 新主人得城 + 全服播报（必达）
  await insertEvent(client, {
    accountId: prevOwnerAccountId,
    cityId: prevOwnerMainCityId,
    type: EventType.CITY_CONQUERED,
    initiator: null,
    detail: {
      outcome: 'lost',
      cityId, cityName: cityRow.name, x: tile.x, y: tile.y,
      attacker: { username: attackerUsername },
    },
  });
  await insertEvent(client, {
    accountId: march.account_id,
    cityId,
    type: EventType.CITY_CONQUERED,
    initiator: march.initiator as InitiatorRole,
    detail: {
      outcome: 'gained',
      cityId, cityName: cityRow.name, x: tile.x, y: tile.y,
      from: { username: cityRow.username },
      protectedUntil: protectedUntil.toISOString(),
      durability: DURABILITY_MAX,
    },
  });
  const broadcast = await insertServerBroadcast(client, 'city_conquered', {
    username: attackerUsername,
    cityName: cityRow.name,
    from: cityRow.username,
    x: tile.x,
    y: tile.y,
  }, { force: true });
  if (broadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast });
  }
  return { protectedUntil };
}

/** 城守经验（守城战同口径；升级事件 + 推送载荷） */
async function grantGuardExp(
  client: pg.PoolClient,
  accountId: string,
  cityId: string,
  heroId: string,
  heroName: string,
  gained: number,
): Promise<{ gained: number; level: number; leveledTo: number | null }> {
  const exp = await grantHeroExp(client, heroId, gained);
  if (exp?.leveledTo) {
    await insertEvent(client, {
      accountId, cityId, buildId: heroId,
      type: EventType.HERO_LEVEL_UP, initiator: null,
      detail: { heroId, heroName, level: exp.leveledTo },
    });
  }
  return { gained, level: exp?.level ?? 0, leveledTo: exp?.leveledTo ?? null };
}

/** 城池命名（攻守双方战报 / 事件用） */
async function loadNaming(
  client: pg.PoolClient,
  cityId: string,
): Promise<{ accountId: string; username: string; cityName: string } | null> {
  const res = await client.query(
    `SELECT c.account_id, a.username, c.name AS city_name FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
    [cityId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { account_id: string; username: string; city_name: string };
  return { accountId: row.account_id, username: row.username, cityName: row.city_name };
}

/** 目标局面已变 / 受保护：不战斗，部队扑空原路返程并记录原因 */
async function abortConquest(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  cause: string,
  until: Date | null,
): Promise<void> {
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, troops, settled, march.initiator);
  await completeMarchEvent(client, march, 'aborted', {
    troops,
    returning,
    cause,
    ...(until ? { until: until.toISOString() } : {}),
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}
