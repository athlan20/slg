// 武将培养的数据库存取（v54，AISLG-144）：加点 / 洗点 / 历练 / 赏赐的占用判定与每日计数。
// API（hero-growth 相关 handler）与 Worker（历练到点结算）共用，规则见 hero-growth.ts。

import type pg from 'pg';
import { scaledSeconds } from './time-scale';
import { heroDayIndex, TRAINING_TIERS, trainingExp, type TrainingTier } from './hero-growth';
import { grantHeroExp, heroBusyMarchMap, heroGuardMaps, usedToday, type AccountHeroRow } from './hero-db';

type Queryable = pg.Pool | pg.PoolClient;

/** 账号主城（创建最早的城）；无城返回 null */
export async function mainCityId(q: Queryable, accountId: string): Promise<string | null> {
  const res = await q.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`, [accountId]);
  return res.rowCount ? (res.rows[0] as { id: string }).id : null;
}

/** 占用判定：随队出征（含返程）→ HERO_BUSY；任城守 → HERO_BUSY；历练中 → HERO_TRAINING；否则 null */
export async function heroBusyCode(
  q: Queryable,
  accountId: string,
  hero: AccountHeroRow,
): Promise<'HERO_BUSY' | 'HERO_TRAINING' | null> {
  if (hero.train_until) {
    return 'HERO_TRAINING';
  }
  const busy = await heroBusyMarchMap(q, accountId);
  if (busy.has(hero.id)) {
    return 'HERO_BUSY';
  }
  const guards = await heroGuardMaps(q, accountId);
  if (guards.heroToCity.has(hero.id)) {
    return 'HERO_BUSY';
  }
  return null;
}

/** 历练开始：写入结束时刻（随时间缩放）、档位与到点经验（按当前等级结算） */
export async function startTraining(client: pg.PoolClient, hero: AccountHeroRow, tier: TrainingTier): Promise<void> {
  const seconds = scaledSeconds(TRAINING_TIERS[tier].hours * 3600);
  await client.query(
    `UPDATE account_heroes SET train_until = now() + make_interval(secs => $2), train_tier = $3, train_exp = $4
     WHERE id = $1`,
    [hero.id, seconds, tier, trainingExp(tier, hero.level)],
  );
}

/** 到点的历练（Worker 用）：先锁后查，已结算或未到点返回 []；每次最多 limit 名 */
export async function dueTrainings(client: pg.PoolClient, limit: number): Promise<AccountHeroRow[]> {
  const res = await client.query(
    `SELECT * FROM account_heroes WHERE train_until IS NOT NULL AND train_until <= now()
     ORDER BY train_until LIMIT $1 FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return res.rows as AccountHeroRow[];
}

/** 结算一名到点的历练：经验到账（可能升级，得自由点数）并清空历练字段 */
export async function settleTraining(client: pg.PoolClient, hero: AccountHeroRow): Promise<number> {
  const gained = hero.train_exp ?? 0;
  await grantHeroExp(client, hero.id, gained);
  await client.query(`UPDATE account_heroes SET train_until = NULL, train_tier = NULL, train_exp = NULL WHERE id = $1`, [
    hero.id,
  ]);
  return gained;
}

/**
 * 每日次数的读取与递增（gift / reset）：跨游戏日归零。返回递增后的当日已用次数。
 * 调用方须已持有武将行锁（FOR UPDATE）。
 */
export async function bumpDailyCount(
  client: pg.PoolClient,
  hero: AccountHeroRow,
  kind: 'gift' | 'reset',
  now = new Date(),
): Promise<number> {
  const today = heroDayIndex(now);
  const dayCol = kind === 'gift' ? 'gift_day' : 'reset_day';
  const countCol = kind === 'gift' ? 'gift_count' : 'reset_count';
  const used = usedDailyCount(hero, kind, now);
  await client.query(`UPDATE account_heroes SET ${dayCol} = $2, ${countCol} = $3 WHERE id = $1`, [hero.id, today, used + 1]);
  return used + 1;
}

/** 当日已用次数（只读，不写库；跨游戏日视为 0） */
export function usedDailyCount(hero: AccountHeroRow, kind: 'gift' | 'reset', now = new Date()): number {
  return kind === 'gift'
    ? usedToday(hero.gift_day, hero.gift_count, heroDayIndex(now))
    : usedToday(hero.reset_day, hero.reset_count, heroDayIndex(now));
}
