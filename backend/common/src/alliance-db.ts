// 联盟的数据访问（v66，AISLG-181）：API 与 Worker 共用。
// 约定：改动联盟成员关系的函数都要求在调用方的事务里执行（传 PoolClient），并先用 lockAlliance 锁住联盟行，
// 同一联盟的加入 / 踢人 / 转让 / 解散因此串行，名额与副盟主上限不会被并发绕过。

import type pg from 'pg';
import { NOTIFY_CHANNEL } from './db';
import type { ChatPlayerView, ChatSystemView } from './protocol-chat';
import {
  ALLIANCE_COOLDOWN_MS,
  ALLIANCE_MAX_MEMBERS,
  ALLIANCE_LIST_PAGE_SIZE,
  ALLIANCE_POWER_FAMOUS_WEIGHT,
  ALLIANCE_POWER_GOVERNMENT_WEIGHT,
  ALLIANCE_POWER_TERRITORY_WEIGHT,
  ALLIANCE_RANK_MIN_MEMBERS,
  type AllianceBriefView,
  type AllianceDetailView,
  type AllianceMarkKind,
  type AllianceMarkView,
  type AllianceMemberView,
  type AllianceRole,
} from './protocol-alliance';
import { effectiveLevelSql } from './production';

type Q = pg.Pool | pg.PoolClient;

export interface Membership {
  allianceId: string;
  role: AllianceRole;
}

/** 账号当前所在联盟与职位；没有联盟返回 null */
export async function getMembership(q: Q, accountId: string): Promise<Membership | null> {
  const res = await q.query(`SELECT alliance_id, role FROM alliance_members WHERE account_id = $1`, [accountId]);
  if (!res.rowCount) {
    return null;
  }
  const row = res.rows[0] as { alliance_id: string; role: AllianceRole };
  return { allianceId: row.alliance_id, role: row.role };
}

/** 两个账号是否同一联盟（盟友互不攻击的判断依据，AISLG-182 复用）；任一方没有联盟为 false */
export async function areAllies(q: Q, accountA: string, accountB: string): Promise<boolean> {
  if (accountA === accountB) {
    return false;
  }
  const res = await q.query(
    `SELECT 1 FROM alliance_members a JOIN alliance_members b ON a.alliance_id = b.alliance_id
     WHERE a.account_id = $1 AND b.account_id = $2`,
    [accountA, accountB],
  );
  return (res.rowCount ?? 0) > 0;
}

/** 锁住联盟行；联盟不存在返回 false */
export async function lockAlliance(client: pg.PoolClient, allianceId: string): Promise<boolean> {
  const res = await client.query(`SELECT 1 FROM alliances WHERE id = $1 FOR UPDATE`, [allianceId]);
  return (res.rowCount ?? 0) > 0;
}

/** 冷却截止（库内时钟）：不在冷却中返回 null */
export async function activeCooldown(q: Q, accountId: string): Promise<Date | null> {
  const res = await q.query(
    `SELECT alliance_cooldown_until AS until FROM accounts WHERE id = $1 AND alliance_cooldown_until > now()`,
    [accountId],
  );
  return res.rowCount ? (res.rows[0] as { until: Date }).until : null;
}

export async function setCooldown(q: Q, accountId: string): Promise<void> {
  await q.query(
    `UPDATE accounts SET alliance_cooldown_until = now() + ($2::bigint * interval '1 millisecond') WHERE id = $1`,
    [accountId, ALLIANCE_COOLDOWN_MS],
  );
}

/** 清掉已过期的申请、邀请与地图标记（读取时另有 expires_at 过滤，这里只是回收） */
export async function purgeExpired(q: Q): Promise<void> {
  await q.query(`DELETE FROM alliance_requests WHERE expires_at <= now()`);
  await q.query(`DELETE FROM alliance_invites WHERE expires_at <= now()`);
  await q.query(`DELETE FROM alliance_marks WHERE expires_at <= now()`);
}

