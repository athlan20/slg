// 在野名将的结交与招揽（v54，AISLG-144）：BEFRIEND_HERO（结交）/ RECRUIT_FAMOUS_HERO（招揽）。
// 前提是结交资格（打赢过其所在野地的原住守军，见 battle-tick 的解锁钩子）。结交花主城金币
// （500 × 野地等级），好感 +10，好感满 100 才能招揽；招揽走 grantFamousHero，全服唯一由它保证。
// 锁序：主城行（花金币）→ 结交进度行 → 名将归属（famous_heroes 主键）。

import pg from 'pg';
import { EventType, Op, type ErrorCode, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { insertServerBroadcast } from '../../common/src/server-broadcast';
import { famousSourceKey, famousSourceLabel, FAMOUS_HERO_CAP } from '../../common/src/hero';
import { grantFamousHero, heroCounts, heroView } from '../../common/src/hero-db';
import { heroDayIndex } from '../../common/src/hero-growth';
import { mainCityId } from '../../common/src/hero-growth-db';
import { activeFriendshipCount, dropFriendship } from '../../common/src/hero-friendship-db';
import {
  BEFRIEND_ACTIVE_CAP,
  BEFRIEND_DAILY_LIMIT,
  BEFRIEND_FAVOR_PER_TIME,
  RECRUIT_FAVOR_REQUIRED,
  WILD_FAMOUS_HEROES,
  befriendCost,
} from '../../common/src/hero-wild';
import { loadWildHeroAttrs, loadWildHeroTile } from '../../common/src/wild-famous-db';
import type { BefriendHeroResponseData, RecruitFamousHeroResponseData } from '../../common/src/protocol-hero';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadCityState, lockCitySnapshot } from './views';

/** 名字合法性：必须是在野名将名单里的名字（其余一律视为「尚未获得资格」） */
function wildDef(name: unknown) {
  return typeof name === 'string' ? WILD_FAMOUS_HEROES.find((def) => def.name === name) ?? null : null;
}

async function fail(
  ctx: HandlerContext,
  conn: ConnInfo,
  client: pg.PoolClient,
  op: number,
  seq: number | undefined,
  code: ErrorCode,
  data?: Record<string, unknown>,
): Promise<void> {
  await client.query('ROLLBACK');
  respondError(ctx.registry, conn, op, seq, code, data);
}

