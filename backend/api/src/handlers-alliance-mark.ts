// 联盟地图标记的协议处理（v69，AISLG-184）：放置、删除、查询。
// 与管理类不同，这三条对 Agent 开放：放置与查询玩家 / Agent 通用；删除对 Agent 只限自己打的（Agent 的「自己」就是账号本人），
// 盟主 / 副盟主删别人的只对玩家连接开放（conn.role 是连接自报的标记，与其他「仅玩家」协议一致）。
// 加锁顺序同管理类：操作者账号行 → 联盟行。同一联盟的放置 / 删除因此串行，「同格不重复」与「20 个上限」不会被并发绕过。

import { Op } from '../../common/src/protocol';
import {
  ALLIANCE_MARK_KINDS,
  ALLIANCE_MARK_MAX,
  ALLIANCE_MARK_TEXT_MAX_CHARS,
  ALLIANCE_MARK_TTL_MS,
  type AllianceMarkKind,
  type PushAllianceMarkData,
} from '../../common/src/protocol-alliance';
import {
  getMembership,
  loadMark,
  loadMarks,
  lockAlliance,
  recordAllianceEvent,
} from '../../common/src/alliance-db';
import { inWorld } from '../../common/src/world';
import type { ConnInfo } from './connections';
import { respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { bannedWordFilter } from './chat-words';
import { chatLength } from './chat-validate';
import { fail, lockAccount, memberIds, runTx, type Outcome } from './handlers-alliance-manage';

/** 联盟标记协议号集合（handlers.ts 的分发表据此路由） */
export const ALLIANCE_MARK_OPS: ReadonlySet<number> = new Set<number>([
  Op.ALLIANCE_MARK_ADD,
  Op.ALLIANCE_MARK_REMOVE,
  Op.GET_ALLIANCE_MARKS,
]);

export async function handleAllianceMarkOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  switch (op) {
    case Op.GET_ALLIANCE_MARKS:
      await handleGetMarks(ctx, conn, op, seq);
      return;
    case Op.ALLIANCE_MARK_ADD:
      await handleMarkAdd(ctx, conn, op, seq, data);
      return;
    case Op.ALLIANCE_MARK_REMOVE:
      await handleMarkRemove(ctx, conn, op, seq, data);
      return;
    default:
      respondError(ctx.registry, conn, op, seq, 'UNKNOWN_OP');
  }
}

/** 标记类型：不在四种之内返回 null */
function readMarkKind(value: unknown): AllianceMarkKind | null {
  return (ALLIANCE_MARK_KINDS as readonly unknown[]).includes(value) ? (value as AllianceMarkKind) : null;
}

/**
 * 附言：缺省或空白为空串；超过 20 字、不是字符串、或含屏蔽词返回 null（整条拒绝，不替换）。
 * 与联盟名不同，这里用屏蔽词判断是否拒绝：验收要求含屏蔽词的标记被拒绝。
 */
function readMarkText(value: unknown): string | null {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value !== 'string') {
    return null;
  }
  const text = value.trim();
  if (chatLength(text) > ALLIANCE_MARK_TEXT_MAX_CHARS) {
    return null;
  }
  if (bannedWordFilter().mask(text) !== text) {
    return null;
  }
  return text;
}

/** 把标记变化推给相关账号的全部在线连接（含 Agent，与 PUSH_ALLIANCE_STATE 同口径） */
function pushMark(ctx: HandlerContext, accountIds: readonly string[], data: PushAllianceMarkData): void {
  for (const id of new Set(accountIds)) {
    ctx.registry.broadcast(id, { op: Op.PUSH_ALLIANCE_MARK, push: true, data: { ...data } });
  }
}

/** 删除的权限：删自己打的一律可以；删别人的只有玩家连接上的盟主 / 副盟主可以 */
function canRemoveAnyMark(conn: ConnInfo, role: string): boolean {
  return conn.role === 'player' && (role === 'leader' || role === 'vice');
}

async function handleGetMarks(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const me = conn.accountId as string;
  const mine = await getMembership(ctx.pool, me);
  if (!mine) {
    respondError(ctx.registry, conn, op, seq, 'ALLIANCE_NOT_IN');
    return;
  }
  const marks = await loadMarks(ctx.pool, mine.allianceId);
  respondOk(ctx.registry, conn, op, seq, { marks, canRemoveAny: canRemoveAnyMark(conn, mine.role) });
}