/** 占用名额数 = 成员数 + 未过期的待处理邀请数 */
export async function slotsUsed(q: Q, allianceId: string): Promise<{ members: number; invites: number }> {
  const res = await q.query(
    `SELECT (SELECT count(*) FROM alliance_members WHERE alliance_id = $1)::int AS members,
            (SELECT count(*) FROM alliance_invites WHERE alliance_id = $1 AND expires_at > now())::int AS invites`,
    [allianceId],
  );
  return res.rows[0] as { members: number; invites: number };
}

export async function viceCount(q: Q, allianceId: string): Promise<number> {
  const res = await q.query(
    `SELECT count(*)::int AS n FROM alliance_members WHERE alliance_id = $1 AND role = 'vice'`,
    [allianceId],
  );
  return (res.rows[0] as { n: number }).n;
}

interface BriefRow {
  id: string;
  name: string;
  leader_id: string;
  leader_name: string;
  member_count: number;
  created_at: Date;
}

const BRIEF_SQL = `
  SELECT al.id, al.name, al.leader_id, la.username AS leader_name, al.created_at,
         (SELECT count(*) FROM alliance_members m WHERE m.alliance_id = al.id)::int AS member_count
  FROM alliances al JOIN accounts la ON la.id = al.leader_id`;

function briefView(row: BriefRow): AllianceBriefView {
  return {
    id: row.id,
    name: row.name,
    leader: { accountId: row.leader_id, username: row.leader_name },
    memberCount: row.member_count,
    maxMembers: ALLIANCE_MAX_MEMBERS,
    createdAt: row.created_at.toISOString(),
  };
}

export async function loadBrief(q: Q, allianceId: string): Promise<AllianceBriefView | null> {
  const res = await q.query(`${BRIEF_SQL} WHERE al.id = $1`, [allianceId]);
  return res.rowCount ? briefView(res.rows[0] as BriefRow) : null;
}

export async function loadBriefs(q: Q, allianceIds: string[]): Promise<Map<string, AllianceBriefView>> {
  if (allianceIds.length === 0) {
    return new Map();
  }
  const res = await q.query(`${BRIEF_SQL} WHERE al.id = ANY($1::uuid[])`, [allianceIds]);
  return new Map((res.rows as BriefRow[]).map((row) => [row.id, briefView(row)]));
}

/** 联盟列表：按成员数降序（同数按创建时间）分页 */
export async function listAlliances(q: Q, page: number): Promise<{ alliances: AllianceBriefView[]; total: number }> {
  const totalRes = await q.query(`SELECT count(*)::int AS n FROM alliances`);
  const res = await q.query(
    `${BRIEF_SQL} ORDER BY member_count DESC, al.created_at, al.id LIMIT $1 OFFSET $2`,
    [ALLIANCE_LIST_PAGE_SIZE, (page - 1) * ALLIANCE_LIST_PAGE_SIZE],
  );
  return { alliances: (res.rows as BriefRow[]).map(briefView), total: (totalRes.rows[0] as { n: number }).n };
}

/** 主城官府有效等级（按城池创建顺序取第一座；没有城按 0） */
export async function governmentLevelOf(q: Q, accountId: string): Promise<number> {
  const res = await q.query(
    `SELECT COALESCE(${effectiveLevelSql('cb.level', "'government'", 'c.famous_name')}, 0)::int AS level
     FROM cities c
     LEFT JOIN city_buildings cb ON cb.city_id = c.id AND cb.kind = 'government'
     WHERE c.account_id = $1
     ORDER BY c.created_at
     LIMIT 1`,
    [accountId],
  );
  return res.rowCount ? (res.rows[0] as { level: number }).level : 0;
}

/** 联盟势力的分项（现算；口径见 protocol-alliance.ts 的 ALLIANCE_POWER_* 常量） */
export interface AlliancePowerParts {
  /** 全体成员占领的野地数 */
  territory: number;
  /** 全体成员的名城数（分城 famous_name 非空） */
  famous: number;
  /** 全体成员主城官府有效等级之和（没有主城的按 0） */
  government: number;
  /** 势力 = 三项按权重合计 */
  power: number;
}

