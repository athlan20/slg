// Worker 的名城外围结算（v24，AISLG-56）：名城分两阶段攻打——外围阶段对其出征（掠夺 /
// 占领 task 均先清外围）打的是外围驻军（野战，守方无城墙）：胜利 = 外围清空，名城进入
// 城守阶段（outerClearedAt = 到达时刻），限时内可再出征攻城守并占领，超时外围恢复满编
// （阶段由 outerClearedAt 惰性推导，见 common/src/famous-city.ts）；战败幸存部队撤回。
// 清外围不带战利品、不占领、不触发掠夺冷却。调用方（world-tick）已锁出征城与目标地块。

import pg from 'pg';
import type { TroopKind } from '../../common/src/protocol';
import { armyPower, resolveBattle } from '../../common/src/battle';
import { famousRecoversAt } from '../../common/src/famous-city';
import { recordWinStreak } from '../../common/src/server-broadcast';
import type { NpcCitySnapshot } from '../../common/src/world';
import type { TileRow } from '../../common/src/world-db';
import {
  completeMarchEvent,
  createReturnMarch,
  loadCityNaming,
  loadMarchHeroBonus,
  markMarchArrived,
  settleMarchHero,
  type MarchRow,
  type TileNotify,
} from './tick-shared';
import { armyTotal } from '../../common/src/hero';
import { saveBattleReport } from './battle-tick';

export async function resolveFamousOuterArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  tile: TileRow,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
): Promise<void> {
  const npc = tile.npc as NpcCitySnapshot;
  const famous = npc.famous!;
  const defender = famous.outerGarrison;
  // v36（AISLG-114）：随队武将加成（按部队规模折算）
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, defender, { wallDefensePercent: 0, siege: false, attackerHero: hero?.engine ?? null });
  const naming = await loadCityNaming(client, march.from_city_id);
  const attackerName = naming ? `${naming.username} · ${naming.cityName}` : '出征部队';
  const reportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon,
    'npc_city', tile.x, tile.y, result, attackerName, `名城 ${famous.name} · 外围（Lv${tile.level}）`, 0, notifies, hero?.report ?? null,
  );
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  const base = {
    troops,
    losses: result.attacker.losses,
    survivors: result.attacker.survivors,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(defender),
    reportId,
    stage: 'outer' as const,
    famousName: famous.name,
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
  // 外围清空：写入清空时刻，名城进入城守阶段（限时内可攻城守）
  const nowRes = await client.query(`SELECT now() AS now`);
  const now = nowRes.rows[0].now as Date;
  const next: NpcCitySnapshot = { ...npc, famous: { ...famous, outerClearedAt: now.toISOString() } };
  await client.query(`UPDATE world_tiles SET npc = $3::jsonb WHERE x = $1 AND y = $2`, [tile.x, tile.y, JSON.stringify(next)]);
  const recoversAt = famousRecoversAt(next.famous!, now);
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
  await completeMarchEvent(client, march, 'battle_won', {
    ...base,
    occupied: false,
    outerCleared: true,
    recoversAt: recoversAt ? recoversAt.toISOString() : null,
    returning,
  });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
  notifies.push({ reason: 'tile_changed', accountId: march.account_id, x: tile.x, y: tile.y, tileReason: 'famous_outer_cleared' });
}
