// 名将被俘与赎回的数据库存取（v93，AISLG-228）。被俘只在玩家打玩家时由 Worker 调用（tryCaptureHero），
// 赎回由 API 调用（payRansom）。两者都要求调用方已对武将行加锁或在同一事务内加锁：
// 行锁串行化「赎回」与「囚禁到期下野」，二者只能生效一个。锁序：主人主城（调用方已锁）→ 武将行 → 胜方主城。

import type pg from 'pg';
import { EventType, type ErrorCode } from './protocol';
import { insertEvent } from './events';
import { insertServerBroadcast, type ServerBroadcastCreated } from './server-broadcast';
import { loadHero, isCaptive, type AccountHeroRow } from './hero-db';
import {
  CAPTIVE_HOURS,
  CAPTURE_LIMIT_DAYS,
  loyaltyAfterRansom,
  ransomCost,
  ransomTakerShare,
  rollCapture,
} from './hero-loyalty';
import { scaledSeconds } from './time-scale';
import { setLoyalty } from './hero-loyalty-db';

/** 被俘结果：双方账号与囚禁截止；broadcast 为全服播报（限频丢弃时为 null） */
export interface CaptureOutcome {
  heroId: string;
  heroName: string;
  ownerAccountId: string;
  captorAccountId: string;
  capturedUntil: Date;
  ransomGold: number;
  broadcast: ServerBroadcastCreated | null;
}

/**
 * 尝试俘虏一名武将（v93，AISLG-228；调用方为玩家打玩家的结算事务）：
 * - 只有带忠诚度的武将（在野名将）可被俘；已被俘 / 主人即胜方 / 武将不存在 → null；
 * - 账号 7 天内已被俘过 1 名 → null（频率限制按主人账号，不管赎没赎回）；限制行 FOR UPDATE 串行化同账号的并发判定；
 * - 概率 = 5% + (100 − 忠诚度) × 0.25%，rng 注入（默认 Math.random）；未中 → null，不改任何数据；
 * - 中：囚禁 24 小时（随缩放），撤下城守，写 hero_captured 事件（主人与胜方各一条）。
 * 调用方负责把攻方随队的 march.hero_id 清空（若被俘的是随队武将），并把 broadcast 推送出去。
 */
export async function tryCaptureHero(
  client: pg.PoolClient,
  args: { heroId: string; captorAccountId: string; cityId?: string | null; rng?: () => number },
): Promise<CaptureOutcome | null> {
  const hero = await loadHero(client, args.heroId, true);
  if (!hero || hero.loyalty === null || isCaptive(hero) || hero.account_id === args.captorAccountId) {
    return null;
  }
  await client.query(`INSERT INTO hero_capture_limits (account_id) VALUES ($1) ON CONFLICT DO NOTHING`, [hero.account_id]);
  const limit = await client.query(
    `SELECT captured_at > now() - make_interval(secs => $2) AS recent
     FROM hero_capture_limits WHERE account_id = $1 FOR UPDATE`,
    [hero.account_id, scaledSeconds(CAPTURE_LIMIT_DAYS * 24 * 3600)],
  );
  if ((limit.rows[0] as { recent: boolean }).recent) {
    return null;
  }
  if (!rollCapture(hero.loyalty, args.rng ?? Math.random)) {
    return null;
  }
  const upd = await client.query(
    `UPDATE account_heroes SET captured_by = $2, captured_until = now() + make_interval(secs => $3)
     WHERE id = $1 RETURNING captured_until`,
    [hero.id, args.captorAccountId, scaledSeconds(CAPTIVE_HOURS * 3600)],
  );
  const capturedUntil = (upd.rows[0] as { captured_until: Date }).captured_until;
  await client.query(`UPDATE cities SET guard_hero_id = NULL WHERE guard_hero_id = $1`, [hero.id]);
  await client.query(`UPDATE hero_capture_limits SET captured_at = now() WHERE account_id = $1`, [hero.account_id]);
  const names = await client.query(
    `SELECT id, username FROM accounts WHERE id = ANY($1::uuid[])`,
    [[hero.account_id, args.captorAccountId]],
  );
  const usernameOf = new Map((names.rows as Array<{ id: string; username: string }>).map((row) => [row.id, row.username]));
  const ownerName = usernameOf.get(hero.account_id) ?? null;
  const captorName = usernameOf.get(args.captorAccountId) ?? null;
  const ransomGold = ransomCost(hero.level);
  const detail = {
    heroId: hero.id,
    heroName: hero.name,
    ownerUsername: ownerName,
    captorUsername: captorName,
    capturedUntil: capturedUntil.toISOString(),
    ransomGold,
  };
  await insertEvent(client, {
    accountId: hero.account_id,
    cityId: args.cityId ?? undefined,
    buildId: hero.id,
    type: EventType.HERO_CAPTURED,
    initiator: null,
    detail: { ...detail, side: 'owner' },
  });
  await insertEvent(client, {
    accountId: args.captorAccountId,
    buildId: hero.id,
    type: EventType.HERO_CAPTURED,
    initiator: null,
    detail: { ...detail, side: 'captor' },
  });
  const broadcast = await insertServerBroadcast(client, 'hero_captured', {
    ownerUsername: ownerName,
    captorUsername: captorName,
    heroName: hero.name,
  });
  return {
    heroId: hero.id,
    heroName: hero.name,
    ownerAccountId: hero.account_id,
    captorAccountId: args.captorAccountId,
    capturedUntil,
    ransomGold,
    broadcast,
  };
}

