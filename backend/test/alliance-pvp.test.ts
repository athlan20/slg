// 联盟 · 盟友互不攻击（v67，AISLG-182）：出征目标校验（掠夺 / 占领分城 / 抢野地）、侦察、
// 出发后才入盟的到达复核（Worker 三个 PvP 结算 + 侦察）、地图盟友标记。
// 需要真实 PostgreSQL：设置 TEST_DATABASE_URL 才会跑（在其所指服务器上另建一次性数据库，别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { TileRow } from '../common/src/world-db';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { resolveMarchTarget } from '../api/src/march-target';
import { handleScout } from '../api/src/handlers-battle';
import { handleGetMapOverview } from '../api/src/map-overview';
import { loadWorldWindow } from '../api/src/views-world';
import type { MarchRow } from '../api/src/views';
import { resolvePvpPlunderArrival } from '../worker/src/pvp-raid';
import { resolvePvpOccupyArrival } from '../worker/src/pvp-tile';
import { resolvePvpConquestArrival } from '../worker/src/pvp-conquer';
import type { TileNotify } from '../worker/src/tick-shared';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const baseUrl = process.env.TEST_DATABASE_URL;

describe('盟友互不攻击（需 TEST_DATABASE_URL）', { skip: baseUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let tmp: TempDatabase;
  let pool: pg.Pool;
  let n = 0;

  interface Frame { ok: boolean; data?: Record<string, unknown>; error?: { code: string } }
  let last: Frame | undefined;
  const registry = {
    send: (_conn: ConnInfo, frame: Frame) => {
      last = { ok: frame.ok ?? true, data: frame.data, error: frame.error };
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  const connOf = (accountId: string): ConnInfo => ({ accountId, host: null, role: 'player' as InitiatorRole }) as unknown as ConnInfo;

  interface Player { id: string; cityId: string; x: number; y: number }

  /** 建账号与主城（城池地块 kind=city、驻军斥候 10 / 步兵 50）；官府 5 级，校场 3 级 */
  async function makePlayer(label: string): Promise<Player> {
    n += 1;
    const x = 100 + n * 10;
    const y = 100;
    const acc = await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${label}-${n}`]);
    const id = acc.rows[0].id as string;
    const city = await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, $2, 5000, 5000, 5000, 5000, 5000, $3, $4) RETURNING id`,
      [id, `${label}城`, x, y],
    );
    const cityId = city.rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 5), ($1, 'parade_ground', 3)`, [cityId]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'scout', 10), ($1, 'militia', 50)`, [cityId]);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id) VALUES ($1, $2, 'plain', 'city', 0, $3)`,
      [x, y, cityId],
    );
    return { id, cityId, x, y };
  }

  /** 把一批账号放进同一个联盟 */
  async function ally(...players: Player[]): Promise<string> {
    n += 1;
    const res = await pool.query(`INSERT INTO alliances (name, leader_id) VALUES ($1, $2) RETURNING id`, [`测试盟${n}`, players[0].id]);
    const allianceId = res.rows[0].id as string;
    for (const [i, p] of players.entries()) {
      await pool.query(`INSERT INTO alliance_members (account_id, alliance_id, role) VALUES ($1, $2, $3)`, [p.id, allianceId, i === 0 ? 'leader' : 'member']);
    }
    return allianceId;
  }

  /** 给某玩家的城添一块占领野地，返回地块行 */
  async function wilderness(owner: Player, dx: number): Promise<TileRow> {
    const x = owner.x + dx;
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id) VALUES ($1, $2, 'forest', 'wilderness', 2, $3)`,
      [x, owner.y + 1, owner.cityId],
    );
    return tileAt(x, owner.y + 1);
  }
  async function tileAt(x: number, y: number): Promise<TileRow> {
    return (await pool.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2`, [x, y])).rows[0] as TileRow;
  }

  async function verdict(attacker: Player, tile: TileRow, task: 'plunder' | 'occupy') {
    const client = await pool.connect();
    try {
      const now = (await client.query(`SELECT now() AS now`)).rows[0].now as Date;
      return await resolveMarchTarget(client, attacker.id, attacker.cityId, tile, task, 5, now);
    } finally {
      client.release();
    }
  }

  async function insertMarch(attacker: Player, x: number, y: number, purpose: string): Promise<MarchRow> {
    const res = await pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, $3, $4, '{"militia":20}'::jsonb, $5, 'marching', 'player', now()) RETURNING *`,
      [attacker.id, attacker.cityId, x, y, purpose],
    );
    return res.rows[0] as MarchRow;
  }

  /** 在事务里跑一次到达结算，返回通知与结果（提交后读事件 / 返程行军） */
  async function arrival(
    march: MarchRow,
    fn: (client: pg.PoolClient, notifies: TileNotify[], settled: { row: { x: number; y: number } }) => Promise<void>,
    attacker: Player,
  ): Promise<{ events: Array<{ detail: Record<string, unknown> }>; returns: number }> {
    const client = await pool.connect();
    const notifies: TileNotify[] = [];
    try {
      await client.query('BEGIN');
      await fn(client, notifies, { row: { x: attacker.x, y: attacker.y } });
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    const events = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND build_id = $2`, [attacker.id, march.id]);
    const returns = await pool.query(`SELECT count(*)::int AS n FROM marches WHERE account_id = $1 AND purpose = 'return'`, [attacker.id]);
    return { events: events.rows as Array<{ detail: Record<string, unknown> }>, returns: returns.rows[0].n as number };
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(baseUrl as string, 'alliance_pvp');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;
  });
  after(async () => {
    await pool.end();
    await tmp.drop();
  });

  test('出征：盟友城池掠夺 / 占领、盟友野地抢占 / 掠夺都被拒，非盟友照常；调兵不受影响', async () => {
    const a = await makePlayer('atk');
    const friend = await makePlayer('friend');
    const stranger = await makePlayer('stranger');
    // 守方都过了新手保护（accounts.newbie_until 默认空即无保护）
    await ally(a, friend);

    const friendCity = await tileAt(friend.x, friend.y);
    assert.equal((await verdict(a, friendCity, 'plunder')).reason, 'ALLY_NOT_ATTACKABLE');
    assert.equal((await verdict(a, friendCity, 'occupy')).reason, 'ALLY_NOT_ATTACKABLE');
    const friendLand = await wilderness(friend, 1);
    assert.equal((await verdict(a, friendLand, 'occupy')).reason, 'ALLY_NOT_ATTACKABLE');
    assert.equal((await verdict(a, friendLand, 'plunder')).reason, 'ALLY_NOT_ATTACKABLE');

    // 非盟友：城池掠夺放行，野地抢占放行
    const strangerCity = await tileAt(stranger.x, stranger.y);
    assert.equal((await verdict(a, strangerCity, 'plunder')).purpose, 'plunder');
    const strangerLand = await wilderness(stranger, 1);
    assert.equal((await verdict(a, strangerLand, 'occupy')).purpose, 'occupy');

    // 自己的野地仍是增援
    const ownLand = await wilderness(a, 1);
    assert.equal((await verdict(a, ownLand, 'occupy')).purpose, 'reinforce');
  });

  test('侦察：盟友的城池与野地不能侦察，非盟友可以，且被拒不扣斥候', async () => {
    const a = await makePlayer('scout-atk');
    const friend = await makePlayer('scout-friend');
    const stranger = await makePlayer('scout-stranger');
    await ally(a, friend);
    const friendLand = await wilderness(friend, 1);

    const scout = async (x: number, y: number): Promise<Frame> => {
      last = undefined;
      await handleScout(ctx, connOf(a.id), Op.SCOUT, 1, x, y, 2);
      assert.ok(last);
      return last as Frame;
    };
    const scoutsLeft = async (): Promise<number> =>
      (await pool.query(`SELECT count FROM city_army WHERE city_id = $1 AND troop = 'scout'`, [a.cityId])).rows[0].count as number;

    let f = await scout(friend.x, friend.y);
    assert.equal(f.ok, false);
    assert.equal(f.error?.code, 'ALLY_NOT_ATTACKABLE');
    f = await scout(friendLand.x, friendLand.y);
    assert.equal(f.error?.code, 'ALLY_NOT_ATTACKABLE');
    assert.equal(await scoutsLeft(), 10, '被拒不扣斥候');
    assert.equal((await pool.query(`SELECT newbie_until FROM accounts WHERE id = $1`, [a.id])).rows[0].newbie_until, null);

    f = await scout(stranger.x, stranger.y);
    assert.equal(f.ok, true, JSON.stringify(f.error));
    assert.equal(await scoutsLeft(), 8);
  });

  test('出发后才入盟：掠夺 / 抢野地 / 占分城到达时都不开战，原路返回并记 cause', async () => {
    const a = await makePlayer('late-atk');
    const target = await makePlayer('late-target');
    const land = await wilderness(target, 1);
    await ally(a, target); // 出发时还不是盟友，到达前才入盟

    const cityTile = await tileAt(target.x, target.y);

    // 掠夺玩家城
    let march = await insertMarch(a, target.x, target.y, 'plunder');
    let out = await arrival(march, (client, notifies, settled) => resolvePvpPlunderArrival(client, march, { militia: 20 }, cityTile, settled, notifies), a);
    assert.equal(out.events.length, 1);
    assert.equal(out.events[0].detail.cause, 'ALLY_NOT_ATTACKABLE');
    assert.equal(out.returns, 1);

    // 占领分城（攻城）
    march = await insertMarch(a, target.x, target.y, 'occupy');
    out = await arrival(march, (client, notifies, settled) => resolvePvpConquestArrival(client, march, { militia: 20 }, cityTile, settled, notifies), a);
    assert.equal(out.events[0].detail.cause, 'ALLY_NOT_ATTACKABLE');
    assert.equal(out.returns, 2);

    // 抢野地：归属不变，地块驻军不变
    march = await insertMarch(a, land.x, land.y, 'occupy');
    out = await arrival(march, (client, notifies, settled) => resolvePvpOccupyArrival(client, march, { militia: 20 }, land, settled, notifies), a);
    assert.equal(out.events[0].detail.cause, 'ALLY_NOT_ATTACKABLE');
    assert.equal(out.returns, 3);
    assert.equal((await tileAt(land.x, land.y)).owner_city_id, target.cityId);
    // 守方城池没被动过：没有免战、没有战报
    assert.equal((await pool.query(`SELECT truce_until FROM cities WHERE id = $1`, [target.cityId])).rows[0].truce_until, null);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM battle_reports`)).rows[0].n, 0);
  });

  test('地图：地块 owner.ally 与小地图 side=ally 只对同联盟的人出现', async () => {
    const a = await makePlayer('map-a');
    const friend = await makePlayer('map-friend');
    const stranger = await makePlayer('map-stranger');
    await ally(a, friend);
    const friendLand = await wilderness(friend, 1);

    const view = async (as: Player | undefined, x: number, y: number) =>
      (await loadWorldWindow(pool, x, y, 1, 1, as?.id)).find((t) => t.x === x && t.y === y);
    assert.equal((await view(a, friend.x, friend.y))?.owner?.ally, true);
    assert.equal((await view(a, friendLand.x, friendLand.y))?.owner?.ally, true);
    assert.equal((await view(a, a.x, a.y))?.owner?.ally, false, '自己不算盟友');
    assert.equal((await view(a, stranger.x, stranger.y))?.owner?.ally, false);
    assert.equal((await view(stranger, friend.x, friend.y))?.owner?.ally, false, '外人看不到盟友标记');
    assert.equal((await view(undefined, friend.x, friend.y))?.owner?.ally, false);

    const overview = async (as: Player): Promise<Map<string, string>> => {
      last = undefined;
      await handleGetMapOverview(ctx, connOf(as.id), Op.GET_MAP_OVERVIEW, 1);
      const cities = (last as unknown as Frame).data?.cities as Array<[number, number, string]>;
      return new Map(cities.map(([x, y, side]) => [`${x},${y}`, side]));
    };
    const mine = await overview(a);
    assert.equal(mine.get(`${a.x},${a.y}`), 'own');
    assert.equal(mine.get(`${friend.x},${friend.y}`), 'ally');
    assert.equal(mine.get(`${stranger.x},${stranger.y}`), 'enemy');
    const theirs = await overview(stranger);
    assert.equal(theirs.get(`${friend.x},${friend.y}`), 'enemy');
  });

  test('退盟后恢复可攻击', async () => {
    const a = await makePlayer('exit-a');
    const friend = await makePlayer('exit-friend');
    await ally(a, friend);
    const city = await tileAt(friend.x, friend.y);
    assert.equal((await verdict(a, city, 'plunder')).reason, 'ALLY_NOT_ATTACKABLE');
    await pool.query(`DELETE FROM alliance_members WHERE account_id = $1`, [friend.id]);
    assert.equal((await verdict(a, city, 'plunder')).purpose, 'plunder');
  });
});
