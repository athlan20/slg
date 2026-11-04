// 礼金的存取（AISLG-221，v89）：读余额、扣除（spendGift）。发放与清零分别在 auth.ts / season-db.ts / season-reset.ts 内按各自事务完成。
// spendGift 必须在调用方的事务里执行（它写事件流，事件与扣除同生共死）。扣除是单条带条件的 UPDATE：
// 并发时第二个请求在行锁上等第一个提交，之后重新判定 gift >= amount，因此总扣额不会超过余额，也不会变负。

import type pg from 'pg';
import { EventType } from './protocol-city';
import { insertEvent } from './events';
import { INSUFFICIENT_GIFT } from './gift';

type Queryable = pg.Pool | pg.PoolClient;

export type GiftSpendResult =
  | { ok: true; balance: number }
  | { ok: false; code: typeof INSUFFICIENT_GIFT; balance: number };

/** 账号当前礼金余额（账号不存在返回 0） */
export async function loadGift(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(`SELECT gift FROM accounts WHERE id = $1`, [accountId]);
  return res.rowCount ? Math.max(0, Number((res.rows[0] as { gift: number | string }).gift)) : 0;
}

/**
 * 扣除礼金（调用方事务内）。余额足够：扣减、写 GIFT_SPENT 事件（detail = { reason, amount, balance }），返回扣后余额。
 * 余额不足：不扣、不写事件、不改任何数据，返回 INSUFFICIENT_GIFT 与当前余额。amount 必须是正整数，否则抛错（调用方错误）。
 */
export async function spendGift(
  client: pg.PoolClient,
  accountId: string,
  amount: number,
  reason: string,
): Promise<GiftSpendResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`spendGift: amount 必须是正整数，收到 ${amount}`);
  }
  const res = await client.query(
    `UPDATE accounts SET gift = gift - $2 WHERE id = $1 AND gift >= $2 RETURNING gift`,
    [accountId, amount],
  );
  if (res.rowCount === 0) {
    return { ok: false, code: INSUFFICIENT_GIFT, balance: await loadGift(client, accountId) };
  }
  const balance = Math.max(0, Number((res.rows[0] as { gift: number | string }).gift));
  await insertEvent(client, {
    accountId,
    type: EventType.GIFT_SPENT,
    detail: { reason, amount, balance },
  });
  return { ok: true, balance };
}
