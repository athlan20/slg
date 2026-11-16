// 换季预告发送（AISLG-134，docs/season-system.md §4）：到达新阶段时写一条「活动」播报（v112，AISLG-260：
// 不再发公告、也不再自带 announcement 类播报，避免重复）+ PUSH_SEASON(warning)。
// 先在 seasons.notified_stages 上抢占（条件 UPDATE），抢到才发：Worker 重启 / 多次 tick 不会重发。
// 发送失败只记日志，不回滚抢占——宁可漏发一次，也不让同一阶段反复刷屏。
// 播报文案（剩余时长 / 结束时刻 / 届时停服重置）由前端按 type + detail 拼，后端只给数据。
import type pg from 'pg';
import { notifySeasonEvent, type SeasonRow } from '../../common/src/season-db';
import { crossedStages, planNotice, type SeasonNoticeStage } from '../../common/src/season-stages';
import { publishServerBroadcast } from '../../common/src/server-broadcast';

/**
 * 若当前时刻到达了新的预告阶段，发送最近的那一个并标记所有已到达阶段为已发。
 * 返回本次发出的阶段；没有需要发的返回 null。
 */
export async function sendDueNotice(pool: pg.Pool, season: SeasonRow, nowMs: number = Date.now()): Promise<SeasonNoticeStage | null> {
  const endMs = season.endAt.getTime();
  // 绝大多数 tick 没有到达任何阶段：纯计算先行返回，不碰数据库
  if (crossedStages(endMs, nowMs).length === 0) {
    return null;
  }
  const cur = await pool.query(`SELECT notified_stages FROM seasons WHERE id = $1`, [season.id]);
  const notified = (cur.rows[0]?.notified_stages ?? []) as string[];
  const plan = planNotice(endMs, nowMs, notified);
  if (plan.send === null) {
    return null;
  }
  const stage = plan.send;
  // 抢占：只有仍未发过该阶段的那一方能拿到 rowCount = 1（其余已到达阶段一并记为已发）
  const claim = await pool.query(
    `UPDATE seasons
     SET notified_stages = ARRAY(SELECT DISTINCT x FROM unnest(notified_stages || $2::text[]) AS x ORDER BY x)
     WHERE id = $1 AND NOT ($3::text = ANY(notified_stages))
     RETURNING id`,
    [season.id, plan.markNotified, stage],
  );
  if (claim.rowCount !== 1) {
    return null;
  }
  const remainingSec = Math.max(0, Math.floor((endMs - nowMs) / 1000));
  const endsAt = season.endAt.toISOString();
  try {
    // 必达：不受全服每分钟 3 条限频（四个阶段各一条）；原先的强提醒弹窗随公告一起去掉
    await publishServerBroadcast(
      pool,
      'season_ending',
      { seasonId: season.id, seasonName: season.name, endAt: endsAt, stage },
      { force: true },
    );
  } catch (err) {
    console.error(`season notice ${stage}: broadcast failed:`, err instanceof Error ? err.message : err);
  }
  try {
    await notifySeasonEvent(pool, {
      reason: 'season_warning',
      data: { seasonId: season.id, endsAt, remainingSec, stage },
    });
  } catch (err) {
    console.error(`season notice ${stage}: push failed:`, err instanceof Error ? err.message : err);
  }
  console.log(`season notice sent: ${stage} (season ${season.id}, ends ${endsAt})`);
  return stage;
}
