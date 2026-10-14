// 公告协议的类型镜像（v60，AISLG-162）。唯一事实来源是 backend/common/src/protocol-announcement.ts；
// protocol.ts 原名再导出。协议调整时以后端为准同步本文件。

export const ANNOUNCEMENT_CATEGORIES = ['system', 'event'] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

export const ANNOUNCEMENT_LANGS = ['zh', 'en'] as const;
export type AnnouncementLang = (typeof ANNOUNCEMENT_LANGS)[number];

/** 公告列表视图（不含正文） */
export interface AnnouncementView {
  id: number;
  category: AnnouncementCategory;
  title: string;
  pinned: boolean;
  strongRemind: boolean;
  read: boolean;
  expired: boolean;
  publishedAt: string;
  startsAt: string;
  endsAt: string | null;
}

/** 公告详情：正文为受限 Markdown 子集（分段、**加粗**、https 链接），服务端已过滤 */
export interface AnnouncementDetailView extends AnnouncementView {
  body: string;
}

export interface GetAnnouncementsRequestData {
  lang?: AnnouncementLang;
  history?: boolean;
  limit?: number;
  beforeId?: number;
}

export interface GetAnnouncementsResponseData {
  announcements: AnnouncementView[];
  unreadCount: number;
}

export interface GetAnnouncementRequestData {
  id: number;
  lang?: AnnouncementLang;
}

export interface GetAnnouncementResponseData {
  announcement: AnnouncementDetailView;
}

export interface ReadAnnouncementRequestData {
  id: number;
}

export interface ReadAnnouncementResponseData {
  id: number;
  unreadCount: number;
}

/** PUSH_ANNOUNCEMENT（op 2022）推送载荷：只带标题与分类，不带正文 */
export interface PushAnnouncementData {
  id: number;
  category: AnnouncementCategory;
  titleZh: string;
  titleEn: string | null;
  pinned: boolean;
  strongRemind: boolean;
  publishedAt: string;
}
