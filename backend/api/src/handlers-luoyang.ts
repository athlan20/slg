// 洛阳争夺（v79，AISLG-200）：查询洛阳状态 / 洛阳之主盟主发布政令。
// 窗口、加成、政令规则见 common/src/luoyang.ts；状态与发布读写在 common/src/luoyang-db.ts。

import { NOTIFY_CHANNEL } from '../../common/src/db';
import { isDecreeKind } from '../../common/src/luoyang';
import { loadLuoyangStatus, publishDecree } from '../../common/src/luoyang-db';
import { recordAllianceEvent } from '../../common/src/alliance-db';
import { insertServerBroadcast } from '../../common/src/server-broadcast';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** GET_LUOYANG（op 137）：玩家与 Agent 通用 */
export async function handleGetLuoyang(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const status = await loadLuoyangStatus(ctx.pool, conn.accountId as string);
  respondOk(ctx.registry, conn, op, seq, status as unknown as Record<string, unknown>);
}

/** PUBLISH_DECREE（op 138）：仅洛阳之主盟主，每 7 天一次 */
export async function handlePublishDecree(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  if (conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  const raw = readString(data, 'kind');
  if (!isDecreeKind(raw)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const kind = raw;
  const client = await ctx.pool.connect();
  let allianceId = '';
  let until = new Date();
  try {
    await client.query('BEGIN');
    const result = await publishDecree(client, accountId, kind);
    if (!result.ok) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, result.code, result.nextAt
        ? { nextAt: result.nextAt.toISOString(), retryAfterSeconds: Math.max(1, Math.ceil((result.nextAt.getTime() - Date.now()) / 1000)) }
        : undefined);
      return;
    }
    allianceId = result.allianceId;
    until = result.until;
    await recordAllianceEvent(client, allianceId, 'decree_published', {
      accountId, decreeKind: kind, until: until.toISOString(),
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  // 全服播报（联盟政令是大事；失败不影响发布）
  try {
    const broadcastClient = await ctx.pool.connect();
    let created = null as Awaited<ReturnType<typeof insertServerBroadcast>>;
    try {
      await broadcastClient.query('BEGIN');
      created = await insertServerBroadcast(
        broadcastClient,
        'luoyang_window',
        { phase: 'decree', allianceId, decreeKind: kind, until: until.toISOString() },
        { force: true },
      );
      await broadcastClient.query('COMMIT');
    } finally {
      broadcastClient.release();
    }
    if (created) {
      await ctx.pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: created }),
      ]);
    }
  } catch (err) {
    console.error('decree broadcast failed:', err instanceof Error ? err.message : err);
  }
  const status = await loadLuoyangStatus(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, status as unknown as Record<string, unknown>);
}
