// 公告的查询与已读（v60，AISLG-162）：API 的 GET_ANNOUNCEMENTS / GET_ANNOUNCEMENT / READ_ANNOUNCEMENT 与
// 运维脚本共用这里的 SQL，可见性规则只写一份：status = published、已到生效时间、站点匹配、未撤回。
// 「生效中」= 未过结束时间；「往期」= 已过结束时间。发布 / 修改 / 撤回见 announcement-publish.ts。

import type pg from 'pg';
import { sanitizeAnnouncementBody } from './announcement-body';
import type {
  AnnouncementCategory,
  AnnouncementDetailView,
  AnnouncementLang,
  AnnouncementView,
} from './protocol-announcement';

/** 查询范围：账号（已读判定）、连接站点（Host，null 只能看到全站公告）、显示语言 */
export interface AnnouncementScope {
  accountId: string;
  host: string | null;
  lang: AnnouncementLang;
}

/** announcements 行（运维与玩家查询共用的列集合） */
export interface AnnouncementRow {
  id: string | number;
  category: AnnouncementCategory;
  title_zh: string;
  title_en: string | null;
  body_zh: string;
  body_en: string | null;
  pinned: boolean;
  strong_remind: boolean;
  host: string | null;
  status: 'published' | 'withdrawn';
  starts_at: Date;
  ends_at: Date | null;
  published_at: Date;
  read?: boolean;
  expired?: boolean;
}

/** 可见性：已发布、已到生效时间、站点匹配（$2 = 连接 Host，可为 null） */
const VISIBLE_SQL = `a.status = 'published' AND a.starts_at <= now() AND (a.host IS NULL OR a.host = $2)`;
const ACTIVE_SQL = `(a.ends_at IS NULL OR a.ends_at > now())`;
const EXPIRED_SQL = `(a.ends_at IS NOT NULL AND a.ends_at <= now())`;

/** 语言回落：英文没填（或选的是中文）就用中文 */
export function titleFor(row: Pick<AnnouncementRow, 'title_zh' | 'title_en'>, lang: AnnouncementLang): string {
  return lang === 'en' && row.title_en ? row.title_en : row.title_zh;
}

export function bodyFor(row: Pick<AnnouncementRow, 'body_zh' | 'body_en'>, lang: AnnouncementLang): string {
  return sanitizeAnnouncementBody(lang === 'en' && row.body_en ? row.body_en : row.body_zh);
}

export function toAnnouncementView(row: AnnouncementRow, lang: AnnouncementLang): AnnouncementView {
  return {
    id: Number(row.id),
    category: row.category,
    title: titleFor(row, lang),
    pinned: row.pinned,
    strongRemind: row.strong_remind,
    read: row.read === true,
    expired: row.expired === true,
    publishedAt: row.published_at.toISOString(),
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at ? row.ends_at.toISOString() : null,
  };
}

const READ_JOIN_SQL = `LEFT JOIN announcement_reads r ON r.announcement_id = a.id AND r.account_id = $1`;

/**
 * 列表：默认生效中的公告（置顶在前，其余按发布时间倒序，取前 limit 条）；
 * history=true 时改为往期（已过结束时间，按发布时间倒序，beforeId 之前翻页）。
 */
export async function listAnnouncements(
  q: pg.Pool | pg.PoolClient,
  scope: AnnouncementScope,
  options: { history: boolean; limit: number; beforeId?: number },
): Promise<AnnouncementView[]> {
  const window = options.history ? EXPIRED_SQL : ACTIVE_SQL;
  const order = options.history
    ? 'a.published_at DESC, a.id DESC'
    : 'a.pinned DESC, a.published_at DESC, a.id DESC';
  const res = await q.query(
    `SELECT a.id, a.category, a.title_zh, a.title_en, a.pinned, a.strong_remind, a.starts_at, a.ends_at, a.published_at,
       (r.account_id IS NOT NULL) AS read, ${EXPIRED_SQL} AS expired
     FROM announcements a ${READ_JOIN_SQL}
     WHERE ${VISIBLE_SQL} AND ${window} AND ($3::bigint IS NULL OR a.id < $3)
     ORDER BY ${order}
     LIMIT $4`,
    [scope.accountId, scope.host, options.history ? (options.beforeId ?? null) : null, options.limit],
  );
  return (res.rows as AnnouncementRow[]).map((row) => toAnnouncementView(row, scope.lang));
}

/** 生效中且未读的公告数（红点用） */
export async function countUnreadAnnouncements(q: pg.Pool | pg.PoolClient, scope: AnnouncementScope): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM announcements a
     WHERE ${VISIBLE_SQL} AND ${ACTIVE_SQL}
       AND NOT EXISTS (SELECT 1 FROM announcement_reads r WHERE r.announcement_id = a.id AND r.account_id = $1)`,
    [scope.accountId, scope.host],
  );
  return (res.rows[0] as { n: number }).n;
}

/** 详情：可见的公告（含往期）；不可见（已撤回 / 未开始 / 他站）返回 null */
export async function loadAnnouncementDetail(
  q: pg.Pool | pg.PoolClient,
  scope: AnnouncementScope,
  id: number,
): Promise<AnnouncementDetailView | null> {
  const res = await q.query(
    `SELECT a.id, a.category, a.title_zh, a.title_en, a.body_zh, a.body_en, a.pinned, a.strong_remind, a.starts_at, a.ends_at, a.published_at,
       (r.account_id IS NOT NULL) AS read, ${EXPIRED_SQL} AS expired
     FROM announcements a ${READ_JOIN_SQL}
     WHERE a.id = $3 AND ${VISIBLE_SQL}`,
    [scope.accountId, scope.host, id],
  );
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as AnnouncementRow;
  return { ...toAnnouncementView(row, scope.lang), body: bodyFor(row, scope.lang) };
}

/** 标记已读（幂等）：返回 false 表示公告不可见；返回 true 时调用方再查未读数 */
export async function markAnnouncementRead(
  q: pg.Pool | pg.PoolClient,
  scope: AnnouncementScope,
  id: number,
): Promise<boolean> {
  const visible = await q.query(`SELECT 1 FROM announcements a WHERE a.id = $1 AND ${VISIBLE_SQL}`, [id, scope.host]);
  if (!visible.rowCount) {
    return false;
  }
  await q.query(
    `INSERT INTO announcement_reads (account_id, announcement_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [scope.accountId, id],
  );
  return true;
}
