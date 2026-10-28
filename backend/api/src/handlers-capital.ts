// 设为主城（v82，AISLG-205）：分城与当前主城对调身份，换完 24 小时内不能再换。
// 主城判定全靠 cities.created_at 最早（约 45 处），所以对调时只需把目标分城的 created_at 改成
// 「账号名下最小值 − 1 秒」，其余判定自动生效；原主城城防从满值开始计，新主城城防置空（主城不落值）。
// 规则判定在 common/src/capital-swap.ts，本文件只管锁序、事务与推送。
// 锁序：账号名下全部城池行按 id 升序 FOR UPDATE，再校验 → 改写；校验在锁内做（冷却、来袭、城防、分城上限）。

import pg from 'pg';
import { EventType, Op, type ErrorCode, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadBuildingLevels } from '../../common/src/production';
import { branchCityLimit } from '../../common/src/branch-city';
import { DURABILITY_MAX, settleDurability } from '../../common/src/protection';
import { repairPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { capitalCooldownFrom, capitalSwapDenial } from '../../common/src/capital-swap';
import { loadIncomingAttack } from '../../common/src/capital-swap-db';
import { currentCityId } from './city-scope';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

type SetCapitalOutcome =
  | { ok: true; capitalId: string; formerCapitalId: string; cooldownUntil: Date; branchLimit: number }
  | { ok: false; code: ErrorCode; data?: Record<string, unknown> };

export async function handleSetCapital(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  // 必须显式确认（与放弃分城同口径）；cityId 必填，且只能是本账号的分城
  const cityId = currentCityId();
  if (!cityId || data?.confirm !== true) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await setCapitalTx(client, accountId, cityId);
    if (!outcome.ok) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, outcome.code, outcome.data);
      return;
    }
    await insertEvent(client, {
      accountId,
      cityId: null,
      type: EventType.CAPITAL_CHANGED,
      initiator: role,
      detail: {
        capitalId: outcome.capitalId,
        formerCapitalId: outcome.formerCapitalId,
        cooldownUntil: outcome.cooldownUntil.toISOString(),
      },
    });
    await client.query('COMMIT');

    respondOk(ctx.registry, conn, op, seq, {
      capitalId: outcome.capitalId,
      formerCapitalId: outcome.formerCapitalId,
      cooldownUntil: outcome.cooldownUntil.toISOString(),
      branchLimit: outcome.branchLimit,
    });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'capital_changed', cityId: outcome.capitalId, formerCapitalId: outcome.formerCapitalId } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 事务内的设为主城判定与对调（调用方负责 BEGIN / COMMIT / ROLLBACK） */
async function setCapitalTx(client: pg.PoolClient, accountId: string, targetId: string): Promise<SetCapitalOutcome> {
  // 锁序：账号名下全部城池行按 id 升序加锁，之后的判定与改写都在锁内
  const locked = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY id FOR UPDATE`, [accountId]);
  const ownIds = (locked.rows as Array<{ id: string }>).map((row) => row.id);
  if (!ownIds.includes(targetId)) {
    return { ok: false, code: 'INVALID_PARAMS' };
  }
  const mainRes = await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [accountId]);
  const mainId = (mainRes.rows[0] as { id: string }).id;
  if (mainId === targetId) {
    // 已是主城：没有可对调的对象
    return { ok: false, code: 'INVALID_PARAMS' };
  }

  const targetRes = await client.query(
    `SELECT famous_name, durability, durability_settled_at, truce_until, now() AS db_now
     FROM cities WHERE id = $1`,
    [targetId],
  );
  const target = targetRes.rows[0] as {
    famous_name: string | null;
    durability: number | null;
    durability_settled_at: Date | null;
    truce_until: Date | null;
    db_now: Date;
  };
  const now = target.db_now;
  const cooldownRes = await client.query(`SELECT until FROM capital_swaps WHERE account_id = $1`, [accountId]);
  const cooldownUntil = (cooldownRes.rows[0] as { until: Date } | undefined)?.until ?? null;
  const underAttack = await loadIncomingAttack(client, accountId);
  const levels = await loadBuildingLevels(client, targetId);
  const techs = await loadTechLevels(client, accountId);

  const denial = capitalSwapDenial({
    famous: target.famous_name !== null,
    cooldownUntil,
    underAttack,
    durability: settleDurability(target.durability, target.durability_settled_at, target.truce_until, now, repairPercent(techs)),
    branchCount: ownIds.length - 1,
    newMainGovernment: levels.government,
    now,
  });
  if (denial) {
    return { ok: false, code: denial.code, data: denial.data };
  }

  // 对调身份：目标分城成为最早的城（created_at 比账号最小值早 1 秒）；原主城城防从满值开始计，新主城城防置空
  const nextCooldown = capitalCooldownFrom(now);
  await client.query(
    `UPDATE cities
     SET created_at = (SELECT min(created_at) FROM cities WHERE account_id = $1) - interval '1 second',
         durability = NULL, durability_settled_at = NULL
     WHERE id = $2`,
    [accountId, targetId],
  );
  await client.query(
    `UPDATE cities SET durability = $2, durability_settled_at = now() WHERE id = $1`,
    [mainId, DURABILITY_MAX],
  );
  await client.query(
    `INSERT INTO capital_swaps (account_id, until) VALUES ($1, $2)
     ON CONFLICT (account_id) DO UPDATE SET until = EXCLUDED.until`,
    [accountId, nextCooldown],
  );
  return {
    ok: true,
    capitalId: targetId,
    formerCapitalId: mainId,
    cooldownUntil: nextCooldown,
    branchLimit: branchCityLimit(levels.government),
  };
}
