// 玩家抢占玩家野地的结算（v39，AISLG-123「玩家对抗（二）」）。从 plunder-tick 拆出：
// purpose='occupy' 且目标为他人占领的野地时由 resolveOccupyArrival 委托到本文件。设计：
// - 调用方（world-tick）已按锁序 出发城 → 地块 加锁；守方城行不写不锁（战斗只动
//   tile_army 与地块归属），与增援 / 召回（守方城 → 地块）不构成死锁环；
// - 到达先在锁内复核（发起后局面可能已变，口径写进 Agent 文档）：
//   · 地块已无主（对方召回等）→ 按目标失效原路返程（aborted，cause=target_gone）；
//   · 地块已归本账号（自己的另一支部队先占到）→ 转增援并入驻军；
//   · 地块已易主第三人 → 按目标失效原路返程（aborted，cause=owner_changed）；
//   · 换主保护期内 / 守方进入新手保护或主动免战 → 不战斗扑空返程（附 cause 与 until）；
// - 守方没留驻军：不打，直接拿下（无战报、无胜负结算）；
// - 野地战（非 siege，无城墙 / 箭塔 / 城守）：守方 = tile_army 驻军；攻方可带随队武将；
// - 攻方胜利且名额（出发城官府等级）有空：地块易主、幸存部队驻守、地块进入换主保护
//   （1 小时基准随缩放，玩家与 NPC 都不能再抢）；名额已满：守方照样失地、地块变无主
//   （不设保护）、攻方幸存部队返程；
// - 守方失地：wilderness_lost（cause=conquest）+ tile_changed 推送，连片加成随下次读取重算；
// - 攻方战败：守方继续占领（驻军按幸存回写），攻方残部返程。

