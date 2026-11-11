// 元宝相关列的迁移（AISLG-251，v108）：accounts.ingot 与 user_items.paid_count。
// 两列都**不回填**：ingot 默认 0（元宝只能充值获得），paid_count 默认 0（存量道具都是礼金买的 /
// 其他来源发放的，换季照旧清零）。列与约束的创建幂等（ADD COLUMN IF NOT EXISTS + 约束存在性判断），
// 重复启动不重复执行；旧代码面对新列也能正常跑（只加不改）。参照 gift-schema.ts 的写法。

import type pg from 'pg';

/** user_items.paid_count 的约束名（幂等判断用） */
const PAID_COUNT_CHECK = 'user_items_paid_count_check';

/**
 * 幂等地加列 + 约束（调用方事务内）。
 * - accounts.ingot：付费货币余额，只增（充值）减（消费、退款回收），换季与重置账号都不动；
 *   默认 0、不回填；AISLG-253 的兑换码也会用这一列，所以必须幂等。
 * - user_items.paid_count：该道具的 count 里有多少张是元宝买的（换季保留这么多），
 *   CHECK 保证 0 <= paid_count <= count。
 */
export async function migrateIngotColumns(client: pg.PoolClient): Promise<void> {
  await client.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ingot integer NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE user_items ADD COLUMN IF NOT EXISTS paid_count integer NOT NULL DEFAULT 0`);
  const exists = await client.query(
    `SELECT 1 FROM pg_constraint c
     JOIN pg_class t ON t.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE n.nspname = current_schema() AND t.relname = 'user_items' AND c.conname = $1`,
    [PAID_COUNT_CHECK],
  );
  if (!exists.rowCount) {
    // 加约束前把历史上不可能的越界值夹回合法区间（正常情况下都是 0）；NOT VALID 再 VALIDATE
    // 会把整表扫一遍，但 user_items 每次换季都被清理，行数很小，直接加上更简单。
    await client.query(
      `ALTER TABLE user_items ADD CONSTRAINT ${PAID_COUNT_CHECK} CHECK (paid_count >= 0 AND paid_count <= count)`,
    );
  }
}
