// 城池迁移（AISLG-220，v91）：MOVE_CITY（op 150）。规则见 common/src/move-city.ts，读取见 common/src/move-city-db.ts。
// 锁序：账号名下全部城池行按 id 升序 FOR UPDATE（同 SET_CAPITAL），之后才读写地块行（world_tiles）。
// 校验全部在锁内做；消耗道具（consumeItem）是事务里最后一个会失败的写操作，失败整体回滚：不扣令、不改任何数据。
// preview = true 走同一套校验后回滚，只返回预览结果。

import pg from 'pg';
import { EventType, Op, type ErrorCode, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadBuildingLevels } from '../../common/src/production';
import { discardCooldownUntil } from '../../common/src/branch-city-db';
import { inWorld, npcSnapshot } from '../../common/src/world';
import { claimCityTile } from '../../common/src/world-db';
import { consumeItem } from '../../common/src/items-db';
import type { ItemId } from '../../common/src/items';
import {
  MOVE_CITY_MIN_GAP,
  drawWildernessLevel,
  isMoveCityMode,
  moveAttackLockUntil,
  moveCityDenial,
  moveCityItemOf,
  moveDistance,
  moveNpcLevelOf,
  moveOldTileOf,
  moveTileUsable,
  type MoveCityMode,
} from '../../common/src/move-city';
import {
  countMoveItem,
  hasFreeWilderness,
  loadMoveCityFacts,
  loadTileBrief,
  tooCloseToOtherCities,
} from '../../common/src/move-city-db';
import type { MoveCityPreviewData, MoveCityResponseData } from '../../common/src/protocol-move-city';
import { loadWorldWindow } from './views-world';
import { pushItemsState } from './handlers-items';
import { currentCityId } from './city-scope';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

interface Point {
  x: number;
  y: number;
}

interface MovedResult {
  response: MoveCityResponseData;
  oldTile: Point;
  newTile: Point;
  /** 事件 city_moved 的 detail（item 为消耗的道具 id） */
  event: Record<string, unknown> & { item: ItemId };
}

type MoveTxOutcome =
  | { ok: false; code: ErrorCode; data?: Record<string, unknown> }
  | { ok: true; preview: MoveCityPreviewData }
  | { ok: true; moved: MovedResult };

export async function handleMoveCity(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const cityId = currentCityId();
  const mode = data?.mode;
  const preview = data?.preview === true;
  // cityId 必填（分发层已校验归属）；mode 只认 random / pointing；执行必须 confirm = true
  if (!cityId || !isMoveCityMode(mode) || (!preview && data?.confirm !== true)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  let target: Point | null = null;
  if (mode === 'pointing') {
    const x = data?.x as number;
    const y = data?.y as number;
    if (!inWorld(x, y)) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    target = { x, y };
  }

  const client = await ctx.pool.connect();
  let moved: MovedResult | null = null;
  let previewData: MoveCityPreviewData | null = null;
  try {
    await client.query('BEGIN');
    const outcome = await moveCityTx(client, { accountId, cityId, mode, target, preview });
    if (!outcome.ok) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, outcome.code, outcome.data);
      return;
    }
    if ('preview' in outcome) {
      await client.query('ROLLBACK');
      previewData = outcome.preview;
    } else {
      const { moved: m } = outcome;
      await insertEvent(client, {
        accountId,
        cityId,
        type: EventType.CITY_MOVED,
        initiator: role,
        detail: m.event,
      });
      // 扣道具放最后一步：失败则整个事务回滚（迁城与坐标都不生效）
      const used = await consumeItem(client, accountId, m.event.item, 1, 'move_city');
      if (!used.ok) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, used.code, { itemId: m.event.item, count: used.count });
        return;
      }
      await client.query('COMMIT');
      m.response.left = used.count;
      moved = m;
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  if (previewData) {
    respondOk(ctx.registry, conn, op, seq, previewData as unknown as Record<string, unknown>);
    return;
  }
  if (!moved) {
    return;
  }
  respondOk(ctx.registry, conn, op, seq, moved.response as unknown as Record<string, unknown>);
  ctx.registry.broadcast(
    accountId,
    {
      op: Op.PUSH_CITY_STATE,
      push: true,
      data: { reason: 'city_moved', cityId, from: moved.oldTile, to: moved.newTile },
    },
    conn,
  );
  // 新旧两格各推一次地块变化（归属方视角）
  for (const point of [moved.oldTile, moved.newTile]) {
    const rows = await loadWorldWindow(ctx.pool, point.x, point.y, 1, 1, accountId);
    if (rows[0]) {
      ctx.registry.broadcast(
        accountId,
        { op: Op.PUSH_TILE_STATE, push: true, data: { reason: 'city_moved', tile: rows[0] } },
        conn,
      );
    }
  }
  await pushItemsState(ctx, accountId, conn);
}

