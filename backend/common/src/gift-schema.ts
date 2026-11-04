// 礼金的表结构与上线回填（AISLG-221，v89）。accounts.gift 不放进 SCHEMA_SQL：上线回填只能在“列刚创建”时做一次，
// 所以列的创建与回填放进同一个迁移事务（db.ts 的 migrateDataOnce），先查列是否存在，重复启动不重复发放。
// 这里不 import season-db.ts（它经 db.ts 的 NOTIFY_CHANNEL 反向依赖本模块），当前赛季子查询按 season-db 的 CURRENT_SEASON_ID_SQL 同口径手写。

import type pg from 'pg';
import { SEASON_GIFT } from './gift';

export async function migrateGiftColumn(client: pg.PoolClient): Promise<void> {
  const exists = await client.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema() AND table_name = 'accounts' AND column_name = 'gift'`,
  );
  if (exists.rowCount) {
    return;
  }
  await client.query(`ALTER TABLE accounts ADD COLUMN gift integer NOT NULL DEFAULT 0`);
  // 上线当刻的存量：当前赛季的账号一次性补发（第一季在线玩家也拿到 1000）；沉睡号与无赛季时为 0，登录时惰性补
  await client.query(
    `UPDATE accounts SET gift = $1
     WHERE season_id = (SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1)`,
    [SEASON_GIFT],
  );
}
