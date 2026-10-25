// 联盟的创建与管理类处理（v66，AISLG-181，仅玩家连接，由 handlers-alliance.ts 把关并分发）。
// 事务内加锁顺序固定为「操作者账号行 → 联盟行」：同一账号的操作串行，同一联盟的加入 / 踢人 / 转让 / 解散串行。
// 并发下两条路径同时把同一账号加进不同联盟，由 alliance_members 主键兜底，映射成 ALLIANCE_ALREADY_IN。

import type pg from 'pg';
import { Op, type ErrorCode } from '../../common/src/protocol';
import {
  ALLIANCE_CREATE_COST_GOLD,
  ALLIANCE_CREATE_MIN_GOVERNMENT,
  ALLIANCE_INVITE_TTL_MS,
  ALLIANCE_MAX_MEMBERS,
  ALLIANCE_MAX_VICES,
  ALLIANCE_NAME_MAX_CHARS,
  ALLIANCE_NAME_MIN_CHARS,
  ALLIANCE_NOTICE_MAX_CHARS,
  ALLIANCE_REQUEST_TTL_MS,
  type AlliancePushReason,
  type AllianceRole,
  type PushAllianceStateData,
} from '../../common/src/protocol-alliance';
import {
  activeCooldown,
  addMember,
  disbandAlliance,
  getMembership,
  governmentLevelOf,
  lockAlliance,
  recordAllianceEvent,
  removeMember,
  setCooldown,
  slotsUsed,
  transferLeader,
  viceCount,
} from '../../common/src/alliance-db';
import type { ConnInfo } from './connections';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import { bannedWordFilter } from './chat-words';
import { chatLength, isUuid } from './chat-validate';
import { lockCitySnapshot } from './views';

export type Outcome =
  | { ok: true; data?: Record<string, unknown>; after?: () => void }
  | { ok: false; code: ErrorCode; data?: Record<string, unknown> };

export const fail = (code: ErrorCode, data?: Record<string, unknown>): Outcome => ({ ok: false, code, data });

/** 事务封装：fn 返回 ok 则提交，否则回滚；pg 唯一约束冲突映射成对应错误码；提交后才执行 after（推送等） */
export async function runTx(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  fn: (client: pg.PoolClient) => Promise<Outcome>,
): Promise<void> {
  const client = await ctx.pool.connect();
  let outcome: Outcome;
  try {
    await client.query('BEGIN');
    outcome = await fn(client);
    await client.query(outcome.ok ? 'COMMIT' : 'ROLLBACK');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    const constraint = (err as { constraint?: string }).constraint;
    if ((err as { code?: string }).code === '23505' && constraint === 'idx_alliances_name') {
      outcome = fail('ALLIANCE_NAME_TAKEN');
    } else if ((err as { code?: string }).code === '23505' && constraint === 'alliance_members_pkey') {
      outcome = fail('ALLIANCE_ALREADY_IN');
    } else if ((err as { code?: string }).code === '23505' && constraint === 'alliance_marks_cell_key') {
      outcome = fail('ALLIANCE_MARK_EXISTS');
    } else {
      throw err;
    }
  } finally {
    client.release();
  }
  if (!outcome.ok) {
    respondError(ctx.registry, conn, op, seq, outcome.code, outcome.data);
    return;
  }
  respondOk(ctx.registry, conn, op, seq, outcome.data ?? {});
  outcome.after?.();
}

/** 锁住操作者账号行（串行化同一账号的联盟操作） */
export async function lockAccount(client: pg.PoolClient, accountId: string): Promise<void> {
  await client.query(`SELECT 1 FROM accounts WHERE id = $1 FOR UPDATE`, [accountId]);
}

/** 推送联盟状态变化（相关账号的全部在线连接）；收到后客户端重新 GET_ALLIANCE */
function pushState(
  ctx: HandlerContext,
  accountIds: readonly string[],
  reason: AlliancePushReason,
  alliance: { id: string; name: string } | null,
): void {
  const data: PushAllianceStateData = { reason, allianceId: alliance?.id ?? null, allianceName: alliance?.name ?? null };
  for (const id of new Set(accountIds)) {
    ctx.registry.broadcast(id, { op: Op.PUSH_ALLIANCE_STATE, push: true, data: { ...data } });
  }
}

