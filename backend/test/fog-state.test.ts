// 战争迷雾的状态维护（AISLG-224 第二步）：开局 / 存量初始化、城与领地视野、上次看到的快照、
// 行军去程写入与探索简报、返程不写入、撤回只写走过的一段、fog_enabled 开关的读写。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { getFogEnabled, refreshFogEnabled, setFogEnabled, setFogEnabledCache } from '../common/src/fog-config';
import { ensureFogState, loadSeenWindow, readFogBits } from '../common/src/fog-db';
import { recordMarchExploration, type ExplorationTrip } from '../common/src/fog-record';
import { isCellExplored } from '../common/src/fog';
import { processFogExploration } from '../worker/src/fog-tick';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('fog_enabled 开关（缓存与默认值，无需数据库）', () => {
  test('默认关闭；注入缓存后读到注入值', () => {
    setFogEnabledCache(null);
    assert.equal(getFogEnabled(), false);
    setFogEnabledCache(true);
    assert.equal(getFogEnabled(), true);
    setFogEnabledCache(null);
    assert.equal(getFogEnabled(), false);
  });
});

describe('战争迷雾状态维护（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let B: string;
  let C: string;
  let cityA: string;
  let cityB: string;
  const tag = `fog-${Date.now()}`;

  /** 固定坐标（与其他文件无关，测试库独立） */
  const HOME = { x: 700, y: 700 };

  async function tile(x: number, y: number, fields: { kind: string; terrain?: string; level?: number; owner?: string | null; npc?: unknown }): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (x, y) DO UPDATE SET terrain = EXCLUDED.terrain, kind = EXCLUDED.kind, level = EXCLUDED.level,
         owner_city_id = EXCLUDED.owner_city_id, npc = EXCLUDED.npc`,
      [x, y, fields.terrain ?? 'plain', fields.kind, fields.level ?? 1, fields.owner ?? null, fields.npc ? JSON.stringify(fields.npc) : null],
    );
  }

  async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function insertResolvedMarch(from: string, to: { x: number; y: number }, purpose: string, opts: { troops?: Record<string, number>; status?: string } = {}): Promise<string> {
    const accountId = from === cityA ? A : B;
    const res = await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, started_at, arrive_at, resolved_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, 'player', now() - interval '20 seconds', now() - interval '1 second', now() - interval '1 second')
       RETURNING id`,
      [accountId, from, to.x, to.y, JSON.stringify(opts.troops ?? { militia: 10 }), purpose, opts.status ?? 'arrived'],
    );
    return res.rows[0].id as string;
  }

  async function eventsOf(accountId: string): Promise<Array<{ detail: Record<string, unknown>; build_id: string | null }>> {
    const res = await pool.query(`SELECT detail, build_id FROM events WHERE account_id = $1 AND type = 'exploration_report' ORDER BY id`, [accountId]);
    return res.rows as Array<{ detail: Record<string, unknown>; build_id: string | null }>;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_state');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    A = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-a`])).rows[0].id as string;
    B = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-b`])).rows[0].id as string;
    C = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-c`])).rows[0].id as string;
    cityA = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'A主城', 0, 0, 0, $2, $3) RETURNING id`, [A, HOME.x, HOME.y])).rows[0].id as string;
    cityB = (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, 'B主城', 0, 0, 0, 900, 300) RETURNING id`, [B])).rows[0].id as string;
    // 固定地块：A 主城附近的 NPC 城（区块被开局覆盖）、野地、B 的城（在开局范围内）
    await tile(705, 705, { kind: 'npc_city', level: 4, npc: { stock: {} } });
    await tile(706, 706, { kind: 'wilderness', level: 6 });
    await tile(710, 710, { kind: 'city', owner: cityB });
    await tile(752, 700, { kind: 'npc_city', level: 5, npc: { famous: { name: '测试名城' } } });
    await tile(601, 601, { kind: 'npc_city', level: 2, npc: {} });
    await tile(820, 820, { kind: 'wilderness', level: 2 });
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('开局：主城周围 30 格的区块已探索，远处未探索；初始化不写简报', async () => {
    const state = await withTx((client) => ensureFogState(client, A, new Date()));
    assert.ok(state.fresh.length > 0);
    assert.equal(isCellExplored(state.bits, HOME.x, HOME.y), true);
    assert.equal(isCellExplored(state.bits, HOME.x - 30, HOME.y), true);
    assert.equal(isCellExplored(state.bits, 600, 600), false, '远处的区块仍是黑雾');
    assert.equal((await eventsOf(A)).length, 0);
  });

  test('上次看到的快照：开局范围内的 NPC 城与玩家城入库，普通野地不入库', async () => {
    const seen = await loadSeenWindow(pool, A, 700, 700, 1, 1);
    assert.equal(seen.size, 0);
    const window = await loadSeenWindow(pool, A, 700, 700, 20, 20);
    assert.ok(window.get('705,705'), 'NPC 城入库');
    assert.equal(window.get('705,705')?.kind, 'npc_city');
    assert.equal(window.get('710,710')?.ownerAccountId, B, '玩家城记下占领者');
    assert.equal(window.get('706,706'), undefined, '普通野地不记');
  });

  test('开局后再次维护无新区块（幂等，不重复写）', async () => {
    const state = await withTx((client) => ensureFogState(client, A, new Date()));
    assert.equal(state.fresh.length, 0);
  });

  test('没有主城的账号不写探索状态', async () => {
    const state = await withTx((client) => ensureFogState(client, C, new Date()));
    assert.equal(state.fresh.length, 0);
    assert.equal(await readFogBits(pool, C), null);
  });

  test('领地带来的新区块不生成简报', async () => {
    await tile(800, 800, { kind: 'wilderness', level: 3, owner: cityA });
    await pool.query(`UPDATE world_tiles SET owner_city_id = $3 WHERE x = $1 AND y = $2`, [800, 800, cityA]);
    const state = await withTx((client) => ensureFogState(client, A, new Date()));
    assert.equal(isCellExplored(state.bits, 800, 800), true);
    assert.equal((await eventsOf(A)).length, 0);
  });

  test('去程到达：走过的新区块写入已探索，生成简报并写 pg 事件；worker 批处理后标记已记录', async () => {
    const march = await insertResolvedMarch(cityA, { x: 760, y: 700 }, 'plunder', { troops: { militia: 10, scout: 2 } });
    const processed = await processFogExploration(pool);
    assert.ok(processed >= 1);
    const bits = await readFogBits(pool, A);
    assert.ok(bits);
    assert.equal(isCellExplored(bits, 760, 700), true, '目标格所在区块已探索');
    const reports = await eventsOf(A);
    assert.equal(reports.length, 1);
    assert.equal(reports[0].build_id, march);
    const detail = reports[0].detail as { chunks: number; npcCities: { total: number }; cells: Array<{ x: number; y: number; kind: string }> };
    assert.ok(detail.chunks > 0);
    assert.ok(detail.npcCities.total >= 1, '新区块里的 NPC 城计数');
    assert.ok(detail.cells.some((cell) => cell.x === 752 && cell.y === 700 && cell.kind === 'famous'), '名城排在坐标首位');
    const row = await pool.query(`SELECT fog_recorded_at FROM marches WHERE id = $1`, [march]);
    assert.ok(row.rows[0].fog_recorded_at, '已标记');
  });

  test('返程不写入：返程行军结算后不改变探索位图，也不生成简报', async () => {
    const before = await readFogBits(pool, A);
    await insertResolvedMarch(cityA, { x: 60, y: 60 }, 'return');
    await processFogExploration(pool);
    const after = await readFogBits(pool, A);
    assert.deepEqual(Buffer.from(after as Uint8Array), Buffer.from(before as Uint8Array));
    assert.equal((await eventsOf(A)).length, 1);
  });

  test('撤回只写走过的一段：目标附近区块仍是黑雾', async () => {
    const trip: ExplorationTrip = {
      marchId: 'recall-probe',
      accountId: A,
      fromCityId: cityA,
      homeX: HOME.x,
      homeY: HOME.y,
      targetX: 900,
      targetY: 700,
      troops: { militia: 10 },
    };
    await withTx((client) => recordMarchExploration(client, trip, 0.1, new Date()));
    const bits = await readFogBits(pool, A);
    assert.equal(isCellExplored(bits as Uint8Array, 720, 700), true, '走过的一段已探索');
    assert.equal(isCellExplored(bits as Uint8Array, 900, 700), false, '撤回点之后的目标附近仍是黑雾');
  });

  test('fog_enabled：未设置时为关闭，写入后可读回', async () => {
    setFogEnabledCache(null);
    assert.equal(await refreshFogEnabled(pool), false);
    await setFogEnabled(pool, true);
    assert.equal(getFogEnabled(), true);
    assert.equal(await refreshFogEnabled(pool), true);
    await setFogEnabled(pool, false);
    assert.equal(await refreshFogEnabled(pool), false);
  });
});
