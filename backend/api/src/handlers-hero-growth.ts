// 武将培养的处理逻辑（v54，AISLG-144）：ALLOCATE_HERO_POINTS（加点）/ RESET_HERO_POINTS（洗点）/
// TRAIN_HERO（历练）/ GIFT_HERO（赏赐）。规则见 common/src/hero-growth.ts，占用判定与每日计数见
// hero-growth-db.ts。锁序与 RECRUIT_HERO 一致：先主城行（花金币的操作），再武将行。
// 历练只登记结束时刻，到点经验由 Worker 的 hero-training-tick 结算。

import pg from 'pg';
import { Op, type ErrorCode, type InitiatorRole } from '../../common/src/protocol';
import { heroAttrs, heroBaseAttrs, heroView, loadHero, grantHeroExp, type AccountHeroRow } from '../../common/src/hero-db';
import { allocatedPoints, resetCost, validatePointsRequest, POINT_KEYS, type PointsRequest } from '../../common/src/hero-growth';
import { isTrainingTier, GIFT_DAILY_LIMIT, GIFT_EXP, GIFT_GOLD, RESET_DAILY_LIMIT } from '../../common/src/hero-growth';
import {
  bumpDailyCount,
  heroBusyCode,
  mainCityId,
  startTraining,
  usedDailyCount,
} from '../../common/src/hero-growth-db';
import { heroBusyMarchMap, heroGuardMaps } from '../../common/src/hero-db';
import type { HeroOnlyResponseData, HeroView } from '../../common/src/protocol-hero';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { lockCitySnapshot, toCityView } from './views';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 错误回滚 + 响应（与 handlers-hero 同口径的小工具） */
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

/** 变更后的武将视图：带上随行 / 城守占用（赏赐允许外出中操作，视图不能丢掉这些状态） */
async function viewAfter(client: pg.PoolClient, accountId: string, hero: AccountHeroRow): Promise<HeroView> {
  const busy = await heroBusyMarchMap(client, accountId);
  const guards = await heroGuardMaps(client, accountId);
  return heroView(hero, guards.heroToCity.get(hero.id) ?? null, busy.get(hero.id) ?? null);
}

/** 读取并锁定本账号的武将；不存在 / 不属于本账号返回 null */
async function lockOwnHero(client: pg.PoolClient, accountId: string, heroId: string): Promise<AccountHeroRow | null> {
  const hero = await loadHero(client, heroId, true);
  return hero && hero.account_id === accountId ? hero : null;
}

/** 武将变更后的统一收尾：回包、通知本账号其他连接（view 已含占用关系，调用方在提交前算好） */
function finish(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  accountId: string,
  view: HeroView,
  reason: 'points_changed' | 'training_started' | 'gifted',
  role: InitiatorRole,
): void {
  const body: HeroOnlyResponseData = { hero: view };
  respondOk(ctx.registry, conn, op, seq, { ...body });
  ctx.registry.broadcast(
    accountId,
    { op: Op.PUSH_HERO_STATE, push: true, data: { reason, heroId: view.id, initiator: role } },
    conn,
  );
}

