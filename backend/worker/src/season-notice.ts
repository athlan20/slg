// 换季预告发送（AISLG-134，docs/season-system.md §4）：到达新阶段时发公告（全服播报）+ PUSH_SEASON(warning)。
// 先在 seasons.notified_stages 上抢占（条件 UPDATE），抢到才发：Worker 重启 / 多次 tick 不会重发。
// 发送失败只记日志，不回滚抢占——宁可漏发一次，也不让同一阶段反复刷屏。
import type pg from 'pg';
import { publishAnnouncement } from '../../common/src/announcement-publish';
import { notifySeasonEvent, type SeasonRow } from '../../common/src/season-db';
import { crossedStages, planNotice, type SeasonNoticeStage } from '../../common/src/season-stages';

/** 阶段对应的中文剩余时长（公告正文用） */
const LEFT_TEXT: Record<SeasonNoticeStage, string> = {
  'T-3d': '3 天',
  'T-1d': '1 天',
  'T-1h': '1 小时',
  'T-10m': '10 分钟',
};

/** 北京时间的可读时刻（运营口径，公告用） */
function formatBeijing(date: Date): string {
  return date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

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
  const strongRemind = stage === 'T-1h' || stage === 'T-10m';
  try {
    // chat: true 同时写一条全服播报（强制入库，不受每分钟限频），PUSH_ANNOUNCEMENT 推给在线连接
    await publishAnnouncement(pool, {
      category: 'system',
      titleZh: `${season.name}即将结束（距结束 ${LEFT_TEXT[stage]}）`,
      bodyZh:
        `${season.name}将于北京时间 ${formatBeijing(season.endAt)} 结束。届时服务会短暂停服，` +
        `世界与城池重置并开启新赛季；账号、Agent 令牌与第三方登录绑定保留，各榜前列进入名人堂。`,
      titleEn: null,
      bodyEn: null,
      pinned: false,
      strongRemind,
      host: null,
      startsAt: new Date(nowMs - 1000),
      endsAt: season.endAt,
      chat: true,
    });
  } catch (err) {
    console.error(`season notice ${stage}: announcement failed:`, err instanceof Error ? err.message : err);
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
