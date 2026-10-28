// 全服排行榜查询（v23，AISLG-61）：读 Worker 定时写入的 leaderboard_snapshots 快照
// （每 10 分钟整榜重算，见 worker/src/leaderboard-tick.ts），不做实时全表统计。
// agentOnline 按查询时刻的连接实时标注（Worker 不知道连接状态）；前 50 名之外
// 的「我的名次」从同一次快照里取（快照存全量名次）。
// v50（AISLG-133）：玩家三榜条目带 agentModel（Agent 自报模型原文，快照里回填）；
// 新增 kind=model 模型榜，读 leaderboard_model_snapshots 聚合快照、经 modelEntries 下发。
// v70（AISLG-185）：新增 kind=alliance 联盟榜，读 alliance_leaderboard_snapshots、经 allianceEntries 下发；
// me 给出我所在联盟的名次与势力（查询时按 membership 取，快照里没有则为 null）。

import { LEADERBOARD_KINDS, type LeaderboardKind } from '../../common/src/protocol';
import { getMembership } from '../../common/src/alliance-db';
import { nobilityName } from '../../common/src/nobility';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** 榜单展示的名次数（快照可存更多，「前 N」按协议约定为 50） */
const LEADERBOARD_TOP = 50;

/** GET_LEADERBOARD：四榜快照查询（kind 必填、取值见 LEADERBOARD_KINDS） */
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
  if (kind === 'model') {
    await respondModelLeaderboard(ctx, conn, op, seq);
    return;
  }
  if (kind === 'alliance') {
    await respondAllianceLeaderboard(ctx, conn, op, seq);
    return;
  }
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
    `SELECT s.rank, s.account_id, s.username, s.city_name, s.value, s.agent_model, a.nobility
     FROM leaderboard_snapshots s
     LEFT JOIN accounts a ON a.id = s.account_id
     WHERE s.kind = $1 AND s.computed_at = $2
     ORDER BY s.rank ASC`,
    [kind, computedAt],
  );
  const entries = (rows.rows as Array<{ rank: number; account_id: string; username: string; city_name: string; value: string | number; agent_model: string | null; nobility: number | null }>).map(
    (row) => ({
      rank: row.rank,
      accountId: row.account_id,
      username: row.username,
      cityName: row.city_name,
      value: Number(row.value),
      agentOnline: ctx.registry.agentConnections(row.account_id).length > 0,
      agentModel: row.agent_model,
      nobility: Math.max(0, Number(row.nobility ?? 0)),
      nobilityName: nobilityName(Number(row.nobility ?? 0)),
    }),
  );
  const accountId = conn.accountId as string;
  const mine = entries.find((entry) => entry.accountId === accountId) ?? null;
  const me = mine ? { rank: mine.rank, value: mine.value, nobility: mine.nobility, nobilityName: mine.nobilityName } : null;
  respondOk(ctx.registry, conn, op, seq, {
    kind,
    updatedAt: computedAt.toISOString(),
    entries: entries.slice(0, LEADERBOARD_TOP),
    me,
  });
}

/** kind=alliance（v70，AISLG-185）：读联盟榜快照（势力排名，成员不足 5 人不上榜）；entries 为空，条目经 allianceEntries 下发 */
async function respondAllianceLeaderboard(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const latest = await ctx.pool.query(`SELECT max(computed_at) AS computed_at FROM alliance_leaderboard_snapshots`);
  const computedAt = latest.rows[0]?.computed_at as Date | null;
  if (!computedAt) {
    respondOk(ctx.registry, conn, op, seq, {
      kind: 'alliance' as const,
      updatedAt: new Date().toISOString(),
      entries: [],
      me: null,
      allianceEntries: [],
    });
    return;
  }
  const rows = await ctx.pool.query(
    `SELECT rank, alliance_id, name, leader_id, leader_name, member_count, value
     FROM alliance_leaderboard_snapshots
     WHERE computed_at = $1
     ORDER BY rank ASC`,
    [computedAt],
  );
  const ranked = (rows.rows as Array<{
    rank: number;
    alliance_id: string;
    name: string;
    leader_id: string;
    leader_name: string;
    member_count: number;
    value: string | number;
  }>).map((row) => ({
    rank: row.rank,
    allianceId: row.alliance_id,
    name: row.name,
    leader: { accountId: row.leader_id, username: row.leader_name },
    memberCount: row.member_count,
    value: Number(row.value),
  }));
  // 我所在联盟的名次从同一份快照里取（快照存全量名次，与玩家榜的「我的名次」同理）
  const membership = await getMembership(ctx.pool, conn.accountId as string);
  const mine = membership ? ranked.find((entry) => entry.allianceId === membership.allianceId) : undefined;
  respondOk(ctx.registry, conn, op, seq, {
    kind: 'alliance' as const,
    updatedAt: computedAt.toISOString(),
    entries: [],
    me: mine ? { rank: mine.rank, value: mine.value } : null,
    allianceEntries: ranked.slice(0, LEADERBOARD_TOP),
  });
}

/** kind=model（v50，AISLG-133）：读模型榜聚合快照，entries 为空、me 恒为 null */
async function respondModelLeaderboard(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const latest = await ctx.pool.query(`SELECT max(computed_at) AS computed_at FROM leaderboard_model_snapshots`);
  const computedAt = latest.rows[0]?.computed_at as Date | null;
  if (!computedAt) {
    respondOk(ctx.registry, conn, op, seq, {
      kind: 'model' as const,
      updatedAt: new Date().toISOString(),
      entries: [],
      me: null,
      modelEntries: [],
    });
    return;
  }
  const rows = await ctx.pool.query(
    `SELECT rank, model_id, model_label, players, top_avg_value, top_player_username, top_player_value
     FROM leaderboard_model_snapshots
     WHERE computed_at = $1
     ORDER BY rank ASC`,
    [computedAt],
  );
  const modelEntries = (rows.rows as Array<{
    rank: number;
    model_id: string;
    model_label: string;
    players: number;
    top_avg_value: string | number;
    top_player_username: string | null;
    top_player_value: string | number | null;
  }>).map((row) => ({
    rank: row.rank,
    modelId: row.model_id,
    label: row.model_label,
    players: row.players,
    value: Number(row.top_avg_value),
    topPlayer:
      row.top_player_username !== null
        ? { username: row.top_player_username, value: Number(row.top_player_value ?? 0) }
        : null,
  }));
  respondOk(ctx.registry, conn, op, seq, {
    kind: 'model' as const,
    updatedAt: computedAt.toISOString(),
    entries: [],
    me: null,
    modelEntries,
  });
}
