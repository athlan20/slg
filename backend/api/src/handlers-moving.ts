// 移动目标查询（v28，AISLG-78）：GET_MOVING_TARGETS。目标的刷新与结算在 Worker
// （worker/src/moving-tick.ts、intercept-tick.ts）；这里只读，视图只给大致范围。

import { loadActiveMovingTargets, movingTargetView } from '../../common/src/moving-target-db';
import { respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** GET_MOVING_TARGETS：当前存在的全部移动目标（含位置、公开路线与时刻表） */
export async function handleGetMovingTargets(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const rows = await loadActiveMovingTargets(ctx.pool);
  const now = Date.now();
  respondOk(ctx.registry, conn, op, seq, { targets: rows.map((row) => movingTargetView(row, now)) });
}
