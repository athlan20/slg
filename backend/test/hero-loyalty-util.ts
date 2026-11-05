// 名将忠诚度 / 被俘用例的共用小工具（AISLG-228）：以玩家连接身份走 handleMessage 收集响应帧；
// 结算 tick 的节流按单调递增的注入时刻推进（每次至少间隔 20 秒，绕开 10 秒节流）。
import assert from 'node:assert/strict';
import pg from 'pg';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import type { InitiatorRole, ResponseFrame } from '../common/src/protocol';
import { insertAccountWithCity } from '../api/src/auth';
import { processHeroLoyalty } from '../worker/src/hero-loyalty-tick';

export async function callAs(pool: pg.Pool, accountId: string, op: number, data?: Record<string, unknown>): Promise<ResponseFrame> {
  const sent: ResponseFrame[] = [];
  const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;
  const registry = new ConnectionRegistry();
  const conn: ConnInfo = {
    socket, ip: null, host: null, accountId, username: null, role: 'player' as InitiatorRole, sessionId: null, connectedAt: new Date(),
  };
  registry.add(conn);
  const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
  await handleMessage(ctx, conn, JSON.stringify({ op, seq: 1, data }));
  const frame = sent.find((f) => f.op === op);
  assert.ok(frame, `op ${op} 没有响应`);
  return frame;
}

export async function newAccount(pool: pg.Pool, username: string): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const created = await insertAccountWithCity(client, { username, passwordHash: 'x', signupIp: null });
    await client.query('COMMIT');
    return created.id;
  } finally {
    client.release();
  }
}

export async function capitalIdOf(pool: pg.Pool, accountId: string): Promise<string> {
  const res = await pool.query(`SELECT id FROM cities WHERE account_id = $1 ORDER BY created_at, id LIMIT 1`, [accountId]);
  return (res.rows[0] as { id: string }).id;
}

/** 推进一次忠诚度结算（注入时刻单调递增，相邻两次至少差 20 秒） */
export function makeLoyaltyTick(pool: pg.Pool): () => Promise<number> {
  let n = 0;
  const base = Date.now() + 1_000_000_000;
  return () => {
    n += 1;
    return processHeroLoyalty(pool, base + n * 20_000);
  };
}
