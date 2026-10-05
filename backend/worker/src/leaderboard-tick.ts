// 全服排行榜（v23，AISLG-61）：三个榜（综合战力 / 领地数量 / 累计掠夺量）。
// 由 Worker 定时（10 分钟）整榜重算并把名次写进 leaderboard_snapshots；API 的
// GET_LEADERBOARD 只读快照，避免查询时实时全表统计。数值口径：
// - 综合战力：账号全部兵力的战力之和（城内驻军 + 占领野地的驻军 + 行军中的部队），
//   按兵种战力系数（TROOP_POWER）合计——与文档「兵种与战斗属性」的战力同源；
// - 领地数量：占领的野地数；
// - 累计掠夺量：掠夺入账的四资源合计（accounts.plunder_total，记在账号上——
//   玩家与 Agent 打出的成绩算同一账号）。
// Agent 在线状态不在快照里（Worker 不知道连接）：API 查询时按当前连接实时标注。
// v50（AISLG-133）：另算模型榜——最近 7 天 Agent 上线过（accounts.agent_last_seen_at）
// 且进了战力统计的账号，按自报模型归类（common/src/agent-models.ts）取各组实力
// 前 10 名平均分，聚合结果写 leaderboard_model_snapshots；玩家三榜快照行带 agent_model
// 原文（API 原样下发）。

import pg from 'pg';
import { TROOP_KINDS, type TroopKind } from '../../common/src/protocol';
import { TROOP_POWER } from '../../common/src/battle';
import {
  aggregateModelLeaderboard,
  MODEL_LEADERBOARD_ACTIVE_DAYS,
  type AgentPowerStat,
} from '../../common/src/agent-models';

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
  /** Agent 自报模型原文（v50；null = 从未声明），随快照回填 */
  agent_model: string | null;
}

/** 全部账号的主城名与自报模型（分城成绩并入账号，展示名用主城） */
async function loadAccountNaming(client: pg.PoolClient): Promise<Map<string, { username: string; cityName: string; agentModel: string | null }>> {
  const res = await client.query(
    `SELECT c.account_id, a.username, a.agent_model, c.name AS city_name
     FROM cities c
     JOIN accounts a ON a.id = c.account_id
     JOIN (SELECT account_id, MIN(created_at) AS first_created FROM cities GROUP BY account_id) m
       ON m.account_id = c.account_id AND m.first_created = c.created_at`,
  );
  const naming = new Map<string, { username: string; cityName: string; agentModel: string | null }>();
  for (const row of res.rows as Array<{ account_id: string; username: string; agent_model: string | null; city_name: string }>) {
    naming.set(row.account_id, { username: row.username, cityName: row.city_name, agentModel: row.agent_model });
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
      agent_model: naming.get(accountId)!.agentModel,
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
      agent_model: naming.get(row.account_id)!.agentModel,
    }));
}

/** 累计掠夺量榜：accounts.plunder_total（四资源合计；掠夺入账时累加） */
async function computePlunderRows(client: pg.PoolClient): Promise<LeaderboardRow[]> {
  const res = await client.query(
    `SELECT a.id AS account_id, a.username, a.agent_model, a.plunder_total,
            (SELECT c.name FROM cities c WHERE c.account_id = a.id ORDER BY c.created_at LIMIT 1) AS city_name
     FROM accounts a
     WHERE a.plunder_total > 0`,
  );
  return (res.rows as Array<{ account_id: string; username: string; agent_model: string | null; plunder_total: string | number; city_name: string | null }>)
    .filter((row) => row.city_name !== null && Number(row.plunder_total) > 0)
    .map((row) => ({
      account_id: row.account_id,
      username: row.username,
      city_name: row.city_name as string,
      value: Number(row.plunder_total),
      agent_model: row.agent_model,
    }));
}

/** 模型榜聚合输入（v50，AISLG-133）：最近 7 天 Agent 上线过的账号，战力取全量战力行 */
async function computeModelRows(client: pg.PoolClient, powerRows: readonly LeaderboardRow[]): Promise<ReturnType<typeof aggregateModelLeaderboard>> {
  const res = await client.query(
    `SELECT a.id AS account_id, a.username, a.agent_model
     FROM accounts a
     WHERE a.agent_last_seen_at > now() - make_interval(days => $1)`,
    [MODEL_LEADERBOARD_ACTIVE_DAYS],
  );
  const powerByAccount = new Map(powerRows.map((row) => [row.account_id, row.value]));
  const stats: AgentPowerStat[] = (res.rows as Array<{ account_id: string; username: string; agent_model: string | null }>).map(
    (row) => ({
      accountId: row.account_id,
      username: row.username,
      declared: row.agent_model,
      power: powerByAccount.get(row.account_id) ?? 0,
    }),
  );
  return aggregateModelLeaderboard(stats);
}

/** 整榜重算（一个事务内替换各榜的全部名次；v50 起含模型榜聚合） */
export async function refreshLeaderboards(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const computedAt = new Date();
    const powerRows = await computePowerRows(client);
    for (const [kind, rows] of [
      ['power', powerRows],
      ['territory', await computeTerritoryRows(client)],
      ['plunder', await computePlunderRows(client)],
    ] as const) {
      const ranked = [...rows].sort((a, b) => b.value - a.value || a.username.localeCompare(b.username)).slice(0, LEADERBOARD_SIZE);
      await client.query(`DELETE FROM leaderboard_snapshots WHERE kind = $1`, [kind]);
      for (let i = 0; i < ranked.length; i += 1) {
        const row = ranked[i];
        await client.query(
          `INSERT INTO leaderboard_snapshots (kind, rank, account_id, username, city_name, value, agent_model, computed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [kind, i + 1, row.account_id, row.username, row.city_name, row.value, row.agent_model, computedAt],
        );
      }
    }
    // 模型榜（v50，AISLG-133）：聚合用战力全量行（不只前 LEADERBOARD_SIZE 名，名单
    // 靠后的模型也能上榜）；「未声明」「其他」同样成组
    const modelRows = await computeModelRows(client, powerRows);
    await client.query(`DELETE FROM leaderboard_model_snapshots`);
    for (const row of modelRows) {
      await client.query(
        `INSERT INTO leaderboard_model_snapshots
           (rank, model_id, model_label, players, top_avg_value, top_player_username, top_player_value, computed_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [row.rank, row.modelId, row.label, row.players, row.value, row.topUsername, row.topValue, computedAt],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
