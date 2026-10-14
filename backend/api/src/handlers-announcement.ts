// 公告协议的处理（v60，AISLG-162）：GET_ANNOUNCEMENTS / GET_ANNOUNCEMENT / READ_ANNOUNCEMENT。
// 玩家与 Agent 同一套规则；可见性（已发布、已生效、站点匹配）与语言回落见 common/src/announcement-db.ts。
// 推送 PUSH_ANNOUNCEMENT 由 notify.ts 收到 pg_notify 后扇出，本文件不负责推送。

import { Op, type AnnouncementLang } from '../../common/src/protocol';
import {
  countUnreadAnnouncements,
  listAnnouncements,
  loadAnnouncementDetail,
  markAnnouncementRead,
  type AnnouncementScope,
} from '../../common/src/announcement-db';
import type { ConnInfo } from './connections';
import type { HandlerContext } from './handlers';
import { readIntInRange, respondError, respondOk } from './frames';

const MAX_ID = Number.MAX_SAFE_INTEGER;

export async function handleAnnouncementOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const scope: AnnouncementScope = {
    accountId: conn.accountId as string,
    host: conn.host,
    lang: readLang(data),
  };
  switch (op) {
    case Op.GET_ANNOUNCEMENTS: {
      const history = data?.history === true;
      const limit = readIntInRange(data, 'limit', 1, 50, 20);
      const beforeId = readIntInRange(data, 'beforeId', 1, MAX_ID, 0);
      const announcements = await listAnnouncements(ctx.pool, scope, {
        history,
        limit,
        beforeId: beforeId > 0 ? beforeId : undefined,
      });
      const unreadCount = await countUnreadAnnouncements(ctx.pool, scope);
      respondOk(ctx.registry, conn, op, seq, { announcements, unreadCount });
      return;
    }
    case Op.GET_ANNOUNCEMENT: {
      const id = readIntInRange(data, 'id', 1, MAX_ID, 0);
      if (id === 0) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        return;
      }
      const announcement = await loadAnnouncementDetail(ctx.pool, scope, id);
      if (!announcement) {
        respondError(ctx.registry, conn, op, seq, 'ANNOUNCEMENT_NOT_FOUND');
        return;
      }
      respondOk(ctx.registry, conn, op, seq, { announcement });
      return;
    }
    case Op.READ_ANNOUNCEMENT: {
      const id = readIntInRange(data, 'id', 1, MAX_ID, 0);
      if (id === 0) {
        respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
        return;
      }
      const visible = await markAnnouncementRead(ctx.pool, scope, id);
      if (!visible) {
        respondError(ctx.registry, conn, op, seq, 'ANNOUNCEMENT_NOT_FOUND');
        return;
      }
      const unreadCount = await countUnreadAnnouncements(ctx.pool, scope);
      respondOk(ctx.registry, conn, op, seq, { id, unreadCount });
      return;
    }
    default:
      respondError(ctx.registry, conn, op, seq, 'UNKNOWN_OP');
  }
}

/** 语言：只认 en，其余（含缺省）一律中文 */
function readLang(data: Record<string, unknown> | undefined): AnnouncementLang {
  return data?.lang === 'en' ? 'en' : 'zh';
}
