// 战争迷雾的地图裁剪（AISLG-224 第三、四步）：GET_WORLD_MAP / GET_TILE 的三种状态、上次看到的快照、
// 盟友城池格实时可见、行军视野、小地图的名城锚点与探索位图；开关关闭时与原来一致。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleGetMapOverview } from '../api/src/map-overview';
import { loadFogTileDetail, loadFogWindow } from '../api/src/fog-view';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('战争迷雾的地图裁剪（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let B: string;
  let C: string;
  let D: string;
  let cityA: string;
  let cityB: string;
  let cityC: string;
  let cityD: string;
  const tag = `fogv-${Date.now()}`;

  const sent: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
      sent.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  const conn = { accountId: null as string | null, role: 'player' as InitiatorRole } as unknown as ConnInfo;

  async function tile(x: number, y: number, fields: { kind: string; terrain?: string; level?: number; owner?: string | null; npc?: unknown }): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (x, y) DO UPDATE SET terrain = EXCLUDED.terrain, kind = EXCLUDED.kind, level = EXCLUDED.level,
         owner_city_id = EXCLUDED.owner_city_id, npc = EXCLUDED.npc`,
      [x, y, fields.terrain ?? 'plain', fields.kind, fields.level ?? 1, fields.owner ?? null, fields.npc ? JSON.stringify(fields.npc) : null],
    );
  }

  type Tile = { x: number; y: number; kind: string; level: number; fog: string; seenAt: string | null; owner: { accountId: string; relation: string; ally: boolean } | null; protection: unknown; garrison: number; npcStockTier: unknown; reserve: unknown };
  async function windowOf(accountId: string, x: number, y: number, w: number, h: number): Promise<Map<string, Tile>> {
    const tiles = (await loadFogWindow(pool, accountId, x, y, w, h)) as unknown as Tile[];
    return new Map(tiles.map((t) => [`${t.x},${t.y}`, t]));
  }

  async function overview(accountId: string): Promise<Record<string, unknown>> {
    sent.length = 0;
    conn.accountId = accountId;
    await handleGetMapOverview(ctx, conn, Op.GET_MAP_OVERVIEW, 1);
    const frame = sent[sent.length - 1];
    assert.equal(frame.ok, true);
    return frame.data as Record<string, unknown>;
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_view');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;
    const mk = async (name: string) => (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    A = await mk('a');
    B = await mk('b');
    C = await mk('c');
    D = await mk('d');
    const city = async (account: string, name: string, x: number, y: number) =>
      (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, $2, 0, 0, 0, $3, $4) RETURNING id`, [account, name, x, y])).rows[0].id as string;
    cityA = await city(A, 'A主城', 700, 700);
    cityB = await city(B, 'B城', 900, 300);
    cityC = await city(C, 'C城', 60, 60);
    cityD = await city(D, 'D城', 940, 940);
    await tile(700, 700, { kind: 'city', owner: cityA });
    await tile(900, 300, { kind: 'city', owner: cityB });
    await tile(60, 60, { kind: 'city', owner: cityC });
    await tile(940, 940, { kind: 'city', owner: cityD });
    await tile(735, 700, { kind: 'npc_city', level: 3, npc: {} });
    await tile(735, 705, { kind: 'city', owner: cityB });
    await tile(733, 690, { kind: 'wilderness', level: 2 });
    await tile(800, 700, { kind: 'wilderness', level: 4 });
    await tile(500, 500, { kind: 'npc_city', level: 2, npc: {} });
    // 名城：官渡（锚点 index 0）的真实位置在远处，未探索时只显示锚点
    await tile(520, 520, { kind: 'npc_city', level: 3, npc: { famous: { name: '官渡' } } });
    await pool.query(`INSERT INTO famous_cities (name, x, y) VALUES ('官渡', 520, 520) ON CONFLICT (name) DO NOTHING`);
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  test('开关关闭：地块全部返回，fog = visible，远处的 NPC 城也在', async () => {
    setFogEnabledCache(false);
    const far = await windowOf(A, 490, 490, 20, 20);
    assert.ok(far.get('500,500'), '未探索的 NPC 城在关闭时照常返回');
    assert.equal(far.get('500,500')?.fog, 'visible');
    assert.equal(far.get('500,500')?.seenAt, null);
    const near = await windowOf(A, 720, 680, 20, 30);
    assert.equal(near.get('735,705')?.fog, 'visible');
    assert.equal(near.get('735,705')?.owner?.relation, 'neutral');
    const ov = await overview(A);
    assert.equal(ov.exploredChunks, undefined, '关闭时小地图不带探索字段');
    assert.ok((ov.cities as unknown[]).length > 0);
    const cities = ov.cities as Array<[number, number, string]>;
    assert.ok(cities.some(([x, y]) => x === 500 && y === 500), '关闭时全图城池照常出现');
    assert.equal(cities.some(([, , side]) => side === 'famous_rumor'), false, '关闭时没有锚点');
  });

  test('开关开启：未探索的窗口没有任何地块；实时视野（主城 12 格）内照常返回', async () => {
    setFogEnabledCache(true);
    const far = await windowOf(A, 490, 490, 20, 20);
    assert.equal(far.size, 0, '未探索的窗口为空');
    const home = await windowOf(A, 690, 690, 20, 20);
    assert.equal(home.get('700,700')?.fog, 'visible');
    assert.equal(home.get('700,700')?.owner?.relation, 'self');
  });

  test('已探索但不在视野内：NPC 城与玩家城按上次看到的样子给，动态字段清空', async () => {
    setFogEnabledCache(true);
    // 735 距主城 35 格：不在实时视野，但所在区块在开局 30 格内已探索
    const win = await windowOf(A, 730, 698, 10, 10);
    const npc = win.get('735,700');
    assert.ok(npc, '已探索的 NPC 城给出');
    assert.equal(npc?.fog, 'explored');
    assert.ok(npc?.seenAt, '带上次看到的时间');
    assert.equal(npc?.kind, 'npc_city');
    assert.equal(npc?.level, 3);
    assert.equal(npc?.npcStockTier, null);
    const city = win.get('735,705');
    assert.equal(city?.fog, 'explored');
    assert.equal(city?.owner?.relation, 'neutral');
    assert.equal(city?.protection, null);
    assert.equal(city?.garrison, 0);
  });

  test('上次看到的占领者：之后地块易主，已探索的格子仍显示旧的占领者；已变城的野地按野地显示', async () => {
    setFogEnabledCache(true);
    await pool.query(`UPDATE world_tiles SET owner_city_id = $1 WHERE x = 735 AND y = 705`, [cityC]);
    await pool.query(`UPDATE world_tiles SET kind = 'city', owner_city_id = $1, level = 0 WHERE x = 733 AND y = 690`, [cityC]);
    const win = await windowOf(A, 730, 688, 8, 20);
    assert.equal(win.get('735,705')?.owner?.accountId, B, '仍显示上次看到的占领者 B');
    const wild = win.get('733,690');
    assert.equal(wild?.kind, 'wilderness', '探索后才变成城的格子按野地显示');
    assert.equal(wild?.owner, null);
    assert.equal(wild?.level, 1, '城池格（等级 0）已变城，按野地显示等级 1（需求第三节）');
    // 还原，便于后续用例
    await pool.query(`UPDATE world_tiles SET owner_city_id = $1 WHERE x = 735 AND y = 705`, [cityB]);
    await pool.query(`UPDATE world_tiles SET kind = 'wilderness', owner_city_id = NULL, level = 2 WHERE x = 733 AND y = 690`);
  });

  test('盟友的城池格始终实时可见（只这一格），不在视野内的其他格仍是黑雾', async () => {
    setFogEnabledCache(true);
    const denied = await windowOf(A, 930, 930, 20, 20);
    assert.equal(denied.size, 0, '不带半径的盟友格之外没有任何地块');
    const alliance = (await pool.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [`${tag}-盟`, A])).rows[0].id as string;
    await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, 'leader'), ($3, $2, 'member')`, [A, alliance, D]);
    const win = await windowOf(A, 930, 930, 20, 20);
    assert.equal(win.get('940,940')?.fog, 'visible');
    assert.equal(win.get('940,940')?.owner?.ally, true);
    assert.equal(win.size, 1, '只有盟友的城池格，周围仍是黑雾');
    await pool.query(`DELETE FROM alliance_members WHERE account_id = ANY($1::uuid[])`, [[A, D]]);
    await pool.query(`DELETE FROM alliances WHERE id = $1`, [alliance]);
  });

  test('行军途中的部队在当前位置带来实时视野；到达前沿途格不写入已探索', async () => {
    setFogEnabledCache(true);
    // 去程 500 秒前出发、500 秒后到达：当前位置在 A(700) → (900,700) 的中点附近
    const marchId = (await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, started_at, arrive_at)
       VALUES ($1, $2, 900, 700, '{"militia": 10}'::jsonb, 'plunder', 'marching', 'player', now() - interval '500 seconds', now() + interval '500 seconds')
       RETURNING id`,
      [A, cityA],
    )).rows[0].id as string;
    const win = await windowOf(A, 795, 695, 10, 10);
    assert.equal(win.get('800,700')?.fog, 'visible', '行军当前位置的视野覆盖到该格');
    const bits = (await pool.query(`SELECT bits FROM fog_explored WHERE account_id = $1`, [A])).rows[0].bits as Buffer;
    const chunk = Math.floor(700 / 10) * 100 + Math.floor(800 / 10);
    assert.equal((bits[chunk >> 3] & (1 << (chunk & 7))) !== 0, false, '实时视野不写已探索');
    await pool.query(`DELETE FROM marches WHERE id = $1`, [marchId]);
  });

  test('GET_TILE：未探索返回 unexplored；已探索只给快照可见的内容；实时的按完整视图', async () => {
    setFogEnabledCache(true);
    assert.equal((await loadFogTileDetail(pool, A, 900, 900)).kind, 'unexplored');
    assert.equal((await loadFogTileDetail(pool, A, 901, 901)).kind, 'unexplored');
    const explored = await loadFogTileDetail(pool, A, 735, 700);
    assert.equal(explored.kind, 'ok');
    if (explored.kind === 'ok') {
      assert.equal(explored.detail.fog, 'explored');
      assert.equal(explored.detail.nativePower, 0);
      assert.equal(explored.detail.defenses, null);
      assert.equal(explored.detail.assists, null);
      assert.equal(explored.detail.plunderedAt, null);
    }
    const own = await loadFogTileDetail(pool, A, 700, 700);
    assert.equal(own.kind === 'ok' && own.detail.fog, 'visible');
    assert.equal((await loadFogTileDetail(pool, A, 1, 1)).kind, 'unexplored');
  });

  test('小地图：未探索的名城在锚点上显示 famous_rumor；已探索的城按上次看到的样子给；远处未探索的城不出现', async () => {
    setFogEnabledCache(true);
    const ov = await overview(A);
    const cities = ov.cities as Array<[number, number, string]>;
    assert.ok(cities.some(([x, y, side]) => x === 166 && y === 166 && side === 'famous_rumor'), '官渡在锚点 (166,166) 显示大致方位');
    assert.equal(cities.some(([x, y]) => x === 520 && y === 520), false, '未探索的名城不显示真实位置');
    assert.equal(cities.some(([x, y]) => x === 500 && y === 500), false, '未探索的 NPC 城不显示');
    assert.ok(cities.some(([x, y, side]) => x === 735 && y === 700 && side === 'npc'), '已探索的 NPC 城显示');
    assert.ok(cities.some(([x, y, side]) => x === 735 && y === 705 && side === 'enemy'), '已探索的玩家城按上次看到的归属');
    assert.ok(cities.some(([x, y, side]) => x === 700 && y === 700 && side === 'own'), '自己的城');
    assert.equal(typeof ov.exploredPercent, 'number');
    const chunks = Buffer.from(ov.exploredChunks as string, 'base64');
    assert.equal(chunks.length, 1250);
  });

  test('小地图：名城探索后显示真实位置', async () => {
    setFogEnabledCache(true);
    await tile(520, 520, { kind: 'npc_city', level: 3, npc: { famous: { name: '官渡' } } });
    // 通过真实路径探索名城所在区块：在旁边设一块自己的领地（半径 3 覆盖到 520,520 所在区块）
    await tile(521, 521, { kind: 'wilderness', level: 2, owner: cityA });
    await pool.query(`UPDATE world_tiles SET owner_city_id = $1 WHERE x = 521 AND y = 521`, [cityA]);
    await windowOf(A, 690, 690, 5, 5);
    const ov = await overview(A);
    const cities = ov.cities as Array<[number, number, string]>;
    assert.ok(cities.some(([x, y, side]) => x === 520 && y === 520 && side === 'famous'), '探索后显示真实位置');
    assert.equal(cities.some(([x, y, side]) => x === 166 && y === 166 && side === 'famous_rumor'), false, '锚点随之撤下');
  });
});
