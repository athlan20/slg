// 在野名将的落位（v54，AISLG-144）：开服（ensureWorld）时把 29 名在野名将随机落到无主、Lv3 以上的
// 野地上，写进 world_tiles.wild_hero 与三项固定属性；之后不再变动（重建世界才会重新分配）。
// 已落位的名将不会重复分配；名将被获得后地块仍保留落位（地图标记按「未被获得」过滤）。

import type pg from 'pg';
import { rollFamousAttrs, type HeroAttrs } from './hero';
import { WILD_FAMOUS_NAMES, WILD_HERO_MIN_LEVEL } from './hero-wild';

/** 咨询锁 ID（与 ensureSchema、世界引导区分；落位只允许一个进程执行） */
const WILD_FAMOUS_LOCK_ID = 8721417;

/**
 * 补齐在野名将的落位：缺谁补谁。候选 = 无主野地（kind='wilderness'、owner_city_id 为空、
 * 等级 ≥ WILD_HERO_MIN_LEVEL、尚未落位），随机抽取后按名单顺序分配。返回本次新落位的数量。
 */
export async function ensureWildFamous(pool: pg.Pool): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const count = await placeWildFamousIn(client);
    await client.query('COMMIT');
    return count;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 同 ensureWildFamous，但在调用方的事务内执行（换季重建世界时与地图同一事务，AISLG-134） */
export async function placeWildFamousIn(client: pg.PoolClient): Promise<number> {
  await client.query(`SELECT pg_advisory_xact_lock(${WILD_FAMOUS_LOCK_ID})`);
  const placed = await client.query(`SELECT wild_hero FROM world_tiles WHERE wild_hero IS NOT NULL`);
  const done = new Set((placed.rows as Array<{ wild_hero: string }>).map((row) => row.wild_hero));
  const missing = WILD_FAMOUS_NAMES.filter((name) => !done.has(name));
  if (missing.length === 0) {
    return 0;
  }
  const spots = await client.query(
    `SELECT x, y FROM world_tiles
     WHERE kind = 'wilderness' AND owner_city_id IS NULL AND wild_hero IS NULL AND level >= $1
     ORDER BY random() LIMIT $2`,
    [WILD_HERO_MIN_LEVEL, missing.length],
  );
  const tiles = spots.rows as Array<{ x: number; y: number }>;
  for (let i = 0; i < tiles.length; i += 1) {
    const attrs: HeroAttrs = rollFamousAttrs(Math.random);
    await client.query(
      `UPDATE world_tiles SET wild_hero = $3, wild_lead = $4, wild_force = $5, wild_wit = $6 WHERE x = $1 AND y = $2`,
      [tiles[i].x, tiles[i].y, missing[i], attrs.lead, attrs.force, attrs.wit],
    );
  }
  return tiles.length;
}

/** 在野名将的固定属性（无此名的落位返回 null） */
export async function loadWildHeroAttrs(q: pg.Pool | pg.PoolClient, name: string): Promise<HeroAttrs | null> {
  const res = await q.query(`SELECT wild_lead, wild_force, wild_wit FROM world_tiles WHERE wild_hero = $1`, [name]);
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { wild_lead: number; wild_force: number; wild_wit: number };
  return { lead: row.wild_lead, force: row.wild_force, wit: row.wild_wit };
}

/** 在野名将所在的野地（坐标与等级）；无落位返回 null */
export async function loadWildHeroTile(
  q: pg.Pool | pg.PoolClient,
  name: string,
): Promise<{ x: number; y: number; level: number } | null> {
  const res = await q.query(`SELECT x, y, level FROM world_tiles WHERE wild_hero = $1`, [name]);
  return res.rowCount ? (res.rows[0] as { x: number; y: number; level: number }) : null;
}