/** ALLOCATE_HERO_POINTS：把自由点数分到统率 / 武力 / 智力（仅在家武将） */
export async function handleAllocateHeroPoints(
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
  const points: PointsRequest = {};
  for (const key of POINT_KEYS) {
    if (data?.[key] !== undefined) {
      points[key] = data[key] as number;
    }
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const hero = await lockOwnHero(client, accountId, heroId);
    if (!hero) {
      return fail(ctx, conn, client, op, seq, 'HERO_NOT_FOUND');
    }
    const busy = await heroBusyCode(client, accountId, hero);
    if (busy) {
      return fail(ctx, conn, client, op, seq, busy);
    }
    const check = validatePointsRequest(points, hero.free_points);
    if (check === 'invalid') {
      return fail(ctx, conn, client, op, seq, 'INVALID_PARAMS');
    }
    if (check === 'insufficient') {
      return fail(ctx, conn, client, op, seq, 'HERO_POINTS_INSUFFICIENT', { freePoints: hero.free_points });
    }
    const res = await client.query(
      `UPDATE account_heroes SET lead = lead + $2, force = force + $3, wit = wit + $4, free_points = free_points - $5
       WHERE id = $1 RETURNING *`,
      [hero.id, points.lead ?? 0, points.force ?? 0, points.wit ?? 0, check.total],
    );
    const view = await viewAfter(client, accountId, res.rows[0] as AccountHeroRow);
    await client.query('COMMIT');
    finish(ctx, conn, op, seq, accountId, view, 'points_changed', role);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** RESET_HERO_POINTS：洗点（已分配点数退回自由点数，属性还原到初始值；花 等级 × 1000 金币，每日 1 次） */
export async function handleResetHeroPoints(
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
    const capitalId = await mainCityId(client, accountId);
    const snap = capitalId ? await lockCitySnapshot(client, accountId, capitalId) : null;
    const hero = await lockOwnHero(client, accountId, heroId);
    if (!hero) {
      return fail(ctx, conn, client, op, seq, 'HERO_NOT_FOUND');
    }
    const busy = await heroBusyCode(client, accountId, hero);
    if (busy) {
      return fail(ctx, conn, client, op, seq, busy);
    }
    const allocated = allocatedPoints(heroAttrs(hero), heroBaseAttrs(hero));
    if (allocated <= 0) {
      return fail(ctx, conn, client, op, seq, 'HERO_NOTHING_TO_RESET');
    }
    if (usedDailyCount(hero, 'reset') >= RESET_DAILY_LIMIT) {
      return fail(ctx, conn, client, op, seq, 'HERO_DAILY_LIMIT', { limit: RESET_DAILY_LIMIT });
    }
    const cost = resetCost(hero.level);
    if (!snap || snap.resources.gold < cost) {
      // 用本事务已锁住的快照回包：另开连接读城池会等本事务持有的城池行锁，自己把自己死锁
      return fail(ctx, conn, client, op, seq, 'INSUFFICIENT_RESOURCES', snap ? { city: toCityView(snap) } : undefined);
    }
    await client.query(`UPDATE cities SET gold = gold - $2 WHERE id = $1`, [snap.cityId, cost]);
    await bumpDailyCount(client, hero, 'reset');
    const res = await client.query(
      `UPDATE account_heroes SET lead = base_lead, force = base_force, wit = base_wit, free_points = free_points + $2
       WHERE id = $1 RETURNING *`,
      [hero.id, allocated],
    );
    const view = await viewAfter(client, accountId, res.rows[0] as AccountHeroRow);
    await client.query('COMMIT');
    finish(ctx, conn, op, seq, accountId, view, 'points_changed', role);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** TRAIN_HERO：派武将历练（档位 1 / 2 / 3；历练中不能出征 / 城守 / 解雇 / 加点 / 洗点，赏赐不受限） */
export async function handleTrainHero(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const heroId = data?.heroId;
  const tier = data?.tier;
  if (typeof heroId !== 'string' || !UUID_RE.test(heroId) || !isTrainingTier(tier)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const hero = await lockOwnHero(client, accountId, heroId);
    if (!hero) {
      return fail(ctx, conn, client, op, seq, 'HERO_NOT_FOUND');
    }
    const busy = await heroBusyCode(client, accountId, hero);
    if (busy) {
      return fail(ctx, conn, client, op, seq, busy);
    }
    await startTraining(client, hero, tier);
    const res = await client.query(`SELECT * FROM account_heroes WHERE id = $1`, [hero.id]);
    const view = await viewAfter(client, accountId, res.rows[0] as AccountHeroRow);
    await client.query('COMMIT');
    finish(ctx, conn, op, seq, accountId, view, 'training_started', role);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** GIFT_HERO：赏赐（1000 金币 → 100 经验，主城扣；每个武将每游戏日最多 3 次；经验可升级得自由点数） */
export async function handleGiftHero(
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
    const capitalId = await mainCityId(client, accountId);
    const snap = capitalId ? await lockCitySnapshot(client, accountId, capitalId) : null;
    const hero = await lockOwnHero(client, accountId, heroId);
    if (!hero) {
      return fail(ctx, conn, client, op, seq, 'HERO_NOT_FOUND');
    }
    if (usedDailyCount(hero, 'gift') >= GIFT_DAILY_LIMIT) {
      return fail(ctx, conn, client, op, seq, 'HERO_DAILY_LIMIT', { limit: GIFT_DAILY_LIMIT });
    }
    if (!snap || snap.resources.gold < GIFT_GOLD) {
      // 用本事务已锁住的快照回包：另开连接读城池会等本事务持有的城池行锁，自己把自己死锁
      return fail(ctx, conn, client, op, seq, 'INSUFFICIENT_RESOURCES', snap ? { city: toCityView(snap) } : undefined);
    }
    await client.query(`UPDATE cities SET gold = gold - $2 WHERE id = $1`, [snap.cityId, GIFT_GOLD]);
    await bumpDailyCount(client, hero, 'gift');
    await grantHeroExp(client, hero.id, GIFT_EXP);
    const res = await client.query(`SELECT * FROM account_heroes WHERE id = $1`, [hero.id]);
    const view = await viewAfter(client, accountId, res.rows[0] as AccountHeroRow);
    await client.query('COMMIT');
    finish(ctx, conn, op, seq, accountId, view, 'gifted', role);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
