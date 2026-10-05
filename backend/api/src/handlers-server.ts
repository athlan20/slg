// 全服播报查询（v23，AISLG-60）：断线重连后可查看最近若干条大事（推送只覆盖在线时刻）。
// 写入在 Worker 结算事务内（见 common/src/server-broadcast.ts），本文件只读。

import { listServerBroadcasts } from '../../common/src/server-broadcast';
import { readIntInRange, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** GET_SERVER_BROADCASTS：全服播报倒序分页（limit 1..50 缺省 20；无分页游标，
 *  历史播报仅保留最近若干条——它不是事件流，定位就是「最近的大事」） */
export async function handleGetServerBroadcasts(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const limit = readIntInRange(data, 'limit', 1, 50, 20);
  const broadcasts = await listServerBroadcasts(ctx.pool, limit);
  respondOk(ctx.registry, conn, op, seq, { broadcasts });
}
