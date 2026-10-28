// RECALL_GARRISON（v12 起；v83 / AISLG-207 起支持按兵种部分撤回）。从 handlers-world.ts 拆出以控制单文件行数。
// - 不带 troops：撤回全部驻军并立即放弃占领（占位规则）：野地回到无主状态，部队作为返程行军
//   回城，到达后才并入城内驻军；
// - 带 troops（v83）：只撤指定兵种与数量，保留占领；被撤的兵作为返程行军回占领城，剩余驻军
//   继续守地。部分撤回后地块至少留 1 兵：撤空返回 GARRISON_WOULD_EMPTY，超过驻军返回
//   INSUFFICIENT_GARRISON，两者都不改任何数据；
// 两种用法共用同一事务结构与锁序：先锁占领城并结算生产（野地加成按归属变化前的速率结到当前
// 时刻），再锁地块并复核归属。

import pg from 'pg';
import {
  Op,
  EventType,
  TROOP_KINDS,
  type InitiatorRole,
  type TroopKind,
} from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { isEmptyArmy } from '../../common/src/battle';
import { marchTravelSeconds } from '../../common/src/world';
import {
  clearTileOccupation,
  loadTerritory,
  loadTile,
  loadTileArmy,
  type TileRow,
} from '../../common/src/world-db';
import { loadArmyFoodUsePerHour, loadBuildingLevels, settleCityProduction, type CityProductionRow } from '../../common/src/production';
import { marchingPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadWorldWindow } from './views-world';
import { marchView, type MarchRow } from './views';

type Troops = Partial<Record<TroopKind, number>>;

/**
 * RECALL_GARRISON 的 troops 解析（v83）。缺省或 null = 全撤（返回 { troops: null }）；
 * 否则必须是非空对象，键为已知兵种、值为正整数，不合法返回 null（调用方答 INVALID_PARAMS）。
 */
export function readRecallTroops(data: Record<string, unknown> | undefined): { troops: Troops | null } | null {
  const raw = data?.troops;
  if (raw === undefined || raw === null) {
    return { troops: null };
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const troops: Troops = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!(TROOP_KINDS as readonly string[]).includes(key)) {
      return null;
    }
    if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
      return null;
    }
    troops[key as TroopKind] = value;
  }
  if (Object.keys(troops).length === 0) {
    return null;
  }
  return { troops };
}

/**
 * 部分撤回的校验（v83）：先看每个兵种是否超过驻军，再看撤回总数是否会撤空地块（至少留 1 兵）。
 * 返回 null 表示通过。
 */
function partialRecallDenial(army: Record<TroopKind, number>, troops: Troops): 'INSUFFICIENT_GARRISON' | 'GARRISON_WOULD_EMPTY' | null {
  for (const kind of TROOP_KINDS) {
    if ((troops[kind] ?? 0) > (army[kind] ?? 0)) {
      return 'INSUFFICIENT_GARRISON';
    }
  }
  const garrisonTotal = TROOP_KINDS.reduce((sum, kind) => sum + (army[kind] ?? 0), 0);
  const recallTotal = TROOP_KINDS.reduce((sum, kind) => sum + (troops[kind] ?? 0), 0);
  return recallTotal >= garrisonTotal ? 'GARRISON_WOULD_EMPTY' : null;
}

