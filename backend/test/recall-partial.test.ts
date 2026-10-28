// 撤回驻军按兵种部分撤回（v83，AISLG-207）：RECALL_GARRISON 带 troops 只撤指定数量、保留占领；
// 不带 troops 仍是全撤（放弃占领）。troops 解析的纯规则无需数据库；事务规则（保留占领、撤空 / 超量拒绝、
// 出错不改数据、全撤兼容）需要 TEST_DATABASE_URL（一次性临时库，别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { EventType, Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { readRecallTroops } from '../api/src/handlers-recall';

import { createTempDatabase, type TempDatabase } from './season-test-db';

describe('RECALL_GARRISON 的 troops 解析（无需数据库）', () => {
  test('缺省或 null 为全撤（{ troops: null }）', () => {
    assert.deepEqual(readRecallTroops({ x: 1, y: 2 }), { troops: null });
    assert.deepEqual(readRecallTroops({ x: 1, y: 2, troops: null }), { troops: null });
    assert.deepEqual(readRecallTroops(undefined), { troops: null });
  });

  test('合法的按兵种数量原样返回', () => {
    assert.deepEqual(readRecallTroops({ troops: { cavalry: 2, porter: 10 } }), { troops: { cavalry: 2, porter: 10 } });
  });

  test('空对象、未知兵种、非正整数、非对象一律判为参数错误（null）', () => {
    const bad: unknown[] = [{}, { light_cavalry: 1 }, { cavalry: 0 }, { cavalry: -1 }, { cavalry: 1.5 }, { cavalry: '3' }, { cavalry: null }, [], 'cavalry', 3];
    for (const troops of bad) {
      assert.equal(readRecallTroops({ troops }), null, JSON.stringify(troops));
    }
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('RECALL_GARRISON 部分撤回的事务规则（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  /** 占领野地坐标（与其他用例不冲突即可） */
  const X = 310;
  const Y = 310;
  let A: string;
  let B: string;
  let cityA: string;

  /** 每次调用一个独立的 sink，收集响应帧与推送帧 */
  function makeSink() {
    const frames: Array<{ ok?: boolean; op?: number; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const pushes: Array<{ op: number; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: (_accountId: string, frame: { op: number; data?: Record<string, unknown> }) => {
        pushes.push({ op: frame.op, data: frame.data });
        return 0;
      },
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    return { ctx, frames, pushes };
  }

  /** 以指定账号发 RECALL_GARRISON（经 handleMessage，同时覆盖分发层的参数解析） */
  async function recall(accountId: string, data: Record<string, unknown>) {
    const sink = makeSink();
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op: Op.RECALL_GARRISON, seq: 1, data }));
    return { res: sink.frames[sink.frames.length - 1], pushes: sink.pushes };
  }

  async function newAccount(label: string): Promise<string> {
    return (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`])).rows[0].id as string;
  }

  async function newCity(accountId: string, x: number, y: number): Promise<string> {
    const id = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, x, y, origin_level)
       VALUES ($1, '城', 1000, 0, 0, $2, $3, 2) RETURNING id`,
      [accountId, x, y],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 2), ($1, 'farm', 3)`, [id]);
    return id;
  }

  /** 把占领地块恢复为 A 占领、驻军为 cavalry 5 + porter 3；清空本用例之前的行军与事件 */
  async function resetTile(owner: string | null = cityA, garrison: Record<string, number> = { cavalry: 5, porter: 3 }): Promise<void> {
    await pool.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [X, Y]);
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [A]);
    await pool.query(`DELETE FROM events WHERE account_id = $1`, [A]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       VALUES ($1, $2, 'plain', 'wilderness', 1, $3, NULL)
       ON CONFLICT (x, y) DO UPDATE SET kind = 'wilderness', level = 1, owner_city_id = $3, npc = NULL`,
      [X, Y, owner],
    );
    for (const [troop, count] of Object.entries(garrison)) {
      await pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, $3, $4)`, [X, Y, troop, count]);
    }
  }

  async function garrisonOf(): Promise<Record<string, number>> {
    const rows = (await pool.query(`SELECT troop, count FROM tile_army WHERE x = $1 AND y = $2`, [X, Y])).rows as Array<{ troop: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.troop, row.count]));
  }

  async function ownerOf(): Promise<string | null> {
    return (await pool.query(`SELECT owner_city_id FROM world_tiles WHERE x = $1 AND y = $2`, [X, Y])).rows[0].owner_city_id as string | null;
  }

  async function countEvents(type: string): Promise<number> {
    return Number((await pool.query(`SELECT count(*)::int AS n FROM events WHERE account_id = $1 AND type = $2`, [A, type])).rows[0].n);
  }

  async function countMarches(): Promise<number> {
    return Number((await pool.query(`SELECT count(*)::int AS n FROM marches WHERE account_id = $1`, [A])).rows[0].n);
  }

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'recall_partial');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    A = await newAccount('recall-a');
    B = await newAccount('recall-b');
    cityA = await newCity(A, 10, 10);
    await newCity(B, 20, 20);
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('不带 troops 仍是全撤：放弃占领、驻军整编队返程、写 WILDERNESS_LOST', async () => {
    await resetTile();
    const { res, pushes } = await recall(A, { x: X, y: Y });
    assert.equal(res.ok, true, JSON.stringify(res));
    const march = res.data?.march as { purpose: string; troops: Record<string, number> };
    assert.equal(march.purpose, 'return');
    assert.equal(march.troops.cavalry, 5);
    assert.equal(march.troops.porter, 3);
    assert.equal(await ownerOf(), null, '占领清除');
    assert.deepEqual(await garrisonOf(), {}, '地块驻军清空');
    assert.equal(await countEvents(EventType.WILDERNESS_LOST), 1);
    assert.ok(pushes.some((push) => push.op === Op.PUSH_TILE_STATE), '全撤推送地块状态');
  });

  test('带 troops 只撤指定数量：保留占领，返程行军只带撤回的兵，剩余驻军继续守地', async () => {
    await resetTile();
    const { res, pushes } = await recall(A, { x: X, y: Y, troops: { cavalry: 2 } });
    assert.equal(res.ok, true, JSON.stringify(res));
    const march = res.data?.march as { id: string; purpose: string; troops: Record<string, number>; x: number; y: number };
    const marchId = march.id;
    assert.equal(march.purpose, 'return');
    assert.equal(march.troops.cavalry, 2);
    assert.equal(march.troops.porter, 0);
    assert.equal(march.x, X);
    assert.equal(march.y, Y);
    assert.equal(await ownerOf(), cityA, '地块仍归本账号');
    assert.deepEqual(await garrisonOf(), { cavalry: 3, porter: 3 }, '驻军减少撤回的数量');
    assert.equal(await countEvents(EventType.WILDERNESS_LOST), 0, '部分撤回不写 WILDERNESS_LOST');
    assert.equal(await countEvents(EventType.MARCH_STARTED), 1);
    const marchRow = (await pool.query(`SELECT purpose, status, troops, from_city_id FROM marches WHERE id = $1`, [marchId])).rows[0];
    assert.equal(marchRow.purpose, 'return');
    assert.equal(marchRow.status, 'marching');
    assert.equal(marchRow.from_city_id, cityA, '返程回占领城');
    assert.deepEqual(marchRow.troops, { cavalry: 2 });
    assert.ok(pushes.some((push) => push.op === Op.PUSH_MARCH_STATE), '推送行军状态');
  });

  test('逐兵种扣减：撤空某兵种时该行删除，其余兵种保留', async () => {
    await resetTile();
    const { res } = await recall(A, { x: X, y: Y, troops: { porter: 3 } });
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.deepEqual(await garrisonOf(), { cavalry: 5 }, '民夫归零，行被删除');
    assert.equal(await ownerOf(), cityA);
  });

  test('某兵种超过驻军返回 INSUFFICIENT_GARRISON，不改任何数据（包括总数未撤空的超量）', async () => {
    await resetTile();
    const single = await recall(A, { x: X, y: Y, troops: { cavalry: 6 } });
    assert.equal(single.res.error?.code, 'INSUFFICIENT_GARRISON');
    // 撤回总数 9 > 驻军 8：超量判定先于撤空判定，错误码仍是 INSUFFICIENT_GARRISON
    const mixed = await recall(A, { x: X, y: Y, troops: { cavalry: 6, porter: 3 } });
    assert.equal(mixed.res.error?.code, 'INSUFFICIENT_GARRISON');
    assert.deepEqual(await garrisonOf(), { cavalry: 5, porter: 3 }, '驻军不变');
    assert.equal(await ownerOf(), cityA, '占领不变');
    assert.equal(await countMarches(), 0, '没有返程行军');
    assert.equal(await countEvents(EventType.MARCH_STARTED), 0);
  });

  test('撤回总数等于驻军总数（会撤空）返回 GARRISON_WOULD_EMPTY，不改任何数据', async () => {
    await resetTile();
    const { res } = await recall(A, { x: X, y: Y, troops: { cavalry: 5, porter: 3 } });
    assert.equal(res.error?.code, 'GARRISON_WOULD_EMPTY');
    assert.deepEqual(await garrisonOf(), { cavalry: 5, porter: 3 });
    assert.equal(await ownerOf(), cityA);
    assert.equal(await countMarches(), 0);
  });

  test('troops 为空对象 / 未知兵种 / 非正整数返回 INVALID_PARAMS，不改任何数据', async () => {
    await resetTile();
    const bad: Array<Record<string, unknown>> = [{}, { light_cavalry: 1 }, { cavalry: 0 }, { cavalry: 1.5 }];
    for (const troops of bad) {
      const { res } = await recall(A, { x: X, y: Y, troops });
      assert.equal(res.error?.code, 'INVALID_PARAMS', JSON.stringify(troops));
    }
    assert.deepEqual(await garrisonOf(), { cavalry: 5, porter: 3 });
    assert.equal(await ownerOf(), cityA);
  });

  test('不是本账号占领的野地：带或不带 troops 都返回 TILE_NOT_OCCUPIED', async () => {
    await resetTile();
    for (const data of [{ x: X, y: Y }, { x: X, y: Y, troops: { cavalry: 1 } }]) {
      const { res } = await recall(B, data);
      assert.equal(res.error?.code, 'TILE_NOT_OCCUPIED', JSON.stringify(data));
    }
    await resetTile(null);
    const unowned = await recall(A, { x: X, y: Y, troops: { cavalry: 1 } });
    assert.equal(unowned.res.error?.code, 'TILE_NOT_OCCUPIED', '无主野地');
    assert.deepEqual(await garrisonOf(), { cavalry: 5, porter: 3 }, '他人与无主的地块驻军不变');
  });

  test('部分撤回后再全撤：全撤返程的是剩余驻军，并放弃占领', async () => {
    await resetTile();
    assert.equal((await recall(A, { x: X, y: Y, troops: { cavalry: 2 } })).res.ok, true);
    const { res } = await recall(A, { x: X, y: Y });
    assert.equal(res.ok, true, JSON.stringify(res));
    const march = res.data?.march as { troops: Record<string, number> };
    assert.equal(march.troops.cavalry, 3);
    assert.equal(march.troops.porter, 3);
    assert.equal(await ownerOf(), null);
    assert.deepEqual(await garrisonOf(), {});
  });
});
