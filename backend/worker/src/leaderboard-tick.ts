// 全服排行榜（v23，AISLG-61）：三个榜（综合战力 / 领地数量 / 累计掠夺量）。
// 由 Worker 定时（10 分钟）整榜重算并把名次写进 leaderboard_snapshots；API 的
// GET_LEADERBOARD 只读快照，避免查询时实时全表统计。数值口径：
// - 综合战力：账号全部兵力的战力之和（城内驻军 + 占领野地的驻军 + 行军中的部队），
//   按兵种战力系数（TROOP_POWER）合计——与文档「兵种与战斗属性」的战力同源；
// - 领地数量：占领的野地数；
// - 累计掠夺量：掠夺入账的四资源合计（accounts.plunder_total，记在账号上——
//   玩家与 Agent 打出的成绩算同一账号）。
// Agent 在线状态不在快照里（Worker 不知道连接）：API 查询时按当前连接实时标注。

import pg from 'pg';
import { TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import { TROOP_POWER } from '../../common/src/battle';

/** 快照刷新间隔（毫秒；占位值 10 分钟，随需求「已定」标注可调；环境变量可覆盖验证） */
export const LEADERBOARD_REFRESH_MS = (() => {
  const raw = Number(process.env.LEADERBOARD_REFRESH_MS);
  return Number.isFinite(raw) && raw >= 10_000 ? Math.floor(raw) : 10 * 60 * 1000;
})();

/** 快照保留的名次数（榜单展示前 50 + 我的名次，快照存全量排名；占位） */
const LEADERBOARD_SIZE = 200;

interface LeaderboardRow {
  account_id: string;
  username: string;
  city_name: string;
  value: number;
}

/** 全部账号的主城名（分城成绩并入账号，展示名用主城） */
async function loadAccountNaming(client: pg.PoolClient): Promise<Map<string, { username: string; cityName: string }>> {
  const res = await client.query(
    `SELECT c.account_id, a.username, c.name AS city_name
     FROM cities c
     JOIN accounts a ON a.id = c.account_id
     JOIN (SELECT account_id, MIN(created_at) AS first_created FROM cities GROUP BY account_id) m
       ON m.account_id = c.account_id AND m.first_created = c.created_at`,
  );
  const naming = new Map<string, { username: string; cityName: string }>();
  for (const row of res.rows as Array<{ account_id: string; username: string; city_name: string }>) {
    naming.set(row.account_id, { username: row.username, cityName: row.city_name });
  }
  return naming;
}

/** 综合战力榜：城内驻军 + 占领野地的驻军 + 行军中部队（×2 倍耗粮的同一批兵力） */
async function computePowerRows(client: pg.PoolClient): Promise<LeaderboardRow[]> {
  const naming = await loadAccountNaming(client);
  const values = new Map<string, number>();
  const addArmy = (accountId: string, troop: string, count: number): void => {
    if (!(TROOP_KINDS as readonly string[]).includes(troop) || count <= 0) {
      return;
    }
    const power = TROOP_POWER[troop as TroopKind] * count;
    values.set(accountId, (values.get(accountId) ?? 0) + power);
  };
  // 城内驻军
  const cityArmy = await client.query(
    `SELECT c.account_id, ca.troop, ca.count FROM city_army ca JOIN cities c ON c.id = ca.city_id`,
  );
  for (const row of cityArmy.rows as Array<{ account_id: string; troop: string; count: string | number }>) {
    addArmy(row.account_id, row.troop, Number(row.count));
  }
  // 占领野地的驻军
  const tileArmy = await client.query(
    `SELECT c.account_id, ta.troop, ta.count
     FROM tile_army ta
     JOIN world_tiles wt ON wt.x = ta.x AND wt.y = ta.y
     JOIN cities c ON c.id = wt.owner_city_id`,
  );
  for (const row of tileArmy.rows as Array<{ account_id: string; troop: string; count: string | number }>) {
    addArmy(row.account_id, row.troop, Number(row.count));
  }
  // 行军中的部队（troops 为 jsonb）
  const marching = await client.query(
    `SELECT m.account_id, m.troops FROM marches m WHERE m.status = 'marching'`,
  );
  for (const row of marching.rows as Array<{ account_id: string; troops: Partial<Record<TroopKind, number>> | null }>) {
    for (const [troop, count] of Object.entries(row.troops ?? {})) {
      addArmy(row.account_id, troop, Math.floor(count ?? 0));
    }
  }
  return [...values.entries()]
    .filter(([accountId]) => naming.has(accountId))
    .map(([accountId, value]) => ({
      account_id: accountId,
      username: naming.get(accountId)!.username,
      city_name: naming.get(accountId)!.cityName,
      value: Math.round(value),
    }));
}

/** 领地数量榜：占领的野地数 */
async function computeTerritoryRows(client: pg.PoolClient): Promise<LeaderboardRow[]> {
  const naming = await loadAccountNaming(client);
  const res = await client.query(
    `SELECT c.account_id, count(*)::int AS n
     FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
     WHERE wt.kind = 'wilderness'
     GROUP BY c.account_id`,
  );
  return (res.rows as Array<{ account_id: string; n: number }>)
    .filter((row) => naming.has(row.account_id) && row.n > 0)
    .map((row) => ({
      account_id: row.account_id,
      username: naming.get(row.account_id)!.username,
      city_name: naming.get(row.account_id)!.cityName,
      value: row.n,
    }));
}

/** 累计掠夺量榜：accounts.plunder_total（四资源合计；掠夺入账时累加） */
async function computePlunderRows(client: pg.PoolClient): Promise<LeaderboardRow[]> {
  const res = await client.query(
    `SELECT a.id AS account_id, a.username, a.plunder_total,
            (SELECT c.name FROM cities c WHERE c.account_id = a.id ORDER BY c.created_at LIMIT 1) AS city_name
     FROM accounts a
     WHERE a.plunder_total > 0`,
  );
  return (res.rows as Array<{ account_id: string; username: string; plunder_total: string | number; city_name: string | null }>)
    .filter((row) => row.city_name !== null && Number(row.plunder_total) > 0)
    .map((row) => ({
      account_id: row.account_id,
      username: row.username,
      city_name: row.city_name as string,
      value: Number(row.plunder_total),
    }));
}

/** 整榜重算（一个事务内替换一个榜的全部名次） */
export async function refreshLeaderboards(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const computedAt = new Date();
    for (const [kind, rows] of [
      ['power', await computePowerRows(client)],
      ['territory', await computeTerritoryRows(client)],
      ['plunder', await computePlunderRows(client)],
    ] as const) {
      const ranked = [...rows].sort((a, b) => b.value - a.value || a.username.localeCompare(b.username)).slice(0, LEADERBOARD_SIZE);
      await client.query(`DELETE FROM leaderboard_snapshots WHERE kind = $1`, [kind]);
      for (let i = 0; i < ranked.length; i += 1) {
        const row = ranked[i];
        await client.query(
          `INSERT INTO leaderboard_snapshots (kind, rank, account_id, username, city_name, value, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [kind, i + 1, row.account_id, row.username, row.city_name, row.value, computedAt],
        );
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
