// 竞技场的数据库存取（v53，AISLG-145）：API（查询 / 保存阵容 / 挑战 / 战报）与 Worker（每日奖励）共用。
// 所有会改名次的事务先 lockArena（咨询锁）串行化，互换名次靠 rank 的可延迟唯一约束在一条 UPDATE 里完成。

import pg from 'pg';
import {
  ARENA_NPC_COUNT,
  ARENA_REPORT_KEEP_DAYS,
  ARENA_SLOTS,
  arenaDayIndex,
  milestoneRewards,
  npcLineup,
  seededRng,
  type ArenaFighter,
  type ArenaMatchResult,
} from './arena';
import type { AccountHeroRow } from './hero-db';
import type { ArenaFighterView, ArenaMatchView } from './protocol-arena';

type Queryable = pg.Pool | pg.PoolClient;

/** 竞技场咨询锁 id（任意固定整数，只要不与 db.ts 的 SCHEMA_LOCK_ID 等冲突） */
export const ARENA_LOCK_ID = 7_450_145;

/** 事务内拿竞技场锁（事务结束自动释放）：所有读后改名次的流程先调它 */
export async function lockArena(client: pg.PoolClient): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1)', [ARENA_LOCK_ID]);
}

export interface ArenaEntryRow {
  id: string;
  account_id: string | null;
  rank: number;
  slot1: string | null;
  slot2: string | null;
  slot3: string | null;
  best_rank: number;
  milestone_best: number | null;
  last_reward_day: string | null;
  npc_name: string | null;
  npc_lineup: ArenaFighter[] | null;
  created_at: Date;
}

/** 席位 + 展示名（玩家取昵称，守擂者取 npc_name） */
export interface ArenaEntryWithName extends ArenaEntryRow {
  username: string;
}

const ENTRY_SELECT = `
  SELECT e.*, COALESCE(a.username, e.npc_name) AS username
  FROM arena_entries e LEFT JOIN accounts a ON a.id = e.account_id`;

/** 榜上没有守擂者时（首次使用）补 ARENA_NPC_COUNT 个：名次 1 最强，调用方事务内且已 lockArena */
export async function ensureArenaNpcs(client: pg.PoolClient): Promise<void> {
  const have = await client.query(`SELECT count(*)::int AS n FROM arena_entries WHERE account_id IS NULL`);
  if ((have.rows[0] as { n: number }).n > 0) {
    return;
  }
  const maxRes = await client.query(`SELECT COALESCE(max(rank), 0)::int AS m FROM arena_entries`);
  const base = (maxRes.rows[0] as { m: number }).m;
  for (let i = 1; i <= ARENA_NPC_COUNT; i += 1) {
    const lineup = npcLineup(i, seededRng(7_000 + i));
    const rank = base + i;
    await client.query(
      `INSERT INTO arena_entries (rank, best_rank, npc_name, npc_lineup) VALUES ($1, $1, $2, $3::jsonb)`,
      [rank, `守擂·${lineup[0].name}`, JSON.stringify(lineup)],
    );
  }
}

export async function loadEntryByAccount(
  q: Queryable,
  accountId: string,
  forUpdate = false,
): Promise<ArenaEntryWithName | null> {
  const res = await q.query(
    `${ENTRY_SELECT} WHERE e.account_id = $1${forUpdate ? ' FOR UPDATE OF e' : ''}`,
    [accountId],
  );
  return res.rowCount ? (res.rows[0] as ArenaEntryWithName) : null;
}

export async function loadEntryById(q: Queryable, id: string, forUpdate = false): Promise<ArenaEntryWithName | null> {
  const res = await q.query(`${ENTRY_SELECT} WHERE e.id = $1${forUpdate ? ' FOR UPDATE OF e' : ''}`, [id]);
  return res.rowCount ? (res.rows[0] as ArenaEntryWithName) : null;
}

export async function countEntries(q: Queryable): Promise<number> {
  const res = await q.query(`SELECT count(*)::int AS n FROM arena_entries`);
  return (res.rows[0] as { n: number }).n;
}

/** 榜单前 n 名 */
export async function loadTop(q: Queryable, n: number): Promise<Array<{ rank: number; username: string; npc: boolean }>> {
  const res = await q.query(
    `SELECT e.rank, COALESCE(a.username, e.npc_name) AS username, (e.account_id IS NULL) AS npc
     FROM arena_entries e LEFT JOIN accounts a ON a.id = e.account_id
     ORDER BY e.rank LIMIT $1`,
    [n],
  );
  return res.rows as Array<{ rank: number; username: string; npc: boolean }>;
}

