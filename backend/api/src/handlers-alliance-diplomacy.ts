// 联盟外交（v77，AISLG-195）：友盟邀请 / 同意 / 拒绝、解除关系、宣布敌对与查询。
// 管理类仅限玩家连接的盟主 / 副盟主；查询类玩家与 Agent 通用。
// 关系与冷却规则：
// - friendly：双方成员互不攻击，可以互相协防；解除后 24 小时内仍不能互相攻击、72 小时内不能再次结好；
// - hostile：单方面宣布，仅地图标红与来袭预警提示，不改变战斗与收益；
// - neutral：默认；解除友好写 neutral 行保留冷却。
// 上限：友盟 2、敌对 5。关系跨季保留。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import { Op } from '../../common/src/protocol';
import {
  ALLIANCE_FRIEND_INVITE_TTL_MS,
  ALLIANCE_MAX_FRIENDS,
  ALLIANCE_MAX_HOSTILES,
  ALLIANCE_REFRIEND_COOLDOWN_MS,
  ALLIANCE_UNFRIEND_NO_ATTACK_MS,
  type AllianceRole,
} from '../../common/src/protocol-alliance';
import {
  activeCooldown,
  allianceRelationBetween,
  getMembership,
  loadBrief,
  loadDiplomacy,
  lockAlliance,
  recordAllianceEvent,
} from '../../common/src/alliance-db';
import { insertServerBroadcast, type ServerBroadcastCreated } from '../../common/src/server-broadcast';
import { isUuid } from './chat-validate';
import { readString, respondError, respondOk } from './frames';
import type { HandlerContext } from './handlers';
import type { ConnInfo } from './connections';

/** 外交协议号（handlers-alliance.ts 路由用） */
export const DIPLOMACY_OPS: ReadonlySet<number> = new Set<number>([
  Op.ALLIANCE_DIPLOMACY_INVITE,
  Op.ALLIANCE_DIPLOMACY_RESPOND,
  Op.ALLIANCE_DIPLOMACY_END,
  Op.ALLIANCE_DIPLOMACY_HOSTILE,
  Op.GET_ALLIANCE_DIPLOMACY,
]);

const MANAGER_ROLES: readonly AllianceRole[] = ['leader', 'vice'];

type Client = pg.PoolClient;

/** 事务内读取我的联盟 + 管理权限；无联盟 / 无权限返回错误码 */
async function requireManager(
  client: Client,
  accountId: string,
): Promise<{ allianceId: string; role: AllianceRole } | 'not_in' | 'forbidden'> {
  const membership = await getMembership(client, accountId);
  if (!membership) {
    return 'not_in';
  }
  return MANAGER_ROLES.includes(membership.role) ? membership : 'forbidden';
}

/** 按固定顺序锁两个联盟，避免交叉请求死锁 */
async function lockPair(client: Client, a: string, b: string): Promise<boolean> {
  const [first, second] = a < b ? [a, b] : [b, a];
  return (await lockAlliance(client, first)) && (await lockAlliance(client, second));
}

async function friendshipCount(q: pg.Pool | Client, allianceId: string): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM alliance_relations
     WHERE relation = 'friendly' AND (a_id = $1 OR b_id = $1)`,
    [allianceId],
  );
  return (res.rows[0] as { n: number }).n;
}

async function hostilityCount(q: pg.Pool | Client, allianceId: string): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM alliance_relations
     WHERE relation = 'hostile' AND (a_id = $1 OR b_id = $1)`,
    [allianceId],
  );
  return (res.rows[0] as { n: number }).n;
}

