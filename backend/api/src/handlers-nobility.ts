// 声望与爵位（v76，AISLG-197）：查询爵位 / 今日俸禄状态、领取每日俸禄。
// 声望由战斗结算与剧本战场军功自动入账（common/src/nobility-db.ts 的 addPrestige），
// 本文件只处理展示与领俸禄。

import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { claimNobilitySalary, loadNobilityStatus } from '../../common/src/nobility-db';

/** GET_NOBILITY（op 126） */
export async function handleGetNobility(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const status = await loadNobilityStatus(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, status as unknown as Record<string, unknown>);
}

/** CLAIM_NOBILITY_SALARY（op 127）：北京日每天一次；平民无俸禄 */
export async function handleClaimNobilitySalary(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const result = await claimNobilitySalary(client, accountId);
    if (result === 'no_nobility') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'NOBILITY_SALARY_NONE');
      return;
    }
    if (result === 'already') {
      await client.query('ROLLBACK');
      const status = await loadNobilityStatus(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'NOBILITY_SALARY_CLAIMED', {
        nextClaimAt: status.nextClaimAt,
      });
      return;
    }
    await client.query('COMMIT');
    respondOk(ctx.registry, conn, op, seq, {
      gold: result.gold,
      index: result.index,
      name: result.name,
      prestige: result.prestige,
      claimedAt: result.claimedAt.toISOString(),
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}