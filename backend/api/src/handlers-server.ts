// 全服播报查询（v23，AISLG-60）：断线重连后可查看最近若干条大事（推送只覆盖在线时刻）。
// 写入在 Worker 结算事务内（见 common/src/server-broadcast.ts），本文件只读。

import { listServerBroadcasts } from '../../common/src/server-broadcast';
import { isServerBroadcastCategory, type ServerBroadcastCategory } from '../../common/src/protocol-server';
import { readIntInRange, readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** GET_SERVER_BROADCASTS：全服播报倒序分页（limit 1..50 缺省 20；无分页游标，
 *  历史播报仅保留最近若干条——它不是事件流，定位就是「最近的大事」）。
 *  v112（AISLG-260）：可选 category = event（活动 / 玩法节点）| war（战况与其余大事），后端过滤；非法值 INVALID_PARAMS。 */
export async function handleGetServerBroadcasts(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const limit = readIntInRange(data, 'limit', 1, 50, 20);
  const rawCategory = readString(data, 'category');
  if (data?.category !== undefined && rawCategory === null) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (rawCategory !== null && !isServerBroadcastCategory(rawCategory)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const category = rawCategory === null ? undefined : (rawCategory as ServerBroadcastCategory);
  const broadcasts = await listServerBroadcasts(ctx.pool, limit, category);
  respondOk(ctx.registry, conn, op, seq, { broadcasts });
}