/** 全服播报（提交后推送；联盟外交属于大事，不受限频） */
async function broadcastDiplomacy(
  pool: pg.Pool,
  kind: 'friendly' | 'hostile' | 'neutral',
  actorAlliance: string,
  actorAllianceName: string,
  otherAlliance: string,
  otherAllianceName: string,
): Promise<void> {
  // 播报在事务外写，避免与管理事务的锁互相等待；失败只记日志
  try {
    const client = await pool.connect();
    try {
      let created: ServerBroadcastCreated | null = null;
      await client.query('BEGIN');
      created = await insertServerBroadcast(
        client,
        'alliance_diplomacy',
        { kind, actorAlliance, actorAllianceName, otherAlliance, otherAllianceName },
        { force: true },
      );
      await client.query('COMMIT');
      if (created) {
        await pool.query('SELECT pg_notify($1, $2)', [
          NOTIFY_CHANNEL,
          JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: created }),
        ]);
      }
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('alliance diplomacy broadcast failed:', err instanceof Error ? err.message : err);
  }
}

/** 查询响应（操作成功后统一返回最新外交全貌） */
async function respondDiplomacy(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  allianceId: string,
): Promise<void> {
  const diplomacy = await loadDiplomacy(ctx.pool, allianceId);
  respondOk(ctx.registry, conn, op, seq, diplomacy as unknown as Record<string, unknown>);
}

/** GET_ALLIANCE_DIPLOMACY（op 132）：玩家与 Agent 通用 */
export async function handleGetAllianceDiplomacy(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
): Promise<void> {
  const membership = await getMembership(ctx.pool, conn.accountId as string);
  if (!membership) {
    respondError(ctx.registry, conn, op, seq, 'ALLIANCE_NOT_IN');
    return;
  }
  await respondDiplomacy(ctx, conn, op, seq, membership.allianceId);
}

