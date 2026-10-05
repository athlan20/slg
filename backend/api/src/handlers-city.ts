// 城池操作协议的处理逻辑：BUILD / UPGRADE / CANCEL_BUILD / RENAME_CITY。
// 协议分发见 handlers.ts。共同约定：
// - 指令的直接结果回给发送连接；同账号其他在线连接收到推送；
// - 建造 / 升级 / 改名在事务内加城池行锁、懒结算生产后按最新状态重新校验
//   （玩家 / Agent 同时提交按先后生效）；
// - 取消排队先用条件翻转守卫 builds 行（锁序与 Worker 相同：builds → cities，避免死锁），
//   再在城池行锁内按成本快照全额返还（2026-09-27 确认规则；在建条目能否取消待定）。
//   一期不提供建筑拆除（范围文档「明确不上线」）。

import pg from 'pg';
import {
  Op,
  EventType,
  RESOURCE_KEYS,
  type BuildingKind,
  type InitiatorRole,
  type Resources,
} from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import {
  INITIAL_BUILDINGS,
  INITIAL_POPULATION,
  INITIAL_RESOURCES,
  EXCHANGE_INPUT_PER_GOLD,
  applyCost,
  buildSeconds,
  exchangeGoldFor,
  startBuild,
  startUpgrade,
  upgradeChainCost,
  upgradeCost,
  upgradeSeconds,
  type BuildDeniedCode,
} from '../../common/src/rules';
import { productionPerHour } from '../../common/src/production';
import { territoryRates } from '../../common/src/world';
import { populationGrowthPerHour } from '../../common/src/rules';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { buildView, loadCityState, lockCitySnapshot, type BuildRow, type CitySnapshot } from './views';

/**
 * 建造 / 升级的共用事务路径：同一事务内行锁、生产结算、校验决策、入队/开工、
 * 扣资源、写事件，提交后响应并推送。玩家与 Agent 并发提交时，后提交方基于
 * 已扣减状态重新校验（decide 在行锁内取最新快照判定）。
 */
async function runBuildAction(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  decide: (
    snap: CitySnapshot,
    counts: { active: number; queued: number },
  ) =>
    | { ok: true; kind: BuildingKind; cost: Resources; level: number; toLevel: number | null; fromLevel: number; mode: 'start' | 'queued'; dueSeconds: number }
    | { ok: false; code: BuildDeniedCode; cost?: Resources },
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const counts = await queueCounts(client, snap.cityId);
    const verdict = decide(snap, counts);
    if (!verdict.ok) {
      await client.query('ROLLBACK');
      // 失败时附当前状态（含本次读取触发的生产结算），客户端据此自行刷新；
      // v22（AISLG-43）：资源不足附缺口 shortfall 与按当前净产量推导的 retryAfterSeconds
      const cityState = await loadCityState(ctx.pool, accountId);
      const extra =
        verdict.code === 'INSUFFICIENT_RESOURCES' && verdict.cost
          ? insufficientResourcesDetail(verdict.cost, snap)
          : undefined;
      respondError(
        ctx.registry, conn, op, seq, verdict.code,
        cityState ? { city: cityState, ...extra } : extra,
      );
      return;
    }
    const afterCost = applyCost(snap.resources, verdict.cost);
    const status = verdict.mode === 'start' ? 'building' : 'queued';
    // 排队中没有到期时间：队首激活时由 Worker 重算写入；cost 为取消返还用的成本快照
    const ins = await client.query(
      `INSERT INTO builds (account_id, city_id, kind, status, level, to_level, initiator, cost, due_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb,
               CASE WHEN $4 = 'building' THEN now() + make_interval(secs => $9) END)
       RETURNING *`,
      [accountId, snap.cityId, verdict.kind, status, verdict.level, verdict.toLevel, role, JSON.stringify(verdict.cost), verdict.dueSeconds],
    );
    const build = ins.rows[0] as BuildRow;
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [snap.cityId, afterCost.gold, afterCost.wood, afterCost.food, afterCost.stone, afterCost.iron],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: build.id,
      type: verdict.mode === 'start' ? EventType.BUILD_STARTED : EventType.BUILD_QUEUED,
      initiator: role,
      // 连续升级（UPGRADE toLevel）：cost 是整链总额、level 是首个推进的等级，toLevel 标明链的终点（AISLG-105）
      detail: { kind: verdict.kind, cost: verdict.cost, level: verdict.level, ...(verdict.toLevel !== null ? { toLevel: verdict.toLevel } : {}) },
    });
    await client.query('COMMIT');

    const view = buildView(build);
    // v22（AISLG-43）：连续升级返回整链计划（每级成本与时长，客户端可展示 / 预估）
    const chain =
      verdict.toLevel !== null
        ? upgradeChainPlan(verdict.kind, verdict.fromLevel, verdict.toLevel)
        : undefined;
    respondOk(ctx.registry, conn, op, seq, chain ? { build: view, chain } : { build: view });
    ctx.registry.broadcast(
      accountId,
      {
        op: Op.PUSH_BUILD_STATE,
        push: true,
        data: { reason: verdict.mode === 'start' ? 'build_started' : 'build_queued', build: view },
      },
      conn,
    );
    // 入队/开工推送只发给同账号其他连接，发起方拿不到；服务端已扣资源，
    // 发起方的资源对齐由客户端按需查询负责（useGameSession 在请求后触发）
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 建造（v5 单实例：已建成或队列中已有该类型则拒绝），目标等级恒为 1 */
export async function handleBuild(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  kind: BuildingKind,
): Promise<void> {
  await runBuildAction(ctx, conn, op, seq, (snap, counts) => {
    const kindBusy = snap.levels[kind] > 0 || snap.queue.some((item) => item.kind === kind);
    const verdict = startBuild(kind, snap.resources, kindBusy, counts.active, counts.queued);
    if (!verdict.ok) {
      return verdict;
    }
    return { ...verdict, kind, level: 1 as const, toLevel: null, fromLevel: 0, dueSeconds: buildSeconds() };
  });
}

