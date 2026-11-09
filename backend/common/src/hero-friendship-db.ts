// 在野名将的结交（v54，AISLG-144）：结交资格（hero_unlocks，打赢过其所在野地的原住守军）与结交进度
// （hero_friendship，好感与当日次数）。v103（AISLG-245）起名将归属按账号判——29 名在野名将每个账号各能
// 获得一份，所以「本账号是否已拥有」才决定结交进度是否作废，别的账号有没有招走与本账号无关。

import type pg from 'pg';
import { BEFRIEND_DAILY_LIMIT, befriendCost } from './hero-wild';
import { heroDayIndex } from './hero-growth';
import { usedToday } from './hero-db';
import type { FriendshipView } from './protocol-hero';

type Queryable = pg.Pool | pg.PoolClient;

export interface FriendshipRow {
  hero_name: string;
  favor: number;
  day: string | null;
  day_count: number;
}

/** 获得结交资格（打赢原住守军时调用；重复获得无副作用） */
export async function grantUnlock(client: pg.PoolClient, accountId: string, heroName: string): Promise<void> {
  await client.query(
    `INSERT INTO hero_unlocks (account_id, hero_name) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [accountId, heroName],
  );
}

/** 账号拥有结交资格的名将名（本账号还没拥有的才算） */
export async function unlockedHeroNames(q: Queryable, accountId: string): Promise<string[]> {
  const res = await q.query(
    `SELECT u.hero_name FROM hero_unlocks u
     WHERE u.account_id = $1
       AND NOT EXISTS (SELECT 1 FROM famous_heroes f WHERE f.name = u.hero_name AND f.owner_account_id = $1)
     ORDER BY u.unlocked_at, u.hero_name`,
    [accountId],
  );
  return (res.rows as Array<{ hero_name: string }>).map((row) => row.hero_name);
}

/** 账号全部结交进度（含已作废的；作废 = 本账号已拥有该名将，v103 起不再看别的账号） */
export async function loadFriendships(q: Queryable, accountId: string, now = new Date()): Promise<FriendshipView[]> {
  const res = await q.query(
    `SELECT h.hero_name, h.favor, h.day, h.day_count, w.level AS tile_level,
            EXISTS (
              SELECT 1 FROM famous_heroes f WHERE f.name = h.hero_name AND f.owner_account_id = h.account_id
            ) AS claimed
     FROM hero_friendship h
     LEFT JOIN world_tiles w ON w.wild_hero = h.hero_name
     WHERE h.account_id = $1
     ORDER BY h.hero_name`,
    [accountId],
  );
  const today = heroDayIndex(now);
  return (res.rows as Array<FriendshipRow & { tile_level: number | null; claimed: boolean }>).map((row) => ({
    heroName: row.hero_name,
    favor: row.favor,
    todayLeft: Math.max(0, BEFRIEND_DAILY_LIMIT - usedToday(row.day, row.day_count, today)),
    cost: befriendCost(row.tile_level ?? 1),
    lost: row.claimed,
  }));
}

/** 同时结交中的人数（本账号还没拥有的进度行；好感 100 但未招揽的仍占位） */
export async function activeFriendshipCount(client: pg.PoolClient, accountId: string): Promise<number> {
  const res = await client.query(
    `SELECT count(*)::int AS n FROM hero_friendship h
     WHERE h.account_id = $1
       AND NOT EXISTS (SELECT 1 FROM famous_heroes f WHERE f.name = h.hero_name AND f.owner_account_id = $1)`,
    [accountId],
  );
  return (res.rows[0] as { n: number }).n;
}

/** 删除本账号对某名将的结交进度（招揽成功后调用，或本账号已拥有该名将时清理） */
export async function dropFriendship(client: pg.PoolClient, accountId: string, heroName: string): Promise<void> {
  await client.query(`DELETE FROM hero_friendship WHERE account_id = $1 AND hero_name = $2`, [accountId, heroName]);
}
