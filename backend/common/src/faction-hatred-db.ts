// 五方势力记仇（AISLG-264，v116）的数据库读写：报复仇恨的累加 / 读取（按半衰期折算）、
// 基础仇恨的前 20 名榜单快照（每天重算一次，存 settings）、GET_FACTIONS 的档位、围攻的仇恨选目标。
// 纯规则与数值在 faction-hatred.ts；表结构见 faction-hatred-schema.ts；入池条件在 faction-siege-db.ts。
//
// 基础仇恨不入库：它是「当前前 20 名榜单 × 这家 G1」的派生值，榜单快照存 settings
//（key = 'faction_hatred_base_ranks'，value = { at, ranks: [{ accountId, rank }] }）。读时若快照缺失、
// 超过一天（随 time_scale 缩放）或早于本季开始就重算一次——API 与 Worker 都走同一个函数，不各算一套。

import type pg from 'pg';
import { chebyshevDistance } from './faction';
import {
  factionHatredBaseRefreshMs,
  factionHatredDecayedRetaliation,
  factionHatredLeaderboard,
  factionHatredSiegeOrder,
  factionHatredTier,
  type FactionHatredBaseRank,
  type FactionHatredEntry,
  type FactionHatredRowInput,
} from './faction-hatred';
import { serverPowerTopAccounts } from './faction-lair-rank-db';
import { querySiegeTargetsForAccounts, type SiegeCandidate } from './faction-siege-target-db';
import type { FactionHatredTier, FactionKey } from './protocol-faction';

type Queryable = pg.Pool | pg.PoolClient;
type Writer = pg.Pool | pg.PoolClient;

/** settings 表里的键：基础仇恨用的前 20 名榜单快照（服务端内部数据，不对外暴露） */
export const FACTION_HATRED_RANKS_KEY = 'faction_hatred_base_ranks';

/** 榜单快照的形状（settings.value） */
interface HatredRanksSnapshot {
  /** 快照时刻（ISO 8601） */
  at: string;
  ranks: Array<{ accountId: string; rank: number }>;
}

/**
 * 累加报复仇恨（打这家老巢一场，加这场歼灭的守军战力；与 faction_contrib 同口径、打输也加）。
 * 写时按半衰期折算旧值（需求「读和写时按半衰期折算」）：先锁行读旧值、折算、再累加，
 * 折算规则与读侧同一个纯函数（factionHatredDecayedRetaliation）。
 */
export async function addFactionHatred(
  client: Writer,
  args: { key: FactionKey | string; accountId: string; power: number; now: Date; halfLifeMs?: number },
): Promise<void> {
  const amount = Math.max(0, Math.floor(Number.isFinite(args.power) ? args.power : 0));
  if (amount <= 0) {
    return;
  }
  const existing = await client.query(
    `SELECT retaliation, updated_at FROM faction_hatred WHERE key = $1 AND account_id = $2 FOR UPDATE`,
    [args.key, args.accountId],
  );
  const row = existing.rows[0] as { retaliation: string | number; updated_at: Date } | undefined;
  const kept = row
    ? factionHatredDecayedRetaliation({
        retaliation: Number(row.retaliation),
        updatedAt: new Date(row.updated_at),
        now: args.now,
        halfLifeMs: args.halfLifeMs,
      })
    : 0;
  await client.query(
    `INSERT INTO faction_hatred (key, account_id, retaliation, updated_at) VALUES ($1, $2, $3, $4)
     ON CONFLICT (key, account_id) DO UPDATE SET retaliation = EXCLUDED.retaliation, updated_at = EXCLUDED.updated_at`,
    [args.key, args.accountId, kept + amount, args.now],
  );
}

/** 读取若干家的报复仇恨原始行（未折算；耐 0 的行一并返回，读侧过滤） */
export async function loadFactionHatredRows(
  q: Queryable,
  keys: readonly (FactionKey | string)[],
): Promise<Map<string, FactionHatredRowInput[]>> {
  const map = new Map<string, FactionHatredRowInput[]>();
  if (keys.length === 0) {
    return map;
  }
  const res = await q.query(`SELECT key, account_id, retaliation, updated_at FROM faction_hatred WHERE key = ANY($1::text[])`, [
    keys,
  ]);
  for (const row of res.rows as Array<{ key: string; account_id: string; retaliation: string | number; updated_at: Date }>) {
    const list = map.get(row.key) ?? [];
    list.push({ accountId: row.account_id, retaliation: Number(row.retaliation), updatedAt: new Date(row.updated_at) });
    map.set(row.key, list);
  }
  return map;
}

/**
 * 基础仇恨用的全服战力榜前 20 名（快照，每天（随缩放）或新赛季开始时重算一次）。
 * 全服没兵时返回空数组（五家的基础仇恨都是 0），不写空快照也算「已刷新」——避免每 tick 重算。
 */
export async function loadHatredBaseRanks(
  q: Queryable,
  now: Date,
  seasonStart: Date | null = null,
): Promise<FactionHatredBaseRank[]> {
  const res = await q.query(`SELECT value FROM settings WHERE key = $1`, [FACTION_HATRED_RANKS_KEY]);
  const snapshot = (res.rows[0] as { value: HatredRanksSnapshot } | undefined)?.value;
  const atMs = snapshot?.at ? new Date(snapshot.at).getTime() : NaN;
  const fresh =
    Number.isFinite(atMs) &&
    now.getTime() - atMs < factionHatredBaseRefreshMs() &&
    (!seasonStart || atMs >= seasonStart.getTime());
  if (fresh && Array.isArray(snapshot?.ranks)) {
    return snapshot.ranks;
  }
  const ranks = await serverPowerTopAccounts(q);
  const value: HatredRanksSnapshot = {
    at: now.toISOString(),
    ranks: ranks.map((row) => ({ accountId: row.accountId, rank: row.rank })),
  };
  await q.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [FACTION_HATRED_RANKS_KEY, JSON.stringify(value)],
  );
  return value.ranks;
}

