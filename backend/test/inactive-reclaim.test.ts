// 长期不活跃账号的野地收回（v98，AISLG-238）：本人和 Agent 都 7 天没上线，名下野地一次全部收回。
// 规则部分（阈值常量）不需要数据库；事务规则（不活跃判定、跨城一次收完、差一点不到 7 天不收、
// 驻军回所属城、望楼毁掉、储量不重置、无换主保护、重复扫描不产生事件、Agent 活跃的账号不收、
// 城与资源兵力不受影响、离线日报计数）需要真实 PostgreSQL：设置 TEST_DATABASE_URL
//（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { INACTIVE_WILDERNESS_RECLAIM_MS } from '../common/src/inactive';
import { ALLIANCE_LEADER_INACTIVE_MS } from '../common/src/protocol-alliance';
import { Op, type InitiatorRole } from '../common/src/protocol';
import { INACTIVE_TICK_MS, processInactiveTerritories } from '../worker/src/inactive-tick';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleGetOfflineReport } from '../api/src/handlers-offline';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const DAY = 24 * 3600 * 1000;

describe('长期不活跃的判定阈值（无需数据库）', () => {
  test('7 天、按现实时间（与盟主自动转让同一个阈值）', () => {
    assert.equal(INACTIVE_WILDERNESS_RECLAIM_MS, 7 * DAY);
    assert.equal(INACTIVE_WILDERNESS_RECLAIM_MS, ALLIANCE_LEADER_INACTIVE_MS);
  });

  test('扫描节流是每小时一轮（不是高频空轮询）', () => {
    assert.equal(INACTIVE_TICK_MS, 3600 * 1000);
  });
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('inactive-tick 收回野地的事务规则（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  /** 每轮扫描用的「当前时刻」：按小时递增，避开进程内节流（同一进程内 lastRunMs 是模块级的） */
  let clock = Date.now();
  const nextClock = (): number => {
    clock += INACTIVE_TICK_MS;
    return clock;
  };

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'inactive238');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
  });

  // 每个用例只看自己造的账号：先把之前用例留下的账号刷成「刚上线」（同一个库、同一个进程）
  beforeEach(async () => {
    await pool.query(`UPDATE accounts SET last_active_at = now(), last_online_at = now()`);
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  /** 建账号：lastActiveAt / lastOnlineAt 显式给（null 走 COALESCE 的下一档） */
  async function newAccount(
    label: string,
    opts: { lastActiveAt?: Date | null; lastOnlineAt?: Date | null; createdAt?: Date } = {},
  ): Promise<string> {
    const res = await pool.query(
      `INSERT INTO accounts (username, password_hash, last_active_at, last_online_at, created_at)
       VALUES ($1, 'x', $2, $3, COALESCE($4::timestamptz, now())) RETURNING id`,
      [`${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, opts.lastActiveAt ?? null, opts.lastOnlineAt ?? null, opts.createdAt ?? null],
    );
    return res.rows[0].id as string;
  }

  async function newCity(accountId: string, x: number, y: number, name: string): Promise<string> {
    const id = (await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y, origin_level)
       VALUES ($1, $2, 1234, 4321, 999, 555, 77, $3, $4, 2) RETURNING id`,
      [accountId, name, x, y],
    )).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 2)`, [id]);
    return id;
  }

  /** 让城占一块野地（含驻军）；reserve / owner_changed_until 用于验证「储量不重置、不设换主保护」 */
  async function claimTile(
    x: number,
    y: number,
    cityId: string,
    garrison: Record<string, number> = {},
    extra: { reserve?: number; ownerChangedUntil?: Date } = {},
  ): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, owner_changed_until, reserve)
       VALUES ($1, $2, 'forest', 'wilderness', 2, $3, $4, $5)
       ON CONFLICT (x, y) DO UPDATE
         SET kind = 'wilderness', level = 2, owner_city_id = $3, owner_changed_until = $4, reserve = $5`,
      [x, y, cityId, extra.ownerChangedUntil ?? null, extra.reserve ?? null],
    );
    await pool.query(`DELETE FROM tile_army WHERE x = $1 AND y = $2`, [x, y]);
    for (const [troop, count] of Object.entries(garrison)) {
      await pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, $3, $4)`, [x, y, troop, count]);
    }
  }

  async function addCityArmy(cityId: string, troops: Record<string, number>): Promise<void> {
    for (const [troop, count] of Object.entries(troops)) {
      await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, $2, $3)`, [cityId, troop, count]);
    }
  }

  async function cityArmy(cityId: string): Promise<Record<string, number>> {
    const res = await pool.query(`SELECT troop, count FROM city_army WHERE city_id = $1`, [cityId]);
    const out: Record<string, number> = {};
    for (const row of res.rows as Array<{ troop: string; count: number }>) {
      out[row.troop] = row.count;
    }
    return out;
  }

  async function tileState(x: number, y: number) {
    const res = await pool.query(
      `SELECT owner_city_id, owner_changed_until, reserve FROM world_tiles WHERE x = $1 AND y = $2`,
      [x, y],
    );
    return res.rows[0] as { owner_city_id: string | null; owner_changed_until: Date | null; reserve: number | null };
  }

  async function tileArmyCount(x: number, y: number): Promise<number> {
    const res = await pool.query(`SELECT COALESCE(sum(count), 0)::int AS n FROM tile_army WHERE x = $1 AND y = $2`, [x, y]);
    return (res.rows[0] as { n: number }).n;
  }

  async function eventRows(accountId: string, type = 'wilderness_lost') {
    const res = await pool.query(
      `SELECT type, city_id, detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id`,
      [accountId, type],
    );
    return res.rows as Array<{ type: string; city_id: string | null; detail: Record<string, unknown> }>;
  }

  /** 一个空的接收器（离线日报的响应帧收集） */
  function makeSink() {
    const frames: Array<{ op?: number; ok?: boolean; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown> }) => {
        frames.push({ op: frame.op, ok: frame.ok ?? true, data: frame.data });
      },
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
    return { ctx, frames };
  }

  const inactive8d = (): Date => new Date(Date.now() - 8 * DAY);

  test('验收 1 / 8：7 天不活跃的账号 12 块野地分属两座城 → 一次全部收回，城与资源兵力不受影响', async () => {
    // 账号 J：8 天没上线，主城 + 分城，一共 12 块野地（7 + 5）
    const j = await newAccount('j-inactive', { lastActiveAt: inactive8d() });
    const main = await newCity(j, 200, 200, '主城');
    const branch = await newCity(j, 205, 200, '分城');
    await addCityArmy(main, { militia: 100 });
    await addCityArmy(branch, { archer: 40 });
    for (let i = 0; i < 7; i += 1) {
      await claimTile(300 + i, 300, main, { militia: 10 + i });
    }
    for (let i = 0; i < 5; i += 1) {
      await claimTile(300 + i, 301, branch, { archer: 3 });
    }
    // 对照：差一点不到 7 天（6 天 23 小时）的账号不收
    const almost = await newAccount('almost', { lastActiveAt: new Date(Date.now() - 7 * DAY + 3600 * 1000) });
    const almostCity = await newCity(almost, 210, 210, '差一点');
    await claimTile(400, 400, almostCity, { militia: 5 });
    // 对照：正常活跃账号不收
    const active = await newAccount('active', { lastActiveAt: new Date(Date.now() - 3600 * 1000) });
    const activeCity = await newCity(active, 215, 215, '活跃');
    await claimTile(401, 401, activeCity, { militia: 5 });

    const result = await processInactiveTerritories(pool, nextClock());
    assert.deepEqual(result, { accounts: 1, tiles: 12 }, '只有 J 被收，12 块地全收');

    for (let i = 0; i < 7; i += 1) {
      assert.equal((await tileState(300 + i, 300)).owner_city_id, null, `主城第 ${i} 块已成无主`);
    }
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await tileState(300 + i, 301)).owner_city_id, null, `分城第 ${i} 块已成无主`);
    }
    assert.equal((await tileState(400, 400)).owner_city_id, almostCity, '差一点不到 7 天：不收');
    assert.equal((await tileState(401, 401)).owner_city_id, activeCity, '最近活跃：不收');

    // 事件：12 条 wilderness_lost，cause=inactive，cityId 是这块地所属的城
    const lost = await eventRows(j);
    assert.equal(lost.length, 12);
    for (const row of lost) {
      assert.equal(row.detail.cause, 'inactive');
      assert.ok(row.city_id === main || row.city_id === branch, '事件挂在所属城上');
      assert.equal(row.detail.terrain, 'forest');
      assert.equal(row.detail.level, 2);
    }
    assert.equal((await eventRows(almost)).length, 0, '不收的账号没有事件');

    // 城与城内资源兵力都不受影响
    const cityRes = await pool.query(`SELECT name, gold, wood, food, stone, iron FROM cities WHERE id = ANY($1::uuid[])`, [[main, branch]]);
    const byName = new Map((cityRes.rows as Array<Record<string, unknown>>).map((row) => [String(row.name), row]));
    for (const name of ['主城', '分城']) {
      assert.deepEqual(byName.get(name), { name, gold: 1234, wood: 4321, food: 999, stone: 555, iron: 77 }, `${name}的资源不受影响`);
    }
    assert.equal(byName.size, 2, '两座城都还在');
  });

  test('验收 4：驻军一兵不少地回到这块地所属的城（不走行军），地块驻军清空', async () => {
    const j = await newAccount('k-garrison', { lastActiveAt: inactive8d() });
    const main = await newCity(j, 220, 220, '主城');
    const branch = await newCity(j, 225, 220, '分城');
    await addCityArmy(main, { militia: 100, archer: 7 });
    await addCityArmy(branch, { cavalry: 2 });
    await claimTile(500, 500, main, { militia: 33 });
    await claimTile(501, 500, main, { archer: 12 });
    await claimTile(502, 500, branch, { cavalry: 9, porter: 4 });

    const result = await processInactiveTerritories(pool, nextClock());
    assert.deepEqual(result, { accounts: 1, tiles: 3 });

    assert.deepEqual(await cityArmy(main), { militia: 133, archer: 19 }, '主城的驻军全部回主城，原有兵力不动');
    assert.deepEqual(await cityArmy(branch), { cavalry: 11, porter: 4 }, '分城的驻军回分城');
    for (const [x, y] of [[500, 500], [501, 500], [502, 500]] as Array<[number, number]>) {
      assert.equal(await tileArmyCount(x, y), 0, '地块驻军清空');
    }
    // 不走行军：没有产生任何行军行
    const marches = await pool.query(`SELECT count(*)::int AS n FROM marches WHERE account_id = $1`, [j]);
    assert.equal((marches.rows[0] as { n: number }).n, 0);
  });

  test('验收 5 / 6：地块立刻变无主、储量不重置、不设换主保护', async () => {
    const j = await newAccount('m-tile', { lastActiveAt: inactive8d() });
    const main = await newCity(j, 230, 230, '主城');
    await claimTile(600, 600, main, {}, { reserve: 640, ownerChangedUntil: new Date(Date.now() + 3600 * 1000) });
    await processInactiveTerritories(pool, nextClock());
    const state = await tileState(600, 600);
    assert.equal(state.owner_city_id, null, '无主');
    assert.equal(state.reserve, 640, '当前储量不重置');
    assert.equal(state.owner_changed_until, null, '不设换主保护（其他玩家可以马上占）');
  });

  test('验收 5：地上的望楼毁掉，不退资源（facility_lost cause=inactive）', async () => {
    const j = await newAccount('n-facility', { lastActiveAt: inactive8d() });
    const main = await newCity(j, 240, 240, '主城');
    await claimTile(700, 700, main, { militia: 1 });
    await pool.query(
      `INSERT INTO wilderness_facilities (x, y, kind, level, city_id) VALUES (700, 700, 'watchtower', 2, $1)`,
      [main],
    );
    await processInactiveTerritories(pool, nextClock());
    const left = await pool.query(`SELECT count(*)::int AS n FROM wilderness_facilities WHERE x = 700 AND y = 700`);
    assert.equal((left.rows[0] as { n: number }).n, 0, '望楼行已删除');
    const facilityLost = await eventRows(j, 'facility_lost');
    assert.equal(facilityLost.length, 1);
    assert.equal(facilityLost[0].detail.cause, 'inactive');
    // 不退资源：城里的数值与建城时一致
    const cityRes = await pool.query(`SELECT gold, wood, food, stone, iron FROM cities WHERE id = $1`, [main]);
    assert.deepEqual(cityRes.rows[0], { gold: 1234, wood: 4321, food: 999, stone: 555, iron: 77 });
  });

  test('验收 2：已经没有野地时再次扫描不产生任何事件', async () => {
    const j = await newAccount('o-idempotent', { lastActiveAt: inactive8d() });
    const main = await newCity(j, 250, 250, '主城');
    await claimTile(800, 800, main, { militia: 4 });
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 1, tiles: 1 });
    const before = (await eventRows(j)).length;
    const sameTick = nextClock();
    assert.deepEqual(await processInactiveTerritories(pool, sameTick), { accounts: 0, tiles: 0 }, '重复扫描无事可做');
    assert.equal((await eventRows(j)).length, before, '不产生任何新事件');
    // 节流：同一小时内再调一次直接返回，不查库
    assert.deepEqual(await processInactiveTerritories(pool, sameTick + INACTIVE_TICK_MS - 1000), { accounts: 0, tiles: 0 }, '同一小时内不再扫');
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 0, tiles: 0 }, '下一个小时才扫');
  });

  test('验收 3：收回时在途的部队到达并占下新地 → 下一轮扫描一并收回', async () => {
    const j = await newAccount('p-inflight', { lastActiveAt: inactive8d() });
    const main = await newCity(j, 260, 260, '主城');
    await claimTile(900, 900, main, {});
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 1, tiles: 1 });
    // 收回之后才到达的占领（在途部队占下的新地）：模拟为这轮之后新归到账号名下的野地
    await claimTile(901, 900, main, { militia: 6 });
    const result = await processInactiveTerritories(pool, nextClock());
    assert.deepEqual(result, { accounts: 1, tiles: 1 }, '下一轮一并收回');
    assert.equal((await tileState(901, 900)).owner_city_id, null);
    assert.equal((await tileState(900, 900)).owner_city_id, null, '先前收回的地不退还');
  });

  test('验收 6：账号回来后新占的地不受影响，直到再次连续 7 天不活跃', async () => {
    const j = await newAccount('q-return', { lastActiveAt: inactive8d() });
    const main = await newCity(j, 270, 270, '主城');
    await claimTile(1000, 1000, main, {});
    await processInactiveTerritories(pool, nextClock());
    // 玩家回来（活跃时刻刷新），新占一块地
    await pool.query(`UPDATE accounts SET last_active_at = now() WHERE id = $1`, [j]);
    await claimTile(1001, 1000, main, { militia: 2 });
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 0, tiles: 0 }, '回来后不收');
    assert.equal((await tileState(1001, 1000)).owner_city_id, main);
    assert.equal((await tileState(1000, 1000)).owner_city_id, null, '已收的地不退还');
    // 再次连续 7 天不活跃：新占的地才被收回
    await pool.query(`UPDATE accounts SET last_active_at = now() - interval '8 days' WHERE id = $1`, [j]);
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 1, tiles: 1 });
    assert.equal((await tileState(1001, 1000)).owner_city_id, null);
  });

  test('验收 7：只有 Agent 在 7 天内上线过的账号不被回收', async () => {
    // last_online_at（玩家连接）是 10 天前，last_active_at（含 Agent 上线）是 1 天前
    const j = await newAccount('r-agent-active', {
      lastActiveAt: new Date(Date.now() - DAY),
      lastOnlineAt: new Date(Date.now() - 10 * DAY),
    });
    const main = await newCity(j, 280, 280, '主城');
    await claimTile(1100, 1100, main, { militia: 3 });
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 0, tiles: 0 });
    assert.equal((await tileState(1100, 1100)).owner_city_id, main, 'Agent 活跃即算活跃');
    // 对照：两个时间都过期（无 last_active_at 时回落到 created_at）才收
    const old = await newAccount('s-created-at', { createdAt: new Date(Date.now() - 9 * DAY) });
    const oldCity = await newCity(old, 285, 285, '老号');
    await claimTile(1101, 1100, oldCity, {});
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 1, tiles: 1 });
  });

  test('兜底：last_active_at 偏旧但 7 天内有 Agent 上线 / 断线事件的账号不被回收；事件过期才收', async () => {
    // 模拟 AISLG-236 之前的存量账号：Agent 在用，last_active_at 却停在 9 天前
    const j = await newAccount('u-agent-stale', {
      lastActiveAt: new Date(Date.now() - 9 * DAY),
      lastOnlineAt: new Date(Date.now() - 9 * DAY),
    });
    const main = await newCity(j, 295, 295, '主城');
    await claimTile(1300, 1300, main, {});
    await pool.query(
      `INSERT INTO events (account_id, city_id, type, created_at) VALUES ($1, $2, 'agent_connected', now() - interval '2 days')`,
      [j, main],
    );
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 0, tiles: 0 });
    assert.equal((await tileState(1300, 1300)).owner_city_id, main, '7 天内有 Agent 事件就算活跃');
    // Agent 事件也过期了才收
    await pool.query(`UPDATE events SET created_at = now() - interval '8 days' WHERE account_id = $1 AND type = 'agent_connected'`, [j]);
    assert.deepEqual(await processInactiveTerritories(pool, nextClock()), { accounts: 1, tiles: 1 });
  });

  test('验收 9：离线日报单独计数（原因：长期未上线），不与 NPC 攻破混在一起', async () => {
    const j = await newAccount('t-digest', {
      lastActiveAt: inactive8d(),
      lastOnlineAt: new Date(Date.now() - 8 * DAY),
    });
    const main = await newCity(j, 290, 290, '主城');
    await claimTile(1200, 1200, main, {});
    await claimTile(1201, 1200, main, {});
    // 另有一条 NPC 攻破的旧事件（同一离线时段内），验证两个计数分开
    await pool.query(
      `INSERT INTO events (account_id, city_id, type, detail)
       VALUES ($1, $2, 'wilderness_lost', '{"x":1,"y":2,"cause":"npc_attack","terrain":"plain","level":1}'::jsonb)`,
      [j, main],
    );
    await processInactiveTerritories(pool, nextClock());

    const sink = makeSink();
    const conn = { accountId: j, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleGetOfflineReport(sink.ctx, conn, Op.GET_OFFLINE_REPORT, 1);
    const offline = sink.frames[sink.frames.length - 1].data?.offline as Record<string, number>;
    assert.equal(offline.wildernessInactiveLost, 2, '被收回的 2 块单独计数');
    assert.equal(offline.wildernessLost, 1, 'NPC 攻破的仍走 wildernessLost');
  });
});
