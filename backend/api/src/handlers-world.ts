// 世界地图协议的处理逻辑：GET_WORLD_MAP / GET_TILE / MARCH / RECALL_GARRISON（v12 起）。
// 协议分发见 handlers.ts。共同约定：
// - 出征与召回在事务内先锁城池行（cities → world_tiles 的全局锁序，与 Worker 一致）、
//   懒结算生产（产量含野地加成）后按最新状态校验；
// - 召回 = 撤回全部驻军并**立即放弃占领**（占位规则）：野地回到无主状态，部队作为
//   返程行军回城，到达后才并入城内驻军；
// - 出征目标本期限野地（无主或本账号占领）与 NPC 城池；玩家城池与他人占领地块随
//   「玩家对抗」阶段开放，当前返回 TARGET_NOT_ATTACKABLE；
// - v16 出征任务（MARCH.task，缺省 plunder）：野地掠夺 / 占领（占领上限 = 官府等级，
//   发起时初核 TERRITORY_LIMIT，Worker 到达复核）；NPC 城掠夺或占领（v24 AISLG-58：
//   占领变分城，资格见 common/src/branch-city.ts）；掠夺冷却 24 小时（plundered_at，
//   发起时校验 PLUNDER_COOLDOWN，Worker 到达在锁内复核）。
// - v24：城池类协议可选 data.cityId 指定出发城（分发层经 city-scope 带入快照加锁）。