/** 势力公式的唯一出处：榜单快照（Worker）与 GET_ALLIANCE（API）都经此计算，口径不会分叉 */
export function alliancePowerOf(parts: Omit<AlliancePowerParts, 'power'>): number {
  return (
    parts.territory * ALLIANCE_POWER_TERRITORY_WEIGHT +
    parts.famous * ALLIANCE_POWER_FAMOUS_WEIGHT +
    parts.government * ALLIANCE_POWER_GOVERNMENT_WEIGHT
  );
}

/**
 * 一批联盟的势力（allianceIds = null 表示全部联盟；空数组直接返回空表；没有成员的联盟不在结果里）。
 * 按账号汇总，与 loadDetail 的成员列表同口径：野地数统计 wilderness 地块，名城统计 famous_name 非空的分城，
 * 官府取每人按建城顺序的第一座主城（同 governmentLevelOf）。
 */
export async function computeAlliancePowers(q: Q, allianceIds: readonly string[] | null): Promise<Map<string, AlliancePowerParts>> {
  const result = new Map<string, AlliancePowerParts>();
  if (allianceIds && allianceIds.length === 0) {
    return result;
  }
  const res = await q.query(
    `WITH mem AS (
       SELECT m.alliance_id, m.account_id FROM alliance_members m
       WHERE $1::uuid[] IS NULL OR m.alliance_id = ANY($1::uuid[])
     ),
     terr AS (
       SELECT c.account_id, count(*)::int AS n
       FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
       WHERE wt.kind = 'wilderness' AND c.account_id IN (SELECT account_id FROM mem)
       GROUP BY c.account_id
     ),
     famous AS (
       SELECT c.account_id, count(*)::int AS n FROM cities c
       WHERE c.famous_name IS NOT NULL AND c.account_id IN (SELECT account_id FROM mem)
       GROUP BY c.account_id
     ),
     gov AS (
       SELECT DISTINCT ON (c.account_id) c.account_id,
         COALESCE(${effectiveLevelSql('cb.level', "'government'", 'c.famous_name')}, 0)::int AS level
       FROM cities c LEFT JOIN city_buildings cb ON cb.city_id = c.id AND cb.kind = 'government'
       WHERE c.account_id IN (SELECT account_id FROM mem)
       ORDER BY c.account_id, c.created_at
     )
     SELECT mem.alliance_id,
       COALESCE(sum(terr.n), 0)::int AS territory,
       COALESCE(sum(famous.n), 0)::int AS famous,
       COALESCE(sum(gov.level), 0)::int AS government
     FROM mem
     LEFT JOIN terr ON terr.account_id = mem.account_id
     LEFT JOIN famous ON famous.account_id = mem.account_id
     LEFT JOIN gov ON gov.account_id = mem.account_id
     GROUP BY mem.alliance_id`,
    [allianceIds ? [...allianceIds] : null],
  );
  for (const row of res.rows as Array<{ alliance_id: string; territory: number; famous: number; government: number }>) {
    const parts = { territory: Number(row.territory), famous: Number(row.famous), government: Number(row.government) };
    result.set(row.alliance_id, { ...parts, power: alliancePowerOf(parts) });
  }
  return result;
}

/**
 * 联盟的榜单名次：取最近一次榜单快照（与榜单同源，可能滞后一个刷新周期）。
 * 成员不足 ALLIANCE_RANK_MIN_MEMBERS 或快照里没有，返回 null。
 */
export async function allianceRankOf(q: Q, allianceId: string, memberCount: number): Promise<number | null> {
  if (memberCount < ALLIANCE_RANK_MIN_MEMBERS) {
    return null;
  }
  const res = await q.query(
    `SELECT rank FROM alliance_leaderboard_snapshots
     WHERE alliance_id = $1 AND computed_at = (SELECT max(computed_at) FROM alliance_leaderboard_snapshots)`,
    [allianceId],
  );
  return res.rowCount ? Number((res.rows[0] as { rank: number }).rank) : null;
}

