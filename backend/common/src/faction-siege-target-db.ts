// 势力围攻的选目标（AISLG-240，v100；v116，AISLG-264 加仇恨路径）：入池条件只在这里写一份，
// 两条取法共用——回落的「范围内离老巢最近」（pickSiegeTarget）与仇恨路径的「每个账号离老巢最近的
// 合格分城、不看范围」（querySiegeTargetsForAccounts，见 faction-hatred-db.ts 的 pickHatredSiegeTarget）。
// 从 faction-siege-db.ts 分出来，避免那个文件把「选目标」与「围攻行读写 / 节奏计数」混在一起。
// 纯规则与数值在 faction-siege.ts；表结构见 faction-siege-schema.ts（每次围攻一行，随换季清空）。
// 锁序沿用全栈：cities → world_tiles（选目标只读，不改地块；结算在 worker 里加锁）。

import type pg from 'pg';
import { factionOwnsTileSql } from './faction';
import { effectiveLevelSql } from './production';
import type { FactionKey } from './protocol-faction';

type Queryable = pg.Pool | pg.PoolClient;

/** 围攻的候选目标（发起时选一家要打的城） */
export interface SiegeCandidate {
  cityId: string;
  accountId: string;
  x: number;
  y: number;
  governmentLevel: number;
  /** 目标城当前城防值（尚未做惰性回涨，进预警文案时按结算口径再算一次） */
  durability: number | null;
  durabilitySettledAt: Date | null;
  truceUntil: Date | null;
  /** 这家上次打这座城的到达时刻（打赢或打输的；作废的不算），从没打过为 null */
  lastArriveAt: Date | null;
}

/**
 * 选一家势力的围攻目标：玩家**分城**（不是主城）、不是名城。入池条件只在本函数里写一份（v116，AISLG-264）：
 * 目标账号不在新手保护 / 主动免战，城不在被动免战，排除这家正在围 / 刚打输 24 小时内的城，
 * 并排除**已经被别家围攻中的账号**（需求「同一账号同一时间最多被 1 家势力围」）。
 *
 * 两种取法（入池条件完全相同）：
 * - pickSiegeTarget（回落路径）：只看这家势力范围内、离老巢最近（距离相同随机），返回 1 座；
 * - querySiegeTargetsForAccounts（仇恨路径）：只看给定账号（仇恨 > 0 的候选），**不看范围**（哪里的分城都行），
 *   每个账号给「离老巢最近的合格分城」。
 * 同城 6 小时和被动免战算的是到达时刻：这里按最长预警放宽（maxLeadMs），精确判定在发起时用
 * factionSiegeArrival。
 */
interface SiegeCandidateRow {
  id: string;
  account_id: string;
  x: number;
  y: number;
  government_level: number;
  durability: number | null;
  durability_settled_at: Date | null;
  truce_until: Date | null;
  last_arrive_at: Date | null;
}

function toSiegeCandidate(row: SiegeCandidateRow): SiegeCandidate {
  return {
    cityId: row.id,
    accountId: row.account_id,
    x: row.x,
    y: row.y,
    governmentLevel: row.government_level,
    durability: row.durability,
    durabilitySettledAt: row.durability_settled_at,
    truceUntil: row.truce_until,
    lastArriveAt: row.last_arrive_at,
  };
}