/** BEFRIEND_HERO：结交一次（需结交资格、未被招揽、同时结交 ≤ 2、当日 ≤ 5、好感未满、金币足够） */
export async function handleBefriendHero(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const def = wildDef(data?.heroName);
  if (!def) {
    respondError(ctx.registry, conn, op, seq, 'HERO_NOT_UNLOCKED');
    return;
  }
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const capitalId = await mainCityId(client, accountId);
    const snap = capitalId ? await lockCitySnapshot(client, accountId, capitalId) : null;
    const tile = await loadWildHeroTile(client, def.name);
    const unlocked = await client.query(
      `SELECT 1 FROM hero_unlocks WHERE account_id = $1 AND hero_name = $2`,
      [accountId, def.name],
    );
    if (!tile || !unlocked.rowCount) {
      return fail(ctx, conn, client, op, seq, 'HERO_NOT_UNLOCKED');
    }
    const claimed = await client.query(`SELECT 1 FROM famous_heroes WHERE name = $1`, [def.name]);
    if (claimed.rowCount) {
      return fail(ctx, conn, client, op, seq, 'FAMOUS_CLAIMED');
    }
    const row = await client.query(
      `SELECT favor, day, day_count FROM hero_friendship WHERE account_id = $1 AND hero_name = $2 FOR UPDATE`,
      [accountId, def.name],
    );
    const existing = row.rowCount ? (row.rows[0] as { favor: number; day: string | null; day_count: number }) : null;
    if (existing && existing.favor >= RECRUIT_FAVOR_REQUIRED) {
      return fail(ctx, conn, client, op, seq, 'HERO_FAVOR_FULL');
    }
    if (!existing && (await activeFriendshipCount(client, accountId)) >= BEFRIEND_ACTIVE_CAP) {
      return fail(ctx, conn, client, op, seq, 'HERO_FRIENDSHIP_LIMIT', { cap: BEFRIEND_ACTIVE_CAP });
    }
    const today = heroDayIndex(new Date());
    const usedToday = existing && existing.day !== null && Number(existing.day) === today ? existing.day_count : 0;
    if (usedToday >= BEFRIEND_DAILY_LIMIT) {
      return fail(ctx, conn, client, op, seq, 'HERO_DAILY_LIMIT', { limit: BEFRIEND_DAILY_LIMIT });
    }
    const cost = befriendCost(tile.level);
    if (!snap || snap.resources.gold < cost) {
      const cityState = await loadCityState(ctx.pool, accountId);
      return fail(ctx, conn, client, op, seq, 'INSUFFICIENT_RESOURCES', cityState ? { city: cityState } : undefined);
    }
    await client.query(`UPDATE cities SET gold = gold - $2 WHERE id = $1`, [snap.cityId, cost]);
    const saved = await client.query(
      `INSERT INTO hero_friendship (account_id, hero_name, favor, day, day_count)
       VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (account_id, hero_name) DO UPDATE SET
         favor = LEAST(${RECRUIT_FAVOR_REQUIRED}, hero_friendship.favor + $3),
         day = $4,
         day_count = CASE WHEN hero_friendship.day = $4 THEN hero_friendship.day_count + 1 ELSE 1 END,
         updated_at = now()
       RETURNING favor, day, day_count`,
      [accountId, def.name, BEFRIEND_FAVOR_PER_TIME, today],
    );
    await client.query('COMMIT');

    const after = saved.rows[0] as { favor: number; day_count: number };
    const body: BefriendHeroResponseData = {
      friendship: {
        heroName: def.name,
        favor: after.favor,
        todayLeft: Math.max(0, BEFRIEND_DAILY_LIMIT - (after.day_count ?? 0)),
        cost: befriendCost(tile.level),
        lost: false,
      },
    };
    respondOk(ctx.registry, conn, op, seq, { ...body });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_HERO_STATE, push: true, data: { reason: 'friendship_changed', initiator: conn.role as InitiatorRole } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** RECRUIT_FAMOUS_HERO：好感满 100 招揽在野名将（全服唯一；名将满 3 名或已被他人获得则拒绝） */
export async function handleRecruitFamousHero(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const def = wildDef(data?.heroName);
  if (!def) {
    respondError(ctx.registry, conn, op, seq, 'HERO_NOT_UNLOCKED');
    return;
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 锁主城行：与结交一样按账号串行，避免并发招揽越过名将上限
    const capitalId = await mainCityId(client, accountId);
    if (capitalId) {
      await lockCitySnapshot(client, accountId, capitalId);
    }
    const row = await client.query(
      `SELECT favor FROM hero_friendship WHERE account_id = $1 AND hero_name = $2 FOR UPDATE`,
      [accountId, def.name],
    );
    const favor = row.rowCount ? (row.rows[0] as { favor: number }).favor : 0;
    if (favor < RECRUIT_FAVOR_REQUIRED) {
      return fail(ctx, conn, client, op, seq, 'HERO_FAVOR_INSUFFICIENT', { favor });
    }
    const attrs = await loadWildHeroAttrs(client, def.name);
    if (!attrs) {
      return fail(ctx, conn, client, op, seq, 'HERO_NOT_UNLOCKED');
    }
    const claimed = await client.query(`SELECT 1 FROM famous_heroes WHERE name = $1`, [def.name]);
    if (claimed.rowCount) {
      return fail(ctx, conn, client, op, seq, 'FAMOUS_CLAIMED');
    }
    const counts = await heroCounts(client, accountId);
    if (counts.famousCount >= FAMOUS_HERO_CAP) {
      return fail(ctx, conn, client, op, seq, 'HERO_CAP_REACHED', { famousCap: FAMOUS_HERO_CAP });
    }
    const hero = await grantFamousHero(client, accountId, def, attrs);
    if (!hero) {
      return fail(ctx, conn, client, op, seq, 'FAMOUS_CLAIMED');
    }
    await dropFriendship(client, accountId, def.name);
    const who = await client.query(`SELECT username FROM accounts WHERE id = $1`, [accountId]);
    const username = (who.rows[0] as { username: string }).username;
    await insertEvent(client, {
      accountId,
      buildId: hero.id,
      type: EventType.HERO_GRANTED,
      initiator: role,
      detail: { heroId: hero.id, heroName: def.name, source: famousSourceLabel(def.source), key: famousSourceKey(def.source) },
    });
    const broadcast = await insertServerBroadcast(
      client,
      'hero_granted',
      { username, heroName: def.name, source: '结交招揽' },
      { force: true },
    );
    await client.query('COMMIT');

    const view = heroView(hero, null, null);
    const body: RecruitFamousHeroResponseData = { hero: view };
    respondOk(ctx.registry, conn, op, seq, { ...body });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_HERO_STATE, push: true, data: { reason: 'granted', heroId: hero.id, initiator: role } },
      conn,
    );
    if (broadcast) {
      ctx.registry.broadcastAll({ op: Op.PUSH_SERVER_BROADCAST, push: true, data: { broadcast } });
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
