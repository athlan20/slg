// Worker 的截击结算（v28，AISLG-78）：purpose='intercept' 的行军到达移动目标路线上选定的格。
// v35（AISLG-112）起「到了先埋伏」：发起时已按固定时刻表把 arrive_at 顺延为预计接战时刻 =
// max(到达时刻, 目标进入相邻范围的时刻)（提前到达记 ambush_at），故结算时刻目标通常在选定格
// 或相邻格（INTERCEPT_REACH）内。判定仍按「结算时刻目标所在格」：
// - 目标已被击败 / 已过时消失 → 「目标消失」战报，部队返程；
// - 目标已走远（到达时所在格距选定格 > 1）→ 「扑空」战报，部队返程；
// - 接战：野战（无城墙）打目标守军；胜 = 目标被击败消失，按幸存部队负重（含负重科技）
//   从目标携带的资源装填入账出发城（金→粮→木→石→铁），败 = 幸存部队撤回、目标原样留存。
// 锁序：出发城（调用方已锁并结算）→ 目标地块（调用方已锁）→ 目标行（本文件加锁）；与流寇掠夺 tick
// （先结算玩家城、最后才更新目标行）一致，不构成死锁环。

import pg from 'pg';
import type { Resources, TroopKind } from '../../common/src/protocol';
import { armyPower, resolveBattle, toFullArmyCounts } from '../../common/src/battle';
import { armyCarryCapacity } from '../../common/src/troops';
import { loadByCarry, lootTotal, PLUNDERABLE_KEYS, type PlunderLoot } from '../../common/src/plunder';
import { carryingPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { INTERCEPT_REACH, MOVING_KIND_INFO, cellDistance, isMovingKind } from '../../common/src/moving-target';
import { loadMovingTarget, movingTargetView, rowIndexAt, type MovingTargetRow } from '../../common/src/moving-target-db';
import { insertBattleReport, type BattleReportDetail } from '../../common/src/battle-db';
import {
  completeMarchEvent,
  createReturnMarch,
  creditLoot,
  loadCityNaming,
  loadMarchHeroBonus,
  markMarchArrived,
  settleMarchHero,
  sideView,
  type MarchRow,
  type TileNotify,
} from './tick-shared';
import { armyTotal } from '../../common/src/hero';
import { saveBattleReport } from './tick-shared';

/** 目标发生变化后经 pg_notify 广播给全服（提交后由 world-tick 统一发送） */
export interface MovingNotify {
  reason: 'spawned' | 'defeated' | 'expired';
  row: MovingTargetRow;
}

/** 未接战（扑空 / 目标消失）战报：双方零损失、0 回合，kind='intercept'，contact 标明原因 */
async function saveNoContactReport(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  contact: 'missed' | 'gone',
  defenderName: string,
  notifies: TileNotify[],
): Promise<number> {
  const naming = await loadCityNaming(client, march.from_city_id);
  const sent = toFullArmyCounts(troops);
  const empty = toFullArmyCounts({});
  const detail: BattleReportDetail = {
    x: march.x,
    y: march.y,
    kind: 'intercept',
    role: 'attacker',
    won: false,
    rounds: 0,
    endReason: 'no_contact',
    contact,
    attacker: sideView(naming ? `${naming.username} · ${naming.cityName}` : '出征部队', {
      troops: sent, losses: empty, survivors: sent, damage: 0,
    }),
    defender: sideView(defenderName, { troops: empty, losses: empty, survivors: empty, damage: 0 }),
    wallDefensePercent: 0,
    roundLog: [],
  };
  const report = await insertBattleReport(client, march.account_id, detail);
  notifies.push({ reason: 'battle_report', accountId: march.account_id, reportId: report.id });
  return report.id;
}

/**
 * 截击到达（purpose='intercept'）。movingNotifies 收集目标状态变化，调用方提交后广播。
 */
export async function resolveInterceptArrival(
  client: pg.PoolClient,
  march: MarchRow,
  troops: Partial<Record<TroopKind, number>>,
  settled: { row: { x: number | null; y: number | null } | null },
  notifies: TileNotify[],
  movingNotifies: MovingNotify[],
): Promise<void> {
  const target = march.target_id ? await loadMovingTarget(client, march.target_id, true) : null;
  const arriveMs = march.arrive_at.getTime();
  const label = target && isMovingKind(target.kind) ? MOVING_KIND_INFO[target.kind].label : '移动目标';
  const index = target ? rowIndexAt(target, arriveMs) : null;

  // 目标消失：不存在 / 已被击败 / 到达时已过时
  if (!target || index === null) {
    const reportId = await saveNoContactReport(client, march, troops, 'gone', `${label}（已消失）`, notifies);
    const returning = await createReturnMarch(client, march, troops, settled, march.initiator);
    await markMarchArrived(client, march.id);
    await completeMarchEvent(client, march, 'intercept_gone', { troops, returning, reportId, targetId: march.target_id });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 扑空：到达时目标已走出选定格的相邻范围（太晚发起、发起后目标走远；行军途中目标被
  // 他人击败 / 过时消失走上面的「目标消失」分支）
  const [tx, ty] = target.route[index];
  if (cellDistance(tx, ty, march.x, march.y) > INTERCEPT_REACH) {
    const reportId = await saveNoContactReport(client, march, troops, 'missed', `${label} Lv${target.level}（已走远）`, notifies);
    const returning = await createReturnMarch(client, march, troops, settled, march.initiator);
    await markMarchArrived(client, march.id);
    await completeMarchEvent(client, march, 'intercept_missed', {
      troops, returning, reportId, targetId: target.id, targetAt: { x: tx, y: ty },
    });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 接战：野战（无城墙），守军即目标的守军编成；v36（AISLG-114）随队武将加成（按部队规模折算）
  const defender = target.garrison ?? {};
  const hero = await loadMarchHeroBonus(client, march, armyTotal(troops));
  const result = resolveBattle(troops, defender, { wallDefensePercent: 0, siege: false, attackerHero: hero?.engine ?? null });
  const naming = await loadCityNaming(client, march.from_city_id);
  const reportId = await saveBattleReport(
    client, march.account_id, 'attacker', result.attackerWon, 'intercept', march.x, march.y, result,
    naming ? `${naming.username} · ${naming.cityName}` : '出征部队', `${label} Lv${target.level}`, 0, notifies, hero?.report ?? null,
  );
  const heroSettle = await settleMarchHero(client, march, result, notifies);
  const common = {
    troops,
    survivors: result.attacker.survivors,
    losses: result.attacker.losses,
    rounds: result.rounds,
    endReason: result.endReason,
    attackerPower: armyPower(troops),
    defenderPower: armyPower(defender),
    reportId,
    targetId: target.id,
    ...(heroSettle ? { heroExp: heroSettle } : {}),
  };

  if (!result.attackerWon) {
    await markMarchArrived(client, march.id);
    const retreating = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
    await completeMarchEvent(client, march, 'intercept_lost', { ...common, returning: retreating });
    notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
    return;
  }

  // 胜利：目标被击败消失，按幸存部队负重（含负重科技）装填其携带的资源
  const carry = armyCarryCapacity(result.attacker.survivors, carryingPercent(await loadTechLevels(client, march.account_id)));
  const pool: Partial<Record<(typeof PLUNDERABLE_KEYS)[number], number>> = {};
  for (const key of PLUNDERABLE_KEYS) {
    pool[key] = Math.max(0, Math.floor(target.stock[key] ?? 0));
  }
  const loot: PlunderLoot = loadByCarry(carry, pool);
  const lootView: Resources = { gold: loot.gold, food: loot.food, wood: loot.wood, stone: loot.stone, iron: loot.iron };
  if (settled.row && lootTotal(loot) > 0) {
    await creditLoot(client, march.from_city_id, lootView);
    // 累计掠夺台账（v23 AISLG-61）：四资源合计（金不计），与掠夺同口径
    await client.query(`UPDATE accounts SET plunder_total = plunder_total + $2 WHERE id = $1`, [
      march.account_id,
      loot.food + loot.wood + loot.stone + loot.iron,
    ]);
  }
  const upd = await client.query(
    `UPDATE moving_targets SET status = 'defeated', defeated_by = $2, resolved_at = clock_timestamp()
     WHERE id = $1 AND status = 'active' RETURNING *`,
    [target.id, march.account_id],
  );
  if (upd.rowCount) {
    movingNotifies.push({ reason: 'defeated', row: upd.rows[0] as MovingTargetRow });
  }
  await markMarchArrived(client, march.id);
  const returning = await createReturnMarch(client, march, result.attacker.survivors, settled, march.initiator);
  await completeMarchEvent(client, march, 'intercepted', { ...common, loot: lootView, carry, returning });
  notifies.push({ reason: 'march_resolved', accountId: march.account_id, marchId: march.id });
}

/** 目标变化的广播载荷（提交后 pg_notify；漏发时客户端重连 / 定时拉取覆盖） */
export function movingNotifyPayload(n: MovingNotify): { reason: 'moving_target'; data: Record<string, unknown> } {
  return { reason: 'moving_target', data: { reason: n.reason, target: movingTargetView(n.row) } };
}
