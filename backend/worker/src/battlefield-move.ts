// 剧本战场·官渡（v75，AISLG-198）的行军到达与据点战斗结算：
// 到点队伍在据点开战（大营按守城战，其余野战），更新守军 / 归属 / 军功 / 战报，并在大营被攻破时结束战场。
// 生命周期、积分与发奖在 battlefield-event.ts / battlefield-tick.ts。

import pg from 'pg';
import { EventType, TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import { armyPower, resolveBattle, wallDefensePercent } from '../../common/src/battle';
import { towerStats } from '../../common/src/building-effects';
import {
  BATTLEFIELD_FIRST_CAPTURE_MERIT,
  splitBattlefieldDefenderLosses,
  type BattlefieldCamp,
} from '../../common/src/battlefield';
import {
  loadLatestBattlefieldEvent,
  type BattlefieldEventRow,
  type BattlefieldSquadRow,
  type BattlefieldStrongholdRow,
} from '../../common/src/battlefield-db';
import { saveBattleReport, type TileNotify } from './tick-shared';
import type { ServerBroadcastCreated } from '../../common/src/server-broadcast';
import {
  BATTLEFIELD_LOCK_ID,
  accrueScores,
  battlefieldBroadcast,
  finishBattlefield,
  grantMerit,
  notifyBattlefield,
  publishBroadcasts,
  publishNotifies,
} from './battlefield-event';

function asCamp(value: unknown): BattlefieldCamp {
  return value === 'cao' ? 'cao' : 'yuan';
}

export async function processBattlefieldMovements(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  const notifies: TileNotify[] = [];
  const broadcasts: ServerBroadcastCreated[] = [];
  let finishedEventId: string | null = null;
  let changedStronghold: string | null = null;
  let resolved = 0;
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [BATTLEFIELD_LOCK_ID]);
    const eventRes = await client.query(
      `SELECT * FROM battlefield_events WHERE status = 'active' ORDER BY signup_start DESC LIMIT 1 FOR UPDATE`,
    );
    const event = eventRes.rows[0] as BattlefieldEventRow | undefined;
    if (!event) {
      await client.query('ROLLBACK');
      return 0;
    }
    const due = await client.query(
      `SELECT * FROM battlefield_squads
       WHERE event_id = $1 AND status = 'marching' AND arrive_at <= now()
       ORDER BY arrive_at LIMIT 20 FOR UPDATE SKIP LOCKED`,
      [event.id],
    );
    for (const squad of due.rows as BattlefieldSquadRow[]) {
      const target = (squad.target_stronghold_id
        ? await client.query(`SELECT * FROM battlefield_strongholds WHERE event_id = $1 AND id = $2 FOR UPDATE`, [
            event.id,
            squad.target_stronghold_id,
          ])
        : { rows: [] }) as { rows: BattlefieldStrongholdRow[] };
      const stronghold = target.rows[0];
      if (!stronghold) {
        await client.query(
          `UPDATE battlefield_squads SET status = 'idle', x = target_x, y = target_y,
                  stronghold_id = NULL, target_x = NULL, target_y = NULL,
                  target_stronghold_id = NULL, arrive_at = NULL WHERE id = $1`,
          [squad.id],
        );
        resolved += 1;
        continue;
      }
      if (stronghold.owner_camp === squad.camp) {
        // 增援自己的据点：直接入驻
        await client.query(
          `UPDATE battlefield_squads SET status = 'garrison', stronghold_id = $2, x = $3, y = $4,
                  target_x = NULL, target_y = NULL, target_stronghold_id = NULL, arrive_at = NULL
           WHERE id = $1`,
          [squad.id, stronghold.id, stronghold.x, stronghold.y],
        );
        changedStronghold = stronghold.id;
        resolved += 1;
        continue;
      }
      const outcome = await resolveStrongholdBattle(client, event, squad, stronghold, notifies, broadcasts);
      resolved += 1;
      changedStronghold = stronghold.id;
      if (outcome === 'base_captured') {
        const winner = asCamp(squad.camp);
        await accrueScores(client, event, new Date());
        await finishBattlefield(client, event, winner, 'base_captured', broadcasts, notifies);
        finishedEventId = event.id;
        break;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await publishBroadcasts(pool, broadcasts);
  await publishNotifies(pool, notifies);
  if (finishedEventId) {
    await notifyBattlefield(pool, 'finished', finishedEventId);
  } else if (changedStronghold) {
    const latest = await loadLatestBattlefieldEvent(pool);
    if (latest) {
      await notifyBattlefield(pool, 'stronghold', latest.id, changedStronghold);
    }
  }
  return resolved;
}

/** 攻打一个敌方 / 中立据点：现有战斗引擎结算（大营按守城战），更新守军、归属与军功 */
async function resolveStrongholdBattle(
  client: pg.PoolClient,
  event: BattlefieldEventRow,
  squad: BattlefieldSquadRow,
  stronghold: BattlefieldStrongholdRow,
  notifies: TileNotify[],
  broadcasts: ServerBroadcastCreated[],
): Promise<'attacker_won' | 'defender_won' | 'base_captured'> {
  const garrisonRes = await client.query(
    `SELECT * FROM battlefield_squads WHERE event_id = $1 AND stronghold_id = $2 AND status = 'garrison'`,
    [event.id, stronghold.id],
  );
  const defenders = garrisonRes.rows as BattlefieldSquadRow[];
  const npc = (stronghold.garrison ?? {}) as Partial<Record<TroopKind, number>>;
  const merged = {} as Record<TroopKind, number>;
  for (const kind of TROOP_KINDS) {
    merged[kind] = Math.max(0, Math.floor(npc[kind] ?? 0));
  }
  for (const defender of defenders) {
    for (const kind of TROOP_KINDS) {
      merged[kind] += Math.max(0, Math.floor(defender.troops[kind] ?? 0));
    }
  }
  const attacker = squad.troops;
  const defenderUnitsTotal = TROOP_KINDS.reduce((sum, kind) => sum + Math.max(0, Math.floor(merged[kind] ?? 0)), 0);
  if (defenderUnitsTotal === 0) {
    // 空据点：直接接管（没有战斗，也没有歼敌军功；首占 +200 仍然生效）
    const firstCapture = stronghold.first_captured_at === null;
    await client.query(
      `UPDATE battlefield_squads SET status = 'garrison', stronghold_id = $2, x = $3, y = $4,
              target_x = NULL, target_y = NULL, target_stronghold_id = NULL, arrive_at = NULL
       WHERE id = $1`,
      [squad.id, stronghold.id, stronghold.x, stronghold.y],
    );
    await client.query(
      `UPDATE battlefield_strongholds
       SET owner_camp = $2, garrison = '{}'::jsonb, captured_at = now(),
           first_captured_at = COALESCE(first_captured_at, now())
       WHERE event_id = $1 AND id = $3`,
      [event.id, squad.camp, stronghold.id],
    );
    if (firstCapture) {
      await grantMerit(client, event.id, squad.account_id, BATTLEFIELD_FIRST_CAPTURE_MERIT, broadcasts);
    }
    const username = await loadUsername(client, squad.account_id);
    await battlefieldBroadcast(client, broadcasts, 'battlefield_stronghold', {
      eventId: event.id,
      strongholdId: stronghold.id,
      name: stronghold.name,
      camp: squad.camp,
      username,
      firstCapture,
      reportId: null,
    });
    return stronghold.kind === 'base' ? 'base_captured' : 'attacker_won';
  }
  const siege = stronghold.kind === 'base';
  const result = resolveBattle(attacker, merged, {
    siege,
    wallDefensePercent: siege ? wallDefensePercent(Number(stronghold.wall_level)) : 0,
    tower: siege ? towerStats(Number(stronghold.tower_level)) : null,
  });
  // 军功先算好：战报要记录本场获得的声望，且要与 grantMerit 入账的数值一致
  const defenderLossPower = armyPower(result.defender.losses);
  const firstCapture = result.attackerWon && stronghold.first_captured_at === null;
  const attackerMerit = defenderLossPower + (firstCapture ? BATTLEFIELD_FIRST_CAPTURE_MERIT : 0);
  const attackerName = await loadUsername(client, squad.account_id);
  const defenderName = `${stronghold.name}守军${stronghold.owner_camp ? `（${stronghold.owner_camp === 'yuan' ? '袁绍军' : '曹操军'}）` : ''}`;
  const reportId = await saveBattleReport(
    client,
    squad.account_id,
    'attacker',
    result.attackerWon,
    'battlefield',
    stronghold.x,
    stronghold.y,
    result,
    `${attackerName}（${squad.camp === 'yuan' ? '袁绍军' : '曹操军'}）`,
    defenderName,
    siege ? wallDefensePercent(Number(stronghold.wall_level)) : 0,
    notifies,
    null,
    null,
    null,
    attackerMerit,
  );
  // 守方伤亡拆分：NPC 余数 + 各玩家据守部队按开战数量占比
  const split = splitBattlefieldDefenderLosses(
    npc,
    defenders.map((row) => ({ id: row.id, troops: row.troops })),
    result.defender.losses,
  );
  const attackerLossPower = armyPower(result.attacker.losses);
  // 攻方军功 = 歼灭守军（含 NPC）参考战力；首占据点额外 +200
  await grantMerit(client, event.id, squad.account_id, attackerMerit, broadcasts);
  // 守方玩家军功 = 歼灭攻方战力，按各自部队占比分摊（NPC 不吃军功）
  let defenderUnits = 0;
  for (const defender of defenders) {
    defenderUnits += Object.values(defender.troops).reduce((sum, value) => sum + Math.max(0, Math.floor(value ?? 0)), 0);
  }
  if (defenderUnits > 0) {
    for (const defender of defenders) {
      const units = Object.values(defender.troops).reduce((sum, value) => sum + Math.max(0, Math.floor(value ?? 0)), 0);
      const merit = Math.floor((attackerLossPower * units) / defenderUnits);
      await grantMerit(client, event.id, defender.account_id, merit, broadcasts);
    }
  }
  // 更新守军：NPC 余量 + 各据守队伍扣伤亡
  const npcAfter = {} as Record<TroopKind, number>;
  for (const kind of TROOP_KINDS) {
    npcAfter[kind] = Math.max(0, Math.floor(npc[kind] ?? 0) - Math.floor(split.npcLosses[kind] ?? 0));
  }
  for (const defender of defenders) {
    if (result.attackerWon) {
      await client.query(`DELETE FROM battlefield_squads WHERE id = $1`, [defender.id]);
      continue;
    }
    const losses = split.partyLosses.get(defender.id);
    const remaining = {} as Partial<Record<TroopKind, number>>;
    let units = 0;
    for (const kind of TROOP_KINDS) {
      const left = Math.max(0, Math.floor(defender.troops[kind] ?? 0) - Math.floor(losses?.[kind] ?? 0));
      if (left > 0) {
        remaining[kind] = left;
        units += left;
      }
    }
    if (units === 0) {
      await client.query(`DELETE FROM battlefield_squads WHERE id = $1`, [defender.id]);
    } else {
      await client.query(`UPDATE battlefield_squads SET troops = $2::jsonb WHERE id = $1`, [
        defender.id,
        JSON.stringify(remaining),
      ]);
    }
    await saveBattleReport(
      client,
      defender.account_id,
      'defender',
      !result.attackerWon,
      'battlefield',
      stronghold.x,
      stronghold.y,
      result,
      `${attackerName}（${squad.camp === 'yuan' ? '袁绍军' : '曹操军'}）`,
      defenderName,
      siege ? wallDefensePercent(Number(stronghold.wall_level)) : 0,
      notifies,
    );
  }
  if (result.attackerWon) {
    const survivors = {} as Partial<Record<TroopKind, number>>;
    let units = 0;
    for (const kind of TROOP_KINDS) {
      const left = Math.max(0, Math.floor(result.attacker.survivors[kind] ?? 0));
      if (left > 0) {
        survivors[kind] = left;
        units += left;
      }
    }
    if (units === 0) {
      await client.query(`DELETE FROM battlefield_squads WHERE id = $1`, [squad.id]);
    } else {
      await client.query(
        `UPDATE battlefield_squads SET troops = $2::jsonb, status = 'garrison', stronghold_id = $3,
                x = $4, y = $5, target_x = NULL, target_y = NULL, target_stronghold_id = NULL, arrive_at = NULL
         WHERE id = $1`,
        [squad.id, JSON.stringify(survivors), stronghold.id, stronghold.x, stronghold.y],
      );
    }
    await client.query(
      `UPDATE battlefield_strongholds
       SET owner_camp = $2, garrison = $3::jsonb, captured_at = now(),
           first_captured_at = COALESCE(first_captured_at, now())
       WHERE event_id = $1 AND id = $4`,
      [event.id, squad.camp, JSON.stringify(npcAfter), stronghold.id],
    );
    await battlefieldBroadcast(client, broadcasts, 'battlefield_stronghold', {
      eventId: event.id,
      strongholdId: stronghold.id,
      name: stronghold.name,
      camp: squad.camp,
      username: attackerName,
      firstCapture,
      reportId,
    });
    return stronghold.kind === 'base' ? 'base_captured' : 'attacker_won';
  }
  // 攻方战败：幸存者退回出发位置（全灭则删除）
  const survivors = {} as Partial<Record<TroopKind, number>>;
  let units = 0;
  for (const kind of TROOP_KINDS) {
    const left = Math.max(0, Math.floor(result.attacker.survivors[kind] ?? 0));
    if (left > 0) {
      survivors[kind] = left;
      units += left;
    }
  }
  if (units === 0) {
    await client.query(`DELETE FROM battlefield_squads WHERE id = $1`, [squad.id]);
  } else {
    await client.query(
      `UPDATE battlefield_squads SET troops = $2::jsonb, status = 'idle', x = origin_x, y = origin_y,
              stronghold_id = NULL, target_x = NULL, target_y = NULL, target_stronghold_id = NULL, arrive_at = NULL
       WHERE id = $1`,
      [squad.id, JSON.stringify(survivors)],
    );
  }
  await client.query(
    `UPDATE battlefield_strongholds SET garrison = $2::jsonb WHERE event_id = $1 AND id = $3`,
    [event.id, JSON.stringify(npcAfter), stronghold.id],
  );
  return 'defender_won';
}

async function loadUsername(client: pg.PoolClient, accountId: string): Promise<string> {
  const res = await client.query(`SELECT username FROM accounts WHERE id = $1`, [accountId]);
  return (res.rows[0] as { username: string } | undefined)?.username ?? '玩家';
}

/** Worker 每个 tick 调一次：日程 → 耗粮 → 积分 → 行军结算 */
