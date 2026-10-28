// 赤壁据点技能（v80，AISLG-199）：火攻（孙刘方、东南风期间）与连锁战船（曹方）。
// 花费战场军功，效果在 API 事务内即时结算：火攻伤害按守军各兵种生命比例写入余伤池并折算阵亡，
// 阵亡分摊给 NPC 守军与据守队伍（与守城战伤亡拆分同口径）；连锁战船只写截止时刻，减伤 / 翻倍在战斗结算时生效。
// 规则与数值见 common/src/battlefield.ts。

import type pg from 'pg';
import { EventType, TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import {
  BATTLEFIELD_CHAIN_MERIT_COST,
  BATTLEFIELD_CHAIN_MS,
  BATTLEFIELD_FIRE_COOLDOWN_MS,
  BATTLEFIELD_FIRE_MERIT_COST,
  battlefieldChainActive,
  battlefieldFireDamage,
  battlefieldFireHpRatio,
  battlefieldFireReady,
  battlefieldNeighbors,
  splitBattlefieldDefenderLosses,
} from '../../common/src/battlefield';
import type { BattlefieldEventRow, BattlefieldStrongholdRow, BattlefieldSquadRow } from '../../common/src/battlefield-db';
import { insertEvent } from '../../common/src/events';
import { respondError } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { broadcastState, respondState, scriptOfRow } from './handlers-battlefield';

type Client = pg.PoolClient;

/** 读取本场（赤壁、进行中）、本账号的参与记录与战场军功余额；不满足时返回错误码 */
async function loadSkillContext(
  client: Client,
  accountId: string,
): Promise<
  | { error: 'BATTLEFIELD_NOT_ACTIVE' | 'BATTLEFIELD_SKILL_UNAVAILABLE' | 'BATTLEFIELD_NOT_JOINED' | 'BATTLEFIELD_NOT_ENTERED'; event?: undefined }
  | { error?: undefined; event: BattlefieldEventRow; camp: string; balance: number }
> {
  const eventRes = await client.query(`SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1 FOR UPDATE`);
  const event = eventRes.rows[0] as BattlefieldEventRow | undefined;
  if (!event || event.status !== 'active') {
    return { error: 'BATTLEFIELD_NOT_ACTIVE' };
  }
  if (scriptOfRow(event.script) !== 'chibi') {
    return { error: 'BATTLEFIELD_SKILL_UNAVAILABLE' };
  }
  const partRes = await client.query(
    `SELECT camp, entered_at FROM battlefield_participants WHERE event_id = $1 AND account_id = $2`,
    [event.id, accountId],
  );
  const participant = partRes.rows[0] as { camp: string; entered_at: Date | null } | undefined;
  if (!participant) {
    return { error: 'BATTLEFIELD_NOT_JOINED' };
  }
  if (!participant.entered_at) {
    return { error: 'BATTLEFIELD_NOT_ENTERED' };
  }
  const balanceRes = await client.query(`SELECT merit FROM battlefield_merit WHERE account_id = $1 FOR UPDATE`, [accountId]);
  const balance = Number((balanceRes.rows[0] as { merit: string | number } | undefined)?.merit ?? 0);
  return { event, camp: participant.camp, balance };
}

/** FIRE_BATTLEFIELD_STRONGHOLD（op 139）：孙刘方、东南风期间，火攻一个与己方据点相邻的曹方据点 */
export async function handleFireBattlefieldStronghold(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const strongholdId = typeof data?.strongholdId === 'string' ? data.strongholdId : null;
  if (!strongholdId) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const context = await loadSkillContext(client, accountId);
    if (context.error) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, context.error);
      return;
    }
    const { event, camp, balance } = context;
    if (camp !== 'yuan') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SKILL_UNAVAILABLE');
      return;
    }
    if (event.wind !== 'se') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_WIND_MISMATCH', { wind: event.wind, required: 'se' });
      return;
    }
    // 锁本场全部据点：火攻要同时看到目标与己方据点的归属，并写入余伤池
    const rows = (
      await client.query(`SELECT * FROM battlefield_strongholds WHERE event_id = $1 ORDER BY id FOR UPDATE`, [event.id])
    ).rows as BattlefieldStrongholdRow[];
    const target = rows.find((row) => row.id === strongholdId);
    if (!target || target.owner_camp !== 'cao') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_TARGET_INVALID');
      return;
    }
    const adjacent = rows.some((row) => row.owner_camp === 'yuan' && battlefieldNeighbors(row, target));
    if (!adjacent) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_TARGET_INVALID');
      return;
    }
    const now = new Date();
    if (!battlefieldFireReady(target.fire_next_at, now)) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_FIRE_COOLDOWN', { nextAt: target.fire_next_at?.toISOString() ?? null });
      return;
    }
    if (balance < BATTLEFIELD_FIRE_MERIT_COST) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_MERIT_INSUFFICIENT', { cost: BATTLEFIELD_FIRE_MERIT_COST, balance });
      return;
    }
    await client.query(`UPDATE battlefield_merit SET merit = merit - $2, updated_at = now() WHERE account_id = $1`, [
      accountId,
      BATTLEFIELD_FIRE_MERIT_COST,
    ]);
    // 连锁战船期间火攻伤害翻倍（20% → 40%）
    const chained = battlefieldChainActive(target.chain_until, now);
    const npc = (target.garrison ?? {}) as Partial<Record<TroopKind, number>>;
    const squads = (
      await client.query(
        `SELECT * FROM battlefield_squads WHERE event_id = $1 AND stronghold_id = $2 AND status = 'garrison' ORDER BY created_at`,
        [event.id, target.id],
      )
    ).rows as BattlefieldSquadRow[];
    const merged: Partial<Record<TroopKind, number>> = {};
    for (const kind of TROOP_KINDS) {
      merged[kind] = Math.max(0, Math.floor(npc[kind] ?? 0)) + squads.reduce((sum, row) => sum + Math.max(0, Math.floor(row.troops[kind] ?? 0)), 0);
    }
    const wounds = (target.fire_wounds ?? {}) as Partial<Record<TroopKind, number>>;
    const fire = battlefieldFireDamage(merged, wounds, battlefieldFireHpRatio(chained));
    // 阵亡按各据守部队的生命比例分摊（NPC 余数归 NPC）
    const split = splitBattlefieldDefenderLosses(
      npc,
      squads.map((row) => ({ id: row.id, troops: row.troops })),
      fire.kills,
    );
    const npcAfter: Partial<Record<TroopKind, number>> = {};
    for (const kind of TROOP_KINDS) {
      npcAfter[kind] = Math.max(0, Math.floor(npc[kind] ?? 0) - Math.floor(split.npcLosses[kind] ?? 0));
    }
    for (const row of squads) {
      const losses = split.partyLosses.get(row.id);
      const remaining: Partial<Record<TroopKind, number>> = {};
      let units = 0;
      for (const kind of TROOP_KINDS) {
        const left = Math.max(0, Math.floor(row.troops[kind] ?? 0) - Math.floor(losses?.[kind] ?? 0));
        if (left > 0) {
          remaining[kind] = left;
          units += left;
        }
      }
      if (units === 0) {
        await client.query(`DELETE FROM battlefield_squads WHERE id = $1`, [row.id]);
      } else {
        await client.query(`UPDATE battlefield_squads SET troops = $2::jsonb WHERE id = $1`, [row.id, JSON.stringify(remaining)]);
      }
    }
    await client.query(
      `UPDATE battlefield_strongholds SET garrison = $3::jsonb, fire_wounds = $4::jsonb, fire_next_at = $5
       WHERE event_id = $1 AND id = $2`,
      [
        event.id,
        target.id,
        JSON.stringify(npcAfter),
        JSON.stringify(fire.wounds),
        new Date(now.getTime() + BATTLEFIELD_FIRE_COOLDOWN_MS),
      ],
    );
    await insertEvent(client, {
      accountId,
      type: EventType.BATTLEFIELD_SKILL,
      initiator: conn.role,
      detail: { eventId: event.id, skill: 'fire', strongholdId: target.id, chained, cost: BATTLEFIELD_FIRE_MERIT_COST, kills: fire.kills },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await broadcastState(ctx, accountId, 'stronghold', strongholdId);
  await respondState(ctx, conn, op, seq, accountId);
}

/** CHAIN_BATTLEFIELD_STRONGHOLD（op 140）：曹方给己方据点连锁战船 6 小时 */
export async function handleChainBattlefieldStronghold(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const strongholdId = typeof data?.strongholdId === 'string' ? data.strongholdId : null;
  if (!strongholdId) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const context = await loadSkillContext(client, accountId);
    if (context.error) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, context.error);
      return;
    }
    const { event, camp, balance } = context;
    if (camp !== 'cao') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SKILL_UNAVAILABLE');
      return;
    }
    const targetRes = await client.query(
      `SELECT * FROM battlefield_strongholds WHERE event_id = $1 AND id = $2 FOR UPDATE`,
      [event.id, strongholdId],
    );
    const target = targetRes.rows[0] as BattlefieldStrongholdRow | undefined;
    if (!target || target.owner_camp !== 'cao') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_TARGET_INVALID');
      return;
    }
    const now = new Date();
    if (battlefieldChainActive(target.chain_until, now)) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_CHAIN_ACTIVE', { chainUntil: target.chain_until?.toISOString() ?? null });
      return;
    }
    if (balance < BATTLEFIELD_CHAIN_MERIT_COST) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_MERIT_INSUFFICIENT', { cost: BATTLEFIELD_CHAIN_MERIT_COST, balance });
      return;
    }
    await client.query(`UPDATE battlefield_merit SET merit = merit - $2, updated_at = now() WHERE account_id = $1`, [
      accountId,
      BATTLEFIELD_CHAIN_MERIT_COST,
    ]);
    const chainUntil = new Date(now.getTime() + BATTLEFIELD_CHAIN_MS);
    await client.query(`UPDATE battlefield_strongholds SET chain_until = $3 WHERE event_id = $1 AND id = $2`, [
      event.id,
      target.id,
      chainUntil,
    ]);
    await insertEvent(client, {
      accountId,
      type: EventType.BATTLEFIELD_SKILL,
      initiator: conn.role,
      detail: { eventId: event.id, skill: 'chain', strongholdId: target.id, chainUntil: chainUntil.toISOString(), cost: BATTLEFIELD_CHAIN_MERIT_COST },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  await broadcastState(ctx, accountId, 'stronghold', strongholdId);
  await respondState(ctx, conn, op, seq, accountId);
}