export async function memberIds(q: pg.PoolClient, allianceId: string): Promise<string[]> {
  const res = await q.query(`SELECT account_id FROM alliance_members WHERE alliance_id = $1`, [allianceId]);
  return (res.rows as Array<{ account_id: string }>).map((r) => r.account_id);
}

async function managerIds(q: pg.PoolClient, allianceId: string): Promise<string[]> {
  const res = await q.query(
    `SELECT account_id FROM alliance_members WHERE alliance_id = $1 AND role IN ('leader', 'vice')`,
    [allianceId],
  );
  return (res.rows as Array<{ account_id: string }>).map((r) => r.account_id);
}

async function allianceName(q: pg.PoolClient, allianceId: string): Promise<string> {
  const res = await q.query(`SELECT name FROM alliances WHERE id = $1`, [allianceId]);
  return (res.rows[0] as { name: string }).name;
}

function cooldownFail(until: Date): Outcome {
  return fail('ALLIANCE_COOLDOWN', {
    until: until.toISOString(),
    retryAfterSeconds: Math.max(1, Math.ceil((until.getTime() - Date.now()) / 1000)),
  });
}

/** 联盟名：去首尾空白后 2–8 字，不含空白 / 控制字符，不含屏蔽词；不合法返回 null */
export function normalizeAllianceName(raw: string): string | null {
  const name = raw.trim();
  const len = chatLength(name);
  if (len < ALLIANCE_NAME_MIN_CHARS || len > ALLIANCE_NAME_MAX_CHARS || /[\s\p{C}]/u.test(name)) {
    return null;
  }
  if (bannedWordFilter().mask(name) !== name) {
    return null;
  }
  return name;
}

export async function handleAllianceCreate(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const rawName = readString(data, 'name');
  const name = rawName === null ? null : normalizeAllianceName(rawName);
  if (name === null) {
    respondError(ctx.registry, conn, op, seq, 'ALLIANCE_NAME_INVALID');
    return;
  }
  await runTx(ctx, conn, op, seq, async (client) => {
    await lockAccount(client, me);
    if (await getMembership(client, me)) {
      return fail('ALLIANCE_ALREADY_IN');
    }
    const until = await activeCooldown(client, me);
    if (until) {
      return cooldownFail(until);
    }
    const government = await governmentLevelOf(client, me);
    if (government < ALLIANCE_CREATE_MIN_GOVERNMENT) {
      return fail('ALLIANCE_GOVERNMENT_TOO_LOW', { required: ALLIANCE_CREATE_MIN_GOVERNMENT, current: government });
    }
    const taken = await client.query(`SELECT 1 FROM alliances WHERE lower(name) = lower($1)`, [name]);
    if (taken.rowCount) {
      return fail('ALLIANCE_NAME_TAKEN');
    }
    // 从主城扣金币（先结算产量；金币不够则整体回滚）
    const snap = await lockCitySnapshot(client, me);
    if (!snap || snap.resources.gold < ALLIANCE_CREATE_COST_GOLD) {
      return fail('INSUFFICIENT_RESOURCES', { required: ALLIANCE_CREATE_COST_GOLD });
    }
    await client.query(`UPDATE cities SET gold = gold - $2 WHERE id = $1`, [snap.cityId, ALLIANCE_CREATE_COST_GOLD]);
    const ins = await client.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [name, me]);
    const allianceId = (ins.rows[0] as { id: string }).id;
    await addMember(client, allianceId, me, 'leader');
    await recordAllianceEvent(client, allianceId, 'joined', { accountId: me, role: 'leader', created: true });
    return {
      ok: true,
      data: { allianceId, cost: ALLIANCE_CREATE_COST_GOLD },
      after: () => pushState(ctx, [me], 'joined', { id: allianceId, name }),
    };
  });
}

