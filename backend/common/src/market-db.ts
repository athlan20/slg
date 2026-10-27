// 玩家交易所（v78，AISLG-196）的读取与过期回收：挂单列表 / 我的挂单与成交 / 每日额度 / 48 小时过期退款。
// 写入（挂单 / 吃单 / 撤单）在 api/src/handlers-market.ts；这里只做查询与 Worker 回收，API 与 Worker 共用口径。

import type pg from 'pg';
import { EventType } from './protocol';
import { insertEvent } from './events';
import { effectiveLevelSql } from './production';
import { nobilityName } from './nobility';
import {
  MARKET_FEE_PERCENT,
  MARKET_MAX_OPEN_ORDERS,
  MARKET_MIN_AMOUNT,
  MARKET_MIN_GOVERNMENT,
  MARKET_ORDER_TTL_MS,
  marketDailyLimit,
  marketPriceRange,
  type MarketBuyKind,
  type MarketResource,
} from './market';
import type {
  MarketLimitsView,
  MarketOrderView,
  MarketTradeView,
} from './protocol-market';

type Queryable = pg.Pool | pg.PoolClient;

export interface MarketOrderRow {
  id: string;
  account_id: string;
  city_id: string;
  sell_resource: string;
  buy_resource: string;
  total: string | number;
  remaining: string | number;
  unit_price: string | number;
  ally_only: boolean;
  status: string;
  created_at: Date;
  expires_at: Date;
  closed_at: Date | null;
  seller_username?: string;
  seller_nobility?: number;
  seller_alliance_id?: string | null;
  seller_alliance_name?: string | null;
  city_name?: string;
  city_x?: number | null;
  city_y?: number | null;
}

export interface MarketTradeRow {
  id: string;
  order_id: string;
  seller_account_id: string;
  buyer_account_id: string;
  seller_city_id: string;
  buyer_city_id: string;
  sell_resource: string;
  buy_resource: string;
  quantity: string | number;
  paid: string | number;
  goods_delivered: string | number;
  payment_delivered: string | number;
  fee_goods: string | number;
  fee_payment: string | number;
  created_at: Date;
  seller_username?: string;
  buyer_username?: string;
  delivered_at?: Date | null;
}

const ORDER_SELECT = `
  SELECT o.*, a.username AS seller_username, a.nobility AS seller_nobility,
         am.alliance_id AS seller_alliance_id, al.name AS seller_alliance_name,
         c.name AS city_name, c.x AS city_x, c.y AS city_y
  FROM market_orders o
  JOIN accounts a ON a.id = o.account_id
  JOIN cities c ON c.id = o.city_id
  LEFT JOIN alliance_members am ON am.account_id = o.account_id
  LEFT JOIN alliances al ON al.id = am.alliance_id`;

/** 每日已用成交额度（按卖出资源数量折算，买卖双方都算） */
export async function marketDailyUsed(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(
    `SELECT COALESCE(sum(quantity), 0)::bigint AS used FROM market_trades
     WHERE buyer_account_id = $1 OR seller_account_id = $1`,
    [accountId],
  );
  return Number((res.rows[0] as { used: string | number }).used);
}

/** 账号的交易门槛与额度（主城官府等级、新手保护、在挂数量、当日已用） */
export async function loadMarketLimits(q: Queryable, accountId: string): Promise<MarketLimitsView> {
  const city = await q.query(
    `SELECT COALESCE(${effectiveLevelSql('g.level', "'government'", 'c.famous_name')}, 0)::int AS government,
            a.newbie_until
     FROM cities c JOIN accounts a ON a.id = c.account_id
     LEFT JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government'
     WHERE c.account_id = $1 ORDER BY c.created_at LIMIT 1`,
    [accountId],
  );
  const row = (city.rows[0] as { government: number; newbie_until: Date | null } | undefined) ?? {
    government: 0,
    newbie_until: null,
  };
  const active = await q.query(
    `SELECT count(*)::int AS n FROM market_orders WHERE account_id = $1 AND status = 'open' AND remaining > 0`,
    [accountId],
  );
  const dailyLimit = marketDailyLimit(Number(row.government));
  const dailyUsed = await marketDailyUsed(q, accountId);
  const newbie = row.newbie_until !== null && row.newbie_until.getTime() > Date.now();
  const lockedReason = Number(row.government) < MARKET_MIN_GOVERNMENT ? 'government' : newbie ? 'newbie' : null;
  return {
    minAmount: MARKET_MIN_AMOUNT,
    maxOpenOrders: MARKET_MAX_OPEN_ORDERS,
    activeOrders: Number((active.rows[0] as { n: number }).n),
    feePercent: MARKET_FEE_PERCENT,
    government: Number(row.government),
    dailyLimit,
    dailyUsed,
    dailyRemaining: Math.max(0, dailyLimit - dailyUsed),
    locked: lockedReason !== null,
    lockedReason,
    priceRangeResource: marketPriceRange('food'),
    priceRangeGold: marketPriceRange('gold'),
  };
}

export function marketOrderView(row: MarketOrderRow, viewerAccountId: string): MarketOrderView {
  const nobility = Math.max(0, Number(row.seller_nobility ?? 0));
  return {
    id: row.id,
    seller: {
      accountId: row.account_id,
      username: row.seller_username ?? '',
      nobility,
      nobilityName: nobilityName(nobility),
      allianceId: row.seller_alliance_id ?? null,
      allianceName: row.seller_alliance_name ?? null,
    },
    city: {
      id: row.city_id,
      name: row.city_name ?? '',
      x: row.city_x ?? null,
      y: row.city_y ?? null,
    },
    sellResource: row.sell_resource as MarketResource,
    buyResource: row.buy_resource as MarketBuyKind,
    total: Number(row.total),
    remaining: Number(row.remaining),
    unitPrice: Number(row.unit_price),
    allyOnly: row.ally_only,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    mine: row.account_id === viewerAccountId,
  };
}

