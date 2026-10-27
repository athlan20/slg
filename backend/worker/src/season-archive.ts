// 换季存档（AISLG-134，docs/season-system.md §3.2 / §3.3）：在换季事务内把即将清空的各榜前列写入名人堂，
// 并按名次发荣誉称号。必须在清表之前、同一事务内执行（失败整体回滚，旧数据仍在，可以重试）。
// 榜单口径：个人三榜取 leaderboard_snapshots（换季前已强制刷新），模型榜取 leaderboard_model_snapshots；
// 竞技场与将星塔没有快照，此处现算（竞技场排除 NPC）。

import type pg from 'pg';

/** 每个个人榜存档的前 N 名 */
export const ARCHIVE_TOP_N = 50;
/** 获得称号的名次上限（冠 / 亚 / 季） */
const HONOR_TOP_N = 3;
/** 联盟榜存档的名次数（v70，AISLG-185：换季时前三进名人堂） */
export const ARCHIVE_ALLIANCE_TOP_N = 3;

/**
 * 存档指定赛季（调用方事务内执行）：个人榜、模型榜、竞技场、将星塔，以及荣誉称号。
 * 同一赛季重复存档前先清掉旧的存档行（幂等，防止重试时叠加）。
 */
export async function archiveSeason(client: pg.PoolClient, seasonId: number, seasonName: string): Promise<void> {
  await client.query(`DELETE FROM season_archives WHERE season_id = $1`, [seasonId]);
  await client.query(`DELETE FROM season_archive_models WHERE season_id = $1`, [seasonId]);
  await client.query(`DELETE FROM season_honors WHERE season_id = $1`, [seasonId]);

  // 个人三榜：快照行已带 username / city_name / agent_model 展示口径
  await client.query(
    `INSERT INTO season_archives (season_id, kind, rank, account_id, username, city_name, value, agent_model)
     SELECT $1, kind, rank, account_id, username, city_name, value, agent_model
     FROM leaderboard_snapshots
     WHERE kind IN ('power', 'territory', 'plunder', 'nobility') AND rank <= $2`,
    [seasonId, ARCHIVE_TOP_N],
  );

  // 联盟榜（v70，AISLG-185）：前三存档；账号列存盟主（展示名与账号 id），联盟信息进专用列
  await client.query(
    `INSERT INTO season_archives (season_id, kind, rank, account_id, username, city_name, value, agent_model, alliance_id, alliance_name, member_count)
     SELECT $1, 'alliance', rank, leader_id, leader_name, NULL, value, NULL, alliance_id, name, member_count
     FROM alliance_leaderboard_snapshots
     WHERE rank <= $2`,
    [seasonId, ARCHIVE_ALLIANCE_TOP_N],
  );

  // 模型榜（全部，上限 ARCHIVE_TOP_N）
  await client.query(
    `INSERT INTO season_archive_models
       (season_id, rank, model_id, model_label, players, top_avg_value, top_player_name, top_player_value)
     SELECT $1, rank, model_id, model_label, players, top_avg_value, top_player_username, top_player_value
     FROM leaderboard_model_snapshots
     WHERE rank <= $2`,
    [seasonId, ARCHIVE_TOP_N],
  );

  // 竞技场：玩家条目（排除 NPC），按赛季末名次取前 N；value 记该玩家赛季末的名次
  await client.query(
    `INSERT INTO season_archives (season_id, kind, rank, account_id, username, city_name, value, agent_model)
     SELECT $1, 'arena', ranked.pos, ranked.account_id, ranked.username, ranked.city_name, ranked.pos, ranked.agent_model
     FROM (
       SELECT ROW_NUMBER() OVER (ORDER BY e.rank) AS pos, e.account_id, a.username, c.name AS city_name, a.agent_model
       FROM arena_entries e
       JOIN accounts a ON a.id = e.account_id
       LEFT JOIN LATERAL (SELECT name FROM cities WHERE account_id = a.id ORDER BY created_at LIMIT 1) c ON true
       WHERE e.account_id IS NOT NULL
     ) ranked
     WHERE ranked.pos <= $2`,
    [seasonId, ARCHIVE_TOP_N],
  );

  // 将星塔：按最高层数取前 N（同层先到达者在前）
  await client.query(
    `INSERT INTO season_archives (season_id, kind, rank, account_id, username, city_name, value, agent_model)
     SELECT $1, 'starTower', ranked.pos, ranked.account_id, ranked.username, ranked.city_name, ranked.best_floor, ranked.agent_model
     FROM (
       SELECT ROW_NUMBER() OVER (ORDER BY p.best_floor DESC, p.updated_at, p.account_id) AS pos,
              p.account_id, p.best_floor, a.username, c.name AS city_name, a.agent_model
       FROM star_tower_progress p
       JOIN accounts a ON a.id = p.account_id
       LEFT JOIN LATERAL (SELECT name FROM cities WHERE account_id = a.id ORDER BY created_at LIMIT 1) c ON true
       WHERE p.best_floor > 0
     ) ranked
     WHERE ranked.pos <= $2`,
    [seasonId, ARCHIVE_TOP_N],
  );

  await writeHonors(client, seasonId, seasonName);
}

/**
 * 荣誉（§3.3）：个人各榜前 3 名得“冠军 / 亚军 / 季军”称号；模型榜第 1 的模型中本季得分最高的玩家得“模型冠军”。
 * 联盟榜（v70）不发称号：联盟跨季保留，称号只给个人（盟主的名字已在名人堂联盟榜上）。
 * 称号只用于名人堂留名与个人信息展示，不带任何数值效果。
 */
async function writeHonors(client: pg.PoolClient, seasonId: number, seasonName: string): Promise<void> {
  await client.query(
    `INSERT INTO season_honors (account_id, season_id, kind, rank, title)
     SELECT a.account_id, a.season_id, a.kind, a.rank,
       $2 || '·' ||
       CASE a.kind WHEN 'power' THEN '力量榜' WHEN 'territory' THEN '领土榜' WHEN 'plunder' THEN '掠夺榜' WHEN 'nobility' THEN '爵位榜'
                   WHEN 'arena' THEN '竞技场' WHEN 'starTower' THEN '将星塔' ELSE a.kind END ||
       CASE a.rank WHEN 1 THEN '冠军' WHEN 2 THEN '亚军' ELSE '季军' END
     FROM season_archives a
     WHERE a.season_id = $1 AND a.rank <= $3 AND a.account_id IS NOT NULL AND a.kind <> 'alliance'`,
    [seasonId, seasonName, HONOR_TOP_N],
  );
  await client.query(
    `INSERT INTO season_honors (account_id, season_id, kind, rank, title)
     SELECT acc.id, $1, 'model', 1, $2 || '·模型冠军'
     FROM season_archive_models m
     JOIN accounts acc ON acc.username = m.top_player_name
     WHERE m.season_id = $1 AND m.rank = 1`,
    [seasonId, seasonName],
  );
}