/** 联盟详情（成员按职位、入盟时间排序）；onlineIds = 此刻有玩家连接的账号；势力与名次一并给出（v70） */
export async function loadDetail(q: Q, allianceId: string, onlineIds: ReadonlySet<string>): Promise<AllianceDetailView | null> {
  const brief = await loadBrief(q, allianceId);
  if (!brief) {
    return null;
  }
  const noticeRes = await q.query(`SELECT notice FROM alliances WHERE id = $1`, [allianceId]);
  const power = (await computeAlliancePowers(q, [allianceId])).get(allianceId)?.power ?? 0;
  const rank = await allianceRankOf(q, allianceId, brief.memberCount);
  const res = await q.query(
    `SELECT m.account_id, a.username, m.role, m.joined_at, a.last_active_at,
            COALESCE((
              SELECT ${effectiveLevelSql('cb.level', "'government'", 'c.famous_name')}
              FROM cities c LEFT JOIN city_buildings cb ON cb.city_id = c.id AND cb.kind = 'government'
              WHERE c.account_id = m.account_id ORDER BY c.created_at LIMIT 1
            ), 0)::int AS government_level,
            (SELECT count(*) FROM world_tiles wt JOIN cities c ON c.id = wt.owner_city_id
              WHERE c.account_id = m.account_id AND wt.kind = 'wilderness')::int AS territory
     FROM alliance_members m JOIN accounts a ON a.id = m.account_id
     WHERE m.alliance_id = $1
     ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'vice' THEN 1 ELSE 2 END, m.joined_at, m.account_id`,
    [allianceId],
  );
  const members: AllianceMemberView[] = (res.rows as Array<{
    account_id: string; username: string; role: AllianceRole; joined_at: Date; last_active_at: Date | null;
    government_level: number; territory: number;
  }>).map((row) => ({
    accountId: row.account_id,
    username: row.username,
    role: row.role,
    governmentLevel: row.government_level,
    territoryCount: row.territory,
    joinedAt: row.joined_at.toISOString(),
    lastActiveAt: row.last_active_at ? row.last_active_at.toISOString() : null,
    online: onlineIds.has(row.account_id),
  }));
  return { ...brief, notice: (noticeRes.rows[0] as { notice: string }).notice, members, power, rank };
}

