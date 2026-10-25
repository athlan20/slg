// 联盟协议的分发与查询类处理（v66，AISLG-181）。
// GET_ALLIANCE / LIST_ALLIANCES 玩家与 Agent 通用；创建与管理类（建盟、申请、邀请、答复、退出、解散、踢人、
// 任免、公告）仅限玩家连接，Agent 一律 AGENT_FORBIDDEN。管理类的实现在 handlers-alliance-manage.ts。

import type pg from 'pg';
import { Op } from '../../common/src/protocol';
import {
  loadBriefs,
  loadDetail,
  listAlliances,
  activeCooldown,
  getMembership,
  governmentLevelOf,
} from '../../common/src/alliance-db';
import type {
  AllianceReceivedInviteView,
  AllianceRequestView,
  AllianceSentInviteView,
  GetAllianceResponseData,
} from '../../common/src/protocol-alliance';
import type { ConnInfo } from './connections';
import { readIntInRange, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { isUuid } from './chat-validate';
import {
  handleAllianceApply,
  handleAllianceCreate,
  handleAllianceDisband,
  handleAllianceInvite,
  handleAllianceKick,
  handleAllianceLeave,
  handleAllianceRespond,
  handleAllianceSetNotice,
  handleAllianceSetRole,
} from './handlers-alliance-manage';

/** 联盟协议号集合（handlers.ts 的分发表据此路由） */
export const ALLIANCE_OPS: ReadonlySet<number> = new Set<number>([
  Op.CREATE_ALLIANCE,
  Op.GET_ALLIANCE,
  Op.LIST_ALLIANCES,
  Op.ALLIANCE_APPLY,
  Op.ALLIANCE_INVITE,
  Op.ALLIANCE_RESPOND,
  Op.ALLIANCE_LEAVE,
  Op.ALLIANCE_DISBAND,
  Op.ALLIANCE_KICK,
  Op.ALLIANCE_SET_ROLE,
  Op.ALLIANCE_SET_NOTICE,
]);

/** 查询类协议：玩家与 Agent 通用；其余管理类仅限玩家 */
const QUERY_OPS: ReadonlySet<number> = new Set<number>([Op.GET_ALLIANCE, Op.LIST_ALLIANCES]);

/** 此刻有玩家连接在线的账号（成员列表的 online 标记） */
function onlinePlayerIds(ctx: HandlerContext): Set<string> {
  const online = new Set<string>();
  for (const id of ctx.registry.onlineAccountIds()) {
    if (ctx.registry.connectionsOf(id).some((c) => c.role === 'player')) {
      online.add(id);
    }
  }
  return online;
}

export async function handleAllianceOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  // 角色是连接自报的标记：拦住诚实声明的 Agent，不构成可验证的安全边界（与聊天等「仅玩家」协议一致）
  if (!QUERY_OPS.has(op) && conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  switch (op) {
    case Op.GET_ALLIANCE:
      await handleGetAlliance(ctx, conn, op, seq, data);
      return;
    case Op.LIST_ALLIANCES:
      await handleListAlliances(ctx, conn, op, seq, data);
      return;
    case Op.CREATE_ALLIANCE:
      await handleAllianceCreate(ctx, conn, op, seq, data);
      return;
    case Op.ALLIANCE_APPLY:
      await handleAllianceApply(ctx, conn, op, seq, data);
      return;
    case Op.ALLIANCE_INVITE:
      await handleAllianceInvite(ctx, conn, op, seq, data);
      return;
    case Op.ALLIANCE_RESPOND:
      await handleAllianceRespond(ctx, conn, op, seq, data);
      return;
    case Op.ALLIANCE_LEAVE:
      await handleAllianceLeave(ctx, conn, op, seq);
      return;
    case Op.ALLIANCE_DISBAND:
      await handleAllianceDisband(ctx, conn, op, seq);
      return;
    case Op.ALLIANCE_KICK:
      await handleAllianceKick(ctx, conn, op, seq, data);
      return;
    case Op.ALLIANCE_SET_ROLE:
      await handleAllianceSetRole(ctx, conn, op, seq, data);
      return;
    case Op.ALLIANCE_SET_NOTICE:
      await handleAllianceSetNotice(ctx, conn, op, seq, data);
      return;
    default:
      respondError(ctx.registry, conn, op, seq, 'UNKNOWN_OP');
  }
}

/** 我的联盟视图（含我的申请 / 邀请，盟主与副盟主另带待审批申请与已发邀请）。创建成功等路径复用 */
export async function buildMyAllianceView(ctx: HandlerContext, q: pg.Pool | pg.PoolClient, accountId: string): Promise<GetAllianceResponseData> {
  const membership = await getMembership(q, accountId);
  const cooldown = await activeCooldown(q, accountId);
  const alliance = membership ? await loadDetail(q, membership.allianceId, onlinePlayerIds(ctx)) : null;

  const reqRes = await q.query(
    `SELECT alliance_id, created_at, expires_at FROM alliance_requests WHERE account_id = $1 AND expires_at > now()`,
    [accountId],
  );
  const inviteRes = await q.query(
    `SELECT i.alliance_id, i.inviter_id, ia.username AS inviter_name, i.created_at, i.expires_at
     FROM alliance_invites i JOIN accounts ia ON ia.id = i.inviter_id
     WHERE i.account_id = $1 AND i.expires_at > now() ORDER BY i.created_at DESC`,
    [accountId],
  );
  const invitedIds = (inviteRes.rows as Array<{ alliance_id: string }>).map((r) => r.alliance_id);
  const requestRow = reqRes.rows[0] as { alliance_id: string; created_at: Date; expires_at: Date } | undefined;
  const briefs = await loadBriefs(q, requestRow ? [...invitedIds, requestRow.alliance_id] : invitedIds);

  const myInvites: AllianceReceivedInviteView[] = [];
  for (const row of inviteRes.rows as Array<{
    alliance_id: string; inviter_id: string; inviter_name: string; created_at: Date; expires_at: Date;
  }>) {
    const brief = briefs.get(row.alliance_id);
    if (brief) {
      myInvites.push({
        alliance: brief,
        inviter: { accountId: row.inviter_id, username: row.inviter_name },
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      });
    }
  }
  const requestBrief = requestRow ? briefs.get(requestRow.alliance_id) : undefined;
  const myRequest =
    requestRow && requestBrief
      ? { alliance: requestBrief, createdAt: requestRow.created_at.toISOString(), expiresAt: requestRow.expires_at.toISOString() }
      : null;

  let requests: AllianceRequestView[] = [];
  let sentInvites: AllianceSentInviteView[] = [];
  if (membership && membership.role !== 'member') {
    const rr = await q.query(
      `SELECT r.account_id, a.username, r.created_at, r.expires_at
       FROM alliance_requests r JOIN accounts a ON a.id = r.account_id
       WHERE r.alliance_id = $1 AND r.expires_at > now() ORDER BY r.created_at`,
      [membership.allianceId],
    );
    requests = await Promise.all(
      (rr.rows as Array<{ account_id: string; username: string; created_at: Date; expires_at: Date }>).map(async (row) => ({
        accountId: row.account_id,
        username: row.username,
        governmentLevel: await governmentLevelOf(q, row.account_id),
        createdAt: row.created_at.toISOString(),
        expiresAt: row.expires_at.toISOString(),
      })),
    );
    const sr = await q.query(
      `SELECT i.account_id, ta.username, i.inviter_id, ia.username AS inviter_name, i.created_at, i.expires_at
       FROM alliance_invites i JOIN accounts ta ON ta.id = i.account_id JOIN accounts ia ON ia.id = i.inviter_id
       WHERE i.alliance_id = $1 AND i.expires_at > now() ORDER BY i.created_at`,
      [membership.allianceId],
    );
    sentInvites = (sr.rows as Array<{
      account_id: string; username: string; inviter_id: string; inviter_name: string; created_at: Date; expires_at: Date;
    }>).map((row) => ({
      accountId: row.account_id,
      username: row.username,
      inviter: { accountId: row.inviter_id, username: row.inviter_name },
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    }));
  }
  return {
    alliance,
    myRole: membership ? membership.role : null,
    cooldownUntil: cooldown ? cooldown.toISOString() : null,
    myRequest,
    myInvites,
    requests,
    sentInvites,
  };
}

async function handleGetAlliance(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const rawId = data?.allianceId;
  if (rawId === undefined || rawId === null) {
    respondOk(ctx.registry, conn, op, seq, { ...(await buildMyAllianceView(ctx, ctx.pool, me)) });
    return;
  }
  if (!isUuid(rawId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const alliance = await loadDetail(ctx.pool, rawId, onlinePlayerIds(ctx));
  if (!alliance) {
    respondError(ctx.registry, conn, op, seq, 'ALLIANCE_NOT_FOUND');
    return;
  }
  const empty: GetAllianceResponseData = {
    alliance,
    myRole: null,
    cooldownUntil: null,
    myRequest: null,
    myInvites: [],
    requests: [],
    sentInvites: [],
  };
  respondOk(ctx.registry, conn, op, seq, { ...empty });
}

async function handleListAlliances(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const page = readIntInRange(data, 'page', 1, 100000, 1);
  const { alliances, total } = await listAlliances(ctx.pool, page);
  respondOk(ctx.registry, conn, op, seq, { alliances, page, total });
}
