// 充值订单与支付回调去重表的结构（AISLG-251，v108）。两张表都用 CREATE TABLE IF NOT EXISTS，
// 向后兼容、不改旧数据；都不进 season-tables.ts 的 RESET_TABLES（订单与回调记录跨季保留——
// 退款 / 拒付可能在赛季结束之后才到，收据也不能随换季消失）。
// - topup_orders：一次结账会话一行，账号归属一律以这里的 account_id 为准（不信回调里的其他字段）；
// - payment_webhook_events：provider + event_id 联合唯一，保证同一个回调重复到达只处理一次。

export const TOPUP_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS topup_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  product_id text NOT NULL,
  usd_cents integer NOT NULL CHECK (usd_cents > 0),
  ingot_amount integer NOT NULL CHECK (ingot_amount > 0),
  status text NOT NULL DEFAULT 'pending',
  provider text NOT NULL,
  provider_checkout_id text,
  provider_order_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  clawback_short integer NOT NULL DEFAULT 0 CHECK (clawback_short >= 0),
  -- 累计已退款金额（分，含拒付）。需求单的列清单里没有它，但「按比例回收 + 累计回收达到整单才置
  -- refunded」必须有累计口径，否则多次部分退款无法判断是否退完。
  refunded_cents integer NOT NULL DEFAULT 0 CHECK (refunded_cents >= 0),
  CONSTRAINT topup_orders_status_check CHECK (status IN ('pending', 'paid', 'refunded', 'expired'))
);
CREATE INDEX IF NOT EXISTS idx_topup_orders_account ON topup_orders (account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_topup_orders_pending ON topup_orders (status, created_at);
CREATE INDEX IF NOT EXISTS idx_topup_orders_checkout ON topup_orders (provider, provider_checkout_id);
CREATE INDEX IF NOT EXISTS idx_topup_orders_provider_order ON topup_orders (provider, provider_order_id);

CREATE TABLE IF NOT EXISTS payment_webhook_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  order_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);
`;
