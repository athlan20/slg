// 全服排行榜查询（v23，AISLG-61）：读 Worker 定时写入的 leaderboard_snapshots 快照
// （每 10 分钟整榜重算，见 worker/src/leaderboard-tick.ts），不做实时全表统计。
// agentOnline 按查询时刻的连接实时标注（Worker 不知道连接状态）；前 50 名之外
// 的「我的名次」从同一次快照里取（快照存全量名次）。

import { LEADERBOARD_KINDS, type LeaderboardKind } from '../../common/src/protocol';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** 榜单展示的名次数（快照可存更多，「前 N」按协议约定为 50） */
const LEADERBOARD_TOP = 50;

/** GET_LEADERBOARD：三榜快照查询（kind 必填、取值见 LEADERBOARD_KINDS） */
export async function handleGetLeaderboard(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const kindRaw = readString(data, 'kind');
  if (!kindRaw || !(LEADERBOARD_KINDS as readonly string[]).includes(kindRaw)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const kind = kindRaw as LeaderboardKind;
  const latest = await ctx.pool.query(
    `SELECT max(computed_at) AS computed_at FROM leaderboard_snapshots WHERE kind = $1`,
    [kind],
  );
  const computedAt = latest.rows[0]?.computed_at as Date | null;
  if (!computedAt) {
    // 快照尚未生成（Worker 刚启动 / 首个周期未到）：返回空榜而不是报错
    respondOk(ctx.registry, conn, op, seq, { kind, updatedAt: new Date().toISOString(), entries: [], me: null });
    return;
  }
  const rows = await ctx.pool.query(
    `SELECT rank, account_id, username, city_name, value
     FROM leaderboard_snapshots
     WHERE kind = $1 AND computed_at = $2
     ORDER BY rank ASC`,
    [kind, computedAt],
  );
  const entries = (rows.rows as Array<{ rank: number; account_id: string; username: string; city_name: string; value: string | number }>).map(
    (row) => ({
      rank: row.rank,
      accountId: row.account_id,
      username: row.username,
      cityName: row.city_name,
      value: Number(row.value),
      agentOnline: ctx.registry.agentConnections(row.account_id).length > 0,
    }),
  );
  const accountId = conn.accountId as string;
  const mine = entries.find((entry) => entry.accountId === accountId) ?? null;
  const me = mine ? { rank: mine.rank, value: mine.value } : null;
  respondOk(ctx.registry, conn, op, seq, {
    kind,
    updatedAt: computedAt.toISOString(),
    entries: entries.slice(0, LEADERBOARD_TOP),
    me,
  });
}
