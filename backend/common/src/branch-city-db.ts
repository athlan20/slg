// 分城资格所需的账号现状（v24，AISLG-58）：主城官府等级与现有分城数。
// API（出征发起初核）与 Worker（到达复核）共用同一查询，口径不得各自实现。

import type pg from 'pg';

export interface BranchStanding {
  /** 主城（账号名下创建最早的城）官府等级 */
  mainGovernment: number;
  /** 现有分城数（不含主城） */
  branchCount: number;
}

export async function loadBranchStanding(q: pg.Pool | pg.PoolClient, accountId: string): Promise<BranchStanding> {
  const res = await q.query(
    `SELECT (SELECT count(*) FROM cities WHERE account_id = $1)::int AS total,
            COALESCE((SELECT g.level FROM city_buildings g
                      WHERE g.kind = 'government'
                        AND g.city_id = (SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1)), 0)::int AS main_gov`,
    [accountId],
  );
  const row = res.rows[0] as { total: number; main_gov: number };
  return { mainGovernment: row.main_gov, branchCount: Math.max(0, row.total - 1) };
}
