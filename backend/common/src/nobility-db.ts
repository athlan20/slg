// 声望与爵位（v76，AISLG-197）的读写：
// - addPrestige 在战斗结算 / 剧本战场军功入账时调用（调用方事务内），达到门槛自动升爵并写播报；
// - loadNobilityStatus 给 GET_NOBILITY / 城池与排行榜复用；
// - claimNobilitySalary 按北京日领取一次俸禄。
// 所有数值口径见 common/src/nobility.ts。

import type pg from 'pg';
import type { ServerBroadcastCreated } from './server-broadcast';
import { insertServerBroadcast } from './server-broadcast';
import type { NobilityStatusView } from './protocol-nobility';
import {
  FAMOUS_CITY_NOBILITY_INDEX,
  nobilityHeroCapBonus,
  nobilityIndexOf,
  nobilityName,
  nobilitySalaryGold,
  nobilityTier,
  nextNobilityTier,
} from './nobility';

type Queryable = pg.Pool | pg.PoolClient;

const DAY_MS = 24 * 3_600_000;
const CST_OFFSET_MS = 8 * 3_600_000;

/** 北京日（YYYY-MM-DD） */
export function beijingDay(now: Date): string {
  return new Date(now.getTime() + CST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 下一个北京时间 0 点 */
export function nextBeijingMidnight(now: Date): Date {
  const shifted = now.getTime() + CST_OFFSET_MS;
  const next = Math.floor(shifted / DAY_MS) * DAY_MS + DAY_MS - CST_OFFSET_MS;
  return new Date(next);
}

export interface PrestigeResult {
  gained: number;
  prestige: number;
  index: number;
  /** 本次跨过的爵位序号（未升爵为 null） */
  promotedTo: number | null;
  /** 升到大夫及以上时的全服播报（调用方提交后推送） */
  broadcast: ServerBroadcastCreated | null;
  name: string;
}

/**
 * 声望入账（调用方事务内）：声望只增不减；跨过门槛时自动升爵，升到大夫及以上写全服播报。
 * 返回升爵信息供调用方写事件 / 推送；amount <= 0 时只读当前状态。
 */
export async function addPrestige(
  client: pg.PoolClient,
  accountId: string,
  amount: number,
  _source: string,
): Promise<PrestigeResult> {
  const gained = Math.max(0, Math.floor(amount));
  // 原子累加：并发战斗不会互相覆盖（先读后写绝对值会丢更新）
  const updated = await client.query(
    `UPDATE accounts SET prestige = prestige + $2 WHERE id = $1 RETURNING prestige, nobility, username`,
    [accountId, gained],
  );
  if (!updated.rowCount) {
    return { gained: 0, prestige: 0, index: 0, promotedTo: null, broadcast: null, name: nobilityName(0) };
  }
  const row = updated.rows[0] as { prestige: string | number; nobility: number; username: string };
  const previous = Math.max(0, Math.floor(Number(row.nobility)));
  const prestige = Number(row.prestige);
  const index = nobilityIndexOf(prestige);
  if (index > previous) {
    await client.query(`UPDATE accounts SET nobility = $2 WHERE id = $1 AND nobility < $2`, [accountId, index]);
  }
  let broadcast: ServerBroadcastCreated | null = null;
  if (index > previous && index >= FAMOUS_CITY_NOBILITY_INDEX) {
    broadcast = await insertServerBroadcast(
      client,
      'nobility_promoted',
      { accountId, username: row.username, nobility: index, name: nobilityName(index), prestige },
      { force: true },
    );
  }
  return {
    gained,
    prestige,
    index,
    promotedTo: index > previous ? index : null,
    broadcast,
    name: nobilityName(index),
  };
}

/** 账号当前爵位序号（未找到账号为 0） */
export async function loadNobilityIndex(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(`SELECT nobility FROM accounts WHERE id = $1`, [accountId]);
  return Math.max(0, Math.floor(Number((res.rows[0] as { nobility: number } | undefined)?.nobility ?? 0)));
}

/** 展示用爵位视图（GET_NOBILITY / 城池详情 / 排行榜共用） */
export async function loadNobilityStatus(
  q: Queryable,
  accountId: string,
  now: Date = new Date(),
): Promise<NobilityStatusView> {
  const account = await q.query(`SELECT prestige, nobility FROM accounts WHERE id = $1`, [accountId]);
  const row = (account.rows[0] as { prestige: string | number; nobility: number } | undefined) ?? {
    prestige: 0,
    nobility: 0,
  };
  const prestige = Number(row.prestige);
  const index = Math.max(0, Math.floor(Number(row.nobility)));
  const tier = nobilityTier(index);
  const next = nextNobilityTier(index);
  const day = beijingDay(now);
  const claim = await q.query(
    `SELECT gold, nobility, claimed_at FROM nobility_claims WHERE account_id = $1 AND day = $2`,
    [accountId, day],
  );
  const claimedToday = Boolean(claim.rowCount);
  const last = await q.query(
    `SELECT claimed_at FROM nobility_claims WHERE account_id = $1 ORDER BY day DESC LIMIT 1`,
    [accountId],
  );
  const salaryGold = nobilitySalaryGold(index);
  return {
    prestige,
    index,
    name: tier.name,
    privilege: tier.privilege,
    next: next ? { index: next.index, name: next.name, threshold: next.threshold } : null,
    progressPercent: next
      ? Math.max(0, Math.min(100, Math.floor(((prestige - tier.threshold) / (next.threshold - tier.threshold)) * 100)))
      : 100,
    salaryGold,
    claimedToday,
    claimable: index > 0 && !claimedToday,
    lastClaimedAt: last.rowCount ? (last.rows[0] as { claimed_at: Date }).claimed_at.toISOString() : null,
    nextClaimAt: (claimedToday ? nextBeijingMidnight(now) : now).toISOString(),
    heroCapBonus: nobilityHeroCapBonus(index),
    canOccupyFamous: index >= FAMOUS_CITY_NOBILITY_INDEX,
  };
}

export interface SalaryClaimResult {
  gold: number;
  index: number;
  name: string;
  prestige: number;
  claimedAt: Date;
}

/**
 * 领取每日俸禄（调用方事务内）：平民无俸禄；北京日只能领一次。
 * 返回 null = 今日已领；noNobility = 平民不能领。
 */
export async function claimNobilitySalary(
  client: pg.PoolClient,
  accountId: string,
  now: Date = new Date(),
): Promise<SalaryClaimResult | 'already' | 'no_nobility'> {
  const account = await client.query(`SELECT prestige, nobility FROM accounts WHERE id = $1 FOR UPDATE`, [accountId]);
  if (!account.rowCount) {
    return 'no_nobility';
  }
  const row = account.rows[0] as { prestige: string | number; nobility: number };
  const index = Math.max(0, Math.floor(Number(row.nobility)));
  if (index === 0) {
    return 'no_nobility';
  }
  const gold = nobilitySalaryGold(index);
  const day = beijingDay(now);
  const inserted = await client.query(
    `INSERT INTO nobility_claims (account_id, day, gold, nobility, claimed_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (account_id, day) DO NOTHING
     RETURNING claimed_at`,
    [accountId, day, gold, index, now],
  );
  if (!inserted.rowCount) {
    return 'already';
  }
  const city = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1`,
    [accountId],
  );
  if (city.rowCount) {
    await client.query(`UPDATE cities SET gold = gold + $2 WHERE id = $1`, [city.rows[0].id, gold]);
  }
  return {
    gold,
    index,
    name: nobilityName(index),
    prestige: Number(row.prestige),
    claimedAt: (inserted.rows[0] as { claimed_at: Date }).claimed_at,
  };
}

/** 批量取爵位序号（聊天 / 排行榜展示用） */
export async function loadNobilityIndexes(
  q: Queryable,
  accountIds: readonly string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(accountIds.filter(Boolean))];
  if (ids.length === 0) {
    return new Map();
  }
  const res = await q.query(`SELECT id, nobility FROM accounts WHERE id = ANY($1::uuid[])`, [ids]);
  return new Map(
    (res.rows as Array<{ id: string; nobility: number }>).map((row) => [row.id, Math.max(0, Number(row.nobility))]),
  );
}