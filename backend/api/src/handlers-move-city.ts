// 城池迁移（AISLG-220，v91）：MOVE_CITY（op 150）。规则见 common/src/move-city.ts，读取见 common/src/move-city-db.ts。
// 锁序：账号名下全部城池行按 id 升序 FOR UPDATE（同 SET_CAPITAL），之后才读写地块行（world_tiles）。
// 校验全部在锁内做；消耗道具（consumeItem）是事务里最后一个会失败的写操作，失败整体回滚：不扣令、不改任何数据。
// preview = true 走同一套校验后回滚，只返回预览结果。

import { EventType, Op, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { inWorld } from '../../common/src/world';
import { consumeItem } from '../../common/src/items-db';
import { isMoveCityMode } from '../../common/src/move-city';
import type { MoveCityPreviewData } from '../../common/src/protocol-move-city';
import { loadWorldWindow } from './views-world';
import { pushItemsState } from './handlers-items';
import { currentCityId } from './city-scope';
import { respondError, respondOk } from './frames';
import { moveCityTx, type MovedResult, type Point } from './handlers-move-city-tx';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

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