/** 名次在 [myRank - gap, myRank - 1] 的席位，按名次从近到远（名次大的在前） */
export async function loadOpponentRows(q: Queryable, myRank: number, gap: number): Promise<ArenaEntryWithName[]> {
  const res = await q.query(
    `${ENTRY_SELECT} WHERE e.rank >= $1 AND e.rank < $2 ORDER BY e.rank DESC`,
    [Math.max(1, myRank - gap), myRank],
  );
  return res.rows as ArenaEntryWithName[];
}

/** 入榜：排在最后一名；当日不发每日奖励（last_reward_day 记为当前竞技日） */
export async function joinArena(
  client: pg.PoolClient,
  accountId: string,
  slots: Array<string | null>,
  now: Date,
): Promise<{ id: string; rank: number }> {
  const maxRes = await client.query(`SELECT COALESCE(max(rank), 0)::int AS m FROM arena_entries`);
  const rank = (maxRes.rows[0] as { m: number }).m + 1;
  // 入榜名次即进档基线（milestone_best）：入榜不发进档奖励，之后历史最好名次跨过档位才发
  const ins = await client.query(
    `INSERT INTO arena_entries (account_id, rank, best_rank, milestone_best, slot1, slot2, slot3, last_reward_day)
     VALUES ($1, $2, $2, $2, $3, $4, $5, $6) RETURNING id`,
    [accountId, rank, slots[0] ?? null, slots[1] ?? null, slots[2] ?? null, arenaDayIndex(now)],
  );
  return { id: (ins.rows[0] as { id: string }).id, rank };
}

export async function saveLineup(client: pg.PoolClient, entryId: string, slots: Array<string | null>): Promise<void> {
  await client.query(`UPDATE arena_entries SET slot1 = $2, slot2 = $3, slot3 = $4 WHERE id = $1`, [
    entryId,
    slots[0] ?? null,
    slots[1] ?? null,
    slots[2] ?? null,
  ]);
}

/** 互换两个席位的名次，并刷新双方历史最好名次（一条 UPDATE，靠可延迟唯一约束过关） */
export async function swapRanks(
  client: pg.PoolClient,
  a: { id: string; rank: number },
  b: { id: string; rank: number },
): Promise<void> {
  await client.query(
    `UPDATE arena_entries
     SET rank = CASE id WHEN $1::uuid THEN $4::int ELSE $3::int END,
         best_rank = LEAST(best_rank, CASE id WHEN $1::uuid THEN $4::int ELSE $3::int END)
     WHERE id IN ($1::uuid, $2::uuid)`,
    [a.id, b.id, a.rank, b.rank],
  );
}

/**
 * 一批席位的 3 个号位 → 展示快照，武将只查一次（玩家读武将当前属性；缺位 / 武将已被解雇为 null；守擂者读存档）。
 * 返回 entryId → 阵容；避免按席位逐个查武将（榜上最多 10 个对手）。
 */
export async function entryLineups(q: Queryable, entries: ArenaEntryRow[]): Promise<Map<string, Array<ArenaFighterView | null>>> {
  const wanted = new Set<string>();
  for (const entry of entries) {
    for (const id of [entry.slot1, entry.slot2, entry.slot3]) {
      if (entry.account_id !== null && id !== null) {
        wanted.add(id);
      }
    }
  }
  const heroes = new Map<string, AccountHeroRow>();
  if (wanted.size > 0) {
    const res = await q.query(`SELECT * FROM account_heroes WHERE id = ANY($1::uuid[])`, [[...wanted]]);
    for (const row of res.rows as AccountHeroRow[]) {
      heroes.set(row.id, row);
    }
  }
  const out = new Map<string, Array<ArenaFighterView | null>>();
  for (const entry of entries) {
    if (entry.account_id === null) {
      const stored = entry.npc_lineup ?? [];
      out.set(
        entry.id,
        Array.from({ length: ARENA_SLOTS }, (_, i) => {
          const f = stored[i];
          return f ? { heroId: null, name: f.name, lead: f.lead, force: f.force, wit: f.wit, level: f.level } : null;
        }),
      );
      continue;
    }
    out.set(
      entry.id,
      [entry.slot1, entry.slot2, entry.slot3].map((id) => {
        const row = id ? heroes.get(id) : undefined;
        // 武将必须仍属于该账号（解雇后 slot 已被 ON DELETE SET NULL 清空，这里再守一道）
        return row && row.account_id === entry.account_id
          ? { heroId: row.id, name: row.name, lead: row.lead, force: row.force, wit: row.wit, level: row.level }
          : null;
      }),
    );
  }
  return out;
}

