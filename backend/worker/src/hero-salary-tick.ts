// 武将俸禄的周期结算（v36，AISLG-114）：每名武将每小时（随全局时间缩放）从账号主城
// 扣俸禄（普通将 20 × 等级、名将 100 × 等级，速率随倍速放大）。主城金币不够时该武将
// 「欠饷」（arrears=true，不能出征），扣款成功自动恢复。模式对齐 starvation-tick：
// 单 tick 节流扫描 + 每次只结一小时的账（停机积压由后续 tick 自然补发），
// 事务内结算 + pg_notify 推送 PUSH_HERO_STATE。

import pg from 'pg';
import { EventType } from '../../common/src/protocol';
import { insertEvent } from '../../common/src/events';
import { scaledMs, scaledRate } from '../../common/src/time-scale';
import { salaryPerHour } from '../../common/src/hero';
import { isCaptive, type AccountHeroRow } from '../../common/src/hero-db';
import { LOYALTY_ARREARS_PER_HOUR } from '../../common/src/hero-loyalty';
import { setLoyalty } from '../../common/src/hero-loyalty-db';
import { NOTIFY_CHANNEL } from '../../common/src/db';

/** tick 节流（毫秒）：俸禄按小时结算，10 秒扫一次足够 */
export const HERO_SALARY_TICK_MS = 10_000;
/** 单 tick 最多处理的武将数（补发积压时分批推进） */
const SWEEP_LIMIT = 100;

let lastRunMs = 0;

export interface SalaryNotice {
  accountId: string;
  data: { reason: 'arrears' | 'salary_paid'; heroId: string; heroName: string };
}

/**
 * 欠饷期间的忠诚度损失（v94，AISLG-228）：只有带忠诚度的武将；欠饷开始时起算锚点，之后每满 1 小时（基准，
 * 随缩放）−1，由本函数在俸禄结算里按小时结清（不是每次 tick 都扣）。
 */
async function settleArrearsLoyalty(client: pg.PoolClient, hero: AccountHeroRow, nowMs: number): Promise<void> {
  if (hero.loyalty === null) {
    return;
  }
  const intervalMs = scaledMs(3_600_000);
  const anchor = hero.loyalty_arrears_at?.getTime() ?? null;
  if (anchor === null) {
    // 欠饷刚开始（或迁移前已欠饷）：从现在起算第一小时
    await client.query(`UPDATE account_heroes SET loyalty_arrears_at = to_timestamp($2 / 1000.0) WHERE id = $1`, [hero.id, nowMs]);
    hero.loyalty_arrears_at = new Date(nowMs);
    return;
  }
  if (nowMs - anchor < intervalMs) {
    return;
  }
  await setLoyalty(client, hero, hero.loyalty - LOYALTY_ARREARS_PER_HOUR);
  await client.query(`UPDATE account_heroes SET loyalty_arrears_at = $2 WHERE id = $1`, [hero.id, new Date(anchor + intervalMs)]);
  hero.loyalty_arrears_at = new Date(anchor + intervalMs);
}

/** 结算一名武将的一小时俸禄（调用方事务内；hero FOR UPDATE 已锁） */
export async function settleHeroSalary(
  client: pg.PoolClient,
  hero: AccountHeroRow,
  capital: { id: string; gold: number } | null,
  nowMs: number,
): Promise<SalaryNotice | null> {
  const intervalMs = scaledMs(3_600_000);
  // 囚禁中不扣俸禄、不计欠饷（v94，AISLG-228）
  if (isCaptive(hero)) {
    return null;
  }
  // 未到期且未欠饷：无事可做；欠饷中每次 tick 都重试（主城金币补足即恢复，不必等下个小时）
  if (hero.salary_at.getTime() > nowMs && !hero.arrears) {
    return null;
  }
  const cost = Math.max(1, Math.round(scaledRate(salaryPerHour(hero.level, hero.famous))));
  const paid = capital !== null && capital.gold >= cost;
  const next = new Date(Math.max(hero.salary_at.getTime() + intervalMs, nowMs));
  if (paid) {
    await client.query(
      `UPDATE cities SET gold = gold - $2 WHERE id = $1`,
      [capital!.id, cost],
    );
    await client.query(`UPDATE account_heroes SET arrears = false, salary_at = $2, loyalty_arrears_at = NULL WHERE id = $1`, [hero.id, next]);
    if (hero.arrears) {
      return { accountId: hero.account_id, data: { reason: 'salary_paid', heroId: hero.id, heroName: hero.name } };
    }
    return null;
  }
  // 欠饷重试时不再推后 salary_at：否则每个 tick 推 1 小时，补上金币后会长期不扣俸禄（AISLG-228）
  if (!hero.arrears) {
    await client.query(`UPDATE account_heroes SET arrears = true, salary_at = $2 WHERE id = $1`, [hero.id, next]);
  }
  await settleArrearsLoyalty(client, hero, nowMs);
  if (!hero.arrears) {
    await insertEvent(client, {
      accountId: hero.account_id,
      // 俸禄从主城扣（AISLG-213）：断供归属主城，带上主城 id
      cityId: capital?.id,
      type: EventType.HERO_ARREARS,
      initiator: null,
      detail: { heroId: hero.id, heroName: hero.name, cost, nextAt: next.toISOString() },
    });
    return { accountId: hero.account_id, data: { reason: 'arrears', heroId: hero.id, heroName: hero.name } };
  }
  return null;
}

/** 单 tick 入口：节流到 HERO_SALARY_TICK_MS；返回本次发出的通知数 */
export async function processHeroSalaries(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < HERO_SALARY_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  const candidates = await pool.query(
    `SELECT * FROM account_heroes WHERE (salary_at <= now() OR arrears) AND captured_by IS NULL ORDER BY salary_at LIMIT $1`,
    [SWEEP_LIMIT],
  );
  let sent = 0;
  for (const raw of candidates.rows as AccountHeroRow[]) {
    const client = await pool.connect();
    let notice: SalaryNotice | null = null;
    try {
      await client.query('BEGIN');
      const heroRes = await client.query(`SELECT * FROM account_heroes WHERE id = $1 FOR UPDATE`, [raw.id]);
      if (!heroRes.rowCount) {
        await client.query('ROLLBACK');
        continue;
      }
      const hero = heroRes.rows[0] as AccountHeroRow;
      // 主城（账号第一座城）付俸禄；账号已无城（重置窗口）跳过
      const capRes = await client.query(
        `SELECT id, gold FROM cities WHERE account_id = $1 ORDER BY created_at LIMIT 1 FOR UPDATE`,
        [hero.account_id],
      );
      const capital = capRes.rowCount
        ? (capRes.rows[0] as { id: string; gold: number })
        : null;
      notice = await settleHeroSalary(client, hero, capital, nowMs);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    if (notice) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'hero_state', accountId: notice.accountId, data: notice.data }),
      ]);
      sent += 1;
    }
  }
  return sent;
}