/** 两种取法共用的入池查询（参数按条件动态编号，不传用不到的参数） */
function siegeCandidatesQuery(args: {
  faction: FactionKey;
  lair: { x: number; y: number };
  /** null = 不看势力范围（仇恨路径） */
  radius: number | null;
  /** null = 不限账号；给了就只取这些账号的分城，每个账号一行（离老巢最近的） */
  accountIds: readonly string[] | null;
  intervalMs: number;
  maxLeadMs: number;
  lossCooldownMs: number;
  now: Date;
}): { sql: string; params: unknown[] } {
  const params: unknown[] = [args.lair.x, args.lair.y];
  let rangeSql = '';
  if (args.radius !== null) {
    params.push(Math.max(0, Math.floor(args.radius)));
    const radiusParam = `$${params.length}`;
    rangeSql = `AND abs(c.x - $1) <= ${radiusParam} AND abs(c.y - $2) <= ${radiusParam}
       AND ${factionOwnsTileSql(args.faction, 'c.x', 'c.y')}`;
  }
  let accountSql = '';
  if (args.accountIds) {
    params.push(args.accountIds);
    accountSql = `AND c.account_id = ANY($${params.length}::uuid[])`;
  }
  params.push(args.faction);
  const factionParam = `$${params.length}`;
  params.push(Math.max(1000, Math.floor(args.intervalMs)));
  const intervalParam = `$${params.length}`;
  params.push(Math.max(1000, Math.floor(args.lossCooldownMs)));
  const cooldownParam = `$${params.length}`;
  params.push(args.now);
  const nowParam = `$${params.length}`;
  params.push(Math.max(0, Math.floor(args.maxLeadMs)));
  const leadParam = `$${params.length}`;
  const distanceSql = 'GREATEST(ABS(c.x - $1), ABS(c.y - $2))';
  const sql = `SELECT ${args.accountIds ? 'DISTINCT ON (c.account_id) ' : ''}c.id, c.account_id, c.x, c.y,
            ${effectiveLevelSql('g.level', "'government'", 'c.famous_name')} AS government_level,
            c.durability, c.durability_settled_at, c.truce_until, last.arrive_at AS last_arrive_at
     FROM cities c
     JOIN city_buildings g ON g.city_id = c.id AND g.kind = 'government'
     JOIN accounts a ON a.id = c.account_id
     LEFT JOIN (SELECT account_id, MIN(created_at) AS first_created FROM cities GROUP BY account_id) m
       ON m.account_id = c.account_id AND m.first_created = c.created_at
     LEFT JOIN LATERAL (
       SELECT max(s.arrive_at) AS arrive_at FROM faction_sieges s
       WHERE s.faction = ${factionParam} AND s.x = c.x AND s.y = c.y AND s.outcome IN ('hit', 'repelled')
     ) last ON true
     WHERE c.x IS NOT NULL AND c.famous_name IS NULL
       AND m.account_id IS NULL
       ${rangeSql}
       ${accountSql}
       AND (c.truce_until IS NULL OR c.truce_until <= ${nowParam}::timestamptz + make_interval(secs => ${leadParam} / 1000.0))
       AND (a.newbie_until IS NULL OR a.newbie_until <= ${nowParam}::timestamptz)
       AND (a.self_truce_until IS NULL OR a.self_truce_until <= ${nowParam}::timestamptz)
       AND (last.arrive_at IS NULL
            OR last.arrive_at + make_interval(secs => ${intervalParam} / 1000.0)
               <= ${nowParam}::timestamptz + make_interval(secs => ${leadParam} / 1000.0))
       AND NOT EXISTS (
         SELECT 1 FROM faction_sieges s
         WHERE s.faction = ${factionParam} AND s.x = c.x AND s.y = c.y
           AND (
             s.resolved_at IS NULL
             OR (s.outcome = 'repelled' AND s.resolved_at > ${nowParam}::timestamptz - make_interval(secs => ${cooldownParam} / 1000.0))
           )
       )
       AND NOT EXISTS (
         SELECT 1 FROM faction_sieges s2
         WHERE s2.account_id = c.account_id AND s2.resolved_at IS NULL
       )
     ORDER BY ${args.accountIds ? 'c.account_id, ' : ''}${distanceSql}, random()
     ${args.accountIds ? '' : 'LIMIT 1'}`;
  return { sql, params };
}

/**
 * 回落路径：选一家势力范围内**离老巢最近**的玩家分城（主城 / 名城 / 保护中 / 免战中的不入池）；
 * 返回 null = 范围内没有可打的城。仇恨路径见 faction-hatred-db.ts 的 pickHatredSiegeTarget。
 */
export async function pickSiegeTarget(
  q: Queryable,
  args: {
    faction: FactionKey;
    lair: { x: number; y: number };
    radius: number;
    /** 同一座城两次到达之间的最小间隔（毫秒，已按缩放；6 小时） */
    intervalMs: number;
    /** 最长预警提前量（毫秒，已按缩放；满级烽火台） */
    maxLeadMs: number;
    /** 打输（守方守住）后同一座城的冷却（毫秒，已按缩放；24 小时） */
    lossCooldownMs: number;
    now?: Date;
  },
): Promise<SiegeCandidate | null> {
  const { sql, params } = siegeCandidatesQuery({ ...args, radius: args.radius, accountIds: null, now: args.now ?? new Date() });
  const res = await q.query(sql, params);
  const row = res.rows[0] as SiegeCandidateRow | undefined;
  return row ? toSiegeCandidate(row) : null;
}

/**
 * 仇恨路径（v116，AISLG-264）：给定账号里每个账号「离老巢最近的合格分城」，**不看势力范围**。
 * 没有合格分城的账号不在结果里（调用方按仇恨顺序跳过它、换下一个）。
 */
export async function querySiegeTargetsForAccounts(
  q: Queryable,
  args: {
    faction: FactionKey;
    lair: { x: number; y: number };
    accountIds: readonly string[];
    intervalMs: number;
    maxLeadMs: number;
    lossCooldownMs: number;
    now?: Date;
  },
): Promise<SiegeCandidate[]> {
  if (args.accountIds.length === 0) {
    return [];
  }
  const { sql, params } = siegeCandidatesQuery({ ...args, radius: null, now: args.now ?? new Date() });
  const res = await q.query(sql, params);
  return (res.rows as SiegeCandidateRow[]).map(toSiegeCandidate);
}

