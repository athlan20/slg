// 赎回被俘名将（v94，AISLG-228）：RANSOM_HERO（op 151）。只有主人能赎；赎金 = 2000 × 等级，从主人主城扣全额，
// 胜方主城收 50%，另一半销毁（规则见 common/src/hero-capture-db.ts 的 payRansom）。锁序与 GIFT_HERO 一致：
// 先锁主人主城（lockCitySnapshot 同时结算生产），再武将行，最后胜方主城。与囚禁到期的下野共用武将行锁互斥。

import { Op, type InitiatorRole } from '../../common/src/protocol';
import { heroView } from '../../common/src/hero-db';
import { payRansom } from '../../common/src/hero-capture-db';
import { mainCityId } from '../../common/src/hero-growth-db';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { lockCitySnapshot, toCityView } from './views';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function handleRansomHero(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const heroId = data?.heroId;
  if (typeof heroId !== 'string' || !UUID_RE.test(heroId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const capitalId = await mainCityId(client, accountId);
    const snap = capitalId ? await lockCitySnapshot(client, accountId, capitalId) : null;
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_NOT_FOUND');
      return;
    }
    const outcome = await payRansom(client, { ownerAccountId: accountId, heroId, capitalId: snap.cityId });
    if ('error' in outcome) {
      await client.query('ROLLBACK');
      // 用本事务已锁住的快照回包（另开连接读城池会等本事务持有的城池行锁）
      respondError(
        ctx.registry,
        conn,
        op,
        seq,
        outcome.error,
        outcome.error === 'INSUFFICIENT_RESOURCES' ? { city: toCityView(snap) } : undefined,
      );
      return;
    }
    await client.query('COMMIT');
    const view = heroView(outcome.hero, null, null);
    respondOk(ctx.registry, conn, op, seq, {
      hero: view,
      ransom: { cost: outcome.cost, taxShare: outcome.taxShare, destroyed: outcome.destroyed },
    });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_HERO_STATE, push: true, data: { reason: 'ransomed', heroId: outcome.hero.id, initiator: role } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
