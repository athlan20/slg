// 玩家交易所（v78，AISLG-196）的表结构：挂单与成交记录。
// 挂单冻结卖出的资源；成交后双方各派一支商队（marches.purpose='caravan'）送货。
// 换季：挂单撤回并退还、成交记录清空（见 season-tables.ts）。

export const MARKET_SCHEMA_SQL = `
-- v78（AISLG-196）：挂单交易所。sell_resource 为卖出的四资源之一，buy_resource 为收取的资源或 gold。
-- unit_price = 每 1 个卖出资源换多少个 buy_resource（numeric，范围见 market.ts）。
CREATE TABLE IF NOT EXISTS market_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  city_id uuid NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  sell_resource text NOT NULL,
  buy_resource text NOT NULL,
  total bigint NOT NULL,
  remaining bigint NOT NULL,
  unit_price numeric(12, 4) NOT NULL,
  ally_only boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_market_orders_open ON market_orders (status, expires_at);
CREATE INDEX IF NOT EXISTS idx_market_orders_seller ON market_orders (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_orders_filter ON market_orders (sell_resource, buy_resource, unit_price) WHERE status = 'open';

-- 成交记录：一笔成交一行（买卖双方、数量、支付、手续费与商队 id）。
CREATE TABLE IF NOT EXISTS market_trades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES market_orders(id) ON DELETE CASCADE,
  seller_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  buyer_account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seller_city_id uuid NOT NULL,
  buyer_city_id uuid NOT NULL,
  sell_resource text NOT NULL,
  buy_resource text NOT NULL,
  quantity bigint NOT NULL,
  paid bigint NOT NULL,
  goods_delivered bigint NOT NULL,
  payment_delivered bigint NOT NULL,
  fee_goods bigint NOT NULL,
  fee_payment bigint NOT NULL,
  goods_march_id uuid,
  payment_march_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_market_trades_buyer ON market_trades (buyer_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_trades_seller ON market_trades (seller_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_trades_created ON market_trades (created_at);

-- 商队目的地（v78）：marches.purpose='caravan' 时使用；到达直接把 cargo 入账到该城。
ALTER TABLE marches ADD COLUMN IF NOT EXISTS to_city_id uuid;
`;
