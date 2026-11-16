// 名城任期轮换的数据库读写（v111，AISLG-259）：规则在 famous-tenure.ts，这里只负责
// 取「本账号现有名城数 / 在该名城上的封禁截止」与写入封禁行。
// API（出征发起初核）与 Worker（到达复核、到期处置）共用同一查询，口径不得各写一份。

import type pg from 'pg';
import type { FamousTenureState } from './famous-tenure';

type Queryable = pg.Pool | pg.PoolClient;

/** 本账号当前占有的名城数（cities.famous_name 非空） */
export async function loadFamousCityCount(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM cities WHERE account_id = $1 AND famous_name IS NOT NULL`,
    [accountId],
  );
  return Math.max(0, Number((res.rows[0] as { n: number } | undefined)?.n ?? 0));
}

/**
 * 本账号在某名城上的封禁截止（到期失去后 48 小时）；没有记录或已过期返回 null。
 * 按 (famous_name, account_id) 查——只对「到期失去这座城的那个人、那座城」生效。
 */
export async function loadFamousBanUntil(
  q: Queryable,
  famousName: string,
  accountId: string,
  now: Date,
): Promise<Date | null> {
  const res = await q.query(
    `SELECT until FROM famous_expiry_bans WHERE famous_name = $1 AND account_id = $2 AND until > $3`,
    [famousName, accountId, now],
  );
  return res.rowCount ? ((res.rows[0] as { until: Date }).until) : null;
}

/** 一次取全校验所需状态（名城数 + 该城的封禁截止） */
export async function loadFamousTenureState(
  q: Queryable,
  accountId: string,
  famousName: string,
  now: Date,
): Promise<FamousTenureState> {
  return {
    famousOwned: await loadFamousCityCount(q, accountId),
    bannedUntil: await loadFamousBanUntil(q, famousName, accountId, now),
  };
}

/** 写入 / 覆盖一条封禁（调用方事务内；到期处置时给原主人写 48 小时） */
export async function insertFamousExpiryBan(
  client: pg.PoolClient,
  famousName: string,
  accountId: string,
  until: Date,
): Promise<void> {
  await client.query(
    `INSERT INTO famous_expiry_bans (famous_name, account_id, until) VALUES ($1, $2, $3)
     ON CONFLICT (famous_name, account_id) DO UPDATE SET until = EXCLUDED.until`,
    [famousName, accountId, until],
  );
}