/** 单个席位的阵容（见 entryLineups） */
export async function entryLineup(q: Queryable, entry: ArenaEntryRow): Promise<Array<ArenaFighterView | null>> {
  return (await entryLineups(q, [entry])).get(entry.id) ?? [null, null, null];
}

/**
 * 启动时补齐系统守擂者（API 启动调用一次）。写路径仍会在锁内兜底补种，读路径不再为补种抢锁。
 */
export async function seedArenaNpcs(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await lockArena(client);
    await ensureArenaNpcs(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// ---- 竞技日计数 ----

export interface ArenaDailyRow {
  challenges: number;
  defended: number;
}

export async function loadDaily(q: Queryable, accountId: string, day: number): Promise<ArenaDailyRow> {
  const res = await q.query(`SELECT challenges, defended FROM arena_daily WHERE account_id = $1 AND day = $2`, [
    accountId,
    day,
  ]);
  return res.rowCount ? (res.rows[0] as ArenaDailyRow) : { challenges: 0, defended: 0 };
}

/** 一批账号当日被挑战的次数（榜单对手列表用） */
export async function loadDefendedMap(q: Queryable, accountIds: string[], day: number): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  if (accountIds.length === 0) {
    return map;
  }
  const res = await q.query(
    `SELECT account_id, defended FROM arena_daily WHERE account_id = ANY($1::uuid[]) AND day = $2`,
    [accountIds, day],
  );
  for (const row of res.rows as Array<{ account_id: string; defended: number }>) {
    map.set(row.account_id, row.defended);
  }
  return map;
}

export async function bumpDaily(
  client: pg.PoolClient,
  accountId: string,
  day: number,
  field: 'challenges' | 'defended',
): Promise<void> {
  await client.query(
    `INSERT INTO arena_daily (account_id, day, ${field}) VALUES ($1, $2, 1)
     ON CONFLICT (account_id, day) DO UPDATE SET ${field} = arena_daily.${field} + 1`,
    [accountId, day],
  );
  await client.query(`DELETE FROM arena_daily WHERE account_id = $1 AND day < $2`, [accountId, day - 3]);
}

/** 我最近一次挑战某席位的时刻（同一对手冷却用） */
export async function lastChallengeAt(q: Queryable, challengerAccountId: string, defenderEntryId: string): Promise<Date | null> {
  const res = await q.query(
    `SELECT created_at FROM arena_matches WHERE challenger_account_id = $1 AND defender_entry_id = $2
     ORDER BY id DESC LIMIT 1`,
    [challengerAccountId, defenderEntryId],
  );
  return res.rowCount ? (res.rows[0] as { created_at: Date }).created_at : null;
}

// ---- 战报 ----

export interface ArenaMatchStored {
  challengerWins: number;
  defenderWins: number;
  rounds: ArenaMatchResult['rounds'];
  challengerLineup: Array<ArenaFighterView | null>;
  defenderLineup: Array<ArenaFighterView | null>;
}

export interface ArenaMatchInsert {
  challengerAccountId: string;
  challengerName: string;
  challengerRankBefore: number;
  challengerRankAfter: number;
  defender: ArenaEntryWithName;
  defenderRankAfter: number;
  challengerWon: boolean;
  seed: number;
  stored: ArenaMatchStored;
}

/** 写战报并顺手清理超过保留期的旧战报；返回战报 id */
export async function insertMatch(client: pg.PoolClient, m: ArenaMatchInsert): Promise<{ id: number; createdAt: Date }> {
  const res = await client.query(
    `INSERT INTO arena_matches (
       challenger_account_id, challenger_name, challenger_rank_before, challenger_rank_after,
       defender_entry_id, defender_account_id, defender_name, defender_rank_before, defender_rank_after,
       challenger_won, seed, result)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) RETURNING id, created_at`,
    [
      m.challengerAccountId,
      m.challengerName,
      m.challengerRankBefore,
      m.challengerRankAfter,
      m.defender.id,
      m.defender.account_id,
      m.defender.username,
      m.defender.rank,
      m.defenderRankAfter,
      m.challengerWon,
      m.seed,
      JSON.stringify(m.stored),
    ],
  );
  await client.query(`DELETE FROM arena_matches WHERE created_at < now() - make_interval(days => $1)`, [
    ARENA_REPORT_KEEP_DAYS,
  ]);
  const row = res.rows[0] as { id: string | number; created_at: Date };
  return { id: Number(row.id), createdAt: row.created_at };
}

interface MatchRow {
  id: string | number;
  challenger_account_id: string;
  challenger_name: string;
  challenger_rank_before: number;
  challenger_rank_after: number;
  defender_account_id: string | null;
  defender_name: string;
  defender_rank_before: number;
  defender_rank_after: number;
  challenger_won: boolean;
  result: ArenaMatchStored;
  created_at: Date;
}

export function matchView(row: MatchRow, myAccountId: string): ArenaMatchView {
  return {
    id: Number(row.id),
    createdAt: row.created_at.toISOString(),
    role: row.challenger_account_id === myAccountId ? 'challenger' : 'defender',
    challenger: {
      username: row.challenger_name,
      rankBefore: row.challenger_rank_before,
      rankAfter: row.challenger_rank_after,
    },
    defender: {
      username: row.defender_name,
      npc: row.defender_account_id === null,
      rankBefore: row.defender_rank_before,
      rankAfter: row.defender_rank_after,
    },
    challengerWon: row.challenger_won,
    challengerWins: row.result.challengerWins,
    defenderWins: row.result.defenderWins,
    rounds: row.result.rounds,
    challengerLineup: row.result.challengerLineup,
    defenderLineup: row.result.defenderLineup,
  };
}

/** 我参与的战报（挑战过别人的与被别人挑战的），新 → 旧；多取一条判断 hasMore */
export async function loadMatches(
  q: Queryable,
  accountId: string,
  limit: number,
  beforeId: number | null,
): Promise<{ reports: ArenaMatchView[]; hasMore: boolean }> {
  const res = await q.query(
    `SELECT * FROM arena_matches
     WHERE (challenger_account_id = $1 OR defender_account_id = $1) AND ($2::bigint IS NULL OR id < $2::bigint)
     ORDER BY id DESC LIMIT $3`,
    [accountId, beforeId, limit + 1],
  );
  const rows = res.rows as MatchRow[];
  return { reports: rows.slice(0, limit).map((row) => matchView(row, accountId)), hasMore: rows.length > limit };
}

export async function loadMatchById(q: Queryable, id: number, accountId: string): Promise<ArenaMatchView | null> {
  const res = await q.query(`SELECT * FROM arena_matches WHERE id = $1`, [id]);
  return res.rowCount ? matchView(res.rows[0] as MatchRow, accountId) : null;
}

// ---- 奖励入账 ----

/** 把金币记进账号主城（账号第一座城，调用方事务内）；账号暂时没有城返回 false */
export async function creditCapitalGold(client: pg.PoolClient, accountId: string, gold: number): Promise<boolean> {
  const cap = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE`,
    [accountId],
  );
  if (!cap.rowCount) {
    return false;
  }
  await client.query(`UPDATE cities SET gold = gold + $2 WHERE id = $1`, [(cap.rows[0] as { id: string }).id, gold]);
  return true;
}

/**
 * 结算进档奖励：历史最好名次从基线（milestone_best）升进新档时发一次。入榜时基线即入榜名次，所以入榜不发。
 * 只有金币真正到账才推进 milestone_best；账号没有城时本次不发、基线不动，下次有城再一并补发，不丢档。
 * 历史遗留的基线为空的行，用挑战前的 best_rank 作基线（不回填已跨过的档）。
 * 调用方须已持有竞技场锁，且 entry 是事务内读出的当前行（bestRank 之前的 best_rank 即挑战前的最好名次）。
 */
export async function settleMilestone(
  client: pg.PoolClient,
  accountId: string,
  entry: { id: string; milestone_best: number | null; best_rank: number },
  bestRank: number,
): Promise<{ gold: number; tiers: number[] }> {
  const base = entry.milestone_best ?? entry.best_rank;
  const ms = milestoneRewards(base, bestRank);
  if (ms.gold === 0) {
    // 没有新档：只推进基线到更好的名次（不改变已发档位）
    if (bestRank < base) {
      await client.query(`UPDATE arena_entries SET milestone_best = $2 WHERE id = $1`, [entry.id, bestRank]);
    }
    return { gold: 0, tiers: [] };
  }
  if (!(await creditCapitalGold(client, accountId, ms.gold))) {
    return { gold: 0, tiers: [] };
  }
  await client.query(`UPDATE arena_entries SET milestone_best = $2 WHERE id = $1`, [entry.id, bestRank]);
  return ms;
}
