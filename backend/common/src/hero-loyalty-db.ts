// 名将忠诚度的数据库存取（v93，AISLG-228）：设置忠诚度（含 30 线提醒）与下野（删除武将、清除全服归属、
// 撤城守、好感从头算）。调用方必须已对该武将行加锁（FOR UPDATE）；下野还要求武将不在行军 / 历练中。
// Worker（忠诚度 tick、欠饷扣减）与 API（赏赐、赎回）共用。

import type pg from 'pg';
import { EventType } from './protocol';
import { insertEvent } from './events';
import { insertServerBroadcast, type ServerBroadcastCreated } from './server-broadcast';
import { heroBusyMarchMap, type AccountHeroRow } from './hero-db';
import { clampLoyalty, isLowLoyalty } from './hero-loyalty';
import { grantUnlock } from './hero-friendship-db';

/**
 * 写入忠诚度（钳到 0..100）并维护 30 线提醒：跌到 30 及以下且本轮未提醒过 → 写一条 hero_loyalty_low；
 * 回到 30 以上即复位，下次再跌才再提醒。会同步修正传入行对象的 loyalty / loyalty_warned，便于同一事务后续使用。
 */
export async function setLoyalty(client: pg.PoolClient, hero: AccountHeroRow, value: number): Promise<number> {
  const next = clampLoyalty(value);
  const low = isLowLoyalty(next);
  const warnNow = low && !hero.loyalty_warned;
  await client.query(`UPDATE account_heroes SET loyalty = $2, loyalty_warned = $3 WHERE id = $1`, [hero.id, next, low]);
  if (warnNow) {
    await insertEvent(client, {
      accountId: hero.account_id,
      buildId: hero.id,
      type: EventType.HERO_LOYALTY_LOW,
      initiator: null,
      detail: { heroId: hero.id, heroName: hero.name, loyalty: next },
    });
  }
  hero.loyalty = next;
  hero.loyalty_warned = low;
  return next;
}

/** 下野结果：ownerUsername 为主人用户名；broadcast 为全服播报（被限频丢弃时为 null） */
export interface DepartOutcome {
  heroName: string;
  ownerUsername: string;
  broadcast: ServerBroadcastCreated | null;
}

/**
 * 下野（v93，AISLG-228）：与解雇同一条删除路径——撤城守、删除武将（famous_heroes 归属随级联清除，名将回到
 * 可获得状态；world_tiles.wild_hero 不变）、清空该名将全服所有账号的结交进度（好感从头算）。
 * cause = captive_expired 时胜方获得结交资格（grantUnlock 重复调用无副作用）。
 * 行军 / 历练中返回 'busy'（不删、不发事件，等结束后由 tick 再次尝试）；武将已不存在（并发下野）返回 null，不重复发事件。
 */
export async function departHero(
  client: pg.PoolClient,
  hero: AccountHeroRow,
  cause: 'loyalty' | 'captive_expired',
): Promise<DepartOutcome | 'busy' | null> {
  if (hero.train_until) {
    return 'busy';
  }
  const busy = await heroBusyMarchMap(client, hero.account_id);
  if (busy.has(hero.id)) {
    return 'busy';
  }
  await client.query(`UPDATE cities SET guard_hero_id = NULL WHERE guard_hero_id = $1`, [hero.id]);
  const del = await client.query(`DELETE FROM account_heroes WHERE id = $1 RETURNING id`, [hero.id]);
  if (!del.rowCount) {
    return null;
  }
  await client.query(`DELETE FROM hero_friendship WHERE hero_name = $1`, [hero.name]);
  const ownerRes = await client.query(`SELECT username FROM accounts WHERE id = $1`, [hero.account_id]);
  const ownerUsername = (ownerRes.rows[0] as { username: string } | undefined)?.username ?? null;
  await insertEvent(client, {
    accountId: hero.account_id,
    buildId: hero.id,
    type: EventType.HERO_LEFT,
    initiator: null,
    detail: { heroId: hero.id, heroName: hero.name, cause },
  });
  if (cause === 'captive_expired' && hero.captured_by) {
    await grantUnlock(client, hero.captured_by, hero.name);
    await insertEvent(client, {
      accountId: hero.captured_by,
      buildId: hero.id,
      type: EventType.HERO_LEFT,
      initiator: null,
      detail: { heroId: hero.id, heroName: hero.name, cause, qualified: true, ownerUsername },
    });
  }
  const broadcast = await insertServerBroadcast(client, 'hero_left', { username: ownerUsername, heroName: hero.name });
  return { heroName: hero.name, ownerUsername: ownerUsername ?? '', broadcast };
}
