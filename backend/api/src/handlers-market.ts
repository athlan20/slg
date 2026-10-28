// 玩家交易所（v78，AISLG-196）：查询挂单 / 挂单 / 吃单 / 撤单。
// 挂单冻结卖出资源；吃单在事务里锁挂单行，按剩余量扣减，双方各派一支商队（purpose='caravan'）送货。
// 规则与数值见 common/src/market.ts；查询与过期回收见 common/src/market-db.ts。

import type pg from 'pg';
import { EventType, Op, type Resources } from '../../common/src/protocol';
import {
  MARKET_FEE_PERCENT,
  MARKET_MIN_AMOUNT,
  MARKET_ORDER_TTL_MS,
  isMarketBuyKind,
  isMarketOrderPair,
  isMarketResource,
  isPriceAllowed,
  marketAfterFee,
  marketDailyLimit,
  marketPayment,
  marketPriceRange,
  marketReferenceValue,
  type MarketBuyKind,
  type MarketResource,
} from '../../common/src/market';
import {
  loadMarketLimits,
  loadMarketOrders,
  loadMyMarket,
  marketDailyUsed,
  marketOrderView,
  type MarketOrderRow,
} from '../../common/src/market-db';
import { insertEvent } from '../../common/src/events';
import { loadBuildingLevels } from '../../common/src/production';
import { loadTechLevels } from '../../common/src/tech-db';
import { stationPercent } from '../../common/src/building-effects';
import { marchingPercent } from '../../common/src/tech';
import { marchTravelSeconds } from '../../common/src/world';
import { currentCityId } from './city-scope';
import { readIntInRange, readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

type Client = pg.PoolClient;
const PAGE_SIZE = 10;

interface CityRow {
  id: string;
  name: string;
  x: number | null;
  y: number | null;
  gold: string | number;
  food: string | number;
  wood: string | number;
  stone: string | number;
  iron: string | number;
}

/** 锁住本账号的一座城（缺省当前城 / 主城）；不存在返回 null */
async function lockOwnCity(client: Client, accountId: string, cityId?: string): Promise<CityRow | null> {
  const res = await client.query(
    `SELECT id, name, x, y, gold, food, wood, stone, iron FROM cities
     WHERE account_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
     ORDER BY created_at LIMIT 1 FOR UPDATE`,
    [accountId, cityId ?? null],
  );
  return (res.rows[0] as CityRow | undefined) ?? null;
}

async function mainCityId(q: pg.Pool | Client, accountId: string): Promise<string | null> {
  const res = await q.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [accountId]);
  return (res.rows[0] as { id: string } | undefined)?.id ?? null;
}

async function sellerAllianceId(q: pg.Pool | Client, accountId: string): Promise<string | null> {
  const res = await q.query(`SELECT alliance_id FROM alliance_members WHERE account_id = $1`, [accountId]);
  return (res.rows[0] as { alliance_id: string } | undefined)?.alliance_id ?? null;
}

/**
 * 派一支商队（复用运输行军的到达结算）：把 cargo 从 fromCity 送到 toCity。
 * 时长与运输同口径（每格 15 秒基准 ÷ 时间缩放，吃出发城驿站与行军科技加速）。
 */
async function createCaravan(
  client: Client,
  accountId: string,
  fromCityId: string,
  toCityId: string,
  cargo: Partial<Resources>,
  initiator: string,
): Promise<string> {
  const cities = await client.query(
    `SELECT id, x, y FROM cities WHERE id = ANY($1::uuid[])`,
    [[fromCityId, toCityId]],
  );
  const byId = new Map((cities.rows as Array<{ id: string; x: number | null; y: number | null }>).map((row) => [row.id, row]));
  const from = byId.get(fromCityId);
  const to = byId.get(toCityId);
  const fromX = from?.x ?? 0;
  const fromY = from?.y ?? 0;
  const toX = to?.x ?? 0;
  const toY = to?.y ?? 0;
  const levels = await loadBuildingLevels(client, fromCityId);
  const techs = await loadTechLevels(client, accountId);
  const seconds = marchTravelSeconds(fromX, fromY, toX, toY, undefined, marchingPercent(techs) + stationPercent(levels.post_station));
  const inserted = await client.query(
    `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, cargo, to_city_id)
     VALUES ($1, $2, $3, $4, '{}'::jsonb, 'caravan', 'marching', $5, $6, $7::jsonb, $8)
     RETURNING id`,
    [accountId, fromCityId, toX, toY, initiator, new Date(Date.now() + seconds * 1000), JSON.stringify(cargo), toCityId],
  );
  return inserted.rows[0].id as string;
}

