// 城池迁移的数据库读取（AISLG-220，v91）：前置条件事实（军队在外 / 盟友驻军 / 战乱 / 名城）、
// 近邻判定、可用空野地探测、迁后出征限制的拦截判定（MARCH 与 SCOUT 共用）。
// 只读，不加锁；写入与加锁在 api/src/handlers-move-city.ts 的事务里完成。

import type pg from 'pg';
import { cityInBattle } from './city-battle';
import { MOVE_CITY_MIN_GAP, moveCityDenials, moveTooClose, type MoveCityDenialCode, type MoveCityFacts } from './move-city';
import { loadItemCount } from './items-db';
import type { ItemId } from './items';
import type { MoveCityView } from './protocol-move-city';

type Queryable = pg.Pool | pg.PoolClient;

/** 迁城判定所需的单城事实（含是否主城、坐标、来源等级与出征限制截止时刻） */
export interface MoveCityFactsRow extends MoveCityFacts {
  isMain: boolean;
  x: number | null;
  y: number | null;
  originLevel: number | null;
  /** 指定坐标迁城后的出征限制截止时刻（仍在生效时才有值） */
  moveLockUntil: Date | null;
  /** 数据库当前时刻（与出征限制同口径） */
  dbNow: Date;
}

/** 读取单城的迁城事实；城不属于该账号返回 null */
export async function loadMoveCityFacts(q: Queryable, accountId: string, cityId: string): Promise<MoveCityFactsRow | null> {
  const res = await q.query(
    `SELECT c.famous_name, c.x, c.y, c.origin_level, c.move_lock_until, now() AS db_now,
            (SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1) = c.id AS is_main,
            ((SELECT count(*) FROM marches WHERE from_city_id = c.id AND status = 'marching')
             + (SELECT count(*) FROM city_assist WHERE from_city_id = c.id))::int AS army_outside,
            (SELECT count(*) FROM city_assist WHERE city_id = c.id AND account_id <> $1)::int AS ally_force
     FROM cities c WHERE c.id = $2 AND c.account_id = $1`,
    [accountId, cityId],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as {
    famous_name: string | null; x: number | null; y: number | null; origin_level: number | null;
    move_lock_until: Date | null; db_now: Date; is_main: boolean; army_outside: number; ally_force: number;
  };
  const dbNow = row.db_now;
  return {
    famous: row.famous_name !== null,
    armyOutside: row.army_outside,
    allyForce: row.ally_force,
    inBattle: await cityInBattle(q, cityId),
    isMain: row.is_main,
    x: row.x,
    y: row.y,
    originLevel: row.origin_level,
    moveLockUntil: row.move_lock_until && row.move_lock_until.getTime() > dbNow.getTime() ? row.move_lock_until : null,
    dbNow,
  };
}

/** GET_STATE 的 moveCity 视图：逐城的不可迁原因、出限截止时刻，以及两种令的持有数（口径见协议文档） */
export async function loadMoveCityView(q: Queryable, accountId: string, items: Record<ItemId, number>): Promise<MoveCityView> {
  const ids = await q.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at`, [accountId]);
  const cities: MoveCityView['cities'] = [];
  for (const row of ids.rows as Array<{ id: string }>) {
    const facts = await loadMoveCityFacts(q, accountId, row.id);
    if (!facts) {
      continue;
    }
    const reasons: MoveCityDenialCode[] = moveCityDenials(facts).map((d) => d.code);
    const view: MoveCityView['cities'][number] = { cityId: row.id, reasons };
    if (facts.moveLockUntil) {
      view.moveLockUntil = facts.moveLockUntil.toISOString();
    }
    cities.push(view);
  }
  return {
    cities,
    items: {
      random: { itemId: 'city_order', count: items.city_order ?? 0 },
      pointing: { itemId: 'city_order_adv', count: items.city_order_adv ?? 0 },
    },
  };
}

/** 目标地块的最小信息（迁城前置检查与拦截判定共用） */
export async function loadTileBrief(
  q: Queryable,
  x: number,
  y: number,
): Promise<{ kind: string; owner_city_id: string | null; npc: unknown } | null> {
  const res = await q.query(`SELECT kind, owner_city_id, npc FROM world_tiles WHERE x = $1 AND y = $2`, [x, y]);
  return (res.rowCount ? res.rows[0] : null) as { kind: string; owner_city_id: string | null; npc: unknown } | null;
}

/** 指定坐标 (x, y) 与他人城池格（kind = city，且城属于其他账号）的距离是否过近（< MOVE_CITY_MIN_GAP） */
export async function tooCloseToOtherCities(q: Queryable, accountId: string, x: number, y: number): Promise<boolean> {
  const res = await q.query(
    `SELECT greatest(abs(wt.x - $2), abs(wt.y - $3))::int AS d
     FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
     WHERE wt.kind = 'city' AND c.account_id <> $1
       AND abs(wt.x - $2) < $4 AND abs(wt.y - $3) < $4`,
    [accountId, x, y, MOVE_CITY_MIN_GAP],
  );
  return moveTooClose((res.rows as Array<{ d: number }>).map((row) => row.d));
}

/** 世界里是否还有一块可迁入的空野地（random 预览的占满判定；真正选址在 claimCityTile） */
export async function hasFreeWilderness(q: Queryable): Promise<boolean> {
  const res = await q.query(
    `SELECT 1 FROM world_tiles WHERE kind = 'wilderness' AND owner_city_id IS NULL AND npc IS NULL LIMIT 1`,
  );
  return (res.rowCount ?? 0) > 0;
}

/** 单种道具数量（迁城预检用；最终消耗在事务末尾由 consumeItem 完成） */
export async function countMoveItem(q: Queryable, accountId: string, itemId: ItemId): Promise<number> {
  return loadItemCount(q, accountId, itemId);
}

/**
 * 迁后出征限制的拦截判定（MARCH 与 SCOUT 入口共用）：城仍在出征限制内、且本次出征属于「攻击类」时，
 * 返回剩余秒数（retryAfterSeconds）；否则返回 null。
 * 攻击类 = 目标是他人城池 / 他人野地 / 无主野地 / NPC 城 / 黄巾营地 / 截击目标；
 * 允许的是运输、调兵（自己的城）、增援（自己名下的野地）与召回（召回不走这里）。
 * tile 为 null（越界等）时不拦，由各自的 TARGET 判定给出原有错误。
 */
/** 城池是否仍在迁后出征限制内（攻击类判定之前的纯时间判断）：返回剩余秒数，否则 null（供驻军入场等整城出兵入口用） */
export async function moveLockRemaining(q: Queryable, cityId: string, dbNow: Date): Promise<number | null> {
  const res = await q.query(`SELECT move_lock_until FROM cities WHERE id = $1`, [cityId]);
  const until = (res.rows[0] as { move_lock_until: Date | null } | undefined)?.move_lock_until ?? null;
  if (!until || until.getTime() <= dbNow.getTime()) {
    return null;
  }
  return Math.max(1, Math.ceil((until.getTime() - dbNow.getTime()) / 1000));
}

export async function moveAttackLockRetry(
  q: Queryable,
  accountId: string,
  cityId: string,
  tile: { owner_city_id: string | null } | null,
  task: string,
  targetId: string | null,
  dbNow: Date,
): Promise<number | null> {
  const left = await moveLockRemaining(q, cityId, dbNow);
  if (left === null || !(await isAttackTarget(q, accountId, tile, task, targetId))) {
    return null;
  }
  return left;
}

async function isAttackTarget(
  q: Queryable,
  accountId: string,
  tile: { owner_city_id: string | null } | null,
  task: string,
  targetId: string | null,
): Promise<boolean> {
  if (targetId) {
    // 截击移动目标：一律视为出征打别人
    return true;
  }
  if (!tile || task === 'transport') {
    return false;
  }
  if (!tile.owner_city_id) {
    return true;
  }
  // 名下（本账号的城 / 野地）：调兵或增援，不是攻击
  const own = await q.query(`SELECT 1 FROM cities WHERE id = $1 AND account_id = $2`, [tile.owner_city_id, accountId]);
  return !own.rowCount;
}
