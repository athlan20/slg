// 剧本战场商店（v75，AISLG-198）：军功兑换资源包 / 武将经验 / 兵，按场限购。
// 军功来自 battlefield_merit（跨场累积、换季清零），价格与限购见 common/src/battlefield.ts。

import { EventType, isBattlefieldShopItem } from '../../common/src/protocol';
import { battlefieldShopDef } from '../../common/src/battlefield';
import { insertEvent } from '../../common/src/events';
import { grantHeroExp } from '../../common/src/hero-db';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadMainCity } from './handlers-battlefield';

/** BUY_BATTLEFIELD_ITEM（op 125）：军功换资源包 / 武将经验 / 兵 */
export async function handleBuyBattlefieldItem(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const item = data?.item;
  if (!isBattlefieldShopItem(item)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const def = battlefieldShopDef(item);
  const heroId = typeof data?.heroId === 'string' ? data.heroId : null;
  if (!def || (item === 'hero_exp' && !heroId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  let reward: Record<string, unknown> = {};
  let bought = 0;
  let balance = 0;
  try {
    await client.query('BEGIN');
    const eventRes = await client.query(`SELECT * FROM battlefield_events ORDER BY signup_start DESC LIMIT 1`);
    const event = eventRes.rows[0] as { id: string } | undefined;
    if (!event) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_NOT_ACTIVE');
      return;
    }
    const main = await loadMainCity(client, accountId);
    if (!main) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const purchaseRes = await client.query(
      `INSERT INTO battlefield_purchases (event_id, account_id, item, count) VALUES ($1, $2, $3, 0)
       ON CONFLICT (event_id, account_id, item) DO UPDATE SET count = battlefield_purchases.count
       RETURNING count`,
      [event.id, accountId, item],
    );
    bought = Number((purchaseRes.rows[0] as { count: number | string }).count);
    if (bought >= def.limit) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_SHOP_LIMIT', { limit: def.limit, bought });
      return;
    }
    const balanceRes = await client.query(
      `SELECT merit FROM battlefield_merit WHERE account_id = $1 FOR UPDATE`,
      [accountId],
    );
    balance = Number((balanceRes.rows[0] as { merit: string | number } | undefined)?.merit ?? 0);
    if (balance < def.cost) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'BATTLEFIELD_MERIT_INSUFFICIENT', { cost: def.cost, balance });
      return;
    }
    await client.query(`UPDATE battlefield_merit SET merit = merit - $2, updated_at = now() WHERE account_id = $1`, [
      accountId,
      def.cost,
    ]);
    await client.query(
      `UPDATE battlefield_purchases SET count = count + 1 WHERE event_id = $1 AND account_id = $2 AND item = $3`,
      [event.id, accountId, item],
    );
    bought += 1;
    if (item === 'resources') {
      const each = def.resourcesEach ?? 0;
      await client.query(
        `UPDATE cities SET wood = wood + $2, food = food + $2, stone = stone + $2, iron = iron + $2 WHERE id = $1`,
        [main.id, each],
      );
      reward = { resources: { gold: 0, wood: each, food: each, stone: each, iron: each } };
    } else if (item === 'hero_exp') {
      const hero = await client.query(`SELECT id FROM account_heroes WHERE id = $1 AND account_id = $2`, [
        heroId,
        accountId,
      ]);
      if (!hero.rowCount) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'HERO_NOT_FOUND');
        return;
      }
      const exp = await grantHeroExp(client, heroId as string, def.heroExp ?? 0);
      reward = { heroExp: def.heroExp ?? 0, level: exp?.level ?? null, leveledTo: exp?.leveledTo ?? null };
    } else if (def.troop && def.count) {
      await client.query(
        `INSERT INTO city_army (city_id, troop, count, updated_at) VALUES ($1, $2, $3, now())
         ON CONFLICT (city_id, troop) DO UPDATE SET count = city_army.count + $3, updated_at = now()`,
        [main.id, def.troop, def.count],
      );
      reward = { troop: def.troop, count: def.count };
    }
    await insertEvent(client, {
      accountId,
      cityId: main.id,
      type: EventType.BATTLEFIELD_SHOP,
      initiator: conn.role,
      detail: { eventId: event.id, item, cost: def.cost, reward },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  respondOk(ctx.registry, conn, op, seq, {
    item,
    cost: def.cost,
    cumulativeMerit: balance - def.cost,
    bought,
    reward,
  });
}