/** 把成员加入联盟（调用方已校验名额、冷却、不在别的联盟里）；同时清掉他的申请与全部邀请 */
export async function addMember(client: pg.PoolClient, allianceId: string, accountId: string, role: AllianceRole): Promise<void> {
  await client.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, $3)`, [
    accountId,
    allianceId,
    role,
  ]);
  await client.query(`DELETE FROM alliance_requests WHERE account_id = $1`, [accountId]);
  await client.query(`DELETE FROM alliance_invites WHERE account_id = $1`, [accountId]);
}

/** 移除成员并设置冷却（退出 / 被踢） */
export async function removeMember(client: pg.PoolClient, accountId: string): Promise<void> {
  await client.query(`DELETE FROM alliance_members WHERE account_id = $1`, [accountId]);
  await setCooldown(client, accountId);
}

/** 转让盟主：newLeader 升为盟主，原盟主降为普通成员；alliances.leader_id 同步 */
export async function transferLeader(client: pg.PoolClient, allianceId: string, oldLeaderId: string, newLeaderId: string): Promise<void> {
  await client.query(`UPDATE alliance_members SET role = 'member' WHERE account_id = $1 AND alliance_id = $2`, [
    oldLeaderId,
    allianceId,
  ]);
  await client.query(`UPDATE alliance_members SET role = 'leader' WHERE account_id = $1 AND alliance_id = $2`, [
    newLeaderId,
    allianceId,
  ]);
  await client.query(`UPDATE alliances SET leader_id = $2 WHERE id = $1`, [allianceId, newLeaderId]);
}

/** 解散联盟：成员关系、申请、邀请随外键级联删除；返回解散前的成员账号（推送用） */
export async function disbandAlliance(client: pg.PoolClient, allianceId: string): Promise<string[]> {
  const res = await client.query(`SELECT account_id FROM alliance_members WHERE alliance_id = $1`, [allianceId]);
  await client.query(`DELETE FROM alliances WHERE id = $1`, [allianceId]);
  return (res.rows as Array<{ account_id: string }>).map((row) => row.account_id);
}

/**
 * 联盟大事的统一出口（调用方事务内执行）：写一条联盟频道的系统消息（v68，AISLG-183），
 * 并在事务内 pg_notify，提交后 API 把这条消息推给本联盟的在线玩家（Worker 调用时同样走这条路，无需它自己有连接）。
 * 解散不写消息：联盟频道随联盟一起被外键级联删除。玩家名在这里取快照，文案由客户端按种类拼接。
 */
export type AllianceEventKind = 'joined' | 'left' | 'kicked' | 'leader_changed' | 'disbanded' | 'mark_created';
export async function recordAllianceEvent(
  q: Q,
  allianceId: string,
  kind: AllianceEventKind,
  detail: Record<string, unknown>,
): Promise<void> {
  if (kind === 'disbanded') {
    return;
  }
  const accountIds = [detail.accountId, detail.by, detail.from, detail.to].filter((id): id is string => typeof id === 'string');
  const names = await accountNames(q, accountIds);
  const player = (accountId: unknown): ChatPlayerView => ({
    accountId: accountId as string,
    username: names.get(accountId as string) ?? '',
  });
  let system: ChatSystemView;
  if (kind === 'joined') {
    system = { kind: 'alliance_joined', player: player(detail.accountId), founder: detail.created === true };
  } else if (kind === 'left') {
    system = { kind: 'alliance_left', player: player(detail.accountId) };
  } else if (kind === 'kicked') {
    system = { kind: 'alliance_kicked', player: player(detail.accountId), by: player(detail.by) };
  } else if (kind === 'mark_created') {
    system = {
      kind: 'alliance_mark_created',
      player: player(detail.accountId),
      markKind: detail.markKind as AllianceMarkKind,
      x: detail.x as number,
      y: detail.y as number,
    };
  } else {
    system = {
      kind: 'alliance_leader_changed',
      from: player(detail.from),
      to: player(detail.to),
      reason: detail.reason === 'inactive' ? 'inactive' : 'transfer',
    };
  }
  const res = await q.query(
    `INSERT INTO chat_messages (channel, alliance_id, system_event) VALUES ('alliance', $1, $2::jsonb) RETURNING id`,
    [allianceId, JSON.stringify(system)],
  );
  const messageId = Number((res.rows[0] as { id: string | number }).id);
  await q.query(`SELECT pg_notify($1, $2)`, [
    NOTIFY_CHANNEL,
    JSON.stringify({ reason: 'alliance_chat', allianceId, messageId }),
  ]);
}

/** 一批账号的用户名（系统消息快照用）；查不到的不出现在结果里 */
async function accountNames(q: Q, accountIds: readonly string[]): Promise<Map<string, string>> {
  if (accountIds.length === 0) {
    return new Map();
  }
  const res = await q.query(`SELECT id, username FROM accounts WHERE id = ANY($1::uuid[])`, [[...new Set(accountIds)]]);
  return new Map((res.rows as Array<{ id: string; username: string }>).map((row) => [row.id, row.username]));
}

export interface LeaderTransfer {
  allianceId: string;
  allianceName: string;
  from: string;
  to: string;
}

/**
 * 盟主长期不活跃自动转让（Worker 定时调用）：盟主最近活跃时刻（last_active_at，缺省回落 last_online_at、账号创建时刻）
 * 早于 inactiveMs 时，转给最近活跃的副盟主；没有副盟主则转给最早入盟的成员；盟里只有盟主一人则不动。
 * 每个联盟一个事务，转让前重新校验盟主是否仍然不活跃（盟主刚好上线则跳过）。
 */
export async function transferInactiveLeaders(pool: pg.Pool, inactiveMs: number): Promise<LeaderTransfer[]> {
  const candidates = await pool.query(
    `SELECT al.id FROM alliances al JOIN accounts a ON a.id = al.leader_id
     WHERE COALESCE(a.last_active_at, a.last_online_at, a.created_at) < now() - ($1::bigint * interval '1 millisecond')`,
    [inactiveMs],
  );
  const done: LeaderTransfer[] = [];
  for (const { id } of candidates.rows as Array<{ id: string }>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (!(await lockAlliance(client, id))) {
        await client.query('ROLLBACK');
        continue;
      }
      const cur = await client.query(
        `SELECT al.name, al.leader_id FROM alliances al JOIN accounts a ON a.id = al.leader_id
         WHERE al.id = $1
           AND COALESCE(a.last_active_at, a.last_online_at, a.created_at) < now() - ($2::bigint * interval '1 millisecond')`,
        [id, inactiveMs],
      );
      if (!cur.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }
      const { name, leader_id: leaderId } = cur.rows[0] as { name: string; leader_id: string };
      const heir = await client.query(
        `SELECT m.account_id FROM alliance_members m JOIN accounts a ON a.id = m.account_id
         WHERE m.alliance_id = $1 AND m.account_id <> $2
         ORDER BY CASE m.role WHEN 'vice' THEN 0 ELSE 1 END,
                  CASE WHEN m.role = 'vice' THEN COALESCE(a.last_active_at, a.last_online_at, a.created_at) END DESC NULLS LAST,
                  m.joined_at, m.account_id
         LIMIT 1`,
        [id, leaderId],
      );
      if (!heir.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }
      const heirId = (heir.rows[0] as { account_id: string }).account_id;
      await transferLeader(client, id, leaderId, heirId);
      await recordAllianceEvent(client, id, 'leader_changed', { from: leaderId, to: heirId, reason: 'inactive' });
      await client.query('COMMIT');
      done.push({ allianceId: id, allianceName: name, from: leaderId, to: heirId });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }
  return done;
}

/** 联盟的有效标记（未过期），按创建顺序；联盟内任何成员都能看到 */
export async function loadMarks(q: Q, allianceId: string): Promise<AllianceMarkView[]> {
  const res = await q.query(
    `SELECT m.id, m.x, m.y, m.kind, m.text, m.created_at, m.expires_at, m.creator_id, a.username AS creator_name
     FROM alliance_marks m JOIN accounts a ON a.id = m.creator_id
     WHERE m.alliance_id = $1 AND m.expires_at > now()
     ORDER BY m.created_at, m.id`,
    [allianceId],
  );
  return (res.rows as MarkRow[]).map(markView);
}

/** 一条标记（按 id 且属于该联盟，不含过期判断；调用方自行判断） */
export async function loadMark(q: Q, allianceId: string, markId: number): Promise<AllianceMarkView | null> {
  const res = await q.query(
    `SELECT m.id, m.x, m.y, m.kind, m.text, m.created_at, m.expires_at, m.creator_id, a.username AS creator_name
     FROM alliance_marks m JOIN accounts a ON a.id = m.creator_id
     WHERE m.alliance_id = $1 AND m.id = $2`,
    [allianceId, markId],
  );
  return res.rowCount ? markView(res.rows[0] as MarkRow) : null;
}

interface MarkRow {
  id: string | number;
  x: number;
  y: number;
  kind: AllianceMarkKind;
  text: string;
  created_at: Date;
  expires_at: Date;
  creator_id: string;
  creator_name: string;
}

function markView(row: MarkRow): AllianceMarkView {
  return {
    id: Number(row.id),
    x: row.x,
    y: row.y,
    kind: row.kind,
    text: row.text,
    creator: { accountId: row.creator_id, username: row.creator_name },
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
  };
}

/** 刷新一批账号的最近活跃时刻（在线心跳、登录、断线共用） */
export async function touchActive(q: Q, accountIds: readonly string[]): Promise<void> {
  if (accountIds.length === 0) {
    return;
  }
  await q.query(`UPDATE accounts SET last_active_at = now() WHERE id = ANY($1::uuid[])`, [accountIds]);
}
