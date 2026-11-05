// 名将忠诚度的周期结算（v94，AISLG-228）：每 24 小时（基准，随缩放）−10，各名将按自己的锚点 loyalty_at 结算；
// 忠诚度到 0 时下野（行军 / 历练中则等结束后再试）；囚禁到期（24 小时）未赎回则下野，胜方获得结交资格。
// 欠饷的每小时 −1 在俸禄结算里（hero-salary-tick.ts）。模式对齐 hero-salary-tick：节流扫描，每个武将一个
// 事务并 FOR UPDATE 锁行（与赎回互斥），提交后 pg_notify 推送 PUSH_HERO_STATE。囚禁中不衰减。

import pg from 'pg';
import { scaledMs } from '../../common/src/time-scale';
import { LOYALTY_DECAY_PERIOD_HOURS, LOYALTY_DECAY_PER_PERIOD } from '../../common/src/hero-loyalty';
import { isCaptive, type AccountHeroRow } from '../../common/src/hero-db';
import { departHero, setLoyalty, type DepartOutcome } from '../../common/src/hero-loyalty-db';
import { NOTIFY_CHANNEL } from '../../common/src/db';
import type { ServerBroadcastCreated } from '../../common/src/server-broadcast';

/** tick 节流（毫秒）：忠诚度按天结算，10 秒扫一次足够（囚禁到期也在此处理） */
export const HERO_LOYALTY_TICK_MS = 10_000;
/** 单 tick 最多处理的武将数 */
const SWEEP_LIMIT = 100;

let lastRunMs = 0;

interface Notice {
  accountId: string;
  data: Record<string, unknown>;
}

interface SettleResult {
  notices: Notice[];
  broadcast: ServerBroadcastCreated | null;
}

/** 下野后的通知与播报（departHero 返回 DepartOutcome 时才有） */
function departResult(out: DepartOutcome | 'busy' | null, heroId: string, heroName: string, accountIds: string[]): SettleResult {
  if (!out || out === 'busy') {
    return { notices: [], broadcast: null };
  }
  return {
    notices: accountIds.map((accountId) => ({ accountId, data: { reason: 'left', heroId, heroName } })),
    broadcast: out.broadcast,
  };
}

/** 单名武将的结算（事务内，行锁 FOR UPDATE） */
async function settleOne(client: pg.PoolClient, heroId: string, periodMs: number): Promise<SettleResult> {
  const res = await client.query(`SELECT * FROM account_heroes WHERE id = $1 FOR UPDATE`, [heroId]);
  if (!res.rowCount) {
    return { notices: [], broadcast: null };
  }
  const hero = res.rows[0] as AccountHeroRow;
  const nowRes = await client.query(`SELECT now() AS now`);
  const now = (nowRes.rows[0] as { now: Date }).now.getTime();
  if (isCaptive(hero)) {
    // 囚禁到期未赎回：下野，胜方获得结交资格（被俘期间不衰减）
    if ((hero.captured_until as Date).getTime() > now || !hero.captured_by) {
      return { notices: [], broadcast: null };
    }
    const out = await departHero(client, hero, 'captive_expired');
    return departResult(out, hero.id, hero.name, [hero.account_id, hero.captured_by]);
  }
  if (hero.loyalty === null) {
    return { notices: [], broadcast: null };
  }
  const notices: Notice[] = [];
  if (hero.loyalty_at === null) {
    await client.query(`UPDATE account_heroes SET loyalty_at = now() WHERE id = $1`, [hero.id]);
  } else {
    // 自然下降：只结算已经过去的完整周期，锚点前移整周期（停机积压一次补齐，不会丢周期）
    const periods = Math.floor((now - hero.loyalty_at.getTime()) / periodMs);
    if (periods > 0) {
      await setLoyalty(client, hero, hero.loyalty - LOYALTY_DECAY_PER_PERIOD * periods);
      await client.query(`UPDATE account_heroes SET loyalty_at = loyalty_at + make_interval(secs => $2) WHERE id = $1`, [
        hero.id,
        (periods * periodMs) / 1000,
      ]);
      notices.push({ accountId: hero.account_id, data: { reason: 'loyalty_changed', heroId: hero.id, heroName: hero.name } });
    }
  }
  if (hero.loyalty <= 0) {
    // 忠诚度为 0：行军 / 历练中则暂不下野（departHero 返回 busy），下一轮 tick 再试，不破坏这趟结算
    const out = await departHero(client, hero, 'loyalty');
    const left = departResult(out, hero.id, hero.name, [hero.account_id]);
    return { notices: [...notices, ...left.notices], broadcast: left.broadcast };
  }
  return { notices, broadcast: null };
}

/** 单 tick 入口：节流到 HERO_LOYALTY_TICK_MS；返回本次处理的武将数 */
export async function processHeroLoyalty(pool: pg.Pool, nowMs: number = Date.now()): Promise<number> {
  if (nowMs - lastRunMs < HERO_LOYALTY_TICK_MS) {
    return 0;
  }
  lastRunMs = nowMs;
  const periodMs = scaledMs(LOYALTY_DECAY_PERIOD_HOURS * 3_600_000);
  const due = await pool.query(
    `SELECT id FROM account_heroes
     WHERE (loyalty IS NOT NULL AND captured_by IS NULL
            AND (loyalty_at IS NULL OR loyalty_at <= now() - make_interval(secs => $1) OR loyalty <= 0))
        OR (captured_by IS NOT NULL AND captured_until <= now())
     ORDER BY id LIMIT $2`,
    [periodMs / 1000, SWEEP_LIMIT],
  );
  for (const row of due.rows as Array<{ id: string }>) {
    const client = await pool.connect();
    let result: SettleResult;
    try {
      await client.query('BEGIN');
      result = await settleOne(client, row.id, periodMs);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    if (result.broadcast) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'server_broadcast', accountId: '', broadcast: result.broadcast }),
      ]);
    }
    for (const notice of result.notices) {
      await pool.query('SELECT pg_notify($1, $2)', [
        NOTIFY_CHANNEL,
        JSON.stringify({ reason: 'hero_state', accountId: notice.accountId, data: notice.data }),
      ]);
    }
  }
  return due.rowCount ?? 0;
}
