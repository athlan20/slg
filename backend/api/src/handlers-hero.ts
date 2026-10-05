// 武将协议的处理逻辑（v36，AISLG-114/115/116）：GET_HEROES / RECRUIT_HERO /
// DISMISS_HERO / ASSIGN_HERO。武将账号共享；酒馆候选每城一份、读取时惰性刷新；
// 招募扣酒馆所在城的金币；解雇直接消失（名将回到全服可获得状态）；城守任命 /
// 撤换（守城加成与产量加成的消费方在 city-raid 与 production）。
// 锁序：城池行（lockCitySnapshot）→ 武将行 / 候选行，与 Worker 俸禄 tick 一致。

import pg from 'pg';
import { EventType, Op, type ErrorCode, type HeroStateView, type InitiatorRole } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { loadBuildingLevels } from '../../common/src/production';
import { recruitCost } from '../../common/src/hero';
import {
  assignCityGuard,
  heroBusyMarchMap,
  heroCounts,
  heroGuardMaps,
  heroView,
  insertHero,
  loadFamousClaims,
  loadHero,
  loadHeroes,
  loadTavernCandidates,
  tavernRefreshMs,
  type AccountHeroRow,
} from '../../common/src/hero-db';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { currentCityId } from './city-scope';
import { loadCityState, lockCitySnapshot } from './views';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 出征 / 侦察 / 截击 / 运输配将校验（v36，AISLG-114，MARCH 与 SCOUT 共用）：
 * 武将属于本账号、未重伤、未欠饷、未随行（另一支部队）、未任城守（城守不能同时出征）。
 * 通过返回武将行，否则返回错误码。
 */
export async function checkHeroMarchable(
  client: pg.PoolClient,
  accountId: string,
  heroId: string,
): Promise<{ ok: true; hero: AccountHeroRow } | { ok: false; code: ErrorCode }> {
  const hero = await loadHero(client, heroId);
  if (!hero || hero.account_id !== accountId) {
    return { ok: false, code: 'HERO_NOT_FOUND' };
  }
  const nowRes = await client.query(`SELECT now() AS now`);
  const now = (nowRes.rows[0].now as Date).getTime();
  if (hero.wounded_until && hero.wounded_until.getTime() > now) {
    return { ok: false, code: 'HERO_WOUNDED' };
  }
  if (hero.arrears) {
    return { ok: false, code: 'HERO_ARREARS' };
  }
  const busy = await heroBusyMarchMap(client, accountId);
  if (busy.has(hero.id)) {
    return { ok: false, code: 'HERO_BUSY' };
  }
  const guards = await heroGuardMaps(client, accountId);
  if (guards.heroToCity.has(hero.id)) {
    return { ok: false, code: 'GUARD_ASSIGN_DENIED' };
  }
  return { ok: true, hero };
}

/** 目标城的 id：请求显式给的 cityId > 当前请求 scope > 账号主城；城不属于本账号 / 账号无城返回 null */
async function scopedCityId(
  pool: pg.Pool | pg.PoolClient,
  accountId: string,
  explicit?: unknown,
): Promise<string | null> {
  const wanted = typeof explicit === 'string' && UUID_RE.test(explicit) ? explicit : (currentCityId() ?? null);
  const res = await pool.query(
    `SELECT id FROM cities WHERE account_id = $1 AND ($2::uuid IS NULL OR id = $2::uuid)
     ORDER BY created_at LIMIT 1`,
    [accountId, wanted],
  );
  return res.rowCount ? (res.rows[0] as { id: string }).id : null;
}

/** 账号武将 + 酒馆候选 + 上限 + 名将归属 → 完整状态视图（候选刷新须在事务内） */
export async function buildHeroState(client: pg.PoolClient, accountId: string, cityId: string): Promise<HeroStateView> {
  const levels = await loadBuildingLevels(client, cityId);
  const candidates = await loadTavernCandidates(client, cityId, levels.tavern);
  const heroes = await loadHeroes(client, accountId);
  const busy = await heroBusyMarchMap(client, accountId);
  const guards = await heroGuardMaps(client, accountId);
  const counts = await heroCounts(client, accountId);
  return {
    cityId,
    tavernLevel: levels.tavern,
    maxTavernLevel: counts.maxTavernLevel,
    normalCap: counts.normalCap,
    normalCount: counts.normalCount,
    famousCap: counts.famousCap,
    famousCount: counts.famousCount,
    heroes: heroes.map((row) => heroView(row, guards.heroToCity.get(row.id) ?? null, busy.get(row.id) ?? null)),
    candidates,
    famousClaims: await loadFamousClaims(client),
  };
}

