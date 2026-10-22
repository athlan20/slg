// 赛季的数据读写（AISLG-134）：当前赛季、维护态、名人堂查询、荣誉，以及惰性加入赛季（joinCurrentSeason）。
// 所有函数接受 Pool 或 PoolClient（换季引擎 / 注册 / 登录各自的事务内调用）。
// 惰性加入（docs/season-system.md §2.2）：账号 accounts.season_id 与当前赛季不同即在调用方事务内重置
// 赛季字段、建主城、授予新手保护，并把 season_id 置为当前赛季；已在本赛季的账号是空操作。

import type pg from 'pg';
import { newbieUntilFrom } from './protection';
import { NOTIFY_CHANNEL } from './db';
import { insertInitialCity } from './main-city';
import type { HallEntryView, HallKind, HallModelEntryView } from './protocol-season';

type Db = pg.Pool | pg.PoolClient;

/** 当前赛季的子查询（SQL 片段）：status = active 中 id 最大的一行；无则为 NULL */
export const CURRENT_SEASON_ID_SQL = `(SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1)`;

/** 名人堂每页条数 */
export const HALL_PAGE_SIZE = 20;

export interface SeasonRow {
  id: number;
  name: string;
  status: 'active' | 'ended';
  startAt: Date;
  endAt: Date;
  seed: number;
  timeScale: number;
  endedAt: Date | null;
}

/** 维护态（settings 表 key='maintenance'）：存在即表示换季中，reason 如 season_reset */
export interface MaintenanceState {
  reason: string;
  since: string;
}

interface SeasonDbRow {
  id: number;
  name: string;
  status: 'active' | 'ended';
  start_at: Date;
  end_at: Date;
  seed: number;
  time_scale: string | number;
  ended_at: Date | null;
}

function toSeason(row: SeasonDbRow): SeasonRow {
  return {
    id: Number(row.id),
    name: row.name,
    status: row.status,
    startAt: row.start_at,
    endAt: row.end_at,
    seed: Number(row.seed),
    timeScale: Number(row.time_scale),
    endedAt: row.ended_at,
  };
}

const SEASON_COLUMNS = `id, name, status, start_at, end_at, seed, time_scale, ended_at`;

/** 当前赛季（status = active）；没有赛季时返回 null（正常启动后不会出现，播种见 season-seed.ts） */
export async function getCurrentSeason(db: Db): Promise<SeasonRow | null> {
  const res = await db.query(
    `SELECT ${SEASON_COLUMNS} FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1`,
  );
  return res.rowCount ? toSeason(res.rows[0] as SeasonDbRow) : null;
}

/** 已结束的赛季，新 → 旧（名人堂的赛季下拉） */
export async function listEndedSeasons(db: Db): Promise<Array<{ id: number; name: string; endedAt: Date | null }>> {
  const res = await db.query(
    `SELECT id, name, ended_at FROM seasons WHERE status = 'ended' ORDER BY id DESC`,
  );
  return (res.rows as Array<{ id: number; name: string; ended_at: Date | null }>).map((row) => ({
    id: Number(row.id),
    name: row.name,
    endedAt: row.ended_at,
  }));
}

/** 读取维护态；未设置返回 null */
export async function getMaintenance(db: Db): Promise<MaintenanceState | null> {
  const res = await db.query(`SELECT value FROM settings WHERE key = 'maintenance'`);
  if (!res.rowCount) {
    return null;
  }
  const value = res.rows[0].value as { reason?: unknown; since?: unknown } | null;
  if (!value || typeof value !== 'object') {
    return null;
  }
  return { reason: String(value.reason ?? ''), since: String(value.since ?? '') };
}

/** 写入（state 非空）或清除（null）维护态。不发通知：换季引擎在同一事务内自行 pg_notify（见 notifySeasonEvent） */
export async function setMaintenance(db: Db, state: MaintenanceState | null): Promise<void> {
  if (state === null) {
    await db.query(`DELETE FROM settings WHERE key = 'maintenance'`);
    return;
  }
  await db.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ('maintenance', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(state)],
  );
}

/**
 * 发出赛季相关的 pg_notify（走 NOTIFY_CHANNEL，与建造完成等共用通道）。payload 为 JSON，
 * 含 reason（season_warning / season_resetting / season_started / maintenance_on / maintenance_off）
 * 与 data（PUSH_SEASON 的推送载荷，仅 season_* 需要）。NOTIFY 随事务提交才送达。
 */
export async function notifySeasonEvent(db: Db, payload: Record<string, unknown>): Promise<void> {
  await db.query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, JSON.stringify(payload)]);
}

/**
 * 查询某赛季某榜的一页存档。kind = model 时结果进 modelEntries（entries 为空），否则进 entries。
 * page 从 1 起，每页 HALL_PAGE_SIZE 条；total 为该榜的总条数（分页用）。
 */
