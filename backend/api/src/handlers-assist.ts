// 协防的召回 / 遣返（v74，AISLG-194）：DISMISS_ASSIST。派出方随时召回，城主可遣返任意一支。
// 规则见 common/src/city-assist.ts；返程行军与事件由 city-assist-db 的 sendAssistHome 统一处理。

import { Op } from '../../common/src/protocol';
import { loadAssistForAction, sendAssistHome } from '../../common/src/city-assist-db';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { marchView, type MarchRow } from './views';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleDismissAssist(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const assistId = data?.assistId;
  if (typeof assistId !== 'string' || !UUID_RE.test(assistId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const assist = await loadAssistForAction(client, assistId);
    if (!assist || (assist.provider_account_id !== accountId && assist.host_account_id !== accountId)) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ASSIST_NOT_FOUND');
      return;
    }
    const cause = assist.provider_account_id === accountId ? 'recall' : 'expel';
    const returned = await sendAssistHome(client, assist, cause);
    let march: MarchRow | null = null;
    if (returned.marchId) {
      const marchRes = await client.query(`SELECT * FROM marches WHERE id = $1`, [returned.marchId]);
      march = marchRes.rowCount ? (marchRes.rows[0] as MarchRow) : null;
    }
    await client.query('COMMIT');

    respondOk(ctx.registry, conn, op, seq, { assistId: returned.assistId, marchId: returned.marchId });
    // 双方都刷新城池 / 协防列表（发起连接已拿到响应，也一并推，客户端按需对齐）
    for (const target of new Set([accountId, returned.providerAccountId, returned.hostAccountId ?? ''].filter(Boolean))) {
      ctx.registry.broadcast(target, {
        op: Op.PUSH_CITY_STATE,
        push: true,
        data: { reason: 'assist_changed', cityId: returned.hostCityId },
      });
    }
    if (march) {
      ctx.registry.broadcast(returned.providerAccountId, {
        op: Op.PUSH_MARCH_STATE,
        push: true,
        data: { reason: 'march_started', march: marchView(march) },
      });
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