import pg from 'pg';
import { EventType, type InitiatorRole, type TroopKind } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { armyPower, resolveBattle } from '../../common/src/battle';
import { territoryLimit } from '../../common/src/plunder';
import { TILE_CAPTURE_PROTECTION_MS, activeAt, inNewbieProtection } from '../../common/src/protection';
import { scaledMs } from '../../common/src/time-scale';
import { recordWinStreak } from '../../common/src/server-broadcast';
import { armyTotal } from '../../common/src/hero';
import { loadBuildingLevels } from '../../common/src/production';
import { addTileArmy, clearTileOccupation, loadTileArmy, type TileRow } from '../../common/src/world-db';
import { TERRAIN_INFO, wildernessBonusRate, wildernessGatherRate } from '../../common/src/world';
import {
  completeMarchEvent,
  createReturnMarch,
  loadMarchHeroBonus,
  markMarchArrived,
  reinforceTile,
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

/** 出发城的官府等级（占领名额 = 官府等级；每城注册自带 1 级官府，异常缺行按 1 兜底） */
async function governmentLevel(client: pg.PoolClient, cityId: string): Promise<number> {
  const levels = await loadBuildingLevels(client, cityId);
  return Math.max(1, levels.government);
}

/** 目标局面已变 / 受保护：不战斗，部队扑空原路返程并记录原因（与到期时刻） */
async function abortCause(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  cause: 'target_gone' | 'owner_changed' | 'TILE_PROTECTED' | 'NEWBIE_PROTECTED' | 'TARGET_IN_TRUCE',
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

/** 抢占到达结算：tile 为 kind='wilderness' 且被他人城占领（plunder-tick 已判定） */
export async function resolvePvpOccupyArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const now = await dbNow(client);

  // ---- 锁内复核：归属与保护（发起后局面可能已变，见文件头口径） ----
  if (!tile.owner_city_id) {
    await abortCause(client, march, troops, settled, notifies, 'target_gone', null);
    return;
  }
  const ownRes = await client.query(
    `SELECT 1 FROM cities WHERE id = $1 AND account_id = $2`,
    [tile.owner_city_id, march.account_id],
  );
  if (ownRes.rowCount) {
    // 发起后自己的另一支部队先占到：转增援（与既有自有地块口径一致）
    await reinforceTile(client, march, troops, tile, notifies);
    return;
  }
  const ownerRes = await client.query(
    `SELECT c.account_id, a.username, a.newbie_until, a.self_truce_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     WHERE c.id = $1`,
    [tile.owner_city_id],
  );
  const owner = ownerRes.rows[0] as
    | { account_id: string; username: string; newbie_until: Date | null; self_truce_until: Date | null }
    | undefined;
  if (!owner) {
    // 占领行已删（守方重置等）：地块实际已无主
    await abortCause(client, march, troops, settled, notifies, 'target_gone', null);
    return;
  }
  const capturedAt = activeAt(tile.owner_changed_until ?? null, now);
  if (capturedAt) {
    await abortCause(client, march, troops, settled, notifies, 'TILE_PROTECTED', capturedAt);
    return;
  }
  if (inNewbieProtection(owner.newbie_until, now)) {
    await abortCause(client, march, troops, settled, notifies, 'NEWBIE_PROTECTED', activeAt(owner.newbie_until, now));
    return;
  }
  const shieldAt = activeAt(owner.self_truce_until, now);
  if (shieldAt) {
    await abortCause(client, march, troops, settled, notifies, 'TARGET_IN_TRUCE', shieldAt);
    return;
  }

  const garrison = await loadTileArmy(client, tile.x, tile.y);
  const garrisonTotal = Object.values(garrison).reduce((sum, n) => sum + (n ?? 0), 0);
  const attackerPower = armyPower(troops);
  const defenderPower = armyPower(garrison);

  // 守方没留驻军：不打，直接拿下（无战报、无胜负结算；仍走名额判定）
  if (garrisonTotal === 0) {
    await takeOverTile(client, march, troops, tile, owner.username, settled, notifies, {
      unopposed: true,
      attackerPower,
      defenderPower: 0,
    });
    return;
  }

  // 野地战（非 siege：无城墙 / 箭塔 / 城守加成；攻方可带随队武将）
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, garrison, {
    wallDefensePercent: 0,
    siege: false,
    attackerHero: hero?.engine ?? null,
  });
  const attackerNaming = await loadAttackerNaming(client, march.from_city_id);
  const attackerName = attackerNaming ? `${attackerNaming.username} · ${attackerNaming.cityName}` : '出征部队';
  const defenderName = `${owner.username} 的驻军（${tile.level} 级野地）`;
  const attackerReportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon, 'pvp_wilderness',
    tile.x, tile.y, result, attackerName, defenderName, 0, notifies, hero?.report ?? null, null,
  );
  const defenderReportId = await saveBattleReport(
    client, owner.account_id, 'defender', !result.attackerWon, 'pvp_wilderness',
    tile.x, tile.y, result, attackerName, defenderName, 0, notifies, hero?.report ?? null, null,
  );
  const heroSettle = await settleMarchHero(client, march, result, notifies);

  if (!result.attackerWon) {
    // 攻方战败：守方继续占领（驻军按幸存回写），攻方残部返程
    await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [tile.x, tile.y]);
    for (const kind of Object.keys(result.defender.survivors) as TroopKind[]) {
      const count = result.defender.survivors[kind] ?? 0;
      if (count > 0) {
        await client.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, $3, $4)`, [tile.x, tile.y, kind, count]);
      }
    }
    await recordWinStreak(client, march.account_id, false, {});
    const streak = await recordWinStreak(client, owner.account_id, true, {
      username: owner.username,
      cityName: null,
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
      target: { username: owner.username, x: tile.x, y: tile.y },
      ...(heroSettle ? { heroExp: heroSettle } : {}),
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 攻方胜利：连胜计攻方、清零守方，再走名额判定
  const streakBroadcast = await recordWinStreak(client, march.account_id, true, {
    username: attackerNaming?.username ?? null,
    cityName: attackerNaming?.cityName ?? null,
  });
  if (streakBroadcast) {
    notifies.push({ reason: 'server_broadcast', accountId: '', broadcast: streakBroadcast });
  }
  await recordWinStreak(client, owner.account_id, false, {});
  await takeOverTile(client, march, result.attacker.survivors, tile, owner.username, settled, notifies, {
    unopposed: false,
    attackerPower,
    defenderPower,
    losses: result.attacker.losses,
    survivors: result.attacker.survivors,
    troops,
    rounds: result.rounds,
    endReason: result.endReason,
    reportId: attackerReportId,
    defenderReportId,
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  });
}

/** 出征城命名（战报双方命名用；城已删返回 null） */
async function loadAttackerNaming(
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

/**
 * 拿下地块（攻方已胜或守方无驻军）：名额有空 → 易主 + 幸存驻守 + 换主保护；
 * 名额已满 → 守方照样失地、地块变无主（不设保护）、攻方幸存返程。
 * 守方失地：wilderness_lost（cause=conquest）+ tile_changed 推送。
 */
async function takeOverTile(
  client: pg.PoolClient,
  march: MarchRow,
  survivors: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  ownerUsername: string,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  info: {
    unopposed: boolean;
    attackerPower: number;
    defenderPower: number;
    troops?: Partial<Record<TroopKind, number>>;
    losses?: Partial<Record<TroopKind, number>>;
    survivors?: Partial<Record<TroopKind, number>>;
    rounds?: number;
    endReason?: string;
    reportId?: number;
    defenderReportId?: number;
    heroExp?: unknown;
  },
): Promise<void> {
  const now = await dbNow(client);
  const ownerCityId = tile.owner_city_id as string;
  const limit = territoryLimit(await governmentLevel(client, march.from_city_id));
  const ownedRes = await client.query(
    `SELECT count(*)::int AS n FROM world_tiles WHERE owner_city_id = $1 AND kind = 'wilderness'`,
    [march.from_city_id],
  );
  const owned = (ownedRes.rows[0] as { n: number }).n;
  const withinLimit = owned < limit;

  // 守方失地（名额满时同样失守——攻方抢不下但守方守不住）
  await clearTileOccupation(client, tile.x, tile.y);
  const ownerNaming = await loadAttackerNaming(client, ownerCityId);
  const conquerorNaming = await loadAttackerNaming(client, march.from_city_id);
  const ownerAccountId = ownerNaming?.accountId;
  if (ownerAccountId) {
    await insertEvent(client, {
      accountId: ownerAccountId,
      cityId: ownerCityId,
      type: EventType.WILDERNESS_LOST,
      initiator: null,
      detail: {
        x: tile.x, y: tile.y, cause: 'conquest', terrain: tile.terrain, level: tile.level,
        attacker: { username: conquerorNaming?.username ?? null },
      },
    });
    notifies.push({ reason: 'tile_changed', accountId: ownerAccountId, x: tile.x, y: tile.y, tileReason: 'wilderness_lost' });
  }

  if (!withinLimit) {
    // 名额已满：地块变无主（不设换主保护），攻方幸存部队返程
    await markMarchArrived(client, march.id);
    const returning = await createReturnMarch(client, march, survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'battle_won', {
      troops: info.troops ?? survivors,
      survivors: info.survivors ?? survivors,
      ...(info.losses ? { losses: info.losses } : {}),
      occupied: false,
      denial: 'TERRITORY_LIMIT',
      territory: owned,
      limit,
      ...(info.rounds !== undefined ? { rounds: info.rounds } : {}),
      ...(info.endReason ? { endReason: info.endReason } : {}),
      attackerPower: info.attackerPower,
      defenderPower: info.defenderPower,
      ...(info.reportId !== undefined ? { reportId: info.reportId } : {}),
      target: { username: ownerUsername, x: tile.x, y: tile.y },
      ...(info.unopposed ? { unopposed: true } : {}),
      returning,
      ...(info.heroExp ? { heroExp: info.heroExp } : {}),
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 名额有空：地块易主、幸存部队驻守、进入换主保护（1 小时基准随缩放，玩家与 NPC 都不能再抢）
  const protectedUntil = new Date(now.getTime() + scaledMs(TILE_CAPTURE_PROTECTION_MS));
  await addTileArmy(client, tile.x, tile.y, survivors);
  await client.query(
    `UPDATE world_tiles SET owner_city_id = $3, owner_changed_until = $4 WHERE x = $1 AND y = $2 AND kind = 'wilderness'`,
    [tile.x, tile.y, march.from_city_id, protectedUntil],
  );
  await markMarchArrived(client, march.id);
  const survivorTotal = Object.values(survivors).reduce((sum, n) => sum + (n ?? 0), 0);
  await completeMarchEvent(client, march, 'battle_won', {
    troops: info.troops ?? survivors,
    survivors: info.survivors ?? survivors,
    ...(info.losses ? { losses: info.losses } : {}),
    occupied: true,
    ...(info.rounds !== undefined ? { rounds: info.rounds } : {}),
    ...(info.endReason ? { endReason: info.endReason } : {}),
    attackerPower: info.attackerPower,
    defenderPower: info.defenderPower,
    ...(info.reportId !== undefined ? { reportId: info.reportId } : {}),
    target: { username: ownerUsername, x: tile.x, y: tile.y },
    ...(info.unopposed ? { unopposed: true } : {}),
    protectedUntil: protectedUntil.toISOString(),
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
      cause: 'conquest',
      from: ownerUsername,
    },
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile.x, y: tile.y, tileReason: 'wilderness_occupied' });
}