/** 升级（目标等级 = 当前 + 1；v22 起可选 toLevel 连续升级到目标等级，与建造共用队列） */
export async function handleUpgrade(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  kind: BuildingKind,
  toLevel: number | null,
): Promise<void> {
  await runBuildAction(ctx, conn, op, seq, (snap, counts) => {
    const currentLevel = snap.levels[kind];
    const kindInQueue = snap.queue.some((item) => item.kind === kind);
    const verdict = startUpgrade(kind, currentLevel, snap.resources, kindInQueue, counts.active, counts.queued, toLevel ?? undefined);
    if (!verdict.ok) {
      return verdict;
    }
    return { ...verdict, kind, fromLevel: currentLevel, dueSeconds: upgradeSeconds(currentLevel) };
  });
}

/** 连续升级的整链计划（响应体 chain）：每级 { level, cost, seconds }，秒为该级单级时长（未加速基准由服务端缩放后给出） */
function upgradeChainPlan(kind: BuildingKind, fromLevel: number, toLevel: number): Array<{ level: number; cost: Resources; seconds: number }> {
  const plan: Array<{ level: number; cost: Resources; seconds: number }> = [];
  for (let level = fromLevel + 1; level <= toLevel; level += 1) {
    plan.push({ level, cost: upgradeCost(kind, level - 1), seconds: upgradeSeconds(level - 1) });
  }
  return plan;
}

/**
 * 资源不足失败响应的派生字段（v22，AISLG-43）：shortfall = 每资源缺口；
 * retryAfterSeconds = 按当前净产量（含缩放、粮扣除耗粮）补齐全部缺口所需秒数——
 * 等满该时长后重发必然成功（净产量为 0 / 负的缺口资源存在时为 null，客户端只能等外部输入）。
 * 产量随后续建造 / 领地变化而变时，以最新失败响应为准。
 */
export function insufficientResourcesDetail(cost: Resources, snap: CitySnapshot): { shortfall: Partial<Resources>; retryAfterSeconds: number | null } {
  const rates = productionPerHour(snap.levels, territoryRates(snap.territory), snap.productionBonusPercent, snap.techs);
  const netRates: Resources = {
    gold: rates.gold,
    wood: rates.wood,
    food: rates.food - snap.armyFoodUsePerHour,
    stone: rates.stone,
    iron: rates.iron,
  };
  const shortfall: Partial<Resources> = {};
  let eta: number | null = 0;
  for (const key of RESOURCE_KEYS) {
    const missing = cost[key] - snap.resources[key];
    if (missing > 0) {
      shortfall[key] = missing;
      const rate = netRates[key];
      eta = rate > 0 ? Math.max(eta ?? 0, Math.ceil((missing / rate) * 3600)) : null;
      if (eta === null) {
        break;
      }
    }
  }
  return { shortfall, retryAfterSeconds: eta };
}

/**
 * 人口不足失败响应的派生字段（v22，AISLG-43，征兵路径复用）：
 * retryAfterSeconds 按当前人口增速（已含 timeScale）推导。
 */
export function insufficientPopulationDetail(populationCost: number, snap: CitySnapshot): { shortfall: number; retryAfterSeconds: number | null } {
  const missing = populationCost - snap.population;
  const growth = populationGrowthPerHour(snap.levels.house);
  return {
    shortfall: Math.max(0, missing),
    retryAfterSeconds: growth > 0 ? Math.ceil((missing / growth) * 3600) : null,
  };
}

