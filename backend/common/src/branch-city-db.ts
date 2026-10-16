// 分城资格所需的账号现状（v24，AISLG-58）：主城官府等级与现有分城数。
// API（出征发起初核）与 Worker（到达复核）共用同一查询，口径不得各自实现。

import type pg from 'pg';
import { effectiveLevelSql } from './production';

export interface BranchStanding {
  /** 主城（账号名下创建最早的城）官府等级 */
  mainGovernment: number;
  /** 现有分城数（不含主城） */
  branchCount: number;
}

export async function loadBranchStanding(q: pg.Pool | pg.PoolClient, accountId: string): Promise<BranchStanding> {
  const res = await q.query(
    `SELECT (SELECT count(*) FROM cities WHERE account_id = $1)::int AS total,
            COALESCE((SELECT ${effectiveLevelSql('g.level', "'government'", 'mc.famous_name')} FROM city_buildings g
                      JOIN cities mc ON mc.id = g.city_id
                      WHERE g.kind = 'government'
                        AND g.city_id = (SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1)), 0)::int AS main_gov`,
    [accountId],
  );
  const row = res.rows[0] as { total: number; main_gov: number };
  return { mainGovernment: row.main_gov, branchCount: Math.max(0, row.total - 1) };
}

/**
 * 本账号在该地块的放弃冷却是否未结束（v57，AISLG-153）：放弃分城后原账号不能再占回该 NPC 城，
 * 冷却截止时刻记在 city_discards；时间取数据库 now()，与其它到期判定同口径。
 */
export async function loadDiscardCooldownActive(
  q: pg.Pool | pg.PoolClient,
  accountId: string,
  x: number,
  y: number,
): Promise<boolean> {
  const res = await q.query(
    `SELECT 1 FROM city_discards WHERE x = $1 AND y = $2 AND account_id = $3 AND until > now()`,
    [x, y, accountId],
  );
  return (res.rowCount ?? 0) > 0;
}