export async function queryHallOfFame(
  db: Db,
  seasonId: number,
  kind: HallKind,
  page: number,
): Promise<{ entries: HallEntryView[]; modelEntries: HallModelEntryView[]; total: number }> {
  const offset = (Math.max(1, page) - 1) * HALL_PAGE_SIZE;
  if (kind === 'model') {
    const [rows, count] = await Promise.all([
      db.query(
        `SELECT rank, model_id, model_label, players, top_avg_value, top_player_name, top_player_value
         FROM season_archive_models WHERE season_id = $1 ORDER BY rank LIMIT $2 OFFSET $3`,
        [seasonId, HALL_PAGE_SIZE, offset],
      ),
      db.query(`SELECT count(*)::int AS n FROM season_archive_models WHERE season_id = $1`, [seasonId]),
    ]);
    const modelEntries: HallModelEntryView[] = (rows.rows as Array<Record<string, unknown>>).map((row) => ({
      rank: Number(row.rank),
      modelId: String(row.model_id),
      label: String(row.model_label),
      players: Number(row.players),
      value: Number(row.top_avg_value),
      topPlayer:
        row.top_player_name === null ? null : { username: String(row.top_player_name), value: Number(row.top_player_value) },
    }));
    return { entries: [], modelEntries, total: Number(count.rows[0].n) };
  }
  const [rows, count] = await Promise.all([
    db.query(
      `SELECT rank, account_id, username, city_name, value, agent_model
       FROM season_archives WHERE season_id = $1 AND kind = $2 ORDER BY rank LIMIT $3 OFFSET $4`,
      [seasonId, kind, HALL_PAGE_SIZE, offset],
    ),
    db.query(`SELECT count(*)::int AS n FROM season_archives WHERE season_id = $1 AND kind = $2`, [seasonId, kind]),
  ]);
  const entries: HallEntryView[] = (rows.rows as Array<Record<string, unknown>>).map((row) => ({
    rank: Number(row.rank),
    accountId: row.account_id === null ? null : String(row.account_id),
    username: String(row.username),
    cityName: row.city_name === null ? null : String(row.city_name),
    value: Number(row.value),
    agentModel: row.agent_model === null ? null : String(row.agent_model),
  }));
  return { entries, modelEntries: [], total: Number(count.rows[0].n) };
}

/** 荣誉称号（个人信息展示，最新赛季在前） */
export async function getMyHonors(
  db: Db,
  accountId: string,
): Promise<Array<{ seasonId: number; kind: string; rank: number; title: string }>> {
  const res = await db.query(
    `SELECT season_id, kind, rank, title FROM season_honors WHERE account_id = $1 ORDER BY season_id DESC, rank, kind`,
    [accountId],
  );
  return (res.rows as Array<{ season_id: number; kind: string; rank: number; title: string }>).map((row) => ({
    seasonId: Number(row.season_id),
    kind: row.kind,
    rank: Number(row.rank),
    title: row.title,
  }));
}

/**
 * 惰性加入当前赛季（必须在调用方的事务内调用；调用方对账号行 FOR UPDATE 已加锁，此处再锁一次幂等）。
 * accounts.season_id 已等于当前赛季 → 空操作（joined = false）。否则：重置赛季字段（掠夺台账、
 * 新手保护重新授予、主动免战、最后在线时刻），建主城（没有城池时；有残留城池则不再新建，见注释），
 * 并把 season_id 置为当前赛季（joined = true）。账号本身与 Agent 令牌、昵称、第三方绑定不变。
 */
export async function joinCurrentSeason(
  client: pg.PoolClient,
  accountId: string,
): Promise<{ season: SeasonRow; joined: boolean }> {
  const season = await getCurrentSeason(client);
  if (!season) {
    throw new Error('joinCurrentSeason: 没有进行中的赛季');
  }
  const acc = await client.query(`SELECT season_id FROM accounts WHERE id = $1 FOR UPDATE`, [accountId]);
  if (!acc.rowCount) {
    throw new Error(`joinCurrentSeason: 账号不存在 ${accountId}`);
  }
  if (acc.rows[0].season_id !== null && Number(acc.rows[0].season_id) === season.id) {
    return { season, joined: false };
  }
  await client.query(
    `UPDATE accounts
     SET plunder_total = 0, newbie_until = $2, self_truce_until = NULL, self_truce_used_at = NULL,
         last_online_at = NULL, season_id = $3
     WHERE id = $1`,
    [accountId, newbieUntilFrom(new Date()), season.id],
  );
  const cities = await client.query(`SELECT count(*)::int AS n FROM cities WHERE account_id = $1`, [accountId]);
  if (Number(cities.rows[0].n) === 0) {
    await insertInitialCity(client, accountId);
  } else {
    // 残留城池说明换季重置没有清干净（不应出现）：不再新建第二座主城，只记日志，等人工核查
    console.warn(`joinCurrentSeason: 账号 ${accountId} 加入赛季 ${season.id} 时仍有城池残留，未新建主城`);
  }
  return { season, joined: true };
}

/** 登录路径用：独立事务内完成惰性加入（失败整体回滚，调用方据此拒绝登录，不留半成品） */
export async function enterCurrentSeason(pool: pg.Pool, accountId: string): Promise<{ season: SeasonRow; joined: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await joinCurrentSeason(client, accountId);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