/** 逐兵种扣减地块驻军（部分撤回用；归零的行随后删除） */
async function takeTileArmy(client: pg.PoolClient, x: number, y: number, troops: Troops): Promise<void> {
  for (const [troop, count] of Object.entries(troops)) {
    await client.query(
      `UPDATE tile_army SET count = count - $3, updated_at = now()
       WHERE x = $1 AND y = $2 AND troop = $4`,
      [x, y, count ?? 0, troop],
    );
  }
  await client.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2 AND count <= 0`, [x, y]);
}

/** 写一条回城的返程行军（全撤与部分撤回共用）：返程按撤回编队的最慢兵种折算速度 */
async function startReturnMarch(
  client: pg.PoolClient,
  args: { accountId: string; role: InitiatorRole; ownerCityId: string; cityX: number; cityY: number; x: number; y: number; troops: Troops },
): Promise<MarchRow> {
  const { accountId, role, ownerCityId, cityX, cityY, x, y, troops } = args;
  const travel = marchTravelSeconds(cityX, cityY, x, y, troops, marchingPercent(await loadTechLevels(client, accountId)));
  const ins = await client.query(
    `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, 'return', 'marching', $6, now() + make_interval(secs => $7))
     RETURNING *`,
    [accountId, ownerCityId, x, y, JSON.stringify(troops), role, travel],
  );
  const march = ins.rows[0] as MarchRow;
  await insertEvent(client, {
    accountId,
    cityId: ownerCityId,
    buildId: march.id,
    type: EventType.MARCH_STARTED,
    initiator: role,
    detail: { x, y, troops, purpose: 'return', arriveAt: march.arrive_at.toISOString() },
  });
  return march;
}

/**
 * RECALL_GARRISON：不带 troops 撤回本账号占领野地的全部驻军（撤回即放弃占领，部队返程回城）；
 * 带 troops 按兵种部分撤回（保留占领，地块至少留 1 兵）。
 */
export async function handleRecallGarrison(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  x: number,
  y: number,
  troops: Troops | null,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  // 先无锁读地块找到占领城，确认归属本账号后再进事务（锁序与出征一致）
  const probe = await loadTile(ctx.pool, x, y);
  if (!probe || probe.kind !== 'wilderness' || !probe.owner_city_id) {
    respondError(ctx.registry, conn, op, seq, 'TILE_NOT_OCCUPIED');
    return;
  }
  const ownerRes = await ctx.pool.query(
    `SELECT id FROM cities WHERE id = $1 AND account_id = $2`,
    [probe.owner_city_id, accountId],
  );
  if (!ownerRes.rowCount) {
    respondError(ctx.registry, conn, op, seq, 'TILE_NOT_OCCUPIED');
    return;
  }
  const ownerCityId = probe.owner_city_id;

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 锁占领城并结算生产：野地加成在归属清除前按旧速率结到当前时刻（产量切分）
    const cityRes = await client.query(
      `SELECT id, name, level, x, y, gold, wood, food, stone, iron,
              settled_at, gold_rem, food_rem, wood_rem, stone_rem, iron_rem,
              population, population_rem, now() AS db_now
       FROM cities WHERE id = $1 FOR UPDATE`,
      [ownerCityId],
    );
    const cityRow = cityRes.rows[0] as CityProductionRow & { x: number | null; y: number | null; db_now: Date };
    if (!cityRow || cityRow.x === null || cityRow.y === null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const levels = await loadBuildingLevels(client, ownerCityId);
    const territory = await loadTerritory(client, ownerCityId);
    await settleCityProduction(
      client,
      cityRow,
      levels,
      cityRow.db_now,
      territory,
      await loadArmyFoodUsePerHour(client, ownerCityId),
    );

    // 复核地块归属未变（并发召回 / NPC 袭击由行锁串开）
    const tileRes = await client.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [x, y]);
    const tile = tileRes.rows[0] as TileRow | undefined;
    if (!tile || tile.kind !== 'wilderness' || tile.owner_city_id !== ownerCityId) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'TILE_NOT_OCCUPIED');
      return;
    }
    const army = await loadTileArmy(client, x, y);

    if (troops) {
      // 部分撤回（v83）：保留占领，只撤指定兵种；不调用 clearTileOccupation、不写 WILDERNESS_LOST
      const denial = partialRecallDenial(army, troops);
      if (denial) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, denial);
        return;
      }
      await takeTileArmy(client, x, y, troops);
      const march = await startReturnMarch(client, {
        accountId, role, ownerCityId, cityX: cityRow.x, cityY: cityRow.y, x, y, troops,
      });
      await client.query('COMMIT');

      const view = marchView(march);
      respondOk(ctx.registry, conn, op, seq, { march: view });
      ctx.registry.broadcast(
        accountId,
        { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_started', march: view } },
        conn,
      );
      return;
    }

    // 全部撤回（v12 行为不变）：清除占领，驻军整编队返程
    await clearTileOccupation(client, x, y);
    let march: MarchRow | null = null;
    if (!isEmptyArmy(army)) {
      march = await startReturnMarch(client, {
        accountId, role, ownerCityId, cityX: cityRow.x, cityY: cityRow.y, x, y, troops: army,
      });
    }
    await insertEvent(client, {
      accountId,
      cityId: ownerCityId,
      type: EventType.WILDERNESS_LOST,
      initiator: role,
      detail: { x, y, cause: 'recall', terrain: tile.terrain, level: tile.level },
    });
    await client.query('COMMIT');

    const view = march ? marchView(march) : null;
    respondOk(ctx.registry, conn, op, seq, view ? { march: view } : { march: null });
    const tileViewRow = await loadWorldWindow(ctx.pool, x, y, 1, 1, accountId);
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_TILE_STATE, push: true, data: { reason: 'wilderness_lost', tile: tileViewRow[0] } },
      conn,
    );
    if (view) {
      ctx.registry.broadcast(
        accountId,
        { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_started', march: view } },
        conn,
      );
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