/**
 * 一家势力的仇恨榜（基础 + 折算后的报复，仇恨 > 0，已按围攻选目标的顺序排好）。
 * g1 = 这家老巢第 1 营的战力（基础仇恨的基准，见 faction-lair.ts）。
 */
export async function loadFactionHatredLeaderboard(
  q: Queryable,
  args: { faction: FactionKey; g1: number; now: Date; seasonStart?: Date | null; halfLifeMs?: number },
): Promise<FactionHatredEntry[]> {
  const baseRanks = await loadHatredBaseRanks(q, args.now, args.seasonStart ?? null);
  const rows = (await loadFactionHatredRows(q, [args.faction])).get(args.faction) ?? [];
  return factionHatredLeaderboard({ rows, baseRanks, g1: args.g1, now: args.now, halfLifeMs: args.halfLifeMs });
}

/**
 * GET_FACTIONS 的 hatredTier（v116，AISLG-264）：请求者自己在这几家仇恨榜上的档位。
 * 一次读取全部势力的报复仇恨 + 一份榜单快照（不逐家查询）；不在榜上 / 仇恨为 0 一律 none。
 * 请求者未登录（accountId 为 null）时返回空 Map，调用方按 none 处理。
 */
export async function loadFactionHatredTiers(
  q: Queryable,
  args: {
    accountId: string | null;
    factions: ReadonlyArray<{ key: FactionKey; g1: number }>;
    now: Date;
    seasonStart?: Date | null;
  },
): Promise<Map<string, FactionHatredTier>> {
  const tiers = new Map<string, FactionHatredTier>();
  if (!args.accountId || args.factions.length === 0) {
    return tiers;
  }
  const baseRanks = await loadHatredBaseRanks(q, args.now, args.seasonStart ?? null);
  const rows = await loadFactionHatredRows(
    q,
    args.factions.map((faction) => faction.key),
  );
  for (const faction of args.factions) {
    const entries = factionHatredLeaderboard({
      rows: rows.get(faction.key) ?? [],
      baseRanks,
      g1: faction.g1,
      now: args.now,
    });
    const index = entries.findIndex((entry) => entry.accountId === args.accountId);
    tiers.set(
      faction.key,
      factionHatredTier(index >= 0 ? index + 1 : null, index >= 0 ? entries[index].hatred : 0),
    );
  }
  return tiers;
}

/** 仇恨选中的围攻目标：目标城 + 它对这家的仇恨与战力榜名次（日志 / 测试用） */
export interface HatredSiegeTarget {
  candidate: SiegeCandidate;
  hatred: number;
  powerRank: number | null;
}

/**
 * 仇恨路径的选目标（需求「二、势力选谁围」）：候选 = 这家仇恨 > 0 且有一座合格分城的账号，
 * **不要求在势力范围内**；按仇恨 → 战力榜名次 → 分城离老巢距离排序，取第一个；围他离老巢最近的合格分城。
 * 已被别家围攻中的账号、没有合格分城的账号跳过（换下一个，入池条件见 faction-siege-db.ts）。
 * 候选为空返回 null，调用方回落到「范围内离老巢最近」的 pickSiegeTarget。
 * g1 = 这家老巢第 1 营的战力（基础仇恨的基准）。
 */
export async function pickHatredSiegeTarget(
  q: Queryable,
  args: {
    faction: FactionKey;
    lair: { x: number; y: number };
    g1: number;
    /** 同一座城两次到达之间的最小间隔（毫秒，已按缩放；6 小时） */
    intervalMs: number;
    /** 最长预警提前量（毫秒，已按缩放；满级烽火台） */
    maxLeadMs: number;
    /** 打输（守方守住）后同一座城的冷却（毫秒，已按缩放；24 小时） */
    lossCooldownMs: number;
    now: Date;
    seasonStart?: Date | null;
  },
): Promise<HatredSiegeTarget | null> {
  const entries = await loadFactionHatredLeaderboard(q, {
    faction: args.faction,
    g1: args.g1,
    now: args.now,
    seasonStart: args.seasonStart ?? null,
  });
  if (entries.length === 0) {
    return null;
  }
  const cities = await querySiegeTargetsForAccounts(q, {
    faction: args.faction,
    lair: args.lair,
    accountIds: entries.map((entry) => entry.accountId),
    intervalMs: args.intervalMs,
    maxLeadMs: args.maxLeadMs,
    lossCooldownMs: args.lossCooldownMs,
    now: args.now,
  });
  if (cities.length === 0) {
    return null;
  }
  const byAccount = new Map(cities.map((city) => [city.accountId, city]));
  const candidates = entries
    .filter((entry) => byAccount.has(entry.accountId))
    .map((entry) => {
      const city = byAccount.get(entry.accountId) as SiegeCandidate;
      return {
        entry,
        city,
        distance: chebyshevDistance(args.lair, { x: city.x, y: city.y }),
      };
    });
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((a, b) =>
    factionHatredSiegeOrder(
      { hatred: a.entry.hatred, powerRank: a.entry.powerRank, distance: a.distance, accountId: a.entry.accountId },
      { hatred: b.entry.hatred, powerRank: b.entry.powerRank, distance: b.distance, accountId: b.entry.accountId },
    ),
  );
  const best = candidates[0];
  return { candidate: best.city, hatred: best.entry.hatred, powerRank: best.entry.powerRank };
}