// Worker 的移动目标刷新与流寇掠夺（v28，AISLG-78）。截击结算在 intercept-tick.ts。
// 每个 tick（节流到 MOVING_TICK_MS）依次：
// 1) 过期清理：存在期结束的 active 目标标记 expired 并全服广播；
// 2) 流寇掠夺：每个 active 流寇走过的新格若是玩家占领的野地，从其主人城里扣该地「小时产量
//    （占领加成 + 驻军采集）× BANDIT_PLUNDER_HOURS」的资源（不超过存量）、记入流寇携带量，
//    并给被掠方写 bandit_plundered 事件；每格只处理一次（passed_index 推进）；
// 3) 刷新：活跃玩家数决定同时存在的目标数量（desiredMovingCount），不足则以随机活跃玩家的主城为
//    锚点补刷（路线、种类、等级随机）。
// 锁序：先结算 / 锁玩家城，最后才 UPDATE 目标行（与截击到达 出发城 → 地块 → 目标行 一致）。

import pg from 'pg';
import { EventType, type Resources } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { TERRAIN_INFO, wildernessBonusRate, wildernessGatherRate, WORLD_SIZE } from '../../common/src/world';
import {
  ACTIVE_PLAYER_WINDOW_HOURS,
  BANDIT_PLUNDER_HOURS,
  MOVING_KIND_INFO,
  type MovingKind,
  type RouteCell,
  desiredMovingCount,
  generateRoute,
  movingLifetimeMs,
  movingStepMs,
  movingStock,
  pickMovingKindAndLevel,
} from '../../common/src/moving-target';
import {
  loadActiveMovingTargets,
  rowIndexAt,
  type MovingTargetRow,
} from '../../common/src/moving-target-db';
import { settleOwnerCity } from './tick-shared';
import { movingNotifyPayload } from './intercept-tick';

/** 刷新 / 过期 / 掠夺检查的最小间隔（毫秒，真实时间） */
export const MOVING_TICK_MS = 5_000;

let lastRunMs = 0;

export async function notifyMoving(pool: pg.Pool, reason: 'spawned' | 'defeated' | 'expired', row: MovingTargetRow): Promise<void> {
  await pool.query('SELECT pg_notify($1, $2)', [NOTIFY_CHANNEL, JSON.stringify(movingNotifyPayload({ reason, row }))]);
}

/** 过期清理：存在期已结束的 active 目标 → expired */
async function expireTargets(pool: pg.Pool): Promise<number> {
  const res = await pool.query(
    `UPDATE moving_targets SET status = 'expired', resolved_at = now()
     WHERE status = 'active' AND ends_at <= now() RETURNING *`,
  );
  for (const row of res.rows as MovingTargetRow[]) {
    await notifyMoving(pool, 'expired', row);
  }
  return res.rowCount ?? 0;
}

/** 流寇路过的一块玩家野地：被掠资源与数量 */
interface PlunderHit {
  cityId: string;
  accountId: string;
  x: number;
  y: number;
  resource: 'gold' | 'food' | 'wood' | 'stone' | 'iron';
  want: number;
}

/** 一只流寇本 tick 要处理的新格：返回命中的玩家野地（只读，无锁） */
async function findHits(client: pg.PoolClient, row: MovingTargetRow, fromIndex: number, toIndex: number): Promise<PlunderHit[]> {
  const hits: PlunderHit[] = [];
  for (let index = fromIndex; index <= toIndex; index += 1) {
    const [x, y] = row.route[index];
    const res = await client.query(
      `SELECT wt.terrain, wt.level, wt.owner_city_id, c.account_id,
              COALESCE((SELECT sum(count) FROM tile_army ta WHERE ta.x = wt.x AND ta.y = wt.y), 0)::int AS garrison
       FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
       WHERE wt.x = $1 AND wt.y = $2 AND wt.kind = 'wilderness'`,
      [x, y],
    );
    if (!res.rowCount) {
      continue;
    }
    const tile = res.rows[0] as { terrain: keyof typeof TERRAIN_INFO; level: number; owner_city_id: string; account_id: string; garrison: number };
    const perHour = wildernessBonusRate(tile.terrain, tile.level) + wildernessGatherRate(tile.terrain, tile.level, tile.garrison);
    const want = Math.round(perHour * BANDIT_PLUNDER_HOURS);
    if (want > 0) {
      hits.push({ cityId: tile.owner_city_id, accountId: tile.account_id, x, y, resource: TERRAIN_INFO[tile.terrain].resource, want });
    }
  }
  return hits;
}

