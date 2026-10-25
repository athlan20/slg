// 换季维护态拦截（AISLG-134，docs/season-system.md §2.5）：维护中游戏类协议返回 MAINTENANCE（附 retryAfterSec），
// GET_SEASON 仍可用；维护态经 settings 读取并缓存约 2 秒，通知到达时失效缓存；读库失败时放行。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setMaintenance } from '../common/src/season-db';
import { Op, type ResponseFrame } from '../common/src/protocol';
import { ConnectionRegistry, type ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import {
  MAINTENANCE_RETRY_AFTER_SEC,
  invalidateMaintenanceCache,
  maintenanceActive,
} from '../api/src/maintenance-gate';
import { setTimeScaleCache } from '../common/src/time-scale';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('换季维护态拦截（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  const tag = `maint-${Date.now()}`;
  const sent: ResponseFrame[] = [];
  const socket = { readyState: 1, OPEN: 1, send: (raw: string) => sent.push(JSON.parse(raw)), close: () => undefined } as never;

  function connection(): ConnInfo {
    const conn: ConnInfo = { socket, ip: null, host: null, accountId, username: tag, role: 'player', sessionId: null, connectedAt: new Date() };
    return conn;
  }

  /** 以已登录玩家身份发一条协议，返回最后一帧响应 */
  async function send(op: number, data?: Record<string, unknown>): Promise<ResponseFrame> {
    sent.length = 0;
    const registry = new ConnectionRegistry();
    const ctx: HandlerContext = { pool, registry, passwordDisabledHosts: new Set() };
    await handleMessage(ctx, connection(), JSON.stringify({ op, seq: 7, data }));
    return sent[sent.length - 1];
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'maint_gate');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    await setMaintenance(pool, null);
    invalidateMaintenanceCache();
    const acc = await pool.query(
      `INSERT INTO accounts (username, password_hash, season_id)
       VALUES ($1, 'x', (SELECT id FROM seasons WHERE status = 'active' ORDER BY id DESC LIMIT 1)) RETURNING id`,
      [tag],
    );
    accountId = acc.rows[0].id as string;
  });

  after(async () => {
    await setMaintenance(pool, null);
    invalidateMaintenanceCache();
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [accountId]);
    await pool.end();
    await tmp?.drop();
  });

  test('维护中：游戏类协议返回 MAINTENANCE 并附 retryAfterSec', async () => {
    await setMaintenance(pool, { reason: 'season_reset', since: new Date().toISOString() });
    invalidateMaintenanceCache();
    const frame = await send(Op.GET_STATE);
    assert.equal(frame.ok, false);
    assert.equal(frame.error?.code, 'MAINTENANCE');
    assert.deepEqual(frame.data, { retryAfterSec: MAINTENANCE_RETRY_AFTER_SEC });
  });

  test('维护中：GET_SEASON 仍可用，且 maintenance 为 true', async () => {
    const frame = await send(Op.GET_SEASON);
    assert.equal(frame.ok, true, JSON.stringify(frame));
    assert.equal((frame.data as { maintenance: boolean }).maintenance, true);
  });

  test('缓存：维护态清除后，缓存未失效前仍按维护处理；失效后放行', async () => {
    await setMaintenance(pool, null);
    assert.equal(await maintenanceActive(pool), true, '缓存约 2 秒，未失效时仍为维护');
    invalidateMaintenanceCache();
    assert.equal(await maintenanceActive(pool), false);
    const frame = await send(Op.GET_STATE);
    assert.notEqual(frame.error?.code, 'MAINTENANCE', '维护结束后游戏类协议不再被拦截');
  });

  test('读库失败时放行（fail-open），不把整站锁死', async () => {
    const broken = { query: async () => { throw new Error('db down'); } } as unknown as pg.Pool;
    const errorLog = console.error;
    console.error = () => undefined;
    try {
      invalidateMaintenanceCache();
      assert.equal(await maintenanceActive(broken), false);
    } finally {
      console.error = errorLog;
      invalidateMaintenanceCache();
    }
  });
});