/** 事务内的迁城判定与改写（调用方负责 BEGIN / COMMIT / ROLLBACK；扣道具由调用方在最后执行） */
async function moveCityTx(
  client: pg.PoolClient,
  input: { accountId: string; cityId: string; mode: MoveCityMode; target: Point | null; preview: boolean },
): Promise<MoveTxOutcome> {
  const { accountId, cityId, mode, target, preview } = input;
  // 锁序：账号名下全部城池行按 id 升序加锁
  await client.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY id FOR UPDATE`, [accountId]);
  const facts = await loadMoveCityFacts(client, accountId, cityId);
  if (!facts) {
    return { ok: false, code: 'INVALID_PARAMS' };
  }
  if (facts.x === null || facts.y === null) {
    // 城池没有地块坐标属世界分配异常，无法迁移
    return { ok: false, code: 'INTERNAL' };
  }
  // 1-3：名城 → 军队在外 → 盟友驻军 → 战乱（判定顺序即提示优先级）
  const denial = moveCityDenial(facts);
  if (denial) {
    return { ok: false, code: denial.code, data: denial.data };
  }

  const from: Point = { x: facts.x, y: facts.y };
  const oldTile = moveOldTileOf(facts.isMain);
  const item = moveCityItemOf(mode);
  const dbNow = facts.dbNow;

  // 目标格：指定坐标须为无主空野地且不贴近他人城池；随机迁只需世界里还有空地
  let to: Point | null = null;
  if (mode === 'pointing' && target) {
    const tile = await loadTileBrief(client, target.x, target.y);
    if (!moveTileUsable(tile)) {
      return { ok: false, code: 'MOVE_CITY_TILE_INVALID' };
    }
    if (await tooCloseToOtherCities(client, accountId, target.x, target.y)) {
      return { ok: false, code: 'MOVE_CITY_TOO_CLOSE', data: { minGap: MOVE_CITY_MIN_GAP } };
    }
    to = target;
  } else if (!(await hasFreeWilderness(client))) {
    return { ok: false, code: 'MOVE_CITY_NO_SPACE' };
  }

  // 道具预检（只读；最终扣减在事务末尾的 consumeItem 完成，并发时以它为准）
  const have = await countMoveItem(client, accountId, item);
  if (have < 1) {
    return { ok: false, code: 'INSUFFICIENT_ITEM', data: { itemId: item, count: have } };
  }

  if (preview) {
    return {
      ok: true,
      preview: {
        preview: true,
        cityId,
        mode,
        itemId: item,
        count: have,
        need: 1,
        from,
        to,
        distance: to ? moveDistance(from, to) : null,
        oldTile,
        attackLockSeconds:
          mode === 'pointing'
            ? Math.ceil((moveAttackLockUntil(dbNow).getTime() - dbNow.getTime()) / 1000)
            : null,
      },
    };
  }

  // ---- 写入（以下任一步失败由调用方整体回滚）----
  // 新格：随机迁走世界统一选址（同注册落位 claimCityTile，并写 cities.x / y）；指定坐标条件 UPDATE 占格
  if (mode === 'random') {
    const site = await claimCityTile(client, cityId);
    if (!site) {
      return { ok: false, code: 'MOVE_CITY_NO_SPACE' };
    }
    to = site;
  } else if (to) {
    const upd = await client.query(
      `UPDATE world_tiles SET kind = 'city', level = 0, owner_city_id = $3, npc = NULL
       WHERE x = $1 AND y = $2 AND kind = 'wilderness' AND owner_city_id IS NULL AND npc IS NULL`,
      [to.x, to.y, cityId],
    );
    if (!upd.rowCount) {
      // 0 行：判定之后被别人抢先占走（并发）
      return { ok: false, code: 'MOVE_CITY_TILE_TAKEN' };
    }
    await client.query(`UPDATE cities SET x = $2, y = $3 WHERE id = $1`, [cityId, to.x, to.y]);
  }
  const newPoint = to as Point;

  // 旧格：主城变空野地（地形保留、等级重抽）；分城回归 NPC 城（来源等级）并写占回冷却
  if (facts.isMain) {
    await client.query(
      `UPDATE world_tiles SET kind = 'wilderness', level = $4, owner_city_id = NULL, npc = NULL
       WHERE x = $1 AND y = $2 AND kind = 'city' AND owner_city_id = $3`,
      [from.x, from.y, cityId, drawWildernessLevel()],
    );
  } else {
    const level = moveNpcLevelOf(facts.originLevel);
    await client.query(
      `UPDATE world_tiles SET kind = 'npc_city', level = $3, owner_city_id = NULL, npc = $4::jsonb
       WHERE x = $1 AND y = $2 AND kind = 'city' AND owner_city_id = $5`,
      [from.x, from.y, level, JSON.stringify(npcSnapshot(level)), cityId],
    );
    const governmentLevel = (await loadBuildingLevels(client, cityId)).government;
    const until = await discardCooldownUntil(client, governmentLevel);
    await client.query(
      `INSERT INTO city_discards (x, y, account_id, until) VALUES ($1, $2, $3, $4)
       ON CONFLICT (x, y) DO UPDATE SET account_id = EXCLUDED.account_id, until = EXCLUDED.until`,
      [from.x, from.y, accountId, until],
    );
  }

  // 指定坐标迁后 12 小时出征限制（随机迁不设）
  if (mode === 'pointing') {
    await client.query(`UPDATE cities SET move_lock_until = $2 WHERE id = $1`, [cityId, moveAttackLockUntil(dbNow)]);
  }

  const distance = moveDistance(from, newPoint);
  const moveLockUntil = mode === 'pointing' ? moveAttackLockUntil(dbNow).toISOString() : null;
  return {
    ok: true,
    moved: {
      response: {
        cityId,
        mode,
        from,
        to: newPoint,
        distance,
        itemId: item,
        left: 0,
        oldTile,
        moveLockUntil,
      },
      oldTile: from,
      newTile: newPoint,
      event: {
        cityId,
        mode,
        from,
        to: newPoint,
        distance,
        item,
        oldTile,
      },
    },
  };
}
