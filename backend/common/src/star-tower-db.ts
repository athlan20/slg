// 将星塔的数据库存取（v55，AISLG-146）：进度、是否有城、战报。阵容读取复用竞技场的 arena-db（entryLineup）。
// 首通发奖与推进进度在同一个事务里做（调用方持有 FOR UPDATE 的进度行），金币不到账不推进。

import pg from 'pg';
import type { ArenaMatchResult, ArenaFighter } from './arena';
import { starTowerFloorEnemies, STAR_TOWER_REPORT_KEEP } from './star-tower';
import type { ArenaFighterView } from './protocol-arena';
import type { StarTowerMatchView } from './protocol-star-tower';

type Queryable = pg.Pool | pg.PoolClient;

/** 账号的进度行：不存在则建（初始 0 层），并加行锁串行化同一账号的挑战；返回已通过的最高层 */
export async function lockStarTowerProgress(client: pg.PoolClient, accountId: string): Promise<number> {
  await client.query(`INSERT INTO star_tower_progress (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING`, [accountId]);
  const res = await client.query(`SELECT best_floor FROM star_tower_progress WHERE account_id = $1 FOR UPDATE`, [accountId]);
  return (res.rows[0] as { best_floor: number }).best_floor;
}

/** 只读：已通过的最高层（没有进度行视为 0） */
export async function loadStarTowerBestFloor(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(`SELECT best_floor FROM star_tower_progress WHERE account_id = $1`, [accountId]);
  return res.rowCount ? (res.rows[0] as { best_floor: number }).best_floor : 0;
}

/** 推进已通过的最高层（调用方在 lockStarTowerProgress 之后、同一事务内调用） */
export async function setStarTowerBestFloor(client: pg.PoolClient, accountId: string, floor: number): Promise<void> {
  await client.query(`UPDATE star_tower_progress SET best_floor = $2, updated_at = now() WHERE account_id = $1`, [accountId, floor]);
}

/** 账号是否至少有一座城（首通金币进主城） */
export async function hasAnyCity(q: Queryable, accountId: string): Promise<boolean> {
  const res = await q.query(`SELECT 1 FROM cities WHERE account_id = $1 LIMIT 1`, [accountId]);
  return (res.rowCount ?? 0) > 0;
}

/** 写入一份战报，并把该账号超出 STAR_TOWER_REPORT_KEEP 的旧战报删掉 */
export async function insertStarTowerMatch(
  client: pg.PoolClient,
  accountId: string,
  floor: number,
  seed: number,
  result: ArenaMatchResult,
  enemies: ArenaFighter[],
  lineup: Array<ArenaFighterView | null>,
  boss: boolean,
): Promise<{ id: number; createdAt: Date }> {
  const stored = {
    floor,
    boss,
    challengerWins: result.challengerWins,
    defenderWins: result.defenderWins,
    rounds: result.rounds,
    lineup,
    enemies: enemies.map((e) => ({ ...e, heroId: null })),
  };
  const res = await client.query(
    `INSERT INTO star_tower_matches (account_id, floor, won, seed, result) VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
    [accountId, floor, result.challengerWon, seed, JSON.stringify(stored)],
  );
  const row = res.rows[0] as { id: string; created_at: Date };
  await client.query(
    `DELETE FROM star_tower_matches WHERE account_id = $1 AND id NOT IN (
       SELECT id FROM star_tower_matches WHERE account_id = $1 ORDER BY id DESC LIMIT $2
     )`,
    [accountId, STAR_TOWER_REPORT_KEEP],
  );
  return { id: Number(row.id), createdAt: row.created_at };
}

interface StarTowerMatchRow {
  id: string;
  floor: number;
  won: boolean;
  result: {
    floor: number;
    boss: boolean;
    challengerWins: number;
    defenderWins: number;
    rounds: StarTowerMatchView['rounds'];
    lineup: Array<ArenaFighterView | null>;
    enemies: ArenaFighterView[];
  };
  created_at: Date;
}

function toView(row: StarTowerMatchRow): StarTowerMatchView {
  return {
    id: Number(row.id),
    createdAt: row.created_at.toISOString(),
    floor: row.floor,
    boss: row.result.boss,
    won: row.won,
    challengerWins: row.result.challengerWins,
    defenderWins: row.result.defenderWins,
    rounds: row.result.rounds,
    lineup: row.result.lineup,
    enemies: row.result.enemies,
  };
}

/** 战报分页：按 id 倒序，beforeId 之前的更早战报；多取一条判断是否还有 */
export async function loadStarTowerReports(
  q: Queryable,
  accountId: string,
  limit: number,
  beforeId: number | null,
): Promise<{ reports: StarTowerMatchView[]; hasMore: boolean }> {
  const res = await q.query(
    `SELECT id, floor, won, result, created_at FROM star_tower_matches
     WHERE account_id = $1 AND ($2::bigint IS NULL OR id < $2::bigint)
     ORDER BY id DESC LIMIT $3`,
    [accountId, beforeId, limit + 1],
  );
  const rows = res.rows as StarTowerMatchRow[];
  return { reports: rows.slice(0, limit).map(toView), hasMore: rows.length > limit };
}

/** 敌方阵容（按层号生成）的展示快照：匿名，heroId 为 null */
export function starTowerEnemyViews(floor: number): ArenaFighterView[] {
  return starTowerFloorEnemies(floor).map((e) => ({ heroId: null, ...e }));
}
