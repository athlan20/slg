// 战争迷雾复核修复的回归用例（AISLG-224 复核）：盲打被拒标记（fog_denied）与到达一律原路返回、
// 撤回的实时视野按撤回点计算、关闭时零写入、已探索详情与小地图以快照为准、未探索黄巾营地可见。
// 需要 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { EventType, Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { handleGetMapOverview } from '../api/src/map-overview';
import { loadFogTileDetail, loadFogWindow } from '../api/src/fog-view';
import { syncSeenTiles } from '../common/src/fog-db';
import { processDueMarches } from '../worker/src/world-tick';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('战争迷雾复核修复（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let B: string;
  let C: string;
  let D: string;
  let Z: string;
  let cityA: string;
  let cityB: string;
  let cityC: string;
  let cityD: string;
  let cityZ: string;
  const tag = `fogr-${Date.now()}`;

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
    return { ctx: { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext, frames, pushes };
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

  async function resetA(): Promise<void> {
    await pool.query(`DELETE FROM marches WHERE account_id = $1 OR from_city_id = $2`, [A, cityA]);
    await pool.query(`DELETE FROM battle_reports WHERE account_id = $1`, [A]);
    await pool.query(`DELETE FROM city_army WHERE city_id = $1`, [cityA]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 500), ($1, 'scout', 20)`, [cityA]);
    await pool.query(`UPDATE accounts SET self_truce_until = NULL WHERE id = $1`, [A]);
    await pool.query(`UPDATE accounts SET newbie_until = NULL WHERE id = ANY($1::uuid[])`, [[A, B, C, D]]);
    await pool.query(`UPDATE cities SET truce_until = NULL WHERE id = ANY($1::uuid[])`, [[cityB, cityC, cityD]]);
  }

  async function countRows(sql: string, params: unknown[]): Promise<number> {
    return (await pool.query(sql, params)).rows[0].n as number;
  }

  /** 把行军推到到期并交给 Worker 结算 */
  async function resolveNow(marchWhere: string, params: unknown[]): Promise<void> {
    await pool.query(`UPDATE marches SET arrive_at = now() - interval '1 second', started_at = now() - interval '2 seconds' WHERE ${marchWhere}`, params);
    await processDueMarches(pool);
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_review');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    const mk = async (name: string) => (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    A = await mk('a');
    B = await mk('b');
    C = await mk('c');
    D = await mk('d');
    Z = await mk('z');
    const city = async (account: string, name: string, x: number, y: number) =>
      (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, $2, 1000, 1000, 1000, $3, $4) RETURNING id`, [account, name, x, y])).rows[0].id as string;
    cityA = await city(A, 'A主城', 700, 700);
    cityB = await city(B, 'B城', 900, 900);
    cityC = await city(C, 'C城', 60, 60);
    cityD = await city(D, 'D城', 950, 950);
    cityZ = await city(Z, 'Z主城', 300, 300);
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', 9), ($1, 'government', 5)`, [cityA]);
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', 9), ($1, 'government', 5)`, [cityZ]);
    await tile(700, 700, { kind: 'city', owner: cityA, level: 0 });
    await tile(900, 900, { kind: 'city', owner: cityB, level: 0 });
    await tile(950, 950, { kind: 'city', owner: cityD, level: 0 });
    await tile(60, 60, { kind: 'city', owner: cityC, level: 0 });
    await tile(300, 300, { kind: 'city', owner: cityZ, level: 0 });
    await tile(301, 300, { kind: 'wilderness', level: 2 });
    await tile(721, 700, { kind: 'wilderness', level: 2 });
    await tile(800, 700, { kind: 'wilderness', level: 4 });
    await tile(900, 700, { kind: 'wilderness', level: 4 });
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  beforeEach(async () => {
    setFogEnabledCache(true);
    await resetA();
  });

  // ---- 1. 盲打被拒的标记：到达时即使目标已能打，也一律原路返回 ----

  test('盲打被免战拒绝、免战在途中结束：到达后不开战、不掠夺，事件 aborted，兵力不变', async () => {
    await pool.query(`UPDATE cities SET truce_until = now() + interval '1 day' WHERE id = $1`, [cityB]);
    const { res } = await send(A, Op.MARCH, { x: 900, y: 900, troops: { militia: 10 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    const flag = await pool.query(`SELECT fog_denied FROM marches WHERE account_id = $1 AND x = 900 AND y = 900`, [A]);
    assert.equal(flag.rows[0].fog_denied, true, '校验被拒的盲打写 fog_denied');
    await pool.query(`UPDATE cities SET truce_until = NULL WHERE id = $1`, [cityB]);
    await resolveNow(`account_id = '${A}' AND x = 900 AND y = 900`, []);
    const done = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.MARCH_COMPLETED]);
    assert.equal(done.rows[0].detail.outcome, 'aborted');
    assert.equal(await countRows(`SELECT count(*)::int AS n FROM battle_reports WHERE account_id = $1`, [A]), 0, '不开战');
    assert.equal(await countRows(`SELECT COALESCE(sum(count), 0)::int AS n FROM city_army WHERE city_id = $1 AND troop = 'militia'`, [cityA]), 490, '兵力只按出征扣减');
  });

  test('盲打时攻方自己主动免战：到达后即使免战已解除也不开战，事件 aborted', async () => {
    await pool.query(`UPDATE accounts SET self_truce_until = now() + interval '1 day' WHERE id = $1`, [A]);
    const { res } = await send(A, Op.MARCH, { x: 950, y: 950, troops: { militia: 10 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    await pool.query(`UPDATE accounts SET self_truce_until = NULL WHERE id = $1`, [A]);
    await resolveNow(`account_id = '${A}' AND x = 950 AND y = 950`, []);
    const done = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.MARCH_COMPLETED]);
    assert.equal(done.rows[0].detail.outcome, 'aborted');
    assert.equal(await countRows(`SELECT count(*)::int AS n FROM battle_reports WHERE account_id = $1`, [A]), 0);
  });

  // ---- 2. 撤回：实时视野按撤回点计算 ----

  test('走 10% 后撤回：撤回后的实时视野只在撤回点到出发城之间，路线中点与目标附近查不到实时地块', async () => {
    const marchId = (await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, started_at, arrive_at)
       VALUES ($1, $2, 900, 700, '{"militia": 10, "scout": 2}'::jsonb, 'scout', 'marching', 'player', now() - interval '1000 seconds', now() + interval '9000 seconds')
       RETURNING id`,
      [A, cityA],
    )).rows[0].id as string;
    const { res } = await send(A, Op.RECALL_MARCH, { marchId });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    const near = await loadFogWindow(pool, A, 715, 698, 11, 5);
    assert.ok(near.some((tileView) => tileView.x === 721 && tileView.y === 700 && tileView.fog === 'visible'), '撤回点附近实时可见');
    const mid = await loadFogWindow(pool, A, 795, 698, 11, 5);
    assert.equal(mid.some((tileView) => tileView.x === 800 && tileView.y === 700), false, '路线中点不是实时视野');
    const far = await loadFogWindow(pool, A, 895, 698, 11, 5);
    assert.equal(far.some((tileView) => tileView.x === 900 && tileView.y === 700), false, '目标附近仍是黑雾');
  });

  // ---- 3. SCOUT 与 MARCH 同一模式：被拒才写标记，到达按标记原路返回，不产出情报 ----

  test('盲侦察受保护的玩家城：校验被拒但照常出发（fog_denied），到达原路返回，不产出情报', async () => {
    await pool.query(`UPDATE accounts SET newbie_until = now() + interval '3 days' WHERE id = $1`, [B]);
    const { res } = await send(A, Op.SCOUT, { x: 900, y: 900, count: 5 });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    const flag = await pool.query(`SELECT fog_denied FROM marches WHERE account_id = $1 AND purpose = 'scout'`, [A]);
    assert.equal(flag.rows[0].fog_denied, true);
    await resolveNow(`account_id = '${A}' AND purpose = 'scout'`, []);
    const done = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id DESC LIMIT 1`, [A, EventType.MARCH_COMPLETED]);
    assert.equal(done.rows[0].detail.outcome, 'aborted');
    assert.equal(await countRows(`SELECT count(*)::int AS n FROM scout_intel WHERE account_id = $1 AND x = 900 AND y = 900`, [A]), 0);
  });

  // ---- 4. fog_enabled 关闭：查询与出征不写任何迷雾表 ----

  test('开关关闭：地图、地块、小地图、出征都不写 fog_explored / fog_seen', async () => {
    setFogEnabledCache(false);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 50) ON CONFLICT (city_id, troop) DO NOTHING`, [cityZ]);
    await pool.query(`INSERT INTO world_tiles (x, y, terrain, kind, level) VALUES (305, 300, 'plain', 'npc_city', 2) ON CONFLICT (x, y) DO UPDATE SET kind = 'npc_city', level = 2`);
    await loadFogWindow(pool, Z, 290, 290, 20, 20);
    await loadFogTileDetail(pool, Z, 300, 300);
    const sink = makeSink();
    await handleGetMapOverview(sink.ctx, { accountId: Z, role: 'player' } as unknown as ConnInfo, Op.GET_MAP_OVERVIEW, 1);
    const march = await send(Z, Op.MARCH, { x: 301, y: 300, troops: { militia: 1 } });
    assert.equal(march.res.ok, true, JSON.stringify(march.res.error));
    assert.equal(await countRows(`SELECT count(*)::int AS n FROM fog_explored WHERE account_id = $1`, [Z]), 0, '关闭时不写探索位图');
    assert.equal(await countRows(`SELECT count(*)::int AS n FROM fog_seen WHERE account_id = $1`, [Z]), 0, '关闭时不写上次看到的快照');
  });

  // ---- 5. 已探索详情：白名单，只由显示的 kind 与快照决定 ----

  test('快照是野地、真实已变成玩家城：已探索详情与真实仍是野地时完全一样', async () => {
    // 先让 (745,700) 成为自己的领地（在视野内，写入快照），再撤掉领地让它退出视野
    await tile(745, 700, { kind: 'wilderness', level: 3, owner: cityA });
    await loadFogWindow(pool, A, 735, 690, 30, 20);
    await pool.query(`UPDATE world_tiles SET owner_city_id = NULL WHERE x = 745 AND y = 700`);
    const before = await loadFogTileDetail(pool, A, 745, 700);
    assert.equal(before.kind, 'ok');
    await pool.query(`UPDATE world_tiles SET kind = 'city', owner_city_id = $1, level = 0 WHERE x = 745 AND y = 700`, [cityC]);
    const after = await loadFogTileDetail(pool, A, 745, 700);
    assert.equal(after.kind, 'ok');
    assert.deepEqual(after, before);
  });

  // ---- 6. 小地图：已探索的城以快照为准 ----

  test('小地图：上次看到的玩家城迁走后，点位仍按快照显示', async () => {
    await tile(735, 705, { kind: 'city', owner: cityC, level: 0 });
    // 模拟“上次看到”：该格在某次看到时写入快照（真实流程下由视野或新区块刷新）
    const snapClient = await pool.connect();
    try {
      await snapClient.query('BEGIN');
      await syncSeenTiles(snapClient, A, [{ x: 735, y: 705 }], new Date());
      await snapClient.query('COMMIT');
    } finally {
      snapClient.release();
    }
    const seen = await countRows(`SELECT count(*)::int AS n FROM fog_seen WHERE account_id = $1 AND x = 735 AND y = 705`, [A]);
    assert.equal(seen, 1, '前提：该城已写入快照');
    await pool.query(`UPDATE world_tiles SET kind = 'wilderness', owner_city_id = NULL, level = 2 WHERE x = 735 AND y = 705`);
    const sink = makeSink();
    await handleGetMapOverview(sink.ctx, { accountId: A, role: 'player' } as unknown as ConnInfo, Op.GET_MAP_OVERVIEW, 1);
    const cities = (sink.frames[0].data?.cities ?? []) as Array<[number, number, string]>;
    assert.ok(cities.some(([x, y]) => x === 735 && y === 705), '迁走后的旧点位仍按快照显示');
  });

  // ---- 7. 未探索的黄巾营地可见（最小视图） ----

  test('未探索格上的黄巾营地：窗口与 GET_TILE 都返回最小视图（camp、fog=explored、seenAt=null）', async () => {
    const ev = (await pool.query(`INSERT INTO yt_events (status, ends_at, total_camps) VALUES ('active', now() + interval '1 day', 1) RETURNING id`)).rows[0].id as string;
    await tile(960, 960, { kind: 'wilderness', level: 5 });
    await pool.query(`INSERT INTO yt_camps (event_id, x, y, tier, status) VALUES ($1, 960, 960, 'small', 'active')`, [ev]);
    const win = await loadFogWindow(pool, A, 955, 955, 10, 10);
    const camp = win.find((tileView) => tileView.x === 960 && tileView.y === 960);
    assert.ok(camp, '黄巾营地在窗口里');
    assert.equal(camp?.fog, 'explored');
    assert.equal(camp?.seenAt, null);
    assert.ok(camp?.camp, '营地信息给出');
    assert.equal(camp?.owner, null);
    assert.equal(camp?.garrison, 0);
    const detail = await loadFogTileDetail(pool, A, 960, 960);
    assert.equal(detail.kind, 'ok');
    if (detail.kind === 'ok') {
      assert.ok(detail.detail.camp);
      assert.equal(detail.detail.wilderness, null);
    }
    await pool.query(`DELETE FROM yt_events WHERE id = $1`, [ev]);
  });
});
