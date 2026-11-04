// 战争迷雾的盲打（AISLG-224 第四步）：未探索目标上 MARCH / SCOUT 的校验被拒绝时照常建行军（不报错、
// 不预警、不破保护），响应结构与校验通过时一致；到达后由 Worker 复核（守方保护 / 他人占领 → 原路返回）；
// 开关关闭时拒绝照旧。需要 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { EventType, Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { processDueMarches } from '../worker/src/world-tick';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('战争迷雾的盲打（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let B: string;
  let cityA: string;
  let cityB: string;
  let cityP: string;
  let cityU: string;
  let accountU: string;
  const tag = `fogm-${Date.now()}`;

  function makeSink() {
    const frames: Array<{ op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const pushes: Array<{ accountId: string; op: number; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: (accountId: string, frame: { op: number; data?: Record<string, unknown> }) => {
        pushes.push({ accountId, op: frame.op, data: frame.data });
        return 0;
      },
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    return { ctx, frames, pushes };
  }

  async function send(account: string, op: number, data: Record<string, unknown>) {
    const sink = makeSink();
    const conn = { accountId: account, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op, seq: 1, data }));
    return { res: sink.frames[sink.frames.length - 1], pushes: sink.pushes };
  }

  async function tile(x: number, y: number, fields: { kind: string; terrain?: string; level?: number; owner?: string | null }): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, $3, $4, $5, $6, NULL)
       ON CONFLICT (x, y) DO UPDATE SET terrain = EXCLUDED.terrain, kind = EXCLUDED.kind, level = EXCLUDED.level,
         owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [x, y, fields.terrain ?? 'plain', fields.kind, fields.level ?? 3, fields.owner ?? null],
    );
  }

  /** 把 A 的主城重置为有兵、校场够用的状态；清掉上一用例残留的行军 */
  async function resetArmy(): Promise<void> {
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [A]);
    await pool.query(`DELETE FROM city_army WHERE city_id = $1`, [cityA]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 500), ($1, 'scout', 20)`, [cityA]);
    await pool.query(`UPDATE city_army SET count = 500 WHERE city_id = $1 AND troop = 'militia'`, [cityA]);
    await pool.query(`UPDATE accounts SET self_truce_until = NULL WHERE id = $1`, [A]);
  }

  async function protectedOf(account: string): Promise<string | null> {
    const res = await pool.query(`SELECT newbie_until FROM accounts WHERE id = $1`, [account]);
    return res.rows[0].newbie_until ? new Date(res.rows[0].newbie_until).toISOString() : null;
  }

  async function warningsFor(account: string): Promise<number> {
    const res = await pool.query(`SELECT count(*)::int AS n FROM events WHERE account_id = $1 AND type = $2`, [account, EventType.PLAYER_ATTACK_WARNING]);
    return res.rows[0].n as number;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_march');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    const mk = async (name: string) => (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    A = await mk('a');
    B = await mk('b');
    cityA = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'A主城', 100000, 100000, 100000, 700, 700) RETURNING id`, [A])).rows[0].id as string;
    cityB = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'B城', 0, 0, 0, 900, 900) RETURNING id`, [B])).rows[0].id as string;
    cityP = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'B近城', 0, 0, 0, 720, 720) RETURNING id`, [B])).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', 9), ($1, 'government', 5)`, [cityA]);
    // B 的城均在新手保护期内
    await pool.query(`UPDATE accounts SET newbie_until = now() + interval '3 days' WHERE id = $1`, [B]);
    await tile(900, 900, { kind: 'city', owner: cityB, level: 0 });
    await tile(720, 720, { kind: 'city', owner: cityP, level: 0 });
    await tile(910, 910, { kind: 'wilderness', level: 3 });
    await tile(920, 920, { kind: 'wilderness', level: 3, owner: cityB });
    await tile(712, 700, { kind: 'wilderness', level: 2 });
    // 未受保护的玩家城（未探索）：校验通过，走完整流程（预警照发）
    const E = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-e`])).rows[0].id as string;
    cityU = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'U城', 0, 0, 0, 950, 950) RETURNING id`, [E])).rows[0].id as string;
    accountU = E;
    await tile(950, 950, { kind: 'city', owner: cityU, level: 0 });
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  beforeEach(async () => {
    setFogEnabledCache(true);
    await resetArmy();
  });

  test('盲打受保护的玩家城：校验被拒绝但照常建行军，不预警、不破除保护，响应与通过时结构一致', async () => {
    const protectedBefore = await protectedOf(B);
    const warningsBefore = await warningsFor(B);
    const blind = await send(A, Op.MARCH, { x: 900, y: 900, troops: { militia: 10 } });
    assert.equal(blind.res.ok, true, JSON.stringify(blind.res.error));
    const row = await pool.query(`SELECT purpose, status FROM marches WHERE account_id = $1 AND x = 900 AND y = 900`, [A]);
    assert.equal(row.rows[0].purpose, 'plunder', '盲打用 task 作为 purpose');
    assert.equal(await protectedOf(B), protectedBefore, '守方保护不被破除');
    assert.equal(await warningsFor(B), warningsBefore, '不发来袭预警');
    assert.equal(blind.pushes.some((push) => push.accountId === B), false, '守方不收到推送');
    // 响应结构与一次校验通过的出征一致
    const ok = await send(A, Op.MARCH, { x: 712, y: 700, troops: { militia: 10 } });
    assert.equal(ok.res.ok, true, JSON.stringify(ok.res.error));
    assert.deepEqual(Object.keys(blind.res.data?.march as object).sort(), Object.keys(ok.res.data?.march as object).sort());
  });

  test('盲打未受保护的玩家城：校验通过，走完整流程，守方收到来袭预警（与上线前一致）', async () => {
    const warningsBefore = await warningsFor(accountU);
    const { res, pushes } = await send(A, Op.MARCH, { x: 950, y: 950, troops: { militia: 10 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.ok((await warningsFor(accountU)) > warningsBefore, '守方收到来袭预警');
    assert.ok(pushes.some((push) => push.accountId === accountU), '守方在线推送');
    assert.ok(cityU);
  });

  test('已探索的受保护玩家城：照常拒绝（不是盲打）', async () => {
    const { res } = await send(A, Op.MARCH, { x: 720, y: 720, troops: { militia: 10 } });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'NEWBIE_PROTECTED');
  });

  test('开关关闭：未探索的受保护城照常拒绝（与上线前一致）', async () => {
    setFogEnabledCache(false);
    const { res } = await send(A, Op.MARCH, { x: 900, y: 900, troops: { militia: 10 } });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'NEWBIE_PROTECTED');
  });

  test('盲打他人占领的未探索野地：到达后不战斗，原路返回（aborted），兵力不变', async () => {
    const { res } = await send(A, Op.MARCH, { x: 920, y: 920, troops: { militia: 10 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    await pool.query(`UPDATE marches SET arrive_at = now() - interval '1 second', started_at = now() - interval '2 seconds' WHERE account_id = $1 AND x = 920 AND y = 920`, [A]);
    await processDueMarches(pool);
    const done = await pool.query(`SELECT type, detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.MARCH_COMPLETED]);
    assert.equal(done.rows[0].detail.outcome, 'aborted');
    const back = await pool.query(`SELECT purpose FROM marches WHERE account_id = $1 AND purpose = 'return'`, [A]);
    assert.ok(back.rowCount && back.rowCount >= 1, '部队原路返回');
    const army = await pool.query(`SELECT count FROM city_army WHERE city_id = $1 AND troop = 'militia'`, [cityA]);
    assert.equal(army.rows[0].count, 490, '只扣了出征的 10 人，战斗未发生');
  });

  test('盲打校验通过的（未探索的无主野地）：走完整流程，与普通出征相同', async () => {
    const { res } = await send(A, Op.MARCH, { x: 910, y: 910, troops: { militia: 10 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    const row = await pool.query(`SELECT purpose FROM marches WHERE account_id = $1 AND x = 910 AND y = 910`, [A]);
    assert.equal(row.rows[0].purpose, 'plunder');
  });

  test('盲侦察受保护的玩家城：到达后复核保护，不产出情报，aborted（NEWBIE_PROTECTED）', async () => {
    const { res } = await send(A, Op.SCOUT, { x: 900, y: 900, count: 5 });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    await pool.query(`UPDATE marches SET arrive_at = now() - interval '1 second', started_at = now() - interval '2 seconds' WHERE account_id = $1 AND purpose = 'scout'`, [A]);
    await processDueMarches(pool);
    const done = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.MARCH_COMPLETED]);
    assert.equal(done.rows[0].detail.outcome, 'aborted');
    assert.equal(done.rows[0].detail.cause, 'NEWBIE_PROTECTED');
    const intel = await pool.query(`SELECT count(*)::int AS n FROM scout_intel WHERE account_id = $1 AND x = 900 AND y = 900`, [A]);
    assert.equal(intel.rows[0].n, 0, '未产出情报');
  });
});
