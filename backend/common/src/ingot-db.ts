// 元宝的存取（AISLG-251，v108；v109 AISLG-253 加 grantIngot）：读余额 loadIngot、扣除 spendIngot、
// 发放 grantIngot。充值入账与退款回收分别在 topup-settle.ts 的结算事务里完成（它们还要改订单状态，不能拆开）。
// spendIngot 的签名与 gift-db.ts 的 spendGift 对齐：必须在调用方事务内、单条带条件的 UPDATE、
// 余额不足返回 INSUFFICIENT_INGOT 且什么都不改、成功写 INGOT_SPENT 事件。并发时第二个请求在
// accounts 行锁上等第一个提交，之后重新判定 ingot >= amount，因此总扣额不会超过余额、余额不会为负。

import type pg from 'pg';
import { EventType } from './protocol-city';
import { insertEvent } from './events';
import { INSUFFICIENT_INGOT } from './ingot';

type Queryable = pg.Pool | pg.PoolClient;

export type IngotSpendResult =
  | { ok: true; balance: number }
  | { ok: false; code: typeof INSUFFICIENT_INGOT; balance: number };

/** 账号当前元宝余额（账号不存在返回 0） */
export async function loadIngot(q: Queryable, accountId: string): Promise<number> {
  const res = await q.query(`SELECT ingot FROM accounts WHERE id = $1`, [accountId]);
  return res.rowCount ? Math.max(0, Number((res.rows[0] as { ingot: number | string }).ingot)) : 0;
}

/**
 * 扣除元宝（调用方事务内）。余额足够：扣减、写 INGOT_SPENT 事件（detail = { reason, amount, balance }），
 * 返回扣后余额。余额不足：不扣、不写事件、不改任何数据，返回 INSUFFICIENT_INGOT 与当前余额。
 * amount 必须是正整数，否则抛错（调用方错误，与 spendGift 一致）。
 */
export async function spendIngot(
  client: pg.PoolClient,
  accountId: string,
  amount: number,
  reason: string,
): Promise<IngotSpendResult> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`spendIngot: amount 必须是正整数，收到 ${amount}`);
  }
  const res = await client.query(
    `UPDATE accounts SET ingot = ingot - $2 WHERE id = $1 AND ingot >= $2 RETURNING ingot`,
    [accountId, amount],
  );
  if (res.rowCount === 0) {
    return { ok: false, code: INSUFFICIENT_INGOT, balance: await loadIngot(client, accountId) };
  }
  const balance = Math.max(0, Number((res.rows[0] as { ingot: number | string }).ingot));
  await insertEvent(client, {
    accountId,
    type: EventType.INGOT_SPENT,
    detail: { reason, amount, balance },
  });
  return { ok: true, balance };
}

/**
 * 发放元宝（AISLG-253，v109；调用方事务内）：ingot += amount 并写 INGOT_GRANTED 事件
 * （detail = { reason, amount, balance }），返回发放后的余额。福利元宝与充值元宝同账户、同口径：
 * 不随换季清零、不可转让；也不属于任何充值订单，退款 / 拒付不会回收这部分。
 * amount 必须是正整数，账号不存在抛错（兑换码的批次奖励在创建时已校验，这里是调用方错误）。
 */
export async function grantIngot(
  client: pg.PoolClient,
  accountId: string,
  amount: number,
  reason: string,
): Promise<number> {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error(`grantIngot: amount 必须是正整数，收到 ${amount}`);
  }
  const res = await client.query(`UPDATE accounts SET ingot = ingot + $2 WHERE id = $1 RETURNING ingot`, [
    accountId,
    amount,
  ]);
  if (res.rowCount === 0) {
    throw new Error(`grantIngot: 账号 ${accountId} 不存在`);
  }
  const balance = Math.max(0, Number((res.rows[0] as { ingot: number | string }).ingot));
  await insertEvent(client, {
    accountId,
    type: EventType.INGOT_GRANTED,
    detail: { reason, amount, balance },
  });
  return balance;
}