export async function handleAllianceApply(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const allianceId = data?.allianceId;
  const cancel = data?.cancel === true;
  if (!isUuid(allianceId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  await runTx(ctx, conn, op, seq, async (client) => {
    await lockAccount(client, me);
    if (cancel) {
      const del = await client.query(`DELETE FROM alliance_requests WHERE account_id = $1 AND alliance_id = $2`, [me, allianceId]);
      return del.rowCount ? { ok: true, data: { cancelled: true } } : fail('ALLIANCE_NOT_FOUND');
    }
    if (await getMembership(client, me)) {
      return fail('ALLIANCE_ALREADY_IN');
    }
    const until = await activeCooldown(client, me);
    if (until) {
      return cooldownFail(until);
    }
    if (!(await lockAlliance(client, allianceId))) {
      return fail('ALLIANCE_NOT_FOUND');
    }
    // 过期的旧申请不挡路
    await client.query(`DELETE FROM alliance_requests WHERE account_id = $1 AND expires_at <= now()`, [me]);
    const existing = await client.query(`SELECT 1 FROM alliance_requests WHERE account_id = $1`, [me]);
    if (existing.rowCount) {
      return fail('ALLIANCE_REQUEST_EXISTS');
    }
    const slots = await slotsUsed(client, allianceId);
    if (slots.members + slots.invites >= ALLIANCE_MAX_MEMBERS) {
      return fail('ALLIANCE_FULL');
    }
    const ins = await client.query(
      `INSERT INTO alliance_requests (account_id, alliance_id, expires_at)
       VALUES ($1, $2, now() + ($3::bigint * interval '1 millisecond')) RETURNING expires_at`,
      [me, allianceId, ALLIANCE_REQUEST_TTL_MS],
    );
    const name = await allianceName(client, allianceId);
    const managers = await managerIds(client, allianceId);
    return {
      ok: true,
      data: { allianceId, expiresAt: (ins.rows[0] as { expires_at: Date }).expires_at.toISOString() },
      after: () => pushState(ctx, managers, 'request_received', { id: allianceId, name }),
    };
  });
}

export async function handleAllianceInvite(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const username = readString(data, 'username')?.trim();
  const cancel = data?.cancel === true;
  if (!username) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  await runTx(ctx, conn, op, seq, async (client) => {
    await lockAccount(client, me);
    const mine = await getMembership(client, me);
    if (!mine) {
      return fail('ALLIANCE_NOT_IN');
    }
    if (mine.role === 'member') {
      return fail('ALLIANCE_FORBIDDEN');
    }
    const target = await client.query(`SELECT id, username FROM accounts WHERE username = $1`, [username]);
    if (!target.rowCount) {
      return fail('ALLIANCE_NOT_FOUND');
    }
    const targetId = (target.rows[0] as { id: string }).id;
    if (targetId === me) {
      return fail('INVALID_PARAMS');
    }
    await lockAlliance(client, mine.allianceId);
    if (cancel) {
      const del = await client.query(`DELETE FROM alliance_invites WHERE alliance_id = $1 AND account_id = $2`, [mine.allianceId, targetId]);
      return del.rowCount ? { ok: true, data: { cancelled: true } } : fail('ALLIANCE_NOT_FOUND');
    }
    if (await getMembership(client, targetId)) {
      return fail('ALLIANCE_ALREADY_IN');
    }
    // 重复邀请是覆盖：先去掉旧的（含已过期的），再按剩余名额判断
    await client.query(`DELETE FROM alliance_invites WHERE alliance_id = $1 AND account_id = $2`, [mine.allianceId, targetId]);
    const slots = await slotsUsed(client, mine.allianceId);
    if (slots.members + slots.invites >= ALLIANCE_MAX_MEMBERS) {
      return fail('ALLIANCE_FULL');
    }
    const ins = await client.query(
      `INSERT INTO alliance_invites (alliance_id, account_id, inviter_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4::bigint * interval '1 millisecond')) RETURNING expires_at`,
      [mine.allianceId, targetId, me, ALLIANCE_INVITE_TTL_MS],
    );
    const name = await allianceName(client, mine.allianceId);
    const managers = await managerIds(client, mine.allianceId);
    return {
      ok: true,
      data: { accountId: targetId, expiresAt: (ins.rows[0] as { expires_at: Date }).expires_at.toISOString() },
      after: () => {
        pushState(ctx, [targetId], 'invited', { id: mine.allianceId, name });
        pushState(ctx, managers, 'request_received', { id: mine.allianceId, name });
      },
    };
  });
}

export async function handleAllianceRespond(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const kind = data?.kind;
  const accept = data?.accept;
  if ((kind !== 'request' && kind !== 'invite') || typeof accept !== 'boolean') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const subject = kind === 'request' ? data?.accountId : data?.allianceId;
  if (!isUuid(subject)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  await runTx(ctx, conn, op, seq, async (client) => {
    await lockAccount(client, me);
    if (kind === 'request') {
      // 盟主 / 副盟主审批别人的申请
      const mine = await getMembership(client, me);
      if (!mine) {
        return fail('ALLIANCE_NOT_IN');
      }
      if (mine.role === 'member') {
        return fail('ALLIANCE_FORBIDDEN');
      }
      await lockAlliance(client, mine.allianceId);
      const reqRes = await client.query(
        `SELECT 1 FROM alliance_requests WHERE account_id = $1 AND alliance_id = $2 AND expires_at > now()`,
        [subject, mine.allianceId],
      );
      if (!reqRes.rowCount) {
        return fail('ALLIANCE_NOT_FOUND');
      }
      const name = await allianceName(client, mine.allianceId);
      if (!accept) {
        await client.query(`DELETE FROM alliance_requests WHERE account_id = $1`, [subject]);
        return {
          ok: true,
          data: { accepted: false },
          after: () => pushState(ctx, [subject], 'request_resolved', { id: mine.allianceId, name }),
        };
      }
      if (await getMembership(client, subject)) {
        await client.query(`DELETE FROM alliance_requests WHERE account_id = $1`, [subject]);
        return fail('ALLIANCE_ALREADY_IN');
      }
      const until = await activeCooldown(client, subject);
      if (until) {
        return cooldownFail(until);
      }
      const slots = await slotsUsed(client, mine.allianceId);
      if (slots.members + slots.invites >= ALLIANCE_MAX_MEMBERS) {
        return fail('ALLIANCE_FULL');
      }
      await addMember(client, mine.allianceId, subject, 'member');
      await recordAllianceEvent(client, mine.allianceId, 'joined', { accountId: subject, role: 'member' });
      const members = await memberIds(client, mine.allianceId);
      return {
        ok: true,
        data: { accepted: true },
        after: () => pushState(ctx, members, 'joined', { id: mine.allianceId, name }),
      };
    }
    // 被邀请人答复收到的邀请
    const inv = await client.query(
      `SELECT 1 FROM alliance_invites WHERE account_id = $1 AND alliance_id = $2 AND expires_at > now()`,
      [me, subject],
    );
    if (!inv.rowCount) {
      return fail('ALLIANCE_NOT_FOUND');
    }
    if (!accept) {
      await client.query(`DELETE FROM alliance_invites WHERE account_id = $1 AND alliance_id = $2`, [me, subject]);
      return { ok: true, data: { accepted: false } };
    }
    if (await getMembership(client, me)) {
      return fail('ALLIANCE_ALREADY_IN');
    }
    const until = await activeCooldown(client, me);
    if (until) {
      return cooldownFail(until);
    }
    if (!(await lockAlliance(client, subject))) {
      return fail('ALLIANCE_NOT_FOUND');
    }
    // 我自己的这条邀请已占一个名额，不重复计
    const slots = await slotsUsed(client, subject);
    if (slots.members + slots.invites - 1 >= ALLIANCE_MAX_MEMBERS) {
      return fail('ALLIANCE_FULL');
    }
    await addMember(client, subject, me, 'member');
    await recordAllianceEvent(client, subject, 'joined', { accountId: me, role: 'member' });
    const name = await allianceName(client, subject);
    const members = await memberIds(client, subject);
    return { ok: true, data: { accepted: true }, after: () => pushState(ctx, members, 'joined', { id: subject, name }) };
  });
}

export async function handleAllianceLeave(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const me = conn.accountId as string;
  await runTx(ctx, conn, op, seq, async (client) => {
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
    const name = await allianceName(client, mine.allianceId);
    const members = await memberIds(client, mine.allianceId);
    if (mine.role === 'leader') {
      if (members.length > 1) {
        return fail('ALLIANCE_LEADER_MUST_TRANSFER');
      }
      // 只剩盟主一人：退出等于解散
      await disbandAlliance(client, mine.allianceId);
      await setCooldown(client, me);
      await recordAllianceEvent(client, mine.allianceId, 'disbanded', { accountId: me });
      return { ok: true, data: { disbanded: true }, after: () => pushState(ctx, [me], 'disbanded', { id: mine.allianceId, name }) };
    }
    await removeMember(client, me);
    await recordAllianceEvent(client, mine.allianceId, 'left', { accountId: me });
    return {
      ok: true,
      data: { disbanded: false },
      after: () => pushState(ctx, members, 'left', { id: mine.allianceId, name }),
    };
  });
}

export async function handleAllianceDisband(ctx: HandlerContext, conn: ConnInfo, op: number, seq: number | undefined): Promise<void> {
  const me = conn.accountId as string;
  await runTx(ctx, conn, op, seq, async (client) => {
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
    if (mine.role !== 'leader') {
      return fail('ALLIANCE_FORBIDDEN');
    }
    const name = await allianceName(client, mine.allianceId);
    await recordAllianceEvent(client, mine.allianceId, 'disbanded', { accountId: me });
    // 成员是被动散伙，不吃冷却；解散者本人吃冷却（防建了又散来回试）
    const members = await disbandAlliance(client, mine.allianceId);
    await setCooldown(client, me);
    return { ok: true, data: {}, after: () => pushState(ctx, members, 'disbanded', { id: mine.allianceId, name }) };
  });
}

export async function handleAllianceKick(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const targetId = data?.accountId;
  if (!isUuid(targetId) || targetId === me) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  await runTx(ctx, conn, op, seq, async (client) => {
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
    if (mine.role === 'member') {
      return fail('ALLIANCE_FORBIDDEN');
    }
    const target = await getMembership(client, targetId);
    if (!target || target.allianceId !== mine.allianceId) {
      return fail('ALLIANCE_NOT_FOUND');
    }
    // 盟主不能被踢；副盟主只能踢普通成员
    if (target.role === 'leader' || (mine.role === 'vice' && target.role !== 'member')) {
      return fail('ALLIANCE_FORBIDDEN');
    }
    const name = await allianceName(client, mine.allianceId);
    const members = await memberIds(client, mine.allianceId);
    await removeMember(client, targetId);
    await recordAllianceEvent(client, mine.allianceId, 'kicked', { accountId: targetId, by: me });
    return { ok: true, data: {}, after: () => pushState(ctx, members, 'kicked', { id: mine.allianceId, name }) };
  });
}

export async function handleAllianceSetRole(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const targetId = data?.accountId;
  const role = data?.role as AllianceRole | undefined;
  if (!isUuid(targetId) || targetId === me || (role !== 'vice' && role !== 'member' && role !== 'leader')) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  await runTx(ctx, conn, op, seq, async (client) => {
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
    if (mine.role !== 'leader') {
      return fail('ALLIANCE_FORBIDDEN');
    }
    const target = await getMembership(client, targetId);
    if (!target || target.allianceId !== mine.allianceId) {
      return fail('ALLIANCE_NOT_FOUND');
    }
    if (role === 'vice' && target.role !== 'vice') {
      if ((await viceCount(client, mine.allianceId)) >= ALLIANCE_MAX_VICES) {
        return fail('ALLIANCE_ROLE_FULL');
      }
      await client.query(`UPDATE alliance_members SET role = 'vice' WHERE account_id = $1`, [targetId]);
    } else if (role === 'member' && target.role === 'vice') {
      await client.query(`UPDATE alliance_members SET role = 'member' WHERE account_id = $1`, [targetId]);
    } else if (role === 'leader') {
      await transferLeader(client, mine.allianceId, me, targetId);
      await recordAllianceEvent(client, mine.allianceId, 'leader_changed', { from: me, to: targetId, reason: 'transfer' });
    }
    const name = await allianceName(client, mine.allianceId);
    const members = await memberIds(client, mine.allianceId);
    return { ok: true, data: {}, after: () => pushState(ctx, members, 'role_changed', { id: mine.allianceId, name }) };
  });
}

export async function handleAllianceSetNotice(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const me = conn.accountId as string;
  const raw = readString(data, 'notice');
  if (raw === null) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const trimmed = raw.trim();
  if (chatLength(trimmed) > ALLIANCE_NOTICE_MAX_CHARS) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const notice = bannedWordFilter().mask(trimmed);
  await runTx(ctx, conn, op, seq, async (client) => {
    const mine = await getMembership(client, me);
    if (!mine) {
      return fail('ALLIANCE_NOT_IN');
    }
    if (mine.role === 'member') {
      return fail('ALLIANCE_FORBIDDEN');
    }
    await client.query(`UPDATE alliances SET notice = $2 WHERE id = $1`, [mine.allianceId, notice]);
    const name = await allianceName(client, mine.allianceId);
    const members = await memberIds(client, mine.allianceId);
    return { ok: true, data: { notice }, after: () => pushState(ctx, members, 'notice', { id: mine.allianceId, name }) };
  });
}
