// 全服战况播报（v23，AISLG-60）：只播大事、不做聊天。当前四类：
// 1) NPC 城被掠空  2) 首个占领金矿（全服一次性）  3) 主城被 NPC 攻破
// 4) 玩家（或其 Agent）1 小时内连胜 5 场（此后每再连胜 5 场再播；同一账号两条间隔至少 10 分钟，AISLG-262）。
// 后续版本按同一通道追加：分城易主（city_conquered，v40）、洛阳窗口（luoyang_window，v79）、
// 名将获得 / 下野 / 被俘（hero_granted / hero_left / hero_captured，v36 / v94）、
// 势力动静（faction_*，v99–v107）、剧本战场（battlefield_*，v75），以及
// 名城任期届满重归无主（famous_expired，v111，AISLG-259；周度事件，走普通限频）。
// 限频：全服每分钟最多 3 条，超出的直接丢弃（播报不是事件流，漏掉不补）。
// 写入由 Worker 在结算事务内完成（server_broadcasts 表），提交后 pg_notify → API
// 经 PUSH_SERVER_BROADCAST 广播给全部在线连接；断线重连用 GET_SERVER_BROADCASTS
// 拉最近若干条。API 与 Worker 共用本文件，两侧不得各自实现限频或连胜计数。

import pg from 'pg';
import { NOTIFY_CHANNEL } from './db';
import type { InitiatorRole, ServerBroadcastCategory, ServerBroadcastType } from './protocol';
import { SERVER_BROADCAST_EVENT_TYPES } from './protocol-server';

/** 全服每分钟最多播报条数（超出丢弃；占位值随需求「已定」标注可调） */
export const SERVER_BROADCAST_RATE_PER_MINUTE = 3;
/** 连胜播报阈值（达到后播报一次，此后每再累计同样场次再播一次） */
export const WIN_STREAK_BROADCAST_EVERY = 5;
/**
 * 连胜的统计窗口（毫秒，AISLG-262）：从本轮连胜的第一场胜利起算，满窗口后下一场胜利计数回到 1；
 * 两场胜利间隔超过窗口也清零。所以「1 小时内连胜 N 场」里的 N 至多是一小时内能打赢的场数。
 */
export const WIN_STREAK_WINDOW_MS = 60 * 60 * 1000;
/** 同一账号两条连胜播报之间的最短间隔（毫秒，AISLG-262）；间隔内达到的节点不补播 */
export const WIN_STREAK_BROADCAST_COOLDOWN_MS = 10 * 60 * 1000;

export interface ServerBroadcastCreated {
  id: number;
  type: ServerBroadcastType;
  detail: Record<string, unknown>;
  createdAt: string;
}

/**
 * 写一条全服播报（调用方事务内）：全服 60 秒内已达 3 条时丢弃并返回 null。
 * 返回创建的播报视图（调用方提交后发 pg_notify 广播）。
 */
export async function insertServerBroadcast(
  client: pg.PoolClient,
  type: ServerBroadcastType,
  detail: Record<string, unknown>,
  /** v29：黄巾之乱的关键节点（起事 / 老巢 / 收场）必达，不受每分钟限频（仍计入窗口内条数） */
  options: { force?: boolean } = {},
): Promise<ServerBroadcastCreated | null> {
  if (!options.force) {
    const rateRes = await client.query(
      `SELECT count(*)::int AS n FROM server_broadcasts WHERE created_at > now() - interval '60 seconds'`,
    );
    if ((rateRes.rows[0] as { n: number }).n >= SERVER_BROADCAST_RATE_PER_MINUTE) {
      return null;
    }
  }
  const res = await client.query(
    `INSERT INTO server_broadcasts (type, detail) VALUES ($1, $2::jsonb) RETURNING id, created_at`,
    [type, JSON.stringify(detail)],
  );
  const row = res.rows[0] as { id: number | string; created_at: Date };
  return { id: Number(row.id), type, detail, createdAt: row.created_at.toISOString() };
}

/**
 * 记录一场战斗结果并结算连胜（调用方事务内）。输一场即清零；两场胜利间隔超 1 小时清零；
 * 本轮连胜从首胜起满 1 小时后下一场胜利重新从 1 计（AISLG-262）。
 * 连胜达到 WIN_STREAK_BROADCAST_EVERY 的整数倍、且该账号距上一条连胜播报已过冷却时，写一条 win_streak 播报。
 * 返回需要广播的播报（被全服限频丢弃或在账号冷却内时为 null，但计数仍写库）。
 */
