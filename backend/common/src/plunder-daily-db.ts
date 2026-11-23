// 账号每日野地掠夺次数的读写（v118，AISLG-270）。
// 存储：accounts.plunder_day / accounts.plunder_day_count（见 db.ts 的 ALTER TABLE），
// 只加列、有默认值，存量账号视为「今天还没掠夺」，不需要数据迁移。
// 日界与竞技场 / 武将每日次数同口径（arena.ts 的 arenaDayIndex），时间缩放时按缩放后的日长切分。
// 读写都在调用方的事务里（Worker 的掠夺结算同一事务；API 的 GET_STATE 只读）。

import pg from 'pg';
import { arenaDayIndex } from './arena';
import { plunderDailyView, plunderLootPercent, type PlunderDailyView } from './plunder';

/** 可用的查询者（池或事务内连接） */
type Queryable = pg.Pool | pg.PoolClient;

interface PlunderDailyRow {
  plunder_day: number | null;
  plunder_day_count: number | null;
}

/**
 * 读账号当日的成功野地掠夺次数与下一次的收益倍数（GET_STATE 用）。
 * 存的是哪一天就取那一天的次数；跨日（含从未掠夺）视为 0 次。
 */
export async function loadPlunderDaily(q: Queryable, accountId: string, now: Date): Promise<PlunderDailyView> {
  const res = await q.query(`SELECT plunder_day, plunder_day_count FROM accounts WHERE id = $1`, [accountId]);
  if (!res.rowCount) {
    return plunderDailyView(0, now);
  }
  const row = res.rows[0] as PlunderDailyRow;
  const storedDay = row.plunder_day === null ? null : Math.floor(Number(row.plunder_day));
  const count = storedDay === arenaDayIndex(now) ? Math.max(0, Math.floor(Number(row.plunder_day_count ?? 0))) : 0;
  return plunderDailyView(count, now);
}

/** 一次成功野地掠夺的计数结果：本次是当天第几次（含本次）与本次的收益倍数 */
export interface PlunderDailyUse {
  count: number;
  lootPercent: number;
  /** 清零时刻（ISO 8601，写入事件 / 战报可选展示） */
  resetAt: string;
}

/**
 * 记一次「成功的野地掠夺」并返回本次的收益倍数（本次是当天第 N 次，含本次）。
 * 单条 UPDATE ... RETURNING 保证并发安全（同一账号的多次结算各自 +1，不会读到旧值）；
 * 跨日（存的 plunder_day 不是今天）先重置为 1 再计本次。必须在结算事务内调用。
 */
export async function consumeWildernessPlunder(
  client: pg.PoolClient,
  accountId: string,
  now: Date,
): Promise<PlunderDailyUse> {
  const day = arenaDayIndex(now);
  const res = await client.query(
    `UPDATE accounts
     SET plunder_day = $2,
         plunder_day_count = CASE WHEN plunder_day = $2 THEN plunder_day_count + 1 ELSE 1 END
     WHERE id = $1
     RETURNING plunder_day_count`,
    [accountId, day],
  );
  const count = res.rowCount ? Math.max(1, Math.floor(Number((res.rows[0] as { plunder_day_count: number }).plunder_day_count))) : 1;
  return { count, lootPercent: plunderLootPercent(count), resetAt: plunderDailyView(count, now).resetAt };
}