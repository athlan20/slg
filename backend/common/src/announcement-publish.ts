// 公告的发布 / 修改 / 撤回（v60，AISLG-162），由运维脚本 backend/scripts/announcement.ts 调用。
// 发布与推送在同一事务内完成：pg_notify 随 COMMIT 才投递，API 收到后按站点向在线连接扇出 PUSH_ANNOUNCEMENT；
// --chat 时同事务写一条全服播报（type = announcement，必达，不受每分钟限频），复用 PUSH_SERVER_BROADCAST 通道。
// 修改与撤回不再推送；定时生效（starts_at 在将来）的公告不推送，玩家下次拉取列表时看到。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from './db';
import { insertServerBroadcast, type ServerBroadcastCreated } from './server-broadcast';
import type { AnnouncementCategory, PushAnnouncementData } from './protocol-announcement';

/** 发布草稿：标题与正文须已经过 announcement-body.ts 的校验（英文两项同有或同无） */
export interface AnnouncementDraft {
  category: AnnouncementCategory;
  titleZh: string;
  bodyZh: string;
  titleEn: string | null;
  bodyEn: string | null;
  pinned: boolean;
  strongRemind: boolean;
  /** 站点定向（连接 Host）；null = 两站都可见 */
  host: string | null;
  startsAt: Date;
  endsAt: Date | null;
  /** 是否在全服播报里同步发一句（只给标题，点一下跳到公告） */
  chat: boolean;
}

export interface PublishResult {
  id: number;
  /** 是否生效中（starts_at 已到且未过 ends_at）：只有生效中的公告才推送与播报 */
  live: boolean;
  /** 是否已过结束时间（此时 live 为 false），用于区分 CLI 的提示文案 */
  ended: boolean;
  broadcast: ServerBroadcastCreated | null;
}

/** 修改字段：只改给出的键；null 表示清空（英文标题 / 正文、结束时间、站点） */
export interface AnnouncementPatch {
  category?: AnnouncementCategory;
  titleZh?: string;
  bodyZh?: string;
  titleEn?: string | null;
  bodyEn?: string | null;
  pinned?: boolean;
  strongRemind?: boolean;
  host?: string | null;
  startsAt?: Date;
  endsAt?: Date | null;
}

