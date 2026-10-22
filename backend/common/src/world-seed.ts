// 当前赛季的世界种子（AISLG-134）：第 1 季沿用 WORLD_SEED，之后各季为换季时随机生成并落库的 seasons.seed。
// ensureWorld 用它生成地图，使重启不换图；换季重置（season-reset.ts）则用新种子重建。

import type pg from 'pg';
import { WORLD_SEED } from './world';

/** 当前赛季的世界种子（无赛季记录时回落 WORLD_SEED；seasons 表由 ensureSchema 先行建好） */
export async function currentWorldSeed(q: pg.Pool | pg.PoolClient): Promise<number> {
  const res = await q.query(`SELECT seed FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`);
  return res.rowCount ? Number(res.rows[0].seed) : WORLD_SEED;
}