export async function recordWinStreak(
  client: pg.PoolClient,
  accountId: string,
  won: boolean,
  broadcastDetail: Record<string, unknown>,
): Promise<ServerBroadcastCreated | null> {
  if (!won) {
    await client.query(`UPDATE win_streaks SET count = 0 WHERE account_id = $1`, [accountId]);
    return null;
  }
  // 重新起算的条件：上次已清零、两场间隔超窗口、或本轮连胜从首胜起已满窗口（旧行 streak_started_at 为空也算已过期）
  const restart = `(win_streaks.count = 0
       OR win_streaks.last_win_at < now() - make_interval(secs => $2)
       OR win_streaks.streak_started_at IS NULL
       OR win_streaks.streak_started_at < now() - make_interval(secs => $2))`;
  const upsert = await client.query(
    `INSERT INTO win_streaks (account_id, count, last_win_at, streak_started_at)
     VALUES ($1, 1, now(), now())
     ON CONFLICT (account_id) DO UPDATE SET
       count = CASE WHEN ${restart} THEN 1 ELSE win_streaks.count + 1 END,
       streak_started_at = CASE WHEN ${restart} THEN now() ELSE win_streaks.streak_started_at END,
       last_win_at = now()
     RETURNING count,
       (last_broadcast_at IS NULL OR last_broadcast_at < now() - make_interval(secs => $3)) AS can_broadcast`,
    [accountId, WIN_STREAK_WINDOW_MS / 1000, WIN_STREAK_BROADCAST_COOLDOWN_MS / 1000],
  );
  const row = upsert.rows[0] as { count: number; can_broadcast: boolean };
  if (row.count === 0 || row.count % WIN_STREAK_BROADCAST_EVERY !== 0 || !row.can_broadcast) {
    return null;
  }
  const created = await insertServerBroadcast(client, 'win_streak', { ...broadcastDetail, streak: row.count });
  if (created) {
    await client.query(`UPDATE win_streaks SET last_broadcast_at = now() WHERE account_id = $1`, [accountId]);
  }
  return created;
}

/** 查询最近的全服播报（新→旧；limit 由调用方钳制）。category 非空时只返回该类（v112，AISLG-260） */
export async function listServerBroadcasts(
  q: pg.Pool | pg.PoolClient,
  limit: number,
  category?: ServerBroadcastCategory,
): Promise<ServerBroadcastCreated[]> {
  const eventTypes = SERVER_BROADCAST_EVENT_TYPES as readonly string[];
  const res = await q.query(
    category === 'event'
      ? `SELECT id, type, detail, created_at FROM server_broadcasts WHERE type = ANY($2::text[]) ORDER BY id DESC LIMIT $1`
      : category === 'war'
        ? `SELECT id, type, detail, created_at FROM server_broadcasts WHERE NOT (type = ANY($2::text[])) ORDER BY id DESC LIMIT $1`
        : `SELECT id, type, detail, created_at FROM server_broadcasts ORDER BY id DESC LIMIT $1`,
    category ? [limit, [...eventTypes]] : [limit],
  );
  return (res.rows as Array<{ id: number | string; type: string; detail: Record<string, unknown>; created_at: Date }>).map(
    (row) => ({
      id: Number(row.id),
      type: row.type as ServerBroadcastType,
      detail: row.detail,
      createdAt: row.created_at.toISOString(),
    }),
  );
}

/** 播报里出现的身份（前端拼文案用；与协议的登录类型同形，占位便于文档对齐） */
export type BroadcastActor = InitiatorRole;

/**
 * 单条播报的独立事务（v112，AISLG-260）：写库、COMMIT 时 pg_notify，API 收到后走 PUSH_SERVER_BROADCAST。
 * 用于「不在自己事务里」的调用方（Worker 定时器：活动提醒 / 赛季预告）；已经处在事务里的调用方
 * 应当用 insertServerBroadcast 并在提交后自行发通知（如 battlefieldBroadcast + publishBroadcasts）。
 * 失败向上抛，由调用方决定只记日志还是重试（播报不是关键路径）。
 */
export async function publishServerBroadcast(
  pool: pg.Pool,
  type: ServerBroadcastType,
  detail: Record<string, unknown>,
  options: { force?: boolean } = {},
): Promise<ServerBroadcastCreated | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await insertServerBroadcast(client, type, detail, options);
    if (created) {
      await client.query(`SELECT pg_notify($1, $2)`, [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: created }),
      ]);
    }
    await client.query('COMMIT');
    return created;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