/** GET_HEROES：账号武将 + 当前（或指定）城酒馆候选 + 上限 + 名将归属 */
export async function handleGetHeroes(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data?: Record<string, unknown>,
): Promise<void> {
  const accountId = conn.accountId as string;
  const client = await ctx.pool.connect();
  try {
    const cityId = await scopedCityId(client, accountId, data?.cityId);
    if (!cityId) {
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    // 候选惰性刷新可能写库（重摇一批），开小事务保证一致
    await client.query('BEGIN');
    const state = await buildHeroState(client, accountId, cityId);
    await client.query('COMMIT');
    respondOk(ctx.registry, conn, op, seq, { ...state });
  } finally {
    client.release();
  }
}

/** RECRUIT_HERO：从酒馆候选招募（校验：候选存在且属本批 → 酒馆 → 上限 → 金币） */
export async function handleRecruitHero(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const candidateId = data?.candidateId;
  if (typeof candidateId !== 'string' || !UUID_RE.test(candidateId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const candRes = await client.query(`SELECT * FROM tavern_candidates WHERE id = $1`, [candidateId]);
    if (!candRes.rowCount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_CANDIDATE_GONE');
      return;
    }
    const cand = candRes.rows[0] as {
      city_id: string; name: string; lead: number; force: number; wit: number; refreshed_at: Date;
    };
    const snap = await lockCitySnapshot(client, accountId, cand.city_id);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_CANDIDATE_GONE');
      return;
    }
    if (snap.levels.tavern <= 0) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'TAVERN_NOT_BUILT');
      return;
    }
    // 候选必须是当前批次（已过期批次随刷新整体替换）；与库内时钟同源判定
    const nowRes = await client.query(`SELECT now() AS now`);
    const freshMs = cand.refreshed_at.getTime() + tavernRefreshMs();
    if (freshMs <= (nowRes.rows[0].now as Date).getTime()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_CANDIDATE_GONE');
      return;
    }
    const counts = await heroCounts(client, accountId);
    if (counts.normalCount >= counts.normalCap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_CAP_REACHED', { normalCap: counts.normalCap });
      return;
    }
    const cost = recruitCost({ lead: cand.lead, force: cand.force, wit: cand.wit });
    if (snap.resources.gold < cost) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_RESOURCES', cityState ? { city: cityState } : undefined);
      return;
    }
    await client.query(`UPDATE cities SET gold = gold - $2 WHERE id = $1`, [snap.cityId, cost]);
    // 原子扣减候选（并发招募后到者按候选已消失处理）
    const del = await client.query(`DELETE FROM tavern_candidates WHERE id = $1 RETURNING *`, [candidateId]);
    if (!del.rowCount) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_CANDIDATE_GONE');
      return;
    }
    const hero = await insertHero(client, accountId, {
      name: cand.name, famous: false, lead: cand.lead, force: cand.force, wit: cand.wit,
    });
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: hero.id,
      type: EventType.HERO_RECRUITED,
      initiator: role,
      detail: { heroId: hero.id, name: hero.name, lead: hero.lead, force: hero.force, wit: hero.wit, cost },
    });
    await client.query('COMMIT');

    const view = heroView(hero, null, null);
    respondOk(ctx.registry, conn, op, seq, { hero: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_HERO_STATE, push: true, data: { reason: 'recruited', heroId: hero.id, initiator: role } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** DISMISS_HERO：解雇（随行出征中的武将不能解雇；城守解雇同时撤任；名将回到可获得状态） */
export async function handleDismissHero(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const heroId = data?.heroId;
  if (typeof heroId !== 'string' || !UUID_RE.test(heroId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const hero = await loadHero(client, heroId, true);
    if (!hero || hero.account_id !== accountId) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_NOT_FOUND');
      return;
    }
    const busy = await heroBusyMarchMap(client, accountId);
    if (busy.has(hero.id)) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'HERO_BUSY');
      return;
    }
    // 名将的 famous_heroes 归属行随外键级联删除 → 回到全服可获得状态；城守随解雇撤任
    await client.query(`UPDATE cities SET guard_hero_id = NULL WHERE guard_hero_id = $1`, [hero.id]);
    await client.query(`DELETE FROM account_heroes WHERE id = $1`, [hero.id]);
    await insertEvent(client, {
      accountId,
      buildId: hero.id,
      type: EventType.HERO_DISMISSED,
      initiator: role,
      detail: { heroId: hero.id, name: hero.name, famous: hero.famous },
    });
    await client.query('COMMIT');

    respondOk(ctx.registry, conn, op, seq, { heroId });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_HERO_STATE, push: true, data: { reason: 'dismissed', heroId, initiator: role } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** ASSIGN_HERO：任命 / 撤换城守（heroId=null 撤任；城守不能同时出征） */
export async function handleAssignHero(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const heroId = data?.heroId ?? null;
  if (heroId !== null && (typeof heroId !== 'string' || !UUID_RE.test(heroId))) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId, typeof data?.cityId === 'string' ? data.cityId : undefined);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    let hero: AccountHeroRow | null = null;
    if (heroId !== null) {
      hero = await loadHero(client, heroId, true);
      if (!hero || hero.account_id !== accountId) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'HERO_NOT_FOUND');
        return;
      }
      const busy = await heroBusyMarchMap(client, accountId);
      if (busy.has(hero.id)) {
        await client.query('ROLLBACK');
        respondError(ctx.registry, conn, op, seq, 'HERO_BUSY');
        return;
      }
    }
    // 一名武将至多守一城：先清它原有的城守，再任命到目标城
    await assignCityGuard(client, snap.cityId, heroId);
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: heroId,
      type: EventType.GUARD_CHANGED,
      initiator: role,
      detail: { cityId: snap.cityId, heroId, heroName: hero?.name ?? null },
    });
    await client.query('COMMIT');

    respondOk(ctx.registry, conn, op, seq, {
      cityId: snap.cityId,
      guard: hero ? heroView(hero, snap.cityId, null) : null,
    });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_HERO_STATE, push: true, data: { reason: 'guard_changed', heroId, initiator: role } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
