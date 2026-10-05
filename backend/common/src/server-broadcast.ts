// 全服战况播报（v23，AISLG-60）：只播大事、不做聊天。当前四类：
// 1) NPC 城被掠空  2) 首个占领金矿（全服一次性）  3) 主城被 NPC 攻破
// 4) 玩家（或其 Agent）1 小时内连胜 5 场（此后每再连胜 5 场再播）。
// 限频：全服每分钟最多 3 条，超出的直接丢弃（播报不是事件流，漏掉不补）。
// 写入由 Worker 在结算事务内完成（server_broadcasts 表），提交后 pg_notify → API
// 经 PUSH_SERVER_BROADCAST 广播给全部在线连接；断线重连用 GET_SERVER_BROADCASTS
// 拉最近若干条。API 与 Worker 共用本文件，两侧不得各自实现限频或连胜计数。

import pg from 'pg';
import type { InitiatorRole, ServerBroadcastType } from './protocol';

/** 全服每分钟最多播报条数（超出丢弃；占位值随需求「已定」标注可调） */
export const SERVER_BROADCAST_RATE_PER_MINUTE = 3;
/** 连胜播报阈值（达到后播报一次，此后每再累计同样场次再播一次） */
export const WIN_STREAK_BROADCAST_EVERY = 5;
/** 连胜的统计窗口（毫秒；窗口内无新的胜利则计数清零） */
export const WIN_STREAK_WINDOW_MS = 60 * 60 * 1000;

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
 * 记录一场战斗结果并结算连胜（调用方事务内；输一场即清零，1 小时内无胜利也清零）。
 * 连胜达到 WIN_STREAK_BROADCAST_EVERY 的整数倍时自动写一条 win_streak 播报。
 * 返回需要广播的播报（被限频丢弃时为 null，但仍写库），无播报时为 null。
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
  const upsert = await client.query(
    `INSERT INTO win_streaks (account_id, count, last_win_at)
     VALUES ($1, 1, now())
     ON CONFLICT (account_id) DO UPDATE SET
       count = CASE
         WHEN win_streaks.last_win_at < now() - make_interval(secs => $2) THEN 1
         ELSE win_streaks.count + 1
       END,
       last_win_at = now()
     RETURNING count`,
    [accountId, WIN_STREAK_WINDOW_MS / 1000],
  );
  const count = (upsert.rows[0] as { count: number }).count;
  if (count === 0 || count % WIN_STREAK_BROADCAST_EVERY !== 0) {
    return null;
  }
  return insertServerBroadcast(client, 'win_streak', { ...broadcastDetail, streak: count });
}

/** 查询最近的全服播报（新→旧；limit 由调用方钳制） */
export async function listServerBroadcasts(
  q: pg.Pool | pg.PoolClient,
  limit: number,
): Promise<ServerBroadcastCreated[]> {
  const res = await q.query(
    `SELECT id, type, detail, created_at FROM server_broadcasts ORDER BY id DESC LIMIT $1`,
    [limit],
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
