// 城池敌情判定（v57 起放弃分城用，v84 / AISLG-209 起遣散士兵也用）：该城或其名下野地正有
// 行军在途指向（来袭 / 运输 / 占领 / 侦察等一切 status='marching'），或有未结的 NPC 来袭。
// 两个写操作共用同一口径：有人来打的时候不能把守军遣散（会变成「躲战损 + 拿回一半资源」的投机），
// 放弃分城同理（v57）。锁序：调用方已持有城池行锁；本函数只读 marches / world_tiles / npc_attacks。

import type pg from 'pg';

type Queryable = pg.Pool | pg.PoolClient;

/** 城池是否有敌情（口径见文件头）；调用方负责判定被拒时返回 CITY_IN_BATTLE 且不写数据 */
export async function cityInBattle(q: Queryable, cityId: string): Promise<boolean> {
  const res = await q.query(
    `SELECT 1 FROM marches m JOIN world_tiles wt ON wt.x = m.x AND wt.y = m.y
     WHERE wt.owner_city_id = $1 AND m.status = 'marching'
     UNION ALL
     SELECT 1 FROM npc_attacks WHERE target_city_id = $1 AND resolved_at IS NULL
     LIMIT 1`,
    [cityId],
  );
  return (res.rowCount ?? 0) > 0;
}