/** 发布：插入公告，生效则推送（并可选播报），全部在一个事务里 */
export async function publishAnnouncement(pool: pg.Pool, draft: AnnouncementDraft): Promise<PublishResult> {
  if (draft.chat && draft.host) {
    throw new Error('站点定向的公告不能同时全服播报（播报对两个站都可见）');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inserted = await client.query(
      `INSERT INTO announcements (category, title_zh, body_zh, title_en, body_en, pinned, strong_remind, host, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, published_at, (starts_at <= now()) AS started, (ends_at IS NOT NULL AND ends_at <= now()) AS ended`,
      [
        draft.category,
        draft.titleZh,
        draft.bodyZh,
        draft.titleEn,
        draft.bodyEn,
        draft.pinned,
        draft.strongRemind,
        draft.host,
        draft.startsAt,
        draft.endsAt,
      ],
    );
    const row = inserted.rows[0] as { id: string | number; published_at: Date; started: boolean; ended: boolean };
    const id = Number(row.id);
    // 与生效列表口径一致：已到生效时间且未过结束时间才推送
    const live = row.started && !row.ended;
    if (draft.chat && !row.started) {
      throw new Error('定时生效的公告不能即时播报（去掉 --chat，或把生效时间设为现在）');
    }
    if (draft.chat && row.ended) {
      throw new Error('已过结束时间的公告不能即时播报（去掉 --chat，或把结束时间往后调）');
    }
    let broadcast: ServerBroadcastCreated | null = null;
    if (live) {
      const push: PushAnnouncementData = {
        id,
        category: draft.category,
        titleZh: draft.titleZh,
        titleEn: draft.titleEn,
        pinned: draft.pinned,
        strongRemind: draft.strongRemind,
        publishedAt: row.published_at.toISOString(),
      };
      await notify(client, { reason: 'announcement', host: draft.host, announcement: push });
    }
    if (draft.chat) {
      // 运维主动发布：force 绕过全服每分钟限频，保证公告一定出现在播报里
      broadcast = await insertServerBroadcast(client, 'announcement', { announcementId: id, title: draft.titleZh }, { force: true });
      if (broadcast) {
        await notify(client, { reason: 'server_broadcast', broadcast });
      }
    }
    await client.query('COMMIT');
    return { id, live, ended: row.ended, broadcast };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 修改公告（不推送）：返回 false 表示公告不存在。已撤回的也可以改（改完仍是撤回状态） */
export async function updateAnnouncement(pool: pg.Pool, id: number, patch: AnnouncementPatch): Promise<boolean> {
  const columns: Array<[string, unknown]> = [];
  const add = (column: string, value: unknown) => columns.push([column, value]);
  if (patch.category !== undefined) add('category', patch.category);
  if (patch.titleZh !== undefined) add('title_zh', patch.titleZh);
  if (patch.bodyZh !== undefined) add('body_zh', patch.bodyZh);
  if (patch.titleEn !== undefined) add('title_en', patch.titleEn);
  if (patch.bodyEn !== undefined) add('body_en', patch.bodyEn);
  if (patch.pinned !== undefined) add('pinned', patch.pinned);
  if (patch.strongRemind !== undefined) add('strong_remind', patch.strongRemind);
  if (patch.host !== undefined) add('host', patch.host);
  if (patch.startsAt !== undefined) add('starts_at', patch.startsAt);
  if (patch.endsAt !== undefined) add('ends_at', patch.endsAt);
  if (columns.length === 0) {
    const exists = await pool.query(`SELECT 1 FROM announcements WHERE id = $1`, [id]);
    return exists.rowCount === 1;
  }
  const sets = columns.map(([column], index) => `${column} = $${index + 2}`).join(', ');
  const res = await pool.query(`UPDATE announcements SET ${sets} WHERE id = $1`, [id, ...columns.map(([, value]) => value)]);
  return res.rowCount === 1;
}

/** 撤回（软删除）：立即从玩家列表与推送中消失，记录保留。返回 false 表示不存在或已撤回 */
export async function withdrawAnnouncement(pool: pg.Pool, id: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE announcements SET status = 'withdrawn' WHERE id = $1 AND status = 'published'`,
    [id],
  );
  return res.rowCount === 1;
}

/** 运维列表：默认只列未撤回的（含未开始与已过期），按发布时间倒序 */
export async function listAnnouncementsForOps(pool: pg.Pool, options: { all: boolean }): Promise<OpsAnnouncementRow[]> {
  const res = await pool.query(
    `SELECT id, category, title_zh, pinned, strong_remind, host, status, starts_at, ends_at, published_at,
       (starts_at <= now()) AS started, (ends_at IS NOT NULL AND ends_at <= now()) AS ended
     FROM announcements
     WHERE $1 OR status = 'published'
     ORDER BY published_at DESC, id DESC
     LIMIT 100`,
    [options.all],
  );
  return (res.rows as Array<Record<string, unknown>>).map((row) => ({
    id: Number(row.id),
    category: row.category as AnnouncementCategory,
    titleZh: row.title_zh as string,
    pinned: row.pinned as boolean,
    strongRemind: row.strong_remind as boolean,
    host: row.host as string | null,
    status: row.status as 'published' | 'withdrawn',
    startsAt: (row.starts_at as Date).toISOString(),
    endsAt: row.ends_at ? (row.ends_at as Date).toISOString() : null,
    publishedAt: (row.published_at as Date).toISOString(),
    started: row.started as boolean,
    ended: row.ended as boolean,
  }));
}

export interface OpsAnnouncementRow {
  id: number;
  category: AnnouncementCategory;
  titleZh: string;
  pinned: boolean;
  strongRemind: boolean;
  host: string | null;
  status: 'published' | 'withdrawn';
  startsAt: string;
  endsAt: string | null;
  publishedAt: string;
  started: boolean;
  ended: boolean;
}

/** 经 pg_notify 发给 API（与 Worker 的全服播报同一通道；调用方事务内） */
async function notify(client: pg.PoolClient, payload: Record<string, unknown>): Promise<void> {
  await client.query(`SELECT pg_notify($1, $2)`, [NOTIFY_CHANNEL, JSON.stringify(payload)]);
}