/** GET_MARKET（op 133）：可买挂单 + 我的挂单 / 成交 + 额度 */
export async function handleGetMarket(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const sellRaw = readString(data, 'sellResource');
  const buyRaw = readString(data, 'buyResource');
  if ((sellRaw !== null && !isMarketResource(sellRaw)) || (buyRaw !== null && !isMarketBuyKind(buyRaw))) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const page = readIntInRange(data, 'page', 1, 1000, 1);
  const [orders, mine, limits] = await Promise.all([
    loadMarketOrders(ctx.pool, accountId, { sellResource: sellRaw ?? undefined, buyResource: buyRaw ?? undefined }, page, PAGE_SIZE),
    loadMyMarket(ctx.pool, accountId),
    loadMarketLimits(ctx.pool, accountId),
  ]);
  respondOk(ctx.registry, conn, op, seq, {
    orders: orders.orders,
    page,
    pageSize: PAGE_SIZE,
    total: orders.total,
    mine,
    limits,
  });
}

/** CREATE_MARKET_ORDER（op 134）：挂单卖出资源，立即从挂单城冻结 */
export async function handleCreateMarketOrder(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const sell = readString(data, 'sellResource');
  const buy = readString(data, 'buyResource');
  if (!isMarketResource(sell) || !isMarketBuyKind(buy)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  // 只能「卖 A 收 B（或金币）」：卖什么就收什么属于无意义挂单，直接按参数错误拒绝（AISLG-201）
  if (!isMarketOrderPair(sell, buy)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS', { sellResource: sell, buyResource: buy });
    return;
  }
  const amount = data?.amount;
  const rawPrice = data?.unitPrice;
  const allyOnly = data?.allyOnly;
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < MARKET_MIN_AMOUNT) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS', { minAmount: MARKET_MIN_AMOUNT });
    return;
  }
  if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (allyOnly !== undefined && typeof allyOnly !== 'boolean') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (!isPriceAllowed(buy, rawPrice)) {
    const range = marketPriceRange(buy);
    respondError(ctx.registry, conn, op, seq, 'PRICE_OUT_OF_RANGE', { min: range.min, max: range.max });
    return;
  }
  const price = Math.round(rawPrice * 10_000) / 10_000;
  const client = await ctx.pool.connect();
  let orderId = '';
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [accountId]);
    const limits = await loadMarketLimits(client, accountId);
    if (limits.locked) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'MARKET_LOCKED', {
        reason: limits.lockedReason,
        government: limits.government,
        required: 5,
      });
      return;
    }
    if (limits.activeOrders >= limits.maxOpenOrders) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ORDER_LIMIT', { limit: limits.maxOpenOrders });
      return;
    }
    const city = await lockOwnCity(client, accountId, currentCityId());
    if (!city) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    if (Number(city[sell]) < amount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_RESOURCES', { shortfall: { [sell]: amount - Number(city[sell]) } });
      return;
    }
    await client.query(`UPDATE cities SET ${sell} = ${sell} - $2 WHERE id = $1`, [city.id, amount]);
    const inserted = await client.query(
      `INSERT INTO market_orders (account_id, city_id, sell_resource, buy_resource, total, remaining, unit_price, ally_only, expires_at)
       VALUES ($1, $2, $3, $4, $5, $5, $6, $7, now() + ($8::bigint * interval '1 millisecond'))
       RETURNING id`,
      [accountId, city.id, sell, buy, amount, price, allyOnly === true, MARKET_ORDER_TTL_MS],
    );
    orderId = inserted.rows[0].id as string;
    await insertEvent(client, {
      accountId,
      cityId: city.id,
      type: EventType.MARKET_ORDER_CREATED,
      initiator: conn.role,
      detail: { orderId, sellResource: sell, buyResource: buy, amount, unitPrice: price, allyOnly: allyOnly === true },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const view = await ctx.pool.query(
    `SELECT o.*, a.username AS seller_username, a.nobility AS seller_nobility,
            am.alliance_id AS seller_alliance_id, al.name AS seller_alliance_name,
            c.name AS city_name, c.x AS city_x, c.y AS city_y
     FROM market_orders o JOIN accounts a ON a.id = o.account_id JOIN cities c ON c.id = o.city_id
     LEFT JOIN alliance_members am ON am.account_id = o.account_id
     LEFT JOIN alliances al ON al.id = am.alliance_id WHERE o.id = $1`,
    [orderId],
  );
  const limits = await loadMarketLimits(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, {
    order: marketOrderView(view.rows[0] as MarketOrderRow, accountId),
    limits,
  });
}

/** BUY_MARKET_ORDER（op 135）：吃单（整单或部分），扣买家资源、生成双方商队 */
export async function handleBuyMarketOrder(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const orderId = readString(data, 'orderId');
  const quantity = data?.quantity;
  if (!orderId || typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity <= 0) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  let tradeId = '';
  let remaining = 0;
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(`SELECT * FROM market_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const order = orderRes.rows[0] as MarketOrderRow | undefined;
    if (!order || order.status !== 'open' || Number(order.remaining) <= 0 || order.expires_at.getTime() <= Date.now()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ORDER_NOT_FOUND');
      return;
    }
    if (order.account_id === accountId) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    if (quantity > Number(order.remaining)) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS', { remaining: Number(order.remaining) });
      return;
    }
    if (order.ally_only) {
      const [buyerAlliance, sellerAlliance] = await Promise.all([
        sellerAllianceId(client, accountId),
        sellerAllianceId(client, order.account_id),
      ]);
      if (!buyerAlliance || buyerAlliance !== sellerAlliance) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'MARKET_ALLY_ONLY');
        return;
      }
    }
    const limits = await loadMarketLimits(client, accountId);
    if (limits.locked) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'MARKET_LOCKED', {
        reason: limits.lockedReason,
        government: limits.government,
        required: 5,
      });
      return;
    }
    const price = Number(order.unit_price);
    const paid = marketPayment(quantity, price);
    const tradeValue = quantity;
    const buyerUsed = await marketDailyUsed(client, accountId);
    if (buyerUsed + tradeValue > limits.dailyLimit) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DAILY_TRADE_LIMIT', {
        limit: limits.dailyLimit, used: buyerUsed, remaining: Math.max(0, limits.dailyLimit - buyerUsed),
      });
      return;
    }
    const sellerLimits = await loadMarketLimits(client, order.account_id);
    const sellerUsed = await marketDailyUsed(client, order.account_id);
    if (sellerUsed + tradeValue > sellerLimits.dailyLimit) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DAILY_TRADE_LIMIT', {
        side: 'seller', limit: sellerLimits.dailyLimit, used: sellerUsed,
        remaining: Math.max(0, sellerLimits.dailyLimit - sellerUsed),
      });
      return;
    }
    const buyerCity = await lockOwnCity(client, accountId, currentCityId());
    if (!buyerCity) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const buyerMain = (await mainCityId(client, accountId)) ?? buyerCity.id;
    if (Number(buyerCity[order.buy_resource as keyof CityRow] ?? 0) < paid) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_RESOURCES', {
        shortfall: { [order.buy_resource]: paid - Number(buyerCity[order.buy_resource as keyof CityRow] ?? 0) },
      });
      return;
    }
    await client.query(`UPDATE cities SET ${order.buy_resource} = ${order.buy_resource} - $2 WHERE id = $1`, [
      buyerCity.id,
      paid,
    ]);
    remaining = Number(order.remaining) - quantity;
    await client.query(
      `UPDATE market_orders SET remaining = $2::bigint,
              status = CASE WHEN $2::bigint = 0 THEN 'filled' ELSE status END,
              closed_at = CASE WHEN $2::bigint = 0 THEN now() ELSE closed_at END WHERE id = $1`,
      [orderId, remaining],
    );
    const goods = marketAfterFee(quantity);
    const payment = marketAfterFee(paid);
    const goodsMarch = await createCaravan(
      client, order.account_id, order.city_id, buyerMain,
      { [order.sell_resource]: goods.delivered }, 'player',
    );
    const paymentMarch = await createCaravan(
      client, accountId, buyerCity.id, order.city_id,
      { [order.buy_resource]: payment.delivered }, 'player',
    );
    const trade = await client.query(
      `INSERT INTO market_trades
         (order_id, seller_account_id, buyer_account_id, seller_city_id, buyer_city_id,
          sell_resource, buy_resource, quantity, paid, goods_delivered, payment_delivered,
          fee_goods, fee_payment, goods_march_id, payment_march_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id, created_at`,
      [
        orderId, order.account_id, accountId, order.city_id, buyerMain,
        order.sell_resource, order.buy_resource, quantity, paid, goods.delivered, payment.delivered,
        goods.fee, payment.fee, goodsMarch, paymentMarch,
      ],
    );
    tradeId = trade.rows[0].id as string;
    const detail = {
      tradeId, orderId, sellResource: order.sell_resource, buyResource: order.buy_resource,
      quantity, paid, goodsDelivered: goods.delivered, paymentDelivered: payment.delivered,
      feePercent: MARKET_FEE_PERCENT,
    };
    await insertEvent(client, {
      accountId, cityId: buyerCity.id, type: EventType.MARKET_TRADE, initiator: conn.role,
      detail: { ...detail, role: 'buy' },
    });
    await insertEvent(client, {
      accountId: order.account_id, cityId: order.city_id, type: EventType.MARKET_TRADE, initiator: conn.role,
      detail: { ...detail, role: 'sell' },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const [tradeRes, limits] = await Promise.all([
    ctx.pool.query(
      `SELECT t.*, sa.username AS seller_username, ba.username AS buyer_username
       FROM market_trades t JOIN accounts sa ON sa.id = t.seller_account_id
       JOIN accounts ba ON ba.id = t.buyer_account_id WHERE t.id = $1`,
      [tradeId],
    ),
    loadMarketLimits(ctx.pool, accountId),
  ]);
  const row = tradeRes.rows[0] as {
    id: string; seller_account_id: string; buyer_account_id: string; seller_username: string; buyer_username: string;
    sell_resource: string; buy_resource: string; quantity: string | number; paid: string | number;
    goods_delivered: string | number; fee_goods: string | number; created_at: Date;
  };
  respondOk(ctx.registry, conn, op, seq, {
    trade: {
      id: row.id,
      role: 'buy',
      other: { accountId: row.seller_account_id, username: row.seller_username },
      sellResource: row.sell_resource,
      buyResource: row.buy_resource,
      quantity: Number(row.quantity),
      paid: Number(row.paid),
      delivered: Number(row.goods_delivered),
      fee: Number(row.fee_goods),
      createdAt: row.created_at.toISOString(),
      deliveredAt: null,
    },
    remaining,
    limits,
  });
}

/** CANCEL_MARKET_ORDER（op 136）：撤单，未成交部分立即退还 */
export async function handleCancelMarketOrder(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const orderId = readString(data, 'orderId');
  if (!orderId) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  let refunded = 0;
  let resource: MarketResource = 'food';
  try {
    await client.query('BEGIN');
    const orderRes = await client.query(`SELECT * FROM market_orders WHERE id = $1 FOR UPDATE`, [orderId]);
    const order = orderRes.rows[0] as MarketOrderRow | undefined;
    if (!order || order.account_id !== accountId) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ORDER_NOT_FOUND');
      return;
    }
    if (order.status !== 'open' || Number(order.remaining) <= 0) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ORDER_NOT_CANCELLABLE');
      return;
    }
    refunded = Number(order.remaining);
    resource = order.sell_resource as MarketResource;
    await client.query(`UPDATE cities SET ${order.sell_resource} = ${order.sell_resource} + $2 WHERE id = $1`, [
      order.city_id,
      refunded,
    ]);
    await client.query(`UPDATE market_orders SET status = 'cancelled', remaining = 0, closed_at = now() WHERE id = $1`, [orderId]);
    await insertEvent(client, {
      accountId, cityId: order.city_id, type: EventType.MARKET_ORDER_CANCELLED, initiator: conn.role,
      detail: { orderId, resource, refunded },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const limits = await loadMarketLimits(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, { orderId, refunded, resource, limits });
}
