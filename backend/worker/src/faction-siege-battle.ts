// 势力围攻的到达结算（AISLG-240，v100）：守城战（城墙 / 箭塔 / 城防器械 / 城守 / 协防全生效）
// → 城防值 → 吞城。与玩家打分城（worker/src/pvp-conquer.ts）同一套城防规则，不新增数值：
// - 势力打赢（全灭守军）：扣 35 城防（围城军不带冲车，没有冲车加成），城进入 4 小时被动免战，
//   不掠夺资源；
// - 势力打输：守方续守，该势力 24 小时内不再打这座城（由 faction_sieges 的行做冷却，改选下一座）；
// - 城防归零：城被吞（worker/src/faction-swallow.ts）；
// - 目标失效（已进入免战 / 新手保护 / 城已易主 / 迁走 / 变成主城 / 已成名城）：作废不战斗。
// 锁序沿用全栈：cities → world_tiles。faction_enabled 关闭时整模块不动作。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, resolveBattle, wallDefensePercent } from '../../common/src/battle';
import { defenseExtraPercent, repairPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { towerStats } from '../../common/src/building-effects';
import { loadFamousName } from '../../common/src/famous-effects-db';
import { famousTowerPercent, famousWallExtraPercent } from '../../common/src/famous-effects';
import { loadBuildingLevels } from '../../common/src/production';
import { consumeCityDefenses, loadCityDefenses } from '../../common/src/city-defense-db';
import {
  PVP_CITY_TRUCE_MS,
  settleDurability,
  siegeDamage,
} from '../../common/src/protection';
import { scaledMs } from '../../common/src/time-scale';
import { factionBannerOf, factionDayAt, factionNameOf } from '../../common/src/faction';
import { factionSiegeDenial } from '../../common/src/faction-siege';
import { lockDueSieges, markSiegeResolved, type FactionSiegeRow } from '../../common/src/faction-siege-db';
import { getFactionEnabled } from '../../common/src/faction-config';
import { recordWinStreak } from '../../common/src/server-broadcast';
import { battleBonusOf, grantHeroExp, loadCityGuard } from '../../common/src/hero-db';
import { applyDefenseBattle, loadDefenseSetup, recordDefensePoolCasualties } from './assist-defense';
import { loadCityNaming, saveBattleReport, heroBattleView, type TileNotify } from './tick-shared';
import { swallowFactionCity } from './faction-swallow';

/** 一次结算的结果（测试与日志用） */
export type SiegeOutcomeKind = 'cancelled' | 'repelled' | 'hit' | 'swallowed';

/** 到达结算（Worker tick 调用）：取一批到期的围攻逐条结算；返回处理条数 */
export async function resolveDueFactionSieges(
  pool: pg.Pool,
  args: { now: Date; seasonStart: Date },
): Promise<number> {
  if (!getFactionEnabled()) {
    return 0;
  }
  const client = await pool.connect();
  const notifies: TileNotify[] = [];
  const pushes: Array<{ accountId: string; data: Record<string, unknown> }> = [];
  try {
    await client.query('BEGIN');
    const due = await lockDueSieges(client, args.now);
    for (const siege of due) {
      await resolveOneSiege(client, siege, args, notifies, pushes);
    }
    await client.query('COMMIT');
    for (const payload of notifies) {
      await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(payload)]);
    }
    for (const push of pushes) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'faction_siege', accountId: push.accountId, data: push.data }),
      ]);
    }
    return due.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 单条围攻的结算（调用方已 BEGIN 并锁住该行） */