/**
 * 集市兑换（v22，AISLG-42）：把四种基础资源按固定汇率（EXCHANGE_INPUT_PER_GOLD）
 * 换成金币——满仓资源的可持续出口。金币不可逆向兑换；兑换即时入账、不钳储量上限
 * （与掠夺入账同规则）。响应 { exchange, city }。
 */
export async function handleExchange(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const resource = readString(data, 'resource');
  const amount = data?.amount;
  if (
    resource !== 'food' && resource !== 'wood' && resource !== 'stone' && resource !== 'iron'
  ) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 1) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const gold = exchangeGoldFor(amount);
  if (gold < 1) {
    // 不足最低汇率（4 单位）：换不出 1 金，按参数错误处理
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    if (snap.resources[resource] < amount) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      const shortCost: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
      shortCost[resource] = amount;
      const extra = insufficientResourcesDetail(shortCost, snap);
      respondError(
        ctx.registry, conn, op, seq, 'INSUFFICIENT_RESOURCES',
        cityState ? { city: cityState, ...extra } : extra,
      );
      return;
    }
    await client.query(
      `UPDATE cities SET ${resource} = ${resource} - $2, gold = gold + $3 WHERE id = $1`,
      [snap.cityId, amount, gold],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      type: EventType.RESOURCE_EXCHANGED,
      initiator: role,
      detail: { resource, amount, gold, rate: EXCHANGE_INPUT_PER_GOLD },
    });
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  const cityState = await loadCityState(ctx.pool, accountId);
  respondOk(ctx.registry, conn, op, seq, {
    exchange: { resource, amount, gold, rate: EXCHANGE_INPUT_PER_GOLD },
    ...(cityState ? { city: cityState } : {}),
  });
}

/** builds.cost 成本快照 → Resources（旧数据无快照时按零返还） */
function refundOf(row: { cost?: Record<string, unknown> | null }): Resources {
  const refund: Resources = { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 };
  const cost = row.cost ?? {};
  for (const key of RESOURCE_KEYS) {
    const value = cost[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      refund[key] = Math.floor(value);
    }
  }
  return refund;
}

/** 取消排队条目（v7：仅 status=queued 可取消；成本按快照全额返还，占位规则） */
export async function handleCancelBuild(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  buildId: string,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 条件翻转即守卫：与 Worker 的领取/激活写法一致，并发下只有一方生效。
    // 先锁 builds 再锁 cities（下方快照），与 Worker 的锁序一致，不构成死锁环
    const upd = await client.query(
      `UPDATE builds SET status = 'cancelled', due_at = NULL, completed_at = NULL
       WHERE id = $1 AND account_id = $2 AND status = 'queued'
       RETURNING *`,
      [buildId, accountId],
    );
    if (!upd.rowCount) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'BUILD_NOT_CANCELLABLE', cityState ? { city: cityState } : undefined);
      return;
    }
    const build = upd.rows[0] as BuildRow & { cost: Record<string, unknown> | null };
    // 按条目所属城池加锁与返还（主城 / 分城的排队条目都可取消，v24）
    const snap = await lockCitySnapshot(client, accountId, build.city_id);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    // 返还不受仓储上限钳制（上限只作用于产出增量；占位规则）
    const refund = refundOf(build);
    const refunded: Resources = { ...snap.resources };
    for (const key of RESOURCE_KEYS) {
      refunded[key] += refund[key];
    }
    await client.query(
      `UPDATE cities SET gold = $2, wood = $3, food = $4, stone = $5, iron = $6 WHERE id = $1`,
      [snap.cityId, refunded.gold, refunded.wood, refunded.food, refunded.stone, refunded.iron],
    );
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: build.id,
      type: EventType.BUILD_CANCELLED,
      initiator: role,
      detail: { kind: build.kind, level: build.level, refund },
    });
    await client.query('COMMIT');

    const view = buildView(build);
    respondOk(ctx.registry, conn, op, seq, { build: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_BUILD_STATE, push: true, data: { reason: 'build_cancelled', build: view } },
      conn,
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 城池名长度上限（去首尾空白后；占位决策） */
export const CITY_NAME_MAX = 24;

/** 城池改名（v7）：改名同时把生产结算进快照，保持返回状态一致 */
async function queueCounts(client: pg.PoolClient, cityId: string): Promise<{ active: number; queued: number }> {
  const res = await client.query(
    `SELECT count(*) FILTER (WHERE status = 'building')::int AS active,
            count(*) FILTER (WHERE status = 'queued')::int AS queued
     FROM builds WHERE city_id = $1`,
    [cityId],
  );
  return { active: res.rows[0].active, queued: res.rows[0].queued };
}
