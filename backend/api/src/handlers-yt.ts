// 黄巾之乱查询（v29，AISLG-76）：GET_YELLOW_TURBAN。事件生命周期与营地结算在 Worker
// （worker/src/yt-*.ts）；这里只读：事件进度 / 营地与老巢 / 我的贡献与名次 / 贡献榜前 10。

import type { YtContributionView } from '../../common/src/protocol';
import { YT_REWARD_TIERS, ytCycleMs } from '../../common/src/yellow-turban';
import {
  loadActiveCamps,
  loadActiveYtEvent,
  loadLatestYtEvent,
  ytCampView,
  ytEventView,
} from '../../common/src/yellow-turban-db';
import { respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** GET_YELLOW_TURBAN：当前事件（没有进行中则给最近一轮，status=finished）、营地、我的贡献与榜单 */
export async function handleGetYellowTurban(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const active = await loadActiveYtEvent(ctx.pool);
  const event = active ?? (await loadLatestYtEvent(ctx.pool));
  const camps = active ? await loadActiveCamps(ctx.pool, active.id) : [];
  const now = new Date();

  let top: YtContributionView[] = [];
  let me: { killed: number; rank: number } | null = null;
  if (event) {
    const ranked = await ctx.pool.query(
      `SELECT c.account_id, a.username, c.killed,
              RANK() OVER (ORDER BY c.killed DESC) AS rank
       FROM yt_contrib c JOIN accounts a ON a.id = c.account_id
       WHERE c.event_id = $1 AND c.killed > 0
       ORDER BY c.killed DESC, c.account_id`,
      [event.id],
    );
    const rows = ranked.rows as Array<{ account_id: string; username: string; killed: number; rank: string | number }>;
    top = rows.slice(0, 10).map((row) => ({ rank: Number(row.rank), username: row.username, killed: row.killed }));
    const mine = rows.find((row) => row.account_id === accountId);
    me = mine ? { killed: mine.killed, rank: Number(mine.rank) } : null;
  }

  respondOk(ctx.registry, conn, op, seq, {
    event: event ? ytEventView(event) : null,
    // 没有进行中事件：下一轮预计起事时刻 = 最近一轮开始 + 起事间隔（从未起过事为 null，等有活跃玩家即起）
    nextEventAt: !active && event ? new Date(event.started_at.getTime() + ytCycleMs()).toISOString() : null,
    camps: camps.map((camp) => ytCampView(camp, now)),
    me,
    top,
    rewards: YT_REWARD_TIERS.map((tier) => ({ label: tier.label, maxRank: tier.maxRank, reward: tier.reward })),
  });
}
