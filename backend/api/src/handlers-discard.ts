// 放弃分城（v57，AISLG-153）：分城转回 NPC 城池的唯一入口，规则对齐旧游戏 discardCity：
// - 主城不可放弃；该城或其名下野地正有行军在途、有 NPC 来袭未结、名下野地仍有驻军时拒绝；
//   该城仍有部队在外（行军 / 返程 / 运输 / 侦察）时拒绝；
// - 城内资源、驻军、建筑与建造 / 征兵 / 研究队列随城作废（不返还）；城守武将解除任命，武将本身保留；
// - 名下野地转为无主；地块回到同级 NPC 城池（名城恢复为未攻破的名城）；
// - 原账号的占回冷却 = 放弃时的官府等级 天（按时间缩放），冷却内不能再占回该地块（checkOccupyNpcCity）。
// 锁序：先锁城池行（lockCitySnapshot），再锁地块行；与出征 / 到达结算的加锁顺序一致。

import pg from 'pg';
import { EventType, Op, type ErrorCode, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadBuildingLevels } from '../../common/src/production';
import { discardCooldownDays } from '../../common/src/branch-city';
import { FAMOUS_CITY_LEVEL, famousGarrisons, newFamousState } from '../../common/src/famous-city';
import { npcSnapshot, type NpcCitySnapshot } from '../../common/src/world';
import { scaledMs } from '../../common/src/time-scale';
import { currentCityId } from './city-scope';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { lockCitySnapshot } from './views';

const DAY_MS = 24 * 60 * 60 * 1000;

type DiscardOutcome =
  | { ok: true; cityId: string; x: number; y: number; cooldownUntil: Date }
  | { ok: false; code: ErrorCode };

export async function handleDiscardCity(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  // 必须显式确认（与 RESET_ACCOUNT 同口径）；cityId 必填，缺省主城不能被放弃
  const cityId = currentCityId();
  if (!cityId || data?.confirm !== true) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const outcome = await discardCityTx(client, accountId, cityId);
    if (!outcome.ok) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, outcome.code);
      return;
    }
    await insertEvent(client, {
      accountId,
      cityId: null,
      type: EventType.CITY_DISCARDED,
      initiator: role,
      detail: { cityId, x: outcome.x, y: outcome.y, cooldownUntil: outcome.cooldownUntil.toISOString() },
    });
    await client.query('COMMIT');

    respondOk(ctx.registry, conn, op, seq, {
      cityId,
      x: outcome.x,
      y: outcome.y,
      cooldownUntil: outcome.cooldownUntil.toISOString(),
    });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_CITY_STATE, push: true, data: { reason: 'city_discarded', cityId } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 事务内的放弃判定与结算（调用方负责 BEGIN / COMMIT / ROLLBACK） */
async function discardCityTx(client: pg.PoolClient, accountId: string, cityId: string): Promise<DiscardOutcome> {
  const snap = await lockCitySnapshot(client, accountId, cityId);
  if (!snap) {
    return { ok: false, code: 'INVALID_PARAMS' };
  }
  const mainRes = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
    [accountId],
  );
  if ((mainRes.rows[0] as { id: string } | undefined)?.id === cityId) {
    return { ok: false, code: 'DISCARD_MAIN_CITY' };
  }

  const tileRes = await client.query(
    `SELECT x, y, level FROM world_tiles WHERE kind = 'city' AND owner_city_id = $1 FOR UPDATE`,
    [cityId],
  );
  if (!tileRes.rowCount) {
    return { ok: false, code: 'INTERNAL' };
  }
  const tile = tileRes.rows[0] as { x: number; y: number; level: number };

  // 部队在外：本城发出的行军（含返程、运输、侦察）
  const outside = await client.query(
    `SELECT 1 FROM marches WHERE from_city_id = $1 AND status = 'marching' LIMIT 1`,
    [cityId],
  );
  if (outside.rowCount) {
    return { ok: false, code: 'ARMY_OUTSIDE' };
  }
  // 战斗中：有行军正指向本城或其名下野地，或本城有未结的 NPC 来袭
  const inBattle = await client.query(
    `SELECT 1 FROM marches m JOIN world_tiles wt ON wt.x = m.x AND wt.y = m.y
     WHERE wt.owner_city_id = $1 AND m.status = 'marching'
     UNION ALL
     SELECT 1 FROM npc_attacks WHERE target_city_id = $1 AND resolved_at IS NULL
     LIMIT 1`,
    [cityId],
  );
  if (inBattle.rowCount) {
    return { ok: false, code: 'CITY_IN_BATTLE' };
  }
  // 名下野地驻军须先召回
  const garrisoned = await client.query(
    `SELECT 1 FROM tile_army ta JOIN world_tiles wt ON wt.x = ta.x AND wt.y = ta.y
     WHERE wt.owner_city_id = $1 AND ta.count > 0 LIMIT 1`,
    [cityId],
  );
  if (garrisoned.rowCount) {
    return { ok: false, code: 'WILDERNESS_GARRISONED' };
  }

  const originRes = await client.query(`SELECT origin_level, famous_name FROM cities WHERE id = $1`, [cityId]);
  const origin = originRes.rows[0] as { origin_level: number | null; famous_name: string | null };
  const levels = await loadBuildingLevels(client, cityId);
  const cooldownUntil = await cooldownFrom(client, discardCooldownDays(levels.government) * DAY_MS);

  // 地块回到 NPC 城池：名城按登记恢复为未攻破的名城（城守阶段守军、外围满编）；普通城按来源等级
  const level = origin.famous_name ? FAMOUS_CITY_LEVEL : clampNpcLevel(origin.origin_level ?? 1);
  const base = npcSnapshot(level);
  const npc: NpcCitySnapshot = origin.famous_name
    ? { ...base, garrison: famousGarrisons(level).keeper, famous: newFamousState(origin.famous_name, level) }
    : base;
  await client.query(
    `UPDATE world_tiles SET kind = 'npc_city', level = $3, owner_city_id = NULL, npc = $4::jsonb WHERE x = $1 AND y = $2`,
    [tile.x, tile.y, level, JSON.stringify(npc)],
  );
  await client.query(
    `INSERT INTO city_discards (x, y, account_id, until) VALUES ($1, $2, $3, $4)
     ON CONFLICT (x, y) DO UPDATE SET account_id = EXCLUDED.account_id, until = EXCLUDED.until`,
    [tile.x, tile.y, accountId, cooldownUntil],
  );
  // 名下野地转为无主（owner_city_id 外键 ON DELETE SET NULL），随后删除城池行：
  // 建筑、城内驻军、建造 / 征兵 / 研究队列与城守任命随外键级联清理（资源随城作废）
  await client.query(`DELETE FROM cities WHERE id = $1`, [cityId]);
  return { ok: true, cityId, x: tile.x, y: tile.y, cooldownUntil };
}

/** 冷却截止 = 数据库当前时刻 + 基准时长（按时间缩放） */
async function cooldownFrom(client: pg.PoolClient, baseMs: number): Promise<Date> {
  const res = await client.query(`SELECT now() AS db_now`);
  const now = (res.rows[0] as { db_now: Date }).db_now;
  return new Date(new Date(now).getTime() + scaledMs(baseMs));
}

function clampNpcLevel(level: number): number {
  return Math.min(FAMOUS_CITY_LEVEL, Math.max(1, Math.floor(level)));
}

