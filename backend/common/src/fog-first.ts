// 名城首探与名将处所首探（AISLG-227，v93）：行军写入探索时（fog-record.ts 的 recordMarchExploration），
// 本趟新探索的区块（markRoute 返回的 fresh 区块）里若有 8 座名城 / 8 处名将处所，首次探开它所在区块的账号拿首探奖励并全服播报。
// 判定：名城 / 处所所在区块是这趟行军新探索的（开局范围、城池与领地视野、返程都不是这趟新探索的，自然不算）。
// 去程才调用（返程不记探索，调用方已过滤）。唯一性靠 fog_first_explores 的主键 ON CONFLICT DO NOTHING。
// 调用方须在事务内，且已按锁序锁住主城（奖励发到主城）。
import type pg from 'pg';
import { EventType } from './protocol';
import { insertEvent } from './events';
import { NOTIFY_CHANNEL } from './db';
import { insertServerBroadcast } from './server-broadcast';
import { grantRewards } from './quest';
import { grantItem } from './items-db';
import { grantUnlock } from './hero-friendship-db';
import { chunkIndexOf } from './fog';
import {
  FAMOUS_FIRST_ITEMS,
  FAMOUS_FIRST_REWARD,
  famousFirstKey,
  heroSiteFirstKey,
  HERO_SITE_FIRST_REWARD,
  HERO_SITES,
} from './relic';

/** 一趟去程的身份（首探的事件挂在出发城下） */
export interface FirstExploreTrip {
  marchId: string;
  accountId: string;
  fromCityId: string;
}

type Target =
  | { kind: 'famous'; name: string; x: number; y: number }
  | { kind: 'site'; hero: string; claimed: boolean; x: number; y: number };

/** 登记首探：只有真正插入（本次是第一次）才返回用户名，否则 null */
async function claimFirst(client: pg.PoolClient, key: string, accountId: string, now: Date): Promise<string | null> {
  const res = await client.query(
    `INSERT INTO fog_first_explores (target_key, account_id, username, explored_at)
     SELECT $1, a.id, a.username, $3 FROM accounts a WHERE a.id = $2
     ON CONFLICT (target_key) DO NOTHING
     RETURNING username`,
    [key, accountId, now],
  );
  return res.rowCount ? (res.rows[0] as { username: string }).username : null;
}

/** 全服播报（必达，不带坐标）：写库后经 pg_notify 在提交时广播 */
async function broadcastForced(client: pg.PoolClient, type: 'famous_first_explored' | 'hero_site_first_explored', detail: Record<string, unknown>): Promise<void> {
  const created = await insertServerBroadcast(client, type, detail, { force: true });
  if (created) {
    await client.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: created })]);
  }
}

/** 奖励到账后通知 API 推送城池资源（提交时发出） */
export async function notifyFogReward(client: pg.PoolClient, accountId: string): Promise<void> {
  await client.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify({ reason: 'fog_reward', accountId })]);
}

/**
 * 写探索时检查 8 座名城与 8 处名将处所的首探（调用方已确认迷雾开启）。
 * freshChunks：本趟行军新探索的区块下标（不含开局、城池与领地视野带来的，也不含返程）。
 */
export async function recordFirstExplores(
  client: pg.PoolClient,
  trip: FirstExploreTrip,
  freshChunks: ReadonlySet<number>,
  now: Date,
): Promise<void> {
  const famous = await client.query(`SELECT name, x, y FROM famous_cities`);
  const sites = await client.query(
    `SELECT wt.wild_hero AS hero, wt.x, wt.y, EXISTS (SELECT 1 FROM famous_heroes fh WHERE fh.name = wt.wild_hero) AS claimed
     FROM world_tiles wt WHERE wt.wild_hero = ANY($1::text[])`,
    [HERO_SITES.map((site) => site.hero)],
  );
  const targets: Target[] = [
    ...(famous.rows as Array<{ name: string; x: number; y: number }>).map((row) => ({ kind: 'famous' as const, ...row })),
    ...(sites.rows as Array<{ hero: string; x: number; y: number; claimed: boolean }>).map((row) => ({
      kind: 'site' as const,
      hero: row.hero,
      claimed: row.claimed === true,
      x: row.x,
      y: row.y,
    })),
  ];
  for (const target of targets) {
    if (!freshChunks.has(chunkIndexOf(target.x, target.y))) {
      continue;
    }
    if (target.kind === 'famous') {
      await firstFamous(client, trip, target, now);
    } else {
      await firstHeroSite(client, trip, target, now);
    }
  }
}

async function firstFamous(client: pg.PoolClient, trip: FirstExploreTrip, target: { name: string; x: number; y: number }, now: Date): Promise<void> {
  const username = await claimFirst(client, famousFirstKey(target.name), trip.accountId, now);
  if (username === null) {
    return;
  }
  await grantRewards(client, trip.accountId, FAMOUS_FIRST_REWARD);
  await grantItem(client, trip.accountId, 'city_order_adv', FAMOUS_FIRST_ITEMS.city_order_adv ?? 1, 'famous_first');
  await insertEvent(client, {
    accountId: trip.accountId,
    cityId: trip.fromCityId,
    buildId: trip.marchId,
    type: EventType.FAMOUS_FIRST_EXPLORED,
    initiator: null,
    detail: { name: target.name, x: target.x, y: target.y, reward: FAMOUS_FIRST_REWARD, items: FAMOUS_FIRST_ITEMS },
  });
  await broadcastForced(client, 'famous_first_explored', { username, name: target.name });
  await notifyFogReward(client, trip.accountId);
}

async function firstHeroSite(client: pg.PoolClient, trip: FirstExploreTrip, target: { hero: string; claimed: boolean; x: number; y: number }, now: Date): Promise<void> {
  const site = HERO_SITES.find((entry) => entry.hero === target.hero);
  if (!site) {
    return;
  }
  const username = await claimFirst(client, heroSiteFirstKey(target.hero), trip.accountId, now);
  if (username === null) {
    return;
  }
  await grantRewards(client, trip.accountId, HERO_SITE_FIRST_REWARD);
  // 名将已被招揽则只发资源（结交资格不给）；否则获得结交资格，不用打守军
  const unlocked = !target.claimed;
  if (unlocked) {
    await grantUnlock(client, trip.accountId, target.hero);
  }
  await insertEvent(client, {
    accountId: trip.accountId,
    cityId: trip.fromCityId,
    buildId: trip.marchId,
    type: EventType.HERO_SITE_FIRST_EXPLORED,
    initiator: null,
    detail: { name: site.name, hero: target.hero, x: target.x, y: target.y, reward: HERO_SITE_FIRST_REWARD, unlocked, claimed: target.claimed },
  });
  await broadcastForced(client, 'hero_site_first_explored', { username, name: site.name, hero: target.hero });
  await notifyFogReward(client, trip.accountId);
}