/** 处理一只流寇走过的新格：结算被掠城并扣资源 → 最后更新目标行（携带量 + passed_index） */
async function plunderAlongRoute(pool: pg.Pool, row: MovingTargetRow, now: number): Promise<void> {
  const index = rowIndexAt(row, now);
  if (index === null || index <= row.passed_index) {
    return;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hits = await findHits(client, row, row.passed_index + 1, index);
    const gained: Partial<Resources> = {};
    const losses: Array<PlunderHit & { amount: number }> = [];
    for (const hit of hits) {
      const settled = await settleOwnerCity(client, hit.cityId);
      if (!settled.row) {
        continue;
      }
      // settleOwnerCity 返回的是结算前读到的行：存量要在结算落库后重读
      const haveRes = await client.query(`SELECT ${hit.resource} AS have FROM cities WHERE id = $1`, [hit.cityId]);
      const have = Math.max(0, Math.floor((haveRes.rows[0] as { have: number }).have));
      const amount = Math.min(have, hit.want);
      if (amount <= 0) {
        continue;
      }
      await client.query(`UPDATE cities SET ${hit.resource} = ${hit.resource} - $2 WHERE id = $1`, [hit.cityId, amount]);
      gained[hit.resource] = (gained[hit.resource] ?? 0) + amount;
      losses.push({ ...hit, amount });
    }
    // 最后才锁目标行（锁序：城 → 目标）；已被截获 / 过期则整笔回滚，不让城白白损失
    const stock = { ...(row.stock ?? {}) } as Partial<Resources>;
    for (const [key, value] of Object.entries(gained) as Array<[keyof Resources, number]>) {
      stock[key] = (stock[key] ?? 0) + value;
    }
    const upd = await client.query(
      `UPDATE moving_targets SET passed_index = $2, stock = $3::jsonb
       WHERE id = $1 AND status = 'active' AND passed_index = $4`,
      [row.id, index, JSON.stringify(stock), row.passed_index],
    );
    if (!upd.rowCount) {
      await client.query('ROLLBACK');
      return;
    }
    for (const loss of losses) {
      await insertEvent(client, {
        accountId: loss.accountId,
        cityId: loss.cityId,
        type: EventType.BANDIT_PLUNDERED,
        initiator: null,
        detail: { x: loss.x, y: loss.y, resource: loss.resource, amount: loss.amount, targetId: row.id },
      });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 活跃玩家的主城坐标（最近 ACTIVE_PLAYER_WINDOW_HOURS 小时内登录过的账号，每账号取最早创建的城） */
async function loadActiveAnchors(pool: pg.Pool): Promise<Array<{ x: number; y: number }>> {
  const res = await pool.query(
    `SELECT DISTINCT ON (c.account_id) c.x, c.y
     FROM cities c
     WHERE c.x IS NOT NULL AND c.y IS NOT NULL
       AND c.account_id IN (
         SELECT account_id FROM sessions WHERE last_used_at > now() - make_interval(hours => $1)
       )
     ORDER BY c.account_id, c.created_at`,
    [ACTIVE_PLAYER_WINDOW_HOURS],
  );
  return res.rows as Array<{ x: number; y: number }>;
}

/**
 * 落库一只移动目标（周期补刷与黄巾之乱散成流寇共用）：backdateMs 为「已走了」的时长（错开存在期用；
 * 已走过的格不补算流寇掠夺，passed_index 从当前格前一格起）。
 */
export async function insertMovingTarget(
  q: pg.Pool | pg.PoolClient,
  kind: MovingKind,
  level: number,
  route: RouteCell[],
  backdateMs = 0,
): Promise<MovingTargetRow> {
  const lifetime = movingLifetimeMs();
  const firstIndex = Math.floor(backdateMs / movingStepMs(lifetime));
  const res = await q.query(
    `INSERT INTO moving_targets (kind, level, route, started_at, ends_at, garrison, stock, passed_index)
     VALUES ($1, $2, $3::jsonb, now() - make_interval(secs => $4), now() - make_interval(secs => $4) + make_interval(secs => $5),
             $6::jsonb, $7::jsonb, $8)
     RETURNING *`,
    [kind, level, JSON.stringify(route), backdateMs / 1000, lifetime / 1000, JSON.stringify(MOVING_KIND_INFO[kind].garrison(level)), JSON.stringify(movingStock(kind, level)), firstIndex - 1],
  );
  return res.rows[0] as MovingTargetRow;
}

/** 补刷：存在数量低于期望值时，以随机活跃玩家主城为锚点生成新目标 */
async function spawnTargets(pool: pg.Pool, rng: () => number = Math.random): Promise<number> {
  const anchors = await loadActiveAnchors(pool);
  const desired = desiredMovingCount(anchors.length);
  const active = (await loadActiveMovingTargets(pool)).length;
  let spawned = 0;
  for (let n = active; n < desired; n += 1) {
    const anchor = anchors[Math.floor(rng() * anchors.length)] ?? { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
    const { kind, level } = pickMovingKindAndLevel(rng);
    const route = generateRoute(rng, anchor.x, anchor.y);
    // 错开存在期：新刷的目标随机「已走了」存在期的 0%–50%，避免一批同时刷出又同时消失
    const row = await insertMovingTarget(pool, kind, level, route, Math.floor(rng() * 0.5 * movingLifetimeMs()));
    await notifyMoving(pool, 'spawned', row);
    spawned += 1;
  }
  return spawned;
}

/** 单 tick 入口：过期清理 → 流寇掠夺 → 补刷（节流到 MOVING_TICK_MS）；返回本次变化数 */
export async function processMovingTargets(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < MOVING_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  let changed = await expireTargets(pool);
  for (const row of await loadActiveMovingTargets(pool)) {
    if (row.kind === 'bandit') {
      await plunderAlongRoute(pool, row, nowMs);
    }
  }
  changed += await spawnTargets(pool);
  return changed;
}
