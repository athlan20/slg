// 公告正文的过滤（v60，AISLG-162）：只保留受限 Markdown 子集——分段、**加粗**、[文字](https 链接）。
// 图片、HTML 标签、脚本与非 http(s) 链接一律去掉（链接只留文字）。发布时过滤一次写库，下发时再过滤一次，
// 两处共用本文件。前端按同一子集用 React 元素渲染，不走 innerHTML。

import { ANNOUNCEMENT_BODY_MAX_CHARS, ANNOUNCEMENT_TITLE_MAX_CHARS } from './protocol-announcement';

/** 过滤后的正文：段落之间以空行分隔，段内换行保留；空串表示没有可显示的内容 */
export function sanitizeAnnouncementBody(raw: string): string {
  const text = raw
    .replace(/\r\n?/g, '\n')
    // 控制字符（保留换行与制表）
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    // 图片整体去掉
    .replace(/!\[[^\]\n]*\]\((?:[^()\n]|\([^()\n]*\))*\)/g, '')
    // HTML 标签（含 <script>）整体去掉
    .replace(/<[^>\n]*>/g, '')
    // 链接：只保留 http(s)，其余保留文字
    .replace(/\[([^\]\n]+)\]\(((?:[^()\s]|\([^()\s]*\))*)\)/g, (_match, label: string, url: string) =>
      isSafeLinkUrl(url) ? `[${label}](${url})` : label,
    )
    // 标题符号降为普通段落
    .replace(/^#{1,6}[ \t]+/gm, '');
  return text
    .split(/\n[ \t]*\n/)
    .map((paragraph) => paragraph.split('\n').map((line) => line.trim()).filter((line) => line.length > 0).join('\n'))
    .filter((paragraph) => paragraph.length > 0)
    .join('\n\n');
}

/** 只允许 http / https 链接（大小写不敏感），且不含空白 */
export function isSafeLinkUrl(url: string): boolean {
  return /^https?:\/\/[^\s<>"']+$/i.test(url);
}

/** 文本长度按字形计（一个表情算 1 个字） */
export function announcementTextLength(text: string): number {
  return [...text].length;
}

/** 标题校验：去首尾空白后非空且不超过上限；返回去空白后的标题，不合法返回 null */
export function normalizeAnnouncementTitle(raw: string): string | null {
  const title = raw.trim();
  if (title.length === 0 || announcementTextLength(title) > ANNOUNCEMENT_TITLE_MAX_CHARS) {
    return null;
  }
  return title;
}

/** 正文校验：过滤后非空且不超过上限；返回过滤后的正文，不合法返回 null */
export function normalizeAnnouncementBody(raw: string): string | null {
  const body = sanitizeAnnouncementBody(raw);
  if (body.length === 0 || announcementTextLength(body) > ANNOUNCEMENT_BODY_MAX_CHARS) {
    return null;
  }
  return body;
}
