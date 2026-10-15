// 名城独有效果的数据库读取（v62，AISLG-166）：城池的名城标记读自 cities.famous_name（效果跟着城走）。
// 纯规则在 famous-effects.ts；本文件只提供读取，供守城战、掠夺与行军的消费方在事务内调用。

import type pg from 'pg';

/** 城池当前的名城标记（非名城 / 城不存在为 null）；须在调用方事务内调用，与同一时刻的城池状态一致 */
export async function loadFamousName(q: pg.Pool | pg.PoolClient, cityId: string): Promise<string | null> {
  const res = await q.query(`SELECT famous_name FROM cities WHERE id = $1`, [cityId]);
  return (res.rows[0] as { famous_name: string | null } | undefined)?.famous_name ?? null;
}