async function handleMarkAdd(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const x = data?.x;
  const y = data?.y;
  const kind = readMarkKind(data?.kind);
  const text = readMarkText(data?.text);
  if (!Number.isInteger(x) || !Number.isInteger(y) || !inWorld(x as number, y as number) || kind === null || text === null) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const cellX = x as number;
  const cellY = y as number;
  await runTx(ctx, conn, op, seq, async (client): Promise<Outcome> => {
    await lockAccount(client, me);
    const mine = await getMembership(client, me);
    if (!mine) {
      return fail('ALLIANCE_NOT_IN');
    }
    await lockAlliance(client, mine.allianceId);
    // 过期的先回收：否则它还占着同一格子（唯一约束）和名额
    await client.query(`DELETE FROM alliance_marks WHERE alliance_id = $1 AND expires_at <= now()`, [mine.allianceId]);
    const dup = await client.query(`SELECT 1 FROM alliance_marks WHERE alliance_id = $1 AND x = $2 AND y = $3`, [
      mine.allianceId,
      cellX,
      cellY,
    ]);
    if (dup.rowCount) {
      return fail('ALLIANCE_MARK_EXISTS');
    }
    const count = await client.query(
      `SELECT count(*)::int AS n, min(expires_at) AS earliest FROM alliance_marks WHERE alliance_id = $1`,
      [mine.allianceId],
    );
    const { n, earliest } = count.rows[0] as { n: number; earliest: Date | null };
    if (n >= ALLIANCE_MARK_MAX && earliest) {
      // 最早一个到期后就有名额；附上它的到期时刻让客户端提示
      return fail('ALLIANCE_MARK_LIMIT', {
        limit: ALLIANCE_MARK_MAX,
        until: earliest.toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((earliest.getTime() - Date.now()) / 1000)),
      });
    }
    const ins = await client.query(
      `INSERT INTO alliance_marks (alliance_id, x, y, kind, text, creator_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, now() + ($7::bigint * interval '1 millisecond'))
       RETURNING id`,
      [mine.allianceId, cellX, cellY, kind, text, me, ALLIANCE_MARK_TTL_MS],
    );
    const markId = Number((ins.rows[0] as { id: string | number }).id);
    const mark = await loadMark(client, mine.allianceId, markId);
    if (!mark) {
      throw new Error(`alliance mark ${markId} vanished right after insert`);
    }
    // 联盟频道的系统消息（与标记同生同灭，提交后由 notify 推给本联盟在线成员）
    await recordAllianceEvent(client, mine.allianceId, 'mark_created', { accountId: me, markKind: kind, x: cellX, y: cellY });
    const members = await memberIds(client, mine.allianceId);
    return {
      ok: true,
      data: { mark },
      after: () => pushMark(ctx, members, { reason: 'added', allianceId: mine.allianceId, markId, mark }),
    };
  });
}

async function handleMarkRemove(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const markId = data?.id;
  if (!Number.isInteger(markId) || (markId as number) < 1) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const id = markId as number;
  await runTx(ctx, conn, op, seq, async (client): Promise<Outcome> => {
    await lockAccount(client, me);
    const first = await getMembership(client, me);
    if (!first) {
      return fail('ALLIANCE_NOT_IN');
    }
    await lockAlliance(client, first.allianceId);
    const mine = await getMembership(client, me);
    if (!mine) {
      return fail('ALLIANCE_NOT_IN');
    }
    // 别的联盟的标记、过期的标记一律当作不存在，不泄露其存在与否
    const row = await client.query(
      `SELECT creator_id FROM alliance_marks WHERE alliance_id = $1 AND id = $2 AND expires_at > now()`,
      [mine.allianceId, id],
    );
    if (!row.rowCount) {
      return fail('ALLIANCE_NOT_FOUND');
    }
    const creatorId = (row.rows[0] as { creator_id: string }).creator_id;
    if (creatorId !== me && !canRemoveAnyMark(conn, mine.role)) {
      return fail('ALLIANCE_FORBIDDEN');
    }
    await client.query(`DELETE FROM alliance_marks WHERE id = $1`, [id]);
    const members = await memberIds(client, mine.allianceId);
    return {
      ok: true,
      data: { id },
      after: () => pushMark(ctx, members, { reason: 'removed', allianceId: mine.allianceId, markId: id, mark: null }),
    };
  });
}