import pg from 'pg';
import {
  Op,
  EventType,
  RESOURCE_KEYS,
  TROOP_KINDS,
  type InitiatorRole,
  type MarchTask,
  type Resources,
  type TroopKind,
} from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { isEmptyArmy } from '../../common/src/battle';
import {
  WORLD_SIZE,
  DEFAULT_MAP_WINDOW,
  MAX_MAP_WINDOW,
  clampMapWindow,
  inWorld,
  marchTravelSeconds,
  territoryRates,
} from '../../common/src/world';
import { PLUNDER_COOLDOWN_MS } from '../../common/src/plunder';
import {
  clearTileOccupation,
  loadTerritory,
  loadTile,
  loadTileArmy,
  type TileRow,
} from '../../common/src/world-db';
import { loadArmyFoodUsePerHour, loadBuildingLevels, settleCityProduction, type CityProductionRow } from '../../common/src/production';
import { readIntInRange, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';
import { loadTileDetail, loadWorldWindow } from './views-world';
import { deployCountOf, loadCityState, lockCitySnapshot, marchView, type MarchRow } from './views';
import { canDeployMore, stationPercent } from '../../common/src/building-effects';
import { checkHeroMarchable } from './handlers-hero';
import type { AccountHeroRow } from '../../common/src/hero-db';
import { cargoOverCapacity } from '../../common/src/transport';
import { carryingPercent, marchingPercent } from '../../common/src/tech';
import { loadTechLevels } from '../../common/src/tech-db';
import { resolveIntercept, resolveMarchTarget } from './march-target';
import { breakNewbieProtection, insertAttackWarning, pushAttackWarning } from './pvp';

/** GET_WORLD_MAP：窗口式地图查询；缺省以主城为中心 DEFAULT_MAP_WINDOW×DEFAULT_MAP_WINDOW */
export async function handleGetWorldMap(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  // w/h 越界视为未提供（取缺省），不钳制放大——与文档「1..MAX_MAP_WINDOW，缺省 DEFAULT_MAP_WINDOW」一致（v17）
  const width = readIntInRange(data, 'w', 1, MAX_MAP_WINDOW, DEFAULT_MAP_WINDOW);
  const height = readIntInRange(data, 'h', 1, MAX_MAP_WINDOW, DEFAULT_MAP_WINDOW);
  let originX = Number.isInteger(data?.x) ? (data?.x as number) : undefined;
  let originY = Number.isInteger(data?.y) ? (data?.y as number) : undefined;
  if (originX === undefined || originY === undefined) {
    const city = await ctx.pool.query(
      `SELECT x, y FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
      [conn.accountId as string],
    );
    const row = city.rows[0] as { x: number | null; y: number | null } | undefined;
    const center = Math.floor(WORLD_SIZE / 2);
    const cx = row?.x ?? center;
    const cy = row?.y ?? center;
    originX = cx - Math.floor(width / 2);
    originY = cy - Math.floor(height / 2);
  }
  const window = clampMapWindow(originX, originY, width, height);
  const tiles = await loadWorldWindow(ctx.pool, window.x, window.y, window.w, window.h, conn.accountId as string);
  respondOk(ctx.registry, conn, op, seq, {
    size: WORLD_SIZE,
    x: window.x,
    y: window.y,
    w: window.w,
    h: window.h,
    tiles,
  });
}

/** GET_TILE：单格详情（野地收益预览 / NPC 城池驻军与库存） */
export async function handleGetTile(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const x = data?.x;
  const y = data?.y;
  if (!inWorld(x as number, y as number)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const tile = await loadTileDetail(ctx.pool, x as number, y as number, conn.accountId as string);
  if (!tile) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  respondOk(ctx.registry, conn, op, seq, { tile });
}

/** MARCH：从主城派出部队（扣减城内驻军），到达后由 Worker 结算（v16：task 缺省 plunder） */
export async function handleMarch(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  x: number,
  y: number,
  troops: Partial<Record<TroopKind, number>>,
  task: MarchTask,
  cargo: Resources | null = null,
  targetId: string | null = null,
  heroId: string | null = null,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 锁序：cities → world_tiles（与 Worker 一致，避免死锁环）
    const snap = await lockCitySnapshot(client, accountId);
    if (!snap) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    if (snap.x === null || snap.y === null) {
      // 主城没有地块坐标属世界分配异常（世界占满的占位边界），无法计算行军
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    // v30（AISLG-80）：本城在外部队数已达校场等级 → 拒绝新的出征（已在外的不受影响）
    if (!canDeployMore(deployCountOf(snap), snap.levels.parade_ground)) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      respondError(ctx.registry, conn, op, seq, 'DEPLOY_LIMIT', cityState ? { city: cityState } : undefined);
      return;
    }
    const tileRes = await client.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [x, y]);
    const tile = (tileRes.rowCount ? tileRes.rows[0] : null) as TileRow | null;
    const nowRes = await client.query(`SELECT now() AS now`);
    const dbNow = nowRes.rows[0].now as Date;
    // v28（AISLG-78）：带 targetId = 截击移动目标（目标格内容无关，只核对目标与路线）
    const target = targetId
      ? await resolveIntercept(client, targetId, x, y, dbNow)
      : await resolveMarchTarget(client, accountId, snap.cityId, tile, task, snap.levels.government, dbNow);
    if (!target.purpose) {
      await client.query('ROLLBACK');
      const cityState = await loadCityState(ctx.pool, accountId);
      // v22（AISLG-43）：掠夺冷却附 retryAfterSeconds（冷却截止 − 当前时刻，客户端睡满即重发）
      const cooldownLeft =
        target.reason === 'PLUNDER_COOLDOWN' && tile?.plundered_at
          ? {
              retryAfterSeconds: Math.max(
                1,
                Math.ceil((new Date(tile.plundered_at).getTime() + PLUNDER_COOLDOWN_MS - dbNow.getTime()) / 1000),
              ),
            }
          : undefined;
      // v38（AISLG-122）/ v39（AISLG-123）：保护 / 免战类拒绝附 until 与 retryAfterSeconds
      //（NEWBIE_PROTECTED / TARGET_IN_TRUCE / SELF_TRUCE_ACTIVE / TILE_PROTECTED），告诉进攻方原因与剩余时间
      const protectionLeft =
        target.protectedUntil &&
        (target.reason === 'NEWBIE_PROTECTED' || target.reason === 'TARGET_IN_TRUCE' || target.reason === 'SELF_TRUCE_ACTIVE' || target.reason === 'TILE_PROTECTED')
          ? {
              until: target.protectedUntil.toISOString(),
              retryAfterSeconds: Math.max(1, Math.ceil((target.protectedUntil.getTime() - dbNow.getTime()) / 1000)),
            }
          : undefined;
      const data = { ...(cityState ? { city: cityState } : {}), ...cooldownLeft, ...protectionLeft };
      respondError(ctx.registry, conn, op, seq, target.reason ?? 'TARGET_NOT_ATTACKABLE', Object.keys(data).length ? data : undefined);
      return;
    }
    // v36（AISLG-114）：随队武将校验（属于本账号、未重伤 / 欠饷 / 随行、未任城守）
    let marchHero: AccountHeroRow | null = null;
    if (heroId) {
      const verdict = await checkHeroMarchable(client, accountId, heroId);
      if (!verdict.ok) {
        await client.query('ROLLBACK');
        const cityState = await loadCityState(ctx.pool, accountId);
        respondError(ctx.registry, conn, op, seq, verdict.code, cityState ? { city: cityState } : undefined);
        return;
      }
      marchHero = verdict.hero;
    }
    // 城内驻军逐兵种校验并扣减
    for (const kind of TROOP_KINDS) {
      const want = troops[kind] ?? 0;
      if (want > (snap.army[kind] ?? 0)) {
        await client.query('ROLLBACK');
        const cityState = await loadCityState(ctx.pool, accountId);
        respondError(ctx.registry, conn, op, seq, 'INSUFFICIENT_TROOPS', cityState ? { city: cityState } : undefined);
        return;
      }
    }
    // v26（AISLG-79）运输：货物不超编队负重、出发城资源够付，发起即从出发城扣除
    if (cargo) {
      const verdict = cargoOverCapacity(cargo, troops, carryingPercent(snap.techs))
        ? 'CARGO_OVER_CAPACITY'
        : RESOURCE_KEYS.some((key) => cargo[key] > snap.resources[key])
          ? 'INSUFFICIENT_RESOURCES'
          : null;
      if (verdict) {
        await client.query('ROLLBACK');
        const cityState = await loadCityState(ctx.pool, accountId);
        respondError(ctx.registry, conn, op, seq, verdict, cityState ? { city: cityState } : undefined);
        return;
      }
      await client.query(
        `UPDATE cities SET gold = gold - $2, wood = wood - $3, food = food - $4, stone = stone - $5, iron = iron - $6
         WHERE id = $1`,
        [snap.cityId, cargo.gold, cargo.wood, cargo.food, cargo.stone, cargo.iron],
      );
    }
    for (const [kind, count] of Object.entries(troops)) {
      if ((count ?? 0) > 0) {
        await client.query(
          `UPDATE city_army SET count = count - $3, updated_at = now()
           WHERE city_id = $1 AND troop = $2`,
          [snap.cityId, kind, count],
        );
        await client.query(`DELETE FROM city_army WHERE city_id = $1 AND troop = $2 AND count <= 0`, [snap.cityId, kind]);
      }
    }
    // 行军时长按编队最慢兵种折算（v13：斥候 ×2、轻骑兵 ×1.5，其余基准）
    // v30（AISLG-83）：驿站只加速自己城池之间的调兵 / 运输（出发城驿站等级，每级 +10%）
    const stationBonus = target.purpose === 'transfer' || target.purpose === 'transport' ? stationPercent(snap.levels.post_station) : 0;
    const travel = marchTravelSeconds(snap.x, snap.y, x, y, troops, marchingPercent(snap.techs) + stationBonus);
    const arriveMs = dbNow.getTime() + travel * 1000;
    // v35（AISLG-112）：截击「到了先埋伏」——目标路线与时刻表固定，出发即可算出接战时刻 =
    // max(到达时刻, 目标进入选定格相邻范围的时刻)，Worker 按该时刻结算；提前到达的部队
    // 原地埋伏（记 ambush_at）。到达时目标已走出范围（太晚）不顺延，照旧扑空
    let engageMs = arriveMs;
    let ambushMs: number | null = null;
    if (target.purpose === 'intercept' && target.interceptWindow && arriveMs < target.interceptWindow.to) {
      engageMs = Math.max(arriveMs, target.interceptWindow.from);
      ambushMs = arriveMs < target.interceptWindow.from ? arriveMs : null;
    }
    const ins = await client.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, cargo, target_id, ambush_at, hero_id)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'marching', $7, $8, $9::jsonb, $10, $11, $12)
       RETURNING *`,
      [
        accountId, snap.cityId, x, y, JSON.stringify(troops), target.purpose, role,
        new Date(engageMs).toISOString(), cargo ? JSON.stringify(cargo) : null, targetId,
        ambushMs !== null ? new Date(ambushMs).toISOString() : null, marchHero ? marchHero.id : null,
      ],
    );
    const march = ins.rows[0] as MarchRow;
    await insertEvent(client, {
      accountId,
      cityId: snap.cityId,
      buildId: march.id,
      type: EventType.MARCH_STARTED,
      initiator: role,
      detail: {
        x, y, troops, purpose: target.purpose,
        task: target.purpose === 'plunder' || target.purpose === 'occupy' ? task : null,
        targetCityId: target.targetCityId ?? null,
        ...(cargo ? { cargo } : {}),
        ...(targetId ? { targetId } : {}),
        arriveAt: march.arrive_at.toISOString(),
        ...(march.ambush_at ? { ambushAt: march.ambush_at.toISOString() } : {}),
        ...(marchHero ? { heroId: marchHero.id, heroName: marchHero.name } : {}),
      },
    });
    // v38（AISLG-122）/ v39（AISLG-123）：打玩家的出征（掠夺城池 / 抢占野地）——给守方写
    // 来袭预警事件（提交后推送在线连接）；攻方处于新手保护期则因主动进攻立即失效
    let warning: { accountId: string; detail: Record<string, unknown> } | null = null;
    if (target.pvp) {
      const targetCity = await client.query(
        `SELECT a.username FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
        [target.pvp.targetCityId],
      );
      const row = targetCity.rows[0] as { username: string } | undefined;
      const namingRes = await client.query(
        `SELECT a.username, c.name AS city_name FROM cities c JOIN accounts a ON a.id = c.account_id WHERE c.id = $1`,
        [snap.cityId],
      );
      const naming = namingRes.rows[0] as { username: string; city_name: string } | undefined;
      if (row && naming) {
        warning = {
          accountId: target.pvp.targetAccountId,
          detail: await insertAttackWarning(
            client, march, troops,
            {
              accountId: target.pvp.targetAccountId,
              cityId: target.pvp.targetCityId,
              // 城池目标：x/y = 城池坐标；野地目标：x/y = 地块坐标 + 地形与等级
              x: march.x,
              y: march.y,
              kind: target.pvp.kind,
              terrain: target.pvp.terrain ?? null,
              level: target.pvp.level ?? 0,
            },
            { username: naming.username, cityId: snap.cityId, cityName: naming.city_name },
          ),
        };
      }
      await breakNewbieProtection(
        client,
        accountId,
        target.purpose === 'occupy' ? 'occupy' : 'plunder',
        { username: row?.username ?? '', x: march.x, y: march.y },
        role,
      );
    }
    await client.query('COMMIT');

    const view = marchView(march);
    respondOk(ctx.registry, conn, op, seq, { march: view });
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_started', march: view } },
      conn,
    );
    if (warning) {
      pushAttackWarning(ctx, warning.accountId, warning.detail);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** RECALL_GARRISON：撤回本账号占领野地的全部驻军；撤回即放弃占领，部队返程回城 */
export async function handleRecallGarrison(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  x: number,
  y: number,
): Promise<void> {
  const accountId = conn.accountId as string;
  const role = conn.role as InitiatorRole;
  // 先无锁读地块找到占领城，确认归属本账号后再进事务（锁序与出征一致）
  const probe = await loadTile(ctx.pool, x, y);
  if (!probe || probe.kind !== 'wilderness' || !probe.owner_city_id) {
    respondError(ctx.registry, conn, op, seq, 'TILE_NOT_OCCUPIED');
    return;
  }
  const ownerRes = await ctx.pool.query(
    `SELECT id FROM cities WHERE id = $1 AND account_id = $2`,
    [probe.owner_city_id, accountId],
  );
  if (!ownerRes.rowCount) {
    respondError(ctx.registry, conn, op, seq, 'TILE_NOT_OCCUPIED');
    return;
  }
  const ownerCityId = probe.owner_city_id;

  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    // 锁占领城并结算生产：野地加成在归属清除前按旧速率结到当前时刻（产量切分）
    const cityRes = await client.query(
      `SELECT id, name, level, x, y, gold, wood, food, stone, iron,
              settled_at, gold_rem, food_rem, wood_rem, stone_rem, iron_rem,
              population, population_rem, now() AS db_now
       FROM cities WHERE id = $1 FOR UPDATE`,
      [ownerCityId],
    );
    const cityRow = cityRes.rows[0] as CityProductionRow & { x: number | null; y: number | null; db_now: Date };
    if (!cityRow || cityRow.x === null || cityRow.y === null) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INTERNAL');
      return;
    }
    const levels = await loadBuildingLevels(client, ownerCityId);
    const territory = await loadTerritory(client, ownerCityId);
    await settleCityProduction(
      client,
      cityRow,
      levels,
      cityRow.db_now,
      territoryRates(territory),
      await loadArmyFoodUsePerHour(client, ownerCityId),
    );

    // 复核地块归属未变（并发召回 / NPC 袭击由行锁串开）
    const tileRes = await client.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2 FOR UPDATE`, [x, y]);
    const tile = tileRes.rows[0] as TileRow | undefined;
    if (!tile || tile.kind !== 'wilderness' || tile.owner_city_id !== ownerCityId) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'TILE_NOT_OCCUPIED');
      return;
    }
    const troops = await loadTileArmy(client, x, y);
    await clearTileOccupation(client, x, y);
    let march: MarchRow | null = null;
    if (!isEmptyArmy(troops)) {
      // 返程按撤回编队的最慢兵种折算速度
      const travel = marchTravelSeconds(cityRow.x, cityRow.y, x, y, troops, marchingPercent(await loadTechLevels(client, accountId)));
      const ins = await client.query(
        `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, 'return', 'marching', $6, now() + make_interval(secs => $7))
         RETURNING *`,
        [accountId, ownerCityId, x, y, JSON.stringify(troops), role, travel],
      );
      march = ins.rows[0] as MarchRow;
      await insertEvent(client, {
        accountId,
        cityId: ownerCityId,
        buildId: march.id,
        type: EventType.MARCH_STARTED,
        initiator: role,
        detail: { x, y, troops, purpose: 'return', arriveAt: march.arrive_at.toISOString() },
      });
    }
    await insertEvent(client, {
      accountId,
      cityId: ownerCityId,
      type: EventType.WILDERNESS_LOST,
      initiator: role,
      detail: { x, y, cause: 'recall', terrain: tile.terrain, level: tile.level },
    });
    await client.query('COMMIT');

    const view = march ? marchView(march) : null;
    respondOk(ctx.registry, conn, op, seq, view ? { march: view } : { march: null });
    const tileViewRow = await loadWorldWindow(ctx.pool, x, y, 1, 1, accountId);
    ctx.registry.broadcast(
      accountId,
      { op: Op.PUSH_TILE_STATE, push: true, data: { reason: 'wilderness_lost', tile: tileViewRow[0] } },
      conn,
    );
    if (view) {
      ctx.registry.broadcast(
        accountId,
        { op: Op.PUSH_MARCH_STATE, push: true, data: { reason: 'march_started', march: view } },
        conn,
      );
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
