// 友盟 / 同盟的城池格实时可见（AISLG-226）：城池格的占领者与请求账号的 relation 为 ally 或 friendly 时，
// 只这一格（不带半径）实时可见——GET_WORLD_MAP / GET_TILE / PUSH_TILE_STATE、小地图、聊天坐标卡片、
// 出征判定 cellVisibility 口径一致。解除友好后 24 小时冷却内仍是 friendly，冷却结束回到迷雾；敌对不可见。
// 需要 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { handleGetMapOverview } from '../api/src/map-overview';
import { loadFogTileDetail, loadFogWindow } from '../api/src/fog-view';
import { cellVisibility } from '../api/src/fog-march';
import { buildChatCard } from '../api/src/chat-cards';
import { buildBannedWordFilter } from '../api/src/chat-words';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

/** 城池格（x, y）的关系状态：alliance_relations 的一行；null = 没有任何关系 */
type RelationCase = { relation: 'friendly' | 'hostile' | 'neutral'; cooldown: 'none' | 'future' | 'past' } | null;

describe('友盟城池格实时可见（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let M: string;
  let F: string;
  let cityA: string;
  let cityM: string;
  let cityF: string;
  let allianceA: string;
  let allianceF: string;
  const tag = `fogf-${Date.now()}`;

  // 友盟城（F）与同盟城（M）都在 A 的视野之外：A 的主城在 (100, 100)
  const FRIEND = { x: 900, y: 900 };
  const ALLY = { x: 960, y: 960 };

  function makeSink() {
    const frames: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
        frames.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    return { ctx: { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext, frames };
  }

  async function tile(x: number, y: number, fields: { kind: string; level?: number; owner?: string | null }): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', $3, $4, $5, NULL)
       ON CONFLICT (x, y) DO UPDATE SET terrain = EXCLUDED.terrain, kind = EXCLUDED.kind, level = EXCLUDED.level,
         owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [x, y, fields.kind, fields.level ?? 0, fields.owner ?? null],
    );
  }

  /** 设置 A 与 F 的关系（A 在 allianceA，F 在 allianceF）；按 LEAST / GREATEST 写 alliance_relations */
  async function setRelation(c: RelationCase): Promise<void> {
    await pool.query(`DELETE FROM alliance_relations`);
    if (!c) {
      return;
    }
    const [lo, hi] = [allianceA, allianceF].sort();
    const noAttackUntil =
      c.cooldown === 'future' ? new Date(Date.now() + 86_400_000) : c.cooldown === 'past' ? new Date(Date.now() - 3_600_000) : null;
    await pool.query(
      `INSERT INTO alliance_relations (a_id, b_id, relation, no_attack_until) VALUES ($1, $2, $3, $4)`,
      [lo, hi, c.relation, noAttackUntil],
    );
  }

  /** 请求账号视角：窗口（只返回实时 / 已探索的格）里某格是否存在 */
  async function windowHas(accountId: string, x: number, y: number): Promise<boolean> {
    const tiles = await loadFogWindow(pool, accountId, x, y, 1, 1);
    return tiles.length === 1;
  }

  async function visibilityOf(accountId: string, x: number, y: number): Promise<string> {
    const client = await pool.connect();
    try {
      return await cellVisibility(client, accountId, x, y, new Date());
    } finally {
      client.release();
    }
  }

  async function overviewHas(accountId: string, x: number, y: number): Promise<string | null> {
    const sink = makeSink();
    const conn = { accountId, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleGetMapOverview(sink.ctx, conn, Op.GET_MAP_OVERVIEW, 1);
    const cities = (sink.frames[sink.frames.length - 1].data?.cities ?? []) as Array<[number, number, string]>;
    return cities.find((p) => p[0] === x && p[1] === y)?.[2] ?? null;
  }

  /** 某格在 A 视角下的全部可见性口径（窗口 / GET_TILE / 小地图 / 聊天坐标 / 出征判定），须一致 */
  async function assertCellVisible(x: number, y: number, visible: boolean, label: string): Promise<void> {
    const inWindow = await windowHas(A, x, y);
    const detail = await loadFogTileDetail(pool, A, x, y);
    const client = await pool.connect();
    let chat: unknown;
    try {
      chat = await buildChatCard(client, A, { kind: 'coord', x, y }, buildBannedWordFilter([]));
    } finally {
      client.release();
    }
    const chatVisible = chat !== 'unexplored';
    const visibility = await visibilityOf(A, x, y);
    const overview = await overviewHas(A, x, y);
    assert.equal(inWindow, visible, `${label}：GET_WORLD_MAP 窗口`);
    assert.equal(detail.kind === 'ok', visible, `${label}：GET_TILE`);
    assert.equal(chatVisible, visible, `${label}：聊天坐标卡片`);
    assert.equal(visibility === 'visible', visible, `${label}：出征判定 cellVisibility（实际 ${visibility}）`);
    assert.equal(overview !== null, visible, `${label}：小地图（实际 ${overview}）`);
    if (visible) {
      assert.equal(detail.kind === 'ok' && detail.detail.fog, 'visible', `${label}：GET_TILE fog`);
    }
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_friendly_city');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    const mk = async (name: string) =>
      (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    A = await mk('a');
    M = await mk('m');
    F = await mk('f');
    const city = async (account: string, name: string, x: number, y: number) =>
      (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, x, y) VALUES ($1, $2, 100000, 100000, 100000, $3, $4) RETURNING id`, [account, name, x, y])).rows[0].id as string;
    cityA = await city(A, 'A主城', 100, 100);
    cityM = await city(M, 'M城', ALLY.x, ALLY.y);
    cityF = await city(F, 'F城', FRIEND.x, FRIEND.y);
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'parade_ground', 9), ($1, 'government', 5)`, [cityA]);
    await tile(100, 100, { kind: 'city', owner: cityA });
    await tile(FRIEND.x, FRIEND.y, { kind: 'city', owner: cityF });
    await tile(ALLY.x, ALLY.y, { kind: 'city', owner: cityM });
    // 城池格周围的野地：友盟 / 同盟的城池格之外，这些格必须仍是黑雾
    await tile(FRIEND.x + 1, FRIEND.y, { kind: 'wilderness', level: 2 });
    await tile(FRIEND.x, FRIEND.y + 1, { kind: 'wilderness', level: 2 });
    await tile(ALLY.x + 1, ALLY.y, { kind: 'wilderness', level: 2 });
    allianceA = (await pool.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [`${tag}-甲`, A])).rows[0].id as string;
    allianceF = (await pool.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [`${tag}-乙`, F])).rows[0].id as string;
    await pool.query(
      `INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, 'leader'), ($3, $2, 'member'), ($4, $5, 'leader')`,
      [A, allianceA, M, F, allianceF],
    );
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  beforeEach(async () => {
    setFogEnabledCache(true);
    // 每个用例从“未探索”起步：上一个用例看到过的城池会留下快照和探索位图，互相污染
    await pool.query(`DELETE FROM fog_seen WHERE account_id = $1`, [A]);
    await pool.query(`DELETE FROM fog_explored WHERE account_id = $1`, [A]);
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [A]);
    await pool.query(`DELETE FROM city_army WHERE city_id = $1`, [cityA]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 500), ($1, 'scout', 20)`, [cityA]);
    await pool.query(`DELETE FROM city_assist`);
    await setRelation(null);
  });

  test('友盟城池格（friendly）：窗口 / GET_TILE / 小地图 / 聊天坐标 / 出征判定都实时可见，周围格仍是黑雾', async () => {
    await setRelation({ relation: 'friendly', cooldown: 'none' });
    await assertCellVisible(FRIEND.x, FRIEND.y, true, '友盟城');
    const detail = await loadFogTileDetail(pool, A, FRIEND.x, FRIEND.y);
    assert.equal(detail.kind === 'ok' && detail.detail.owner?.relation, 'friendly');
    assert.equal(await overviewHas(A, FRIEND.x, FRIEND.y), 'friendly', '小地图的点位是友盟');
    await assertCellVisible(FRIEND.x + 1, FRIEND.y, false, '友盟城东侧野地');
    await assertCellVisible(FRIEND.x, FRIEND.y + 1, false, '友盟城南侧野地');
  });

  test('同盟城池格（ally）：同样只这一格实时可见，周围格仍是黑雾', async () => {
    await setRelation(null);
    await assertCellVisible(ALLY.x, ALLY.y, true, '同盟城');
    assert.equal(await overviewHas(A, ALLY.x, ALLY.y), 'ally', '小地图的点位是盟友');
    await assertCellVisible(ALLY.x + 1, ALLY.y, false, '同盟城东侧野地');
  });

  test('解除友好的 24 小时冷却内仍可见；冷却结束后回到迷雾', async () => {
    await setRelation({ relation: 'neutral', cooldown: 'future' });
    await assertCellVisible(FRIEND.x, FRIEND.y, true, '冷却内的友盟城');
    await assertCellVisible(FRIEND.x + 1, FRIEND.y, false, '冷却内的友盟城东侧野地');

    await setRelation({ relation: 'neutral', cooldown: 'past' });
    await assertCellVisible(FRIEND.x, FRIEND.y, false, '冷却结束的原友盟城');
    assert.equal(await overviewHas(A, FRIEND.x, FRIEND.y), null, '冷却结束后小地图不再显示');
  });

  test('敌对的城池格不因关系实时可见（含敌对且仍在冷却内）', async () => {
    await setRelation({ relation: 'hostile', cooldown: 'none' });
    await assertCellVisible(FRIEND.x, FRIEND.y, false, '敌对城');
    await setRelation({ relation: 'hostile', cooldown: 'future' });
    await assertCellVisible(FRIEND.x, FRIEND.y, false, '敌对且冷却内的城');
  });

  test('友盟城可以直接派协防（未探索也能下达 MARCH assist）', async () => {
    await setRelation({ relation: 'friendly', cooldown: 'none' });
    const sink = makeSink();
    const conn = { accountId: A, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op: Op.MARCH, seq: 1, data: { x: FRIEND.x, y: FRIEND.y, task: 'assist', troops: { militia: 10 } } }));
    const res = sink.frames[sink.frames.length - 1];
    assert.equal(res.ok, true, JSON.stringify(res.error));
  });
});
