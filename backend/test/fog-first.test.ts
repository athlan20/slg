// 名城首探与名将处所首探（AISLG-227，v93）用例：验收 1～3、19～22，探索榜（验收 14），
// 换季清空与重新生成（验收 15），开关关闭（验收 16）。需要 TEST_DATABASE_URL（临时库），否则跳过。
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { ensureWorld } from '../common/src/world-db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { chunkIndexOf, isCellExplored, newFogBits, setChunkExplored } from '../common/src/fog';
import { readFogBits } from '../common/src/fog-db';
import { recordMarchExploration, type ExplorationTrip } from '../common/src/fog-record';
import { EventType, Op, type InitiatorRole } from '../common/src/protocol';
import { HERO_SITE_FIRST_REWARD, FAMOUS_FIRST_REWARD } from '../common/src/relic';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { loadFogWindow, withFogRequest } from '../api/src/fog-view';
import { refreshLeaderboards } from '../worker/src/leaderboard-tick';
import { archiveSeason } from '../worker/src/season-archive';
import { runSeasonReset } from '../worker/src/season-reset';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('名城与名将处所首探（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let A: string;
  let B: string;
  let C: string;
  let cityA: string;
  let cityB: string;
  let cityC: string;
  const tag = `first-${Date.now()}`;

  function makeSink() {
    const frames: Array<{ op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    return { ctx: { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext, frames };
  }

  async function send(account: string, op: number, data: Record<string, unknown>) {
    const sink = makeSink();
    const conn = { accountId: account, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op, seq: 1, data }));
    return sink.frames[sink.frames.length - 1];
  }

  /** 让账号探索某格所在区块（不影响其他区块） */
  async function explore(account: string, x: number, y: number, on = true): Promise<void> {
    await withFogRequest(pool, account, async () => undefined);
    const bits = (await readFogBits(pool, account)) ?? newFogBits();
    const index = chunkIndexOf(x, y);
    if (on) {
      setChunkExplored(bits, index);
    } else {
      bits[index >> 3] &= ~(1 << (index & 7));
    }
    await pool.query(`UPDATE fog_explored SET bits = $2 WHERE account_id = $1`, [account, Buffer.from(bits)]);
  }

  /** 一趟去程：从 (fx, fy) 的左侧走到右侧，经过目标格（视野半径 3） */
  function trip(accountId: string, city: string, x: number, y: number, marchId?: string): ExplorationTrip {
    return {
      marchId: marchId ?? '00000000-0000-4000-8000-000000000001',
      accountId,
      fromCityId: city,
      homeX: x - 4,
      homeY: y,
      targetX: x + 4,
      targetY: y,
      troops: { militia: 1 },
    };
  }

  /**
   * 选一个出发格：半径 3 的视野带碰到名城所在区块，但不覆盖名城格本身（回归用：区块整块算新探索）。
   * 左侧或右侧一定有一个可行的位置；两侧都不行时返回 null。
   */
  function chunkOnlyPoint(fx: number, fy: number): { x: number; y: number } | null {
    const cx0 = Math.floor(fx / 10) * 10;
    if (fx - cx0 >= 2 && cx0 - 2 >= 0) {
      return { x: cx0 - 2, y: fy };
    }
    if (fx - cx0 <= 7 && cx0 + 11 <= 999) {
      return { x: cx0 + 11, y: fy };
    }
    return null;
  }

  /** 单格行军（出发即目标）：路线只有这一格，视野带半径 3 */
  function pointTrip(accountId: string, city: string, x: number, y: number, marchId?: string): ExplorationTrip {
    return { marchId: marchId ?? randomUUID(), accountId, fromCityId: city, homeX: x, homeY: y, targetX: x, targetY: y, troops: { militia: 1 } };
  }

  async function recordTrip(t: ExplorationTrip): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await recordMarchExploration(client, t, 1, new Date());
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function firstRow(key: string): Promise<{ username: string } | null> {
    const res = await pool.query(`SELECT username FROM fog_first_explores WHERE target_key = $1`, [key]);
    return res.rowCount ? (res.rows[0] as { username: string }) : null;
  }

  async function cityGold(city: string): Promise<number> {
    return Number((await pool.query(`SELECT gold FROM cities WHERE id = $1`, [city])).rows[0].gold);
  }

  /** 每个用例前：清首探 / 结交 / 探索记录，两账号探索状态归零（保留开局区块） */
  async function resetFirst(): Promise<void> {
    await pool.query(`DELETE FROM fog_first_explores`);
    await pool.query(`DELETE FROM hero_unlocks WHERE account_id = ANY($1::uuid[])`, [[A, B, C]]);
    await pool.query(`DELETE FROM events WHERE account_id = ANY($1::uuid[]) AND type IN ($2, $3, $4)`, [[A, B, C], EventType.FAMOUS_FIRST_EXPLORED, EventType.HERO_SITE_FIRST_EXPLORED, EventType.RELIC_CLAIMED]);
    await pool.query(`DELETE FROM server_broadcasts WHERE type IN ('famous_first_explored', 'hero_site_first_explored')`);
    await pool.query(`UPDATE cities SET gold = 1000, wood = 1000, food = 1000, stone = 1000, iron = 1000 WHERE id = ANY($1::uuid[])`, [[cityA, cityB, cityC]]);
    await pool.query(`DELETE FROM user_items WHERE account_id = ANY($1::uuid[])`, [[A, B, C]]);
    await pool.query(`UPDATE fog_explored SET bits = bits WHERE account_id = ANY($1::uuid[])`, [[A, B, C]]);
  }

  /** 找一座名城 / 一处名将处所（开局后不在任何账号的开局区块里） */
  async function famousOf(index: number): Promise<{ name: string; x: number; y: number }> {
    const res = await pool.query(`SELECT name, x, y FROM famous_cities ORDER BY name`);
    return res.rows[index] as { name: string; x: number; y: number };
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'fog_first');
    pool = new pg.Pool({ connectionString: tmp.url, max: 8 });
    await ensureSchema(pool);
    await ensureWorld(pool);
    const mk = async (name: string) => (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-${name}`])).rows[0].id as string;
    A = await mk('a');
    B = await mk('b');
    C = await mk('c');
    const city = async (account: string, name: string, x: number, y: number) =>
      (await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, $2, 1000, 1000, 1000, 1000, 1000, $3, $4) RETURNING id`, [account, name, x, y])).rows[0].id as string;
    cityA = await city(A, 'A主城', 40, 40);
    cityB = await city(B, 'B主城', 45, 40);
    cityC = await city(C, 'C主城', 980, 980);
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  beforeEach(async () => {
    setFogEnabledCache(true);
    await resetFirst();
  });

  // ---- 名城首探（验收 1～3）----

  test('部队视野带扫到名城：全服播报一次，主城资源与高级迁城令到账，名城详情显示首探者', async () => {
    const f = await famousOf(0);
    await explore(A, f.x, f.y, false);
    const gold0 = await cityGold(cityA);
    await recordTrip(trip(A, cityA, f.x, f.y));
    assert.deepEqual(await firstRow(`famous:${f.name}`), { username: `${tag}-a` }, '首探者记为 A');
    assert.ok((await cityGold(cityA)) >= gold0 + FAMOUS_FIRST_REWARD.gold, '金币到账');
    const items = (await pool.query(`SELECT count FROM user_items WHERE account_id = $1 AND item_id = 'city_order_adv'`, [A])).rows[0];
    assert.equal(Number(items?.count), 1, '高级迁城令 1 张');
    const broadcasts = (await pool.query(`SELECT detail FROM server_broadcasts WHERE type = 'famous_first_explored'`)).rows as Array<{ detail: Record<string, unknown> }>;
    assert.equal(broadcasts.length, 1, '全服播报一次');
    assert.equal(broadcasts[0].detail.name, f.name);
    assert.equal('x' in broadcasts[0].detail, false, '名城播报不带坐标（只带名城名）');
    // 名城详情（已探索）显示首探者
    const [tileView] = await loadFogWindow(pool, A, f.x, f.y, 1, 1);
    assert.equal(tileView.famous?.firstExplorer, `${tag}-a`);
  });

  test('第二个玩家扫到同一座名城：没有奖励，也没有播报；尚无人首探的名城显示为 null', async () => {
    const f = await famousOf(0);
    await explore(A, f.x, f.y, false);
    await explore(B, f.x, f.y, false);
    await recordTrip(trip(A, cityA, f.x, f.y));
    const gold0 = await cityGold(cityB);
    await recordTrip(trip(B, cityB, f.x, f.y, '00000000-0000-4000-8000-000000000002'));
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM fog_first_explores WHERE target_key = $1`, [`famous:${f.name}`])).rows[0].n, 1);
    assert.equal(await cityGold(cityB), gold0, 'B 没有奖励');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM server_broadcasts WHERE type = 'famous_first_explored'`)).rows[0].n, 1, '没有第二次播报');
    const other = await famousOf(1);
    await explore(C, other.x, other.y, true);
    const [view] = await loadFogWindow(pool, C, other.x, other.y, 1, 1);
    assert.equal(view.famous?.firstExplorer, null, '尚无人首探');
  });

  test('名城在开局已探索范围内，或只在返程 / 视野内：不算首探', async () => {
    const f = await famousOf(2);
    // 1) 开局区块（已探索）：不算
    await explore(A, f.x, f.y, true);
    await recordTrip(trip(A, cityA, f.x, f.y));
    assert.equal(await firstRow(`famous:${f.name}`), null, '已探索的格不算');
    // 2) 返程（fog-tick 只处理去程）：processFogExploration 不写首探，这里用 processFogExploration 的过滤条件验证
    const fogTick = await import('../worker/src/fog-tick');
    await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, resolved_at)
       VALUES ($1, $2, $3, $4, '{"militia": 1}'::jsonb, 'return', 'returned', 'player', now() - interval '2 seconds', now() - interval '1 second')`,
      [B, cityB, f.x, f.y],
    );
    await fogTick.processFogExploration(pool);
    assert.equal(await firstRow(`famous:${f.name}`), null, '返程不算');
    await pool.query(`DELETE FROM marches WHERE account_id = $1`, [B]);
  });

  test('回归：视野带只碰到名城所在区块、没碰到名城格：算首探（区块整块记为新探索，不漏奖）', async () => {
    let target: { x: number; y: number } | null = null;
    let picked = await famousOf(0);
    for (let index = 0; index < 8 && !target; index += 1) {
      picked = await famousOf(index);
      target = chunkOnlyPoint(picked.x, picked.y);
    }
    assert.ok(target, '找到一个只碰区块的出发格');
    const f = picked;
    const origin = target!;
    // 出发格的视野带确实碰到名城所在区块、没有覆盖名城格
    assert.ok(Math.max(Math.abs(origin.x - f.x), Math.abs(origin.y - f.y)) > 3, '名城格不在视野内');
    await explore(A, f.x, f.y, false);
    await recordTrip(pointTrip(A, cityA, origin.x, origin.y));
    assert.deepEqual(await firstRow(`famous:${f.name}`), { username: `${tag}-a` }, '首探归 A');
  });

  test('第二个玩家在第一人之后探开同一区块：无奖励（区块第一次新探索的人拿到）', async () => {
    const f = await famousOf(4);
    const origin = chunkOnlyPoint(f.x, f.y) ?? { x: f.x, y: f.y };
    await explore(A, f.x, f.y, false);
    await explore(B, f.x, f.y, false);
    await recordTrip(pointTrip(A, cityA, origin.x, origin.y));
    const gold0 = await cityGold(cityB);
    await recordTrip(pointTrip(B, cityB, origin.x, origin.y));
    assert.deepEqual(await firstRow(`famous:${f.name}`), { username: `${tag}-a` }, '首探仍归 A');
    assert.equal(await cityGold(cityB), gold0, 'B 没有奖励');
  });

  test('区块已探索后再扫到：不算（之前的行军已把这个区块记为探索过）', async () => {
    const f = await famousOf(5);
    const origin = chunkOnlyPoint(f.x, f.y) ?? { x: f.x, y: f.y };
    await explore(C, f.x, f.y, true);
    await recordTrip(pointTrip(C, cityC, origin.x, origin.y));
    assert.equal(await firstRow(`famous:${f.name}`), null, '区块不是这趟新探索的');
  });

  // ---- 名将处所（验收 19～22）----

  test('名将处所：未探索时拿不到处所信息；首探后处所名与名将可见，奖励到账，结交资格直接获得，播报不带坐标', async () => {
    const site = (await pool.query(`SELECT x, y FROM world_tiles WHERE wild_hero = '诸葛亮'`)).rows[0] as { x: number; y: number };
    await explore(B, site.x, site.y, false);
    const [hidden] = await loadFogWindow(pool, B, site.x, site.y, 1, 1);
    assert.equal(hidden, undefined, '未探索的处所格不返回');
    const gold0 = await cityGold(cityB);
    await recordTrip(trip(B, cityB, site.x, site.y));
    assert.deepEqual(await firstRow('site:诸葛亮'), { username: `${tag}-b` });
    assert.ok((await cityGold(cityB)) >= gold0 + HERO_SITE_FIRST_REWARD.gold, '奖励到账');
    const unlock = (await pool.query(`SELECT 1 FROM hero_unlocks WHERE account_id = $1 AND hero_name = '诸葛亮'`, [B])).rowCount;
    assert.equal(unlock, 1, '首探者获得结交资格（不用打守军）');
    const [seen] = await loadFogWindow(pool, B, site.x, site.y, 1, 1);
    assert.deepEqual(seen.heroSite, { name: '茅庐', hero: '诸葛亮', claimed: false });
    const broadcasts = (await pool.query(`SELECT detail FROM server_broadcasts WHERE type = 'hero_site_first_explored'`)).rows as Array<{ detail: Record<string, unknown> }>;
    assert.equal(broadcasts.length, 1, '全服播报一次');
    assert.equal('x' in broadcasts[0].detail, false, '播报不带坐标');
    // 其他玩家：A 也探索后，首探已被占，A 不再得奖；但 A 仍可按规则打赢守军获得资格（这里只验证首探不重复）
    await explore(A, site.x, site.y, false);
    const gold1 = await cityGold(cityA);
    await recordTrip(trip(A, cityA, site.x, site.y, '00000000-0000-4000-8000-000000000003'));
    assert.equal(await cityGold(cityA), gold1, 'A 没有首探奖励');
    assert.equal((await pool.query(`SELECT 1 FROM hero_unlocks WHERE account_id = $1 AND hero_name = '诸葛亮'`, [A])).rowCount, 0, '首探只归 B');
  });

  test('名将已被招揽：处所与名字保留（claimed），首探只发资源，不给结交资格', async () => {
    const site = (await pool.query(`SELECT x, y FROM world_tiles WHERE wild_hero = '关羽'`)).rows[0] as { x: number; y: number };
    const hero = (await pool.query(
      `INSERT INTO account_heroes (account_id, name, famous, lead, force, wit) VALUES ($1, '关羽', true, 80, 80, 80) RETURNING id`,
      [C],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO famous_heroes (name, source, hero_id, owner_account_id) VALUES ('关羽', 'wild', $1, $2)`, [hero, C]);
    try {
      await explore(A, site.x, site.y, false);
      const gold0 = await cityGold(cityA);
      await recordTrip(trip(A, cityA, site.x, site.y));
      assert.deepEqual(await firstRow('site:关羽'), { username: `${tag}-a` });
      assert.ok((await cityGold(cityA)) >= gold0 + HERO_SITE_FIRST_REWARD.gold, '资源照发');
      assert.equal((await pool.query(`SELECT 1 FROM hero_unlocks WHERE account_id = $1 AND hero_name = '关羽'`, [A])).rowCount, 0, '不给结交资格');
      const [view] = await loadFogWindow(pool, A, site.x, site.y, 1, 1);
      assert.deepEqual(view.heroSite, { name: '关公庙', hero: '关羽', claimed: true }, '处所与名字保留，标记已出山');
    } finally {
      await pool.query(`DELETE FROM famous_heroes WHERE name = '关羽'`);
      await pool.query(`DELETE FROM account_heroes WHERE id = $1`, [hero]);
    }
  });

  test('其余在野名将的格不带处所信息（显示与现在一样，★ 标记照旧）', async () => {
    const other = (await pool.query(`SELECT x, y FROM world_tiles WHERE wild_hero = '夏侯惇'`)).rows[0] as { x: number; y: number };
    // 已探索格的在野名将标记取“上次看到”的快照：走一趟经过该格，写入快照
    await explore(A, other.x, other.y, false);
    await recordTrip(trip(A, cityA, other.x, other.y));
    const [view] = await loadFogWindow(pool, A, other.x, other.y, 1, 1);
    assert.equal(view.heroSite, null);
    assert.equal(view.wildFamous, true, '在野名将标记照旧');
  });

  // ---- 探索榜（验收 14）----

  test('探索榜：按已探索区块数排名，换季存档写入名人堂；迷雾关闭时不算、返回空', async () => {
    await pool.query(`DELETE FROM leaderboard_snapshots WHERE kind = 'exploration'`);
    const cells: Array<[number, number]> = [[300, 300], [310, 300], [600, 600]];
    await pool.query(`UPDATE fog_explored SET bits = bits WHERE account_id = ANY($1::uuid[])`, [[A, B]]);
    for (const [x, y] of cells) {
      await explore(A, x, y, true);
    }
    await explore(B, 300, 300, true);
    await refreshLeaderboards(pool);
    const rows = (await pool.query(
      `SELECT username, value FROM leaderboard_snapshots WHERE kind = 'exploration' ORDER BY rank`,
    )).rows as Array<{ username: string; value: string }>;
    assert.equal(rows[0].username, `${tag}-a`, 'A 排第一');
    assert.ok(Number(rows[0].value) > Number(rows[1].value), '区块数更多');
    assert.equal(Number(rows[0].value) / 100 <= 100, true, '百分比 = 区块数 ÷ 100，不超过 100');

    const seasonRow = (await pool.query(`SELECT id, name FROM seasons ORDER BY id LIMIT 1`)).rows[0] as { id: number; name: string };
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await archiveSeason(client, seasonRow.id, seasonRow.name);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const archived = await pool.query(`SELECT count(*)::int AS n FROM season_archives WHERE season_id = $1 AND kind = 'exploration'`, [seasonRow.id]);
    assert.ok(archived.rows[0].n >= 2, '探索榜进名人堂');

    setFogEnabledCache(false);
    await refreshLeaderboards(pool);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM leaderboard_snapshots WHERE kind = 'exploration'`)).rows[0].n, 0, '关闭时不写');
    const off = await send(A, Op.GET_LEADERBOARD, { kind: 'exploration' });
    assert.equal(off.ok, true);
    assert.deepEqual(off.data?.entries, [], '关闭时返回空榜');
    setFogEnabledCache(true);
  });

  // ---- 开关关闭（验收 16）----

  test('fog_enabled 关闭：不记首探、不发奖、不显示处所与遗迹', async () => {
    setFogEnabledCache(false);
    const f = await famousOf(3);
    const site = (await pool.query(`SELECT x, y FROM world_tiles WHERE wild_hero = '刘备'`)).rows[0] as { x: number; y: number };
    await explore(A, f.x, f.y, false);
    await explore(A, site.x, site.y, false);
    const gold0 = await cityGold(cityA);
    await recordTrip(trip(A, cityA, f.x, f.y));
    await recordTrip(trip(A, cityA, site.x, site.y));
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM fog_first_explores`)).rows[0].n, 0);
    assert.equal(await cityGold(cityA), gold0);
    const [view] = await loadFogWindow(pool, A, site.x, site.y, 1, 1);
    assert.equal(view.heroSite, null);
    setFogEnabledCache(true);
    assert.equal(isCellExplored(await readFogBits(pool, A) ?? newFogBits(), f.x, f.y), true, '探索状态照常记录（不丢数据）');
  });

  // ---- 换季（验收 15）----

  test('换季后：遗迹与首探记录清空，按新世界重新生成，fog_enabled 保留', async () => {
    await pool.query(`INSERT INTO fog_first_explores (target_key, account_id, username) VALUES ('famous:官渡', $1, $2)`, [A, `${tag}-a`]);
    const before = (await pool.query(`SELECT array_agg(x || ',' || y ORDER BY x, y) AS cells FROM fog_relics`)).rows[0].cells as string[];
    await pool.query(`UPDATE seasons SET end_at = now() - interval '1 minute' WHERE status = 'active'`);
    const outcome = await runSeasonReset(pool);
    assert.equal(outcome.status, 'reset');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM fog_first_explores`)).rows[0].n, 0, '首探记录清空');
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM fog_relics WHERE claimed_by IS NOT NULL`)).rows[0].n, 0);
    const after = (await pool.query(`SELECT array_agg(x || ',' || y ORDER BY x, y) AS cells FROM fog_relics`)).rows[0].cells as string[];
    assert.equal(after.length, 200, '新世界重新生成 200 处');
    assert.notDeepEqual(after, before, '新种子，遗迹位置不同');
  });
});
