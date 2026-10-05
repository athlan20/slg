// Worker 的黄巾营地 / 张角老巢出征结算（v29，AISLG-76）。出征同打野地（掠夺任务）：到达时目标格有进行中的
// 营地即走本文件（由 plunder-tick 委托），调用方（world-tick）已按锁序锁出征城与目标地块。
// - 战斗：野战（无城墙）打营地当前守军（战后存量按野地同口径每小时恢复 25%，让全服可以接力消耗）；
//   每场战斗按歼灭的黄巾单位数累计贡献（yt_contrib），输赢都算；
// - 普通营地：打赢营地消失，按幸存部队负重（含负重科技）从掉落池装填入账；清剿数 +1，达到 80% 出现老巢；
// - 老巢：外围阶段打赢 = 外围清空（无战利品，限时内进入城守阶段）；城守阶段打赢 = 老巢被击破——掉落、
//   首杀播报、事件收场（发奖 + 散成流寇）。败方幸存部队撤回出发城。
// 锁序：出发城 → 目标地块（调用方）→ 营地行 → 事件行。

import pg from 'pg';
import type { Resources, TroopKind } from '../../common/src/protocol';
import { armyPower, resolveBattle } from '../../common/src/battle';
import { armyCarryCapacity } from '../../common/src/troops';
import { loadByCarry, lootTotal, PLUNDERABLE_KEYS, type PlunderLoot } from '../../common/src/plunder';
import { carryingPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { YT_TIER_INFO, ytBossUnlockCount, ytLootPool } from '../../common/src/yellow-turban';
import {
  campGarrison,
  campStage,
  campTier,
  loadActiveYtEvent,
  ytEventView,
  type YtCampRow,
  type YtEventRow,
} from '../../common/src/yellow-turban-db';
import {
  abortMarchToReturn,
  completeMarchEvent,
  createReturnMarch,
  creditLoot,
  loadCityNaming,
  loadMarchHeroBonus,
  markMarchArrived,
  settleMarchHero,
  type MarchRow,
  type TileNotify,
} from './tick-shared';
import { armyTotal, YT_HERO_BOSS } from '../../common/src/hero';
import { grantFamousHeroWithBroadcast } from './hero-grant';
import { saveBattleReport } from './battle-tick';
import { finishYtEvent, spawnYtBoss, ytBroadcast, type YtNotifies } from './yt-event';

function killedOf(losses: Partial<Record<TroopKind, number>>): number {
  return Object.values(losses).reduce<number>((sum, count) => sum + Math.max(0, count ?? 0), 0);
}

export async function resolveCampArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  camp: YtCampRow,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  yt: YtNotifies,
): Promise<void> {
  const nowRes = await client.query(`SELECT now() AS now`);
  const now = nowRes.rows[0].now as Date;
  let event = await loadActiveYtEvent(client, true);
  if (!event || event.id !== camp.event_id) {
    // 事件已收场（营地理应已散成流寇）：目标失效，部队原路返回
    await abortMarchToReturn(client, march, troops, settled, notifies);
    return;
  }
  const tier = campTier(camp);
  // 老巢城守窗口已过期：外围恢复满编（清掉阶段标记与存量）
  if (tier === 'boss' && camp.outer_cleared_at && campStage(camp, now) === 'outer') {
    await client.query(`UPDATE yt_camps SET outer_cleared_at = NULL, remaining = NULL, remaining_at = NULL WHERE id = $1`, [camp.id]);
    camp = { ...camp, outer_cleared_at: null, remaining: null, remaining_at: null };
  }
  const stage = campStage(camp, now);
  const defender = campGarrison(camp, now);
  // v36（AISLG-114）：随队武将加成（按部队规模折算）
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, defender, { wallDefensePercent: 0, siege: false, attackerHero: hero?.engine ?? null });
  const label = tier === 'boss' ? `${YT_TIER_INFO.boss.label} · ${stage === 'keeper' ? '城守' : '外围'}` : YT_TIER_INFO[tier].label;
  const naming = await loadCityNaming(client, march.from_city_id);
  const reportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon, 'yellow_turban', camp.x, camp.y, result,
    naming ? `${naming.username} · ${naming.cityName}` : '出征部队', label, 0, notifies, hero?.report ?? null,
  );
  const heroSettle = await settleMarchHero(client, march, result, notifies);

  // 贡献：歼灭的黄巾单位数（输赢都算）
  const killed = killedOf(result.defender.losses);
  if (killed > 0) {
    await client.query(
      `INSERT INTO yt_contrib (event_id, account_id, killed) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, account_id) DO UPDATE SET killed = yt_contrib.killed + EXCLUDED.killed`,
      [event.id, march.account_id, killed],
    );
  }
  const base = {
    troops,
    survivors: result.attacker.survivors,
    losses: result.attacker.losses,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(defender),
    reportId,
    killed,
    campTier: tier,
    stage: tier === 'boss' ? stage : null,
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  };

  if (!result.attackerWon) {
    // 战败：营地记下守军存量（之后每小时恢复 25%），幸存部队撤回
    await client.query(`UPDATE yt_camps SET remaining = $2::jsonb, remaining_at = $3 WHERE id = $1`, [
      camp.id, JSON.stringify(result.defender.survivors), now,
    ]);
    await markMarchArrived(client, march.id);
    const retreating = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'camp_lost', { ...base, returning: retreating });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 老巢外围：清空后进入城守阶段（限时），无战利品
  if (tier === 'boss' && stage === 'outer') {
    await client.query(`UPDATE yt_camps SET outer_cleared_at = $2, remaining = NULL, remaining_at = NULL WHERE id = $1`, [camp.id, now]);
    await markMarchArrived(client, march.id);
    const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'boss_outer_cleared', { ...base, returning });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 营地 / 老巢城守被击破：按幸存部队负重装填掉落池
  const carry = armyCarryCapacity(result.attacker.survivors, carryingPercent(await loadTechLevels(client, march.account_id)));
  const pool = ytLootPool(tier);
  const loot: PlunderLoot = loadByCarry(carry, Object.fromEntries(PLUNDERABLE_KEYS.map((key) => [key, pool[key]])));
  const lootView: Resources = { gold: loot.gold, food: loot.food, wood: loot.wood, stone: loot.stone, iron: loot.iron };
  if (settled.row && lootTotal(loot) > 0) {
    await creditLoot(client, march.from_city_id, lootView);
    await client.query(`UPDATE accounts SET plunder_total = plunder_total + $2 WHERE id = $1`, [
      march.account_id, loot.food + loot.wood + loot.stone + loot.iron,
    ]);
  }
  await client.query(
    `UPDATE yt_camps SET status = 'cleared', cleared_by = $2, cleared_at = $3, remaining = NULL WHERE id = $1`,
    [camp.id, march.account_id, now],
  );
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);

  if (tier === 'boss') {
    // 老巢被击破：首杀播报 + 收场（发奖 + 散成流寇）
    await ytBroadcast(client, yt, 'yt_boss_first_kill', { username: naming?.username ?? null, cityName: naming?.cityName ?? null });
    // v36（AISLG-115）：首杀者获得名将张角（全服唯一；已被他人获得则跳过）
    await grantFamousHeroWithBroadcast(client, march.account_id, YT_HERO_BOSS, notifies, yt.broadcasts);
    await client.query(`UPDATE yt_events SET boss_cleared_at = $2, boss_cleared_by = $3 WHERE id = $1`, [event.id, now, march.account_id]);
    event = { ...event, boss_cleared_at: now, boss_cleared_by: march.account_id } as YtEventRow;
    await finishYtEvent(client, yt, event, 'boss_cleared');
    await completeMarchEvent(client, march, 'boss_won', { ...base, loot: lootView, carry, returning });
  } else {
    const upd = await client.query(`UPDATE yt_events SET cleared_camps = cleared_camps + 1 WHERE id = $1 RETURNING *`, [event.id]);
    event = upd.rows[0] as YtEventRow;
    yt.push.push({ reason: 'progress', event: ytEventView(event) });
    if (!event.boss_appeared_at && event.cleared_camps >= ytBossUnlockCount(event.total_camps)) {
      await spawnYtBoss(client, yt, event);
    }
    await completeMarchEvent(client, march, 'camp_won', { ...base, loot: lootView, carry, returning });
  }
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}