/** 赎回结果（成功时）：金额拆分与赎回后的武将 */
export interface RansomOutcome {
  hero: AccountHeroRow;
  cost: number;
  taxShare: number;
  destroyed: number;
  captorAccountId: string;
}

/**
 * 赎回（v93，AISLG-228；调用方已锁住主人主城 capitalId，并在同一事务内）：
 * 武将必须属于 ownerAccountId 且处于囚禁中（截止时刻仍在未来）；否则 HERO_NOT_FOUND / HERO_NOT_CAPTURED。
 * 金币不足 → INSUFFICIENT_RESOURCES（不改数据）。成功：主人主城扣全额赎金，胜方主城收 50%（向下取整），
 * 另一半销毁（胜方无城时全部销毁）；武将立刻回归（囚禁清空），忠诚度 −20 最低 1；俸禄与欠饷的时间锚点
 * 重置为现在（囚禁期间不计）。写 hero_ransomed 事件给双方。
 */
export async function payRansom(
  client: pg.PoolClient,
  args: { ownerAccountId: string; heroId: string; capitalId: string },
): Promise<RansomOutcome | { error: ErrorCode }> {
  const hero = await loadHero(client, args.heroId, true);
  if (!hero || hero.account_id !== args.ownerAccountId) {
    return { error: 'HERO_NOT_FOUND' };
  }
  const nowRes = await client.query(`SELECT now() AS now`);
  const now = nowRes.rows[0].now as Date;
  if (!isCaptive(hero) || (hero.captured_until as Date).getTime() <= now.getTime()) {
    return { error: 'HERO_NOT_CAPTURED' };
  }
  const captorAccountId = hero.captured_by as string;
  const cost = ransomCost(hero.level);
  const capRes = await client.query(`SELECT gold FROM cities WHERE id = $1 FOR UPDATE`, [args.capitalId]);
  const gold = Number((capRes.rows[0] as { gold: number } | undefined)?.gold ?? 0);
  if (gold < cost) {
    return { error: 'INSUFFICIENT_RESOURCES' };
  }
  await client.query(`UPDATE cities SET gold = gold - $2 WHERE id = $1`, [args.capitalId, cost]);
  // 胜方没有城（重置窗口）时分成无处可去，整笔销毁
  const takerCap = await client.query(
    `SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at, id LIMIT 1 FOR UPDATE`,
    [captorAccountId],
  );
  const taxShare = takerCap.rowCount ? ransomTakerShare(cost) : 0;
  if (takerCap.rowCount && taxShare > 0) {
    await client.query(`UPDATE cities SET gold = gold + $2 WHERE id = $1`, [(takerCap.rows[0] as { id: string }).id, taxShare]);
  }
  const destroyed = cost - taxShare;
  await client.query(
    `UPDATE account_heroes SET captured_by = NULL, captured_until = NULL, salary_at = now(),
            loyalty_arrears_at = CASE WHEN arrears THEN now() ELSE NULL END, loyalty_at = now()
     WHERE id = $1`,
    [hero.id],
  );
  hero.captured_by = null;
  hero.captured_until = null;
  await setLoyalty(client, hero, loyaltyAfterRansom(hero.loyalty ?? 1));
  const names = await client.query(`SELECT id, username FROM accounts WHERE id = ANY($1::uuid[])`, [
    [args.ownerAccountId, captorAccountId],
  ]);
  const usernameOf = new Map((names.rows as Array<{ id: string; username: string }>).map((row) => [row.id, row.username]));
  const detail = {
    heroId: hero.id,
    heroName: hero.name,
    ransomGold: cost,
    taxShare,
    destroyed,
    ownerUsername: usernameOf.get(args.ownerAccountId) ?? null,
    captorUsername: usernameOf.get(captorAccountId) ?? null,
    loyalty: hero.loyalty,
  };
  await insertEvent(client, { accountId: args.ownerAccountId, buildId: hero.id, type: EventType.HERO_RANSOMED, initiator: null, detail: { ...detail, side: 'owner' } });
  await insertEvent(client, { accountId: captorAccountId, buildId: hero.id, type: EventType.HERO_RANSOMED, initiator: null, detail: { ...detail, side: 'captor' } });
  return { hero, cost, taxShare, destroyed, captorAccountId };
}