export interface MarketOrderFilters {
  sellResource?: MarketResource;
  buyResource?: MarketBuyKind;
}

/** 可买的挂单（只卖给盟友的单对非盟友不可见），按单价升序、创建时间升序分页 */
export async function loadMarketOrders(
  q: Queryable,
  viewerAccountId: string,
  filters: MarketOrderFilters,
  page: number,
  pageSize: number,
): Promise<{ orders: MarketOrderView[]; total: number }> {
  const alliance = await q.query(`SELECT alliance_id FROM alliance_members WHERE account_id = $1`, [viewerAccountId]);
  const allianceId = (alliance.rows[0] as { alliance_id: string } | undefined)?.alliance_id ?? null;
  const params: unknown[] = [viewerAccountId, allianceId];
  let where = `o.status = 'open' AND o.remaining > 0 AND o.expires_at > now()
    AND o.account_id <> $1
    AND (NOT o.ally_only OR o.account_id IN (
      SELECT account_id FROM alliance_members WHERE alliance_id = $2::uuid
    ))`;
  if (filters.sellResource) {
    params.push(filters.sellResource);
    where += ` AND o.sell_resource = $${params.length}`;
  }
  if (filters.buyResource) {
    params.push(filters.buyResource);
    where += ` AND o.buy_resource = $${params.length}`;
  }
  const totalRes = await q.query(`SELECT count(*)::int AS n FROM market_orders o WHERE ${where}`, params);
  params.push(pageSize, (Math.max(1, page) - 1) * pageSize);
  const res = await q.query(
    `${ORDER_SELECT} WHERE ${where} ORDER BY o.unit_price ASC, o.created_at ASC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return {
    orders: (res.rows as MarketOrderRow[]).map((row) => marketOrderView(row, viewerAccountId)),
    total: Number((totalRes.rows[0] as { n: number }).n),
  };
}

/** 我的挂单（进行中 + 最近结束）与成交记录 */
export async function loadMyMarket(
  q: Queryable,
  accountId: string,
): Promise<{ orders: MarketOrderView[]; trades: MarketTradeView[] }> {
  const orders = await q.query(
    `${ORDER_SELECT} WHERE o.account_id = $1 ORDER BY o.created_at DESC LIMIT 20`,
    [accountId],
  );
  const trades = await q.query(
    `SELECT t.*, sa.username AS seller_username, ba.username AS buyer_username,
            CASE WHEN mg.resolved_at IS NOT NULL AND mp.resolved_at IS NOT NULL
                 THEN GREATEST(mg.resolved_at, mp.resolved_at) ELSE NULL END AS delivered_at
     FROM market_trades t
     JOIN accounts sa ON sa.id = t.seller_account_id
     JOIN accounts ba ON ba.id = t.buyer_account_id
     LEFT JOIN marches mg ON mg.id = t.goods_march_id
     LEFT JOIN marches mp ON mp.id = t.payment_march_id
     WHERE t.buyer_account_id = $1 OR t.seller_account_id = $1
     ORDER BY t.created_at DESC LIMIT 20`,
    [accountId],
  );
  return {
    orders: (orders.rows as MarketOrderRow[]).map((row) => marketOrderView(row, accountId)),
    trades: (trades.rows as MarketTradeRow[]).map((row) => {
      const buy = row.buyer_account_id === accountId;
      const paid = Number(row.paid);
      return {
        id: row.id,
        role: buy ? 'buy' : 'sell',
        other: { accountId: buy ? row.seller_account_id : row.buyer_account_id, username: buy ? row.seller_username ?? '' : row.buyer_username ?? '' },
        sellResource: row.sell_resource as MarketResource,
        buyResource: row.buy_resource as MarketBuyKind,
        quantity: Number(row.quantity),
        paid,
        delivered: buy ? Number(row.goods_delivered) : Number(row.payment_delivered),
        fee: buy ? Number(row.fee_goods) : Number(row.fee_payment),
        createdAt: row.created_at.toISOString(),
        deliveredAt: row.delivered_at ? row.delivered_at.toISOString() : null,
      };
    }),
  };
}

/** Worker 回收：48 小时未卖完的挂单自动撤单并退还冻结资源（返回处理条数） */
export async function expireMarketOrders(client: pg.PoolClient): Promise<number> {
  const due = await client.query(
    `SELECT * FROM market_orders WHERE status = 'open' AND expires_at <= now()
     ORDER BY expires_at LIMIT 50 FOR UPDATE SKIP LOCKED`,
  );
  let count = 0;
  for (const row of due.rows as MarketOrderRow[]) {
    const remaining = Number(row.remaining);
    if (remaining > 0) {
      await client.query(`UPDATE cities SET ${row.sell_resource} = ${row.sell_resource} + $2 WHERE id = $1`, [
        row.city_id,
        remaining,
      ]);
    }
    await client.query(`UPDATE market_orders SET status = 'expired', remaining = 0, closed_at = now() WHERE id = $1`, [row.id]);
    await insertEvent(client, {
      accountId: row.account_id,
      cityId: row.city_id,
      type: EventType.MARKET_ORDER_EXPIRED,
      initiator: null,
      detail: { orderId: row.id, resource: row.sell_resource, refunded: remaining, ttlMs: MARKET_ORDER_TTL_MS },
    });
    count += 1;
  }
  return count;
}