/** ALLIANCE_DIPLOMACY_INVITE（op 128）：发起友好邀请（48 小时过期） */
export async function handleAllianceDiplomacyInvite(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const targetId = readString(data, 'allianceId');
  if (!targetId || !isUuid(targetId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const manager = await requireManager(client, accountId);
    if (manager === 'not_in' || manager === 'forbidden') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, manager === 'not_in' ? 'ALLIANCE_NOT_IN' : 'ALLIANCE_FORBIDDEN');
      return;
    }
    if (manager.allianceId === targetId) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    if (!(await lockPair(client, manager.allianceId, targetId))) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ALLIANCE_NOT_FOUND');
      return;
    }
    const relation = await allianceRelationBetween(client, manager.allianceId, targetId);
    if (relation?.relation === 'friendly' || relation?.relation === 'hostile') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_EXISTS');
      return;
    }
    if (relation?.refriendAfter && relation.refriendAfter.getTime() > Date.now()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_COOLDOWN', {
        refriendAfter: relation.refriendAfter.toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((relation.refriendAfter.getTime() - Date.now()) / 1000)),
      });
      return;
    }
    if ((await friendshipCount(client, manager.allianceId)) >= ALLIANCE_MAX_FRIENDS) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_LIMIT', { limit: ALLIANCE_MAX_FRIENDS });
      return;
    }
    if ((await friendshipCount(client, targetId)) >= ALLIANCE_MAX_FRIENDS) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_LIMIT', { limit: ALLIANCE_MAX_FRIENDS, side: 'target' });
      return;
    }
    await client.query(
      `INSERT INTO alliance_friend_invites (from_alliance_id, to_alliance_id, inviter_id, expires_at)
       VALUES ($1, $2, $3, now() + ($4::bigint * interval '1 millisecond'))
       ON CONFLICT (from_alliance_id, to_alliance_id)
       DO UPDATE SET inviter_id = EXCLUDED.inviter_id, created_at = now(), expires_at = EXCLUDED.expires_at`,
      [manager.allianceId, targetId, accountId, ALLIANCE_FRIEND_INVITE_TTL_MS],
    );
    await client.query('COMMIT');
    await respondDiplomacy(ctx, conn, op, seq, manager.allianceId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** ALLIANCE_DIPLOMACY_RESPOND（op 129）：同意 / 拒绝友好邀请 */
export async function handleAllianceDiplomacyRespond(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const inviteId = readString(data, 'inviteId');
  const accept = data?.accept;
  if (!inviteId || !/^\d+$/.test(inviteId) || typeof accept !== 'boolean') {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  let broadcast: { actorAlliance: string; actorAllianceName: string; otherAlliance: string; otherAllianceName: string } | null = null;
  try {
    await client.query('BEGIN');
    const manager = await requireManager(client, accountId);
    if (manager === 'not_in' || manager === 'forbidden') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, manager === 'not_in' ? 'ALLIANCE_NOT_IN' : 'ALLIANCE_FORBIDDEN');
      return;
    }
    const inviteRes = await client.query(
      `SELECT * FROM alliance_friend_invites
       WHERE id = $1 AND to_alliance_id = $2 AND expires_at > now() FOR UPDATE`,
      [inviteId, manager.allianceId],
    );
    const invite = inviteRes.rows[0] as
      | { id: string | number; from_alliance_id: string; to_alliance_id: string; inviter_id: string }
      | undefined;
    if (!invite) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_INVITE_NOT_FOUND');
      return;
    }
    if (!accept) {
      await client.query(`DELETE FROM alliance_friend_invites WHERE id = $1`, [inviteId]);
      await client.query('COMMIT');
      await respondDiplomacy(ctx, conn, op, seq, manager.allianceId);
      return;
    }
    if (!(await lockPair(client, invite.from_alliance_id, invite.to_alliance_id))) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'ALLIANCE_NOT_FOUND');
      return;
    }
    const relation = await allianceRelationBetween(client, invite.from_alliance_id, invite.to_alliance_id);
    if (relation?.relation === 'friendly' || relation?.relation === 'hostile') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_EXISTS');
      return;
    }
    if (relation?.refriendAfter && relation.refriendAfter.getTime() > Date.now()) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_COOLDOWN', {
        refriendAfter: relation.refriendAfter.toISOString(),
        retryAfterSeconds: Math.max(1, Math.ceil((relation.refriendAfter.getTime() - Date.now()) / 1000)),
      });
      return;
    }
    if (
      (await friendshipCount(client, invite.from_alliance_id)) >= ALLIANCE_MAX_FRIENDS ||
      (await friendshipCount(client, invite.to_alliance_id)) >= ALLIANCE_MAX_FRIENDS
    ) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_LIMIT', { limit: ALLIANCE_MAX_FRIENDS });
      return;
    }
    const aId = invite.from_alliance_id < invite.to_alliance_id ? invite.from_alliance_id : invite.to_alliance_id;
    const bId = invite.from_alliance_id < invite.to_alliance_id ? invite.to_alliance_id : invite.from_alliance_id;
    await client.query(
      `INSERT INTO alliance_relations (a_id, b_id, relation, established_at)
       VALUES ($1, $2, 'friendly', now())
       ON CONFLICT (a_id, b_id) DO UPDATE SET relation = 'friendly', established_at = now(),
         no_attack_until = NULL, refriend_after = NULL`,
      [aId, bId],
    );
    await client.query(
      `DELETE FROM alliance_friend_invites
       WHERE (from_alliance_id = $1 AND to_alliance_id = $2) OR (from_alliance_id = $2 AND to_alliance_id = $1)`,
      [invite.from_alliance_id, invite.to_alliance_id],
    );
    const fromBrief = await loadBrief(client, invite.from_alliance_id);
    const toBrief = await loadBrief(client, invite.to_alliance_id);
    if (fromBrief && toBrief) {
      await recordAllianceEvent(client, invite.from_alliance_id, 'diplomacy_friendly', {
        accountId, otherAllianceName: toBrief.name,
      });
      await recordAllianceEvent(client, invite.to_alliance_id, 'diplomacy_friendly', {
        accountId, otherAllianceName: fromBrief.name,
      });
      broadcast = {
        actorAlliance: invite.from_alliance_id,
        actorAllianceName: fromBrief.name,
        otherAlliance: invite.to_alliance_id,
        otherAllianceName: toBrief.name,
      };
    }
    await client.query('COMMIT');
    if (broadcast) {
      await broadcastDiplomacy(
        ctx.pool, 'friendly',
        broadcast.actorAlliance, broadcast.actorAllianceName,
        broadcast.otherAlliance, broadcast.otherAllianceName,
      );
    }
    await respondDiplomacy(ctx, conn, op, seq, manager.allianceId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** ALLIANCE_DIPLOMACY_END（op 130）：解除友好 / 敌对，回到中立 */
export async function handleAllianceDiplomacyEnd(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const targetId = readString(data, 'allianceId');
  if (!targetId || !isUuid(targetId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const manager = await requireManager(client, accountId);
    if (manager === 'not_in' || manager === 'forbidden') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, manager === 'not_in' ? 'ALLIANCE_NOT_IN' : 'ALLIANCE_FORBIDDEN');
      return;
    }
    if (manager.allianceId === targetId || !(await lockPair(client, manager.allianceId, targetId))) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    const relation = await allianceRelationBetween(client, manager.allianceId, targetId);
    if (!relation || (relation.relation !== 'friendly' && relation.relation !== 'hostile')) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    if (relation.relation === 'friendly') {
      await client.query(
        `UPDATE alliance_relations
         SET relation = 'neutral', no_attack_until = now() + ($3::bigint * interval '1 millisecond'),
             refriend_after = now() + ($4::bigint * interval '1 millisecond')
         WHERE a_id = $1 AND b_id = $2`,
        [relation.aId, relation.bId, ALLIANCE_UNFRIEND_NO_ATTACK_MS, ALLIANCE_REFRIEND_COOLDOWN_MS],
      );
    } else {
      // 从友盟转来的敌对可能还带着 24 小时不可攻击 / 72 小时不可再结好的冷却：保留为 neutral 行；否则直接删除
      const cooling =
        (relation.noAttackUntil !== null && relation.noAttackUntil.getTime() > Date.now()) ||
        (relation.refriendAfter !== null && relation.refriendAfter.getTime() > Date.now());
      if (cooling) {
        await client.query(`UPDATE alliance_relations SET relation = 'neutral' WHERE a_id = $1 AND b_id = $2`, [
          relation.aId,
          relation.bId,
        ]);
      } else {
        await client.query(`DELETE FROM alliance_relations WHERE a_id = $1 AND b_id = $2`, [relation.aId, relation.bId]);
      }
    }
    const mine = await loadBrief(client, manager.allianceId);
    const other = await loadBrief(client, targetId);
    if (mine && other) {
      await recordAllianceEvent(client, manager.allianceId, 'diplomacy_neutral', {
        accountId, otherAllianceName: other.name,
      });
      await recordAllianceEvent(client, targetId, 'diplomacy_neutral', {
        accountId, otherAllianceName: mine.name,
      });
    }
    await client.query('COMMIT');
    await respondDiplomacy(ctx, conn, op, seq, manager.allianceId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** ALLIANCE_DIPLOMACY_HOSTILE（op 131）：单方面宣布敌对 */
export async function handleAllianceDiplomacyHostile(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  const accountId = conn.accountId as string;
  const targetId = readString(data, 'allianceId');
  if (!targetId || !isUuid(targetId)) {
    respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
    return;
  }
  const client = await ctx.pool.connect();
  let broadcast: { actorAllianceName: string; otherAllianceName: string } | null = null;
  try {
    await client.query('BEGIN');
    const manager = await requireManager(client, accountId);
    if (manager === 'not_in' || manager === 'forbidden') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, manager === 'not_in' ? 'ALLIANCE_NOT_IN' : 'ALLIANCE_FORBIDDEN');
      return;
    }
    if (manager.allianceId === targetId || !(await lockPair(client, manager.allianceId, targetId))) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'INVALID_PARAMS');
      return;
    }
    const relation = await allianceRelationBetween(client, manager.allianceId, targetId);
    if (relation?.relation === 'hostile') {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_EXISTS');
      return;
    }
    if ((await hostilityCount(client, manager.allianceId)) >= ALLIANCE_MAX_HOSTILES) {
      await client.query('ROLLBACK');
      respondError(ctx.registry, conn, op, seq, 'DIPLOMACY_LIMIT', { limit: ALLIANCE_MAX_HOSTILES });
      return;
    }
    const aId = manager.allianceId < targetId ? manager.allianceId : targetId;
    const bId = manager.allianceId < targetId ? targetId : manager.allianceId;
    // 从友好直接转敌对：保留 24 小时不可攻击冷却，防止「当场翻脸偷袭」
    const noAttackUntilMs = relation?.relation === 'friendly' ? ALLIANCE_UNFRIEND_NO_ATTACK_MS : null;
    await client.query(
      `INSERT INTO alliance_relations (a_id, b_id, relation, established_at, no_attack_until)
       VALUES ($1, $2, 'hostile', now(), CASE WHEN $3::bigint IS NULL THEN NULL ELSE now() + ($3::bigint * interval '1 millisecond') END)
       ON CONFLICT (a_id, b_id) DO UPDATE SET relation = 'hostile', established_at = now(),
         no_attack_until = CASE WHEN $3::bigint IS NULL THEN alliance_relations.no_attack_until
                                ELSE now() + ($3::bigint * interval '1 millisecond') END`,
      [aId, bId, noAttackUntilMs],
    );
    const mine = await loadBrief(client, manager.allianceId);
    const other = await loadBrief(client, targetId);
    if (mine && other) {
      await recordAllianceEvent(client, manager.allianceId, 'diplomacy_hostile', {
        accountId, otherAllianceName: other.name,
      });
      await recordAllianceEvent(client, targetId, 'diplomacy_hostile', {
        accountId, otherAllianceName: mine.name,
      });
      broadcast = { actorAllianceName: mine.name, otherAllianceName: other.name };
    }
    await client.query('COMMIT');
    if (broadcast) {
      await broadcastDiplomacy(
        ctx.pool, 'hostile',
        manager.allianceId, broadcast.actorAllianceName,
        targetId, broadcast.otherAllianceName,
      );
    }
    await respondDiplomacy(ctx, conn, op, seq, manager.allianceId);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 外交协议分发（handlers.ts 调用） */
export async function handleAllianceDiplomacyOp(
  ctx: HandlerContext,
  conn: ConnInfo,
  op: number,
  seq: number | undefined,
  data: Record<string, unknown> | undefined,
): Promise<void> {
  if (op !== Op.GET_ALLIANCE_DIPLOMACY && conn.role !== 'player') {
    respondError(ctx.registry, conn, op, seq, 'AGENT_FORBIDDEN');
    return;
  }
  switch (op) {
    case Op.GET_ALLIANCE_DIPLOMACY:
      await handleGetAllianceDiplomacy(ctx, conn, op, seq);
      break;
    case Op.ALLIANCE_DIPLOMACY_INVITE:
      await handleAllianceDiplomacyInvite(ctx, conn, op, seq, data);
      break;
    case Op.ALLIANCE_DIPLOMACY_RESPOND:
      await handleAllianceDiplomacyRespond(ctx, conn, op, seq, data);
      break;
    case Op.ALLIANCE_DIPLOMACY_END:
      await handleAllianceDiplomacyEnd(ctx, conn, op, seq, data);
      break;
    case Op.ALLIANCE_DIPLOMACY_HOSTILE:
      await handleAllianceDiplomacyHostile(ctx, conn, op, seq, data);
      break;
    default:
      respondError(ctx.registry, conn, op, seq, 'UNKNOWN_OP');
  }
}