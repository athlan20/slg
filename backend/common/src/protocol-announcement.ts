// 公告协议的载荷类型与常量（v60，AISLG-162）：运营公告的列表 / 详情 / 标记已读，以及新公告推送。
// 公告由运维脚本发布（backend/scripts/announcement.ts），没有后台页面。玩家与 Agent 通用。
// 从 protocol.ts 拆出以控制单文件行数；protocol.ts 再导出，前端镜像 frontend/src/api/protocol-announcement.ts 与之同构。

/** 分类：system 系统公告（版本 / 维护 / 规则 / 数值）；event 活动与推广公告 */
export const ANNOUNCEMENT_CATEGORIES = ['system', 'event'] as const;
export type AnnouncementCategory = (typeof ANNOUNCEMENT_CATEGORIES)[number];

/** 语言：zh 中文（必填）；en 英文（选填，没填时回落到中文） */
export const ANNOUNCEMENT_LANGS = ['zh', 'en'] as const;
export type AnnouncementLang = (typeof ANNOUNCEMENT_LANGS)[number];

/** 标题上限（按字形计，一个表情算 1 个字） */
export const ANNOUNCEMENT_TITLE_MAX_CHARS = 30;
/** 正文上限（过滤后按字符计） */
export const ANNOUNCEMENT_BODY_MAX_CHARS = 4000;

/** 公告列表视图：不含正文，正文走 GET_ANNOUNCEMENT */
export interface AnnouncementView {
  id: number;
  category: AnnouncementCategory;
  /** 按请求的 lang 取标题（英文未填则为中文） */
  title: string;
  /** 置顶：列表中排在最前 */
  pinned: boolean;
  /** 强提醒：玩家进主界面时弹窗，点「知道了」才算已读（默认 false，只亮红点） */
  strongRemind: boolean;
  /** 本账号是否已读 */
  read: boolean;
  /** 已过结束时间（只在 history 列表里出现） */
  expired: boolean;
  publishedAt: string;
  startsAt: string;
  /** null = 不过期 */
  endsAt: string | null;
}

/** 公告详情视图：正文为受限 Markdown 子集（分段、**加粗**、[文字](https 链接)），已过滤 */
export interface AnnouncementDetailView extends AnnouncementView {
  body: string;
}

/**
 * GET_ANNOUNCEMENTS（op 96）请求。
 * 默认返回生效中的公告（置顶在前，其余按发布时间倒序，不分页）；history=true 改为返回已过期的往期公告（按发布时间倒序，
 * 用 beforeId 翻页）。limit 1..50，缺省 20。
 */
export interface GetAnnouncementsRequestData {
  lang?: AnnouncementLang;
  history?: boolean;
  limit?: number;
  beforeId?: number;
}

/** GET_ANNOUNCEMENTS 响应：unreadCount 为生效中且未读的公告数（红点用，不受 limit 影响） */
export interface GetAnnouncementsResponseData {
  announcements: AnnouncementView[];
  unreadCount: number;
}

/** GET_ANNOUNCEMENT（op 97）请求：只能读本站可见的公告（含往期；已撤回与未开始的返回 ANNOUNCEMENT_NOT_FOUND） */
export interface GetAnnouncementRequestData {
  id: number;
  lang?: AnnouncementLang;
}

export interface GetAnnouncementResponseData {
  announcement: AnnouncementDetailView;
}

/** READ_ANNOUNCEMENT（op 98）请求：标记已读（幂等）。客户端打开正文或点「知道了」时调用 */
export interface ReadAnnouncementRequestData {
  id: number;
}

export interface ReadAnnouncementResponseData {
  id: number;
  unreadCount: number;
}

/**
 * PUSH_ANNOUNCEMENT（op 2022）推送载荷：新公告发布。只带标题与分类，不带正文；
 * 站点定向的公告只推给对应站点的连接（Agent 连接同样收到）。定时生效（starts_at 在将来）的公告不推送，
 * 玩家在下次拉取列表时看到。
 */
export interface PushAnnouncementData {
  id: number;
  category: AnnouncementCategory;
  titleZh: string;
  titleEn: string | null;
  pinned: boolean;
  strongRemind: boolean;
  publishedAt: string;
}