export async function resolveOneSiege(
  client: pg.PoolClient,
  siege: FactionSiegeRow,
  args: { now: Date; seasonStart: Date },
  notifies: TileNotify[],
  pushes: Array<{ accountId: string; data: Record<string, unknown> }>,
): Promise<SiegeOutcomeKind> {
  const cancel = async (): Promise<SiegeOutcomeKind> => {
    await markSiegeResolved(client, { id: siege.id, outcome: 'cancelled', now: args.now });
    return 'cancelled';
  };
  const cityId = siege.city_id;
  if (!cityId) {
    return cancel();
  }
  // 锁序：先锁城池行，再锁地块行
  const cityRes = await client.query(
    `SELECT c.id, c.account_id, c.name, c.x, c.y, c.durability, c.durability_settled_at, c.truce_until,
            c.famous_name, a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1 FOR UPDATE OF c`,
    [cityId],
  );
  const city = cityRes.rows[0] as
    | {
        id: string;
        account_id: string;
        name: string;
        x: number;
        y: number;
        durability: number | null;
        durability_settled_at: Date | null;
        truce_until: Date | null;
        famous_name: string | null;
        newbie_until: Date | null;
        self_truce_until: Date | null;
      }
    | undefined;
  if (!city || city.account_id !== siege.account_id || city.x !== siege.x || city.y !== siege.y) {
    // 城已删（重置）/ 已易主 / 已迁走：目标失效，作废不战斗
    return cancel();
  }
  const tileRes = await client.query(`SELECT kind, owner_city_id FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [siege.x, siege.y]);
  const tile = tileRes.rows[0] as { kind: string; owner_city_id: string | null } | undefined;
  if (!tile || tile.kind !== 'city' || tile.owner_city_id !== cityId) {
    return cancel();
  }
  const mainRes = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
    [city.account_id],
  );
  const isMainCity = (mainRes.rows[0] as { id: string } | undefined)?.id === cityId;
  const denial = factionSiegeDenial({
    day: factionDayAt(args.seasonStart, args.now),
    isMainCity,
    famous: !!city.famous_name,
    newbieUntil: city.newbie_until,
    selfTruceUntil: city.self_truce_until,
    cityTruceUntil: city.truce_until,
    now: args.now,
  });
  if (denial) {
    return cancel();
  }

  const banner = factionBannerOf(siege.faction);
  const defenderTechs = await loadTechLevels(client, city.account_id);
  const levels = await loadBuildingLevels(client, cityId);
  const setup = await loadDefenseSetup(client, cityId, city.account_id, (accountId) => loadTechLevels(client, accountId));
  const famousName = await loadFamousName(client, cityId);
  const wall = wallDefensePercent(levels.wall ?? 0, defenseExtraPercent(defenderTechs) + famousWallExtraPercent(famousName));
  const guard = await loadCityGuard(client, cityId);
  const guardBonus = battleBonusOf(guard, setup.hostUnits);
  const defenses = await loadCityDefenses(client, cityId);
  const result = resolveBattle(siege.army, setup.merged, {
    wallDefensePercent: wall,
    siege: true,
    tower: towerStats(levels.arrow_tower ?? 0, famousTowerPercent(famousName)),
    defenderHero: guardBonus,
    defenderHeroScale: setup.heroScale,
    defenderTech: setup.defenderTech,
    defenses,
  });
  await consumeCityDefenses(client, cityId, result.defenseUse);

  const attackerName = `${factionNameOf(siege.faction)}围城军`;
  const naming = await loadCityNaming(client, cityId);
  const assistNote = setup.parties.length > 0 ? ` · 协防 ${setup.parties.length} 支` : '';
  const defenderName = naming
    ? `${naming.username} 的守军（${naming.cityName}${guard ? ` · 城守 ${guard.name}` : ''}${assistNote}）`
    : `守军${assistNote}`;
  const guardView = guard ? heroBattleView(guard, setup.hostUnits) : null;
  const assistLosses = await applyDefenseBattle(client, cityId, setup, result, notifies);
  const casualties = await recordDefensePoolCasualties(client, cityId, setup, result, assistLosses, true);
  const reportId = await saveBattleReport(
    client, city.account_id, 'defender', !result.attackerWon, 'npc_raid',
    siege.x, siege.y, result, attackerName, defenderName, wall, notifies,
    null, guardView, null, null, casualties,
  );
  for (const party of assistLosses) {
    await saveBattleReport(
      client, party.accountId, 'defender', !result.attackerWon, 'npc_raid',
      siege.x, siege.y, result, attackerName, defenderName, wall, notifies,
      null, guardView, party.losses, null, casualties,
    );
  }
  const garrisonPower = armyPower(setup.merged);
  if (guard) {
    const gained = Math.floor(armyPower(result.attacker.losses) * (result.attackerWon ? 0.5 : 1));
    const exp = await grantHeroExp(client, guard.id, gained);
    if (exp?.leveledTo) {
      await insertEvent(client, {
        accountId: city.account_id, cityId, buildId: guard.id,
        type: EventType.HERO_LEVEL_UP, initiator: null,
        detail: { heroId: guard.id, heroName: guard.name, level: exp.leveledTo },
      });
    }
    notifies.push({
      reason: 'hero_state',
      accountId: city.account_id,
      data: { reason: 'exp_gained', heroId: guard.id, exp: { gained, level: exp?.level ?? guard.level, leveledTo: exp?.leveledTo ?? null } },
    });
  }

  const baseDetail = {
    siegeId: siege.id,
    faction: banner,
    cityId,
    cityName: city.name,
    x: siege.x,
    y: siege.y,
    power: siege.power,
    garrisonPower,
    rounds: result.rounds,
    losses: result.defender.losses,
    reportId,
  };
  const recipients = [city.account_id, ...assistLosses.map((party) => party.accountId)];

  if (!result.attackerWon) {
    // 守住了：该势力 24 小时内不再打这座城（行本身就是冷却记录），改选下一座
    const streak = await recordWinStreak(client, city.account_id, true, {
      username: naming?.username ?? null,
      cityName: naming?.cityName ?? null,
    });
    if (streak) {
      notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streak });
    }
    await markSiegeResolved(client, { id: siege.id, outcome: 'repelled', now: args.now });
    const durability = settleDurability(
      city.durability, city.durability_settled_at, city.truce_until, args.now, repairPercent(defenderTechs),
    );
    await insertEvent(client, {
      accountId: city.account_id,
      cityId,
      type: EventType.FACTION_SIEGE,
      initiator: null,
      detail: { ...baseDetail, outcome: 'repelled', durability },
    });
    for (const accountId of recipients) {
      pushes.push({ accountId, data: { reason: 'repelled', ...baseDetail, durability } });
    }
    return 'repelled';
  }

  // 打赢：守方连胜清零，先惰性回涨城防，再扣一次（围城军不带冲车 → 恒 35）
  await recordWinStreak(client, city.account_id, false, {});
  const before = settleDurability(
    city.durability, city.durability_settled_at, city.truce_until, args.now, repairPercent(defenderTechs),
  );
  let survivorTotal = 0;
  for (const count of Object.values(result.attacker.survivors)) {
    survivorTotal += count ?? 0;
  }
  const { damage } = siegeDamage(0, survivorTotal);
  const after = Math.max(0, before - damage);

  if (after > 0) {
    // 只降城防：城进入 4 小时被动免战（免战期内不回涨）；不掠夺资源
    const truceUntil = new Date(args.now.getTime() + scaledMs(PVP_CITY_TRUCE_MS));
    await client.query(
      `UPDATE cities SET durability = $2, durability_settled_at = $3, truce_until = $4 WHERE id = $1`,
      [cityId, after, args.now, truceUntil],
    );
    await markSiegeResolved(client, { id: siege.id, outcome: 'hit', durabilityBefore: before, durabilityAfter: after, now: args.now });
    const detail = {
      ...baseDetail,
      outcome: 'hit',
      durability: before,
      damage,
      durabilityAfter: after,
      protectedUntil: truceUntil.toISOString(),
    };
    await insertEvent(client, { accountId: city.account_id, cityId, type: EventType.FACTION_SIEGE, initiator: null, detail });
    for (const accountId of recipients) {
      pushes.push({ accountId, data: { reason: 'hit', ...detail } });
    }
    return 'hit';
  }

  // 城防归零：城被吞（转成该势力的 NPC 城，建筑与库存留在城里）
  await client.query(
    `UPDATE cities SET durability = 0, durability_settled_at = $2, truce_until = NULL WHERE id = $1`,
    [cityId, args.now],
  );
  await markSiegeResolved(client, { id: siege.id, outcome: 'swallowed', durabilityBefore: before, durabilityAfter: 0, now: args.now });
  const detail = {
    ...baseDetail,
    outcome: 'swallowed',
    durability: before,
    damage,
    durabilityAfter: 0,
  };
  await insertEvent(client, { accountId: city.account_id, cityId, type: EventType.FACTION_SIEGE, initiator: null, detail });
  for (const accountId of recipients) {
    pushes.push({ accountId, data: { reason: 'swallowed', ...detail } });
  }
  await swallowFactionCity(client, {
    cityId,
    faction: siege.faction,
    army: siege.army,
    siegeId: siege.id,
    reportId,
    notifies,
  });
  return 'swallowed';
}
