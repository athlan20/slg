// 全账号伤兵营（v88，AISLG-218）：GET_TROOP_POOLS 的返回结构、主城口径、他人城不可见、过期过滤，
// 以及「站在主城对分城 cityId 发 RESTORE_TROOPS 只动分城资源与驻军」。
// 纯规则不需要数据库；需要库的用例用 TEST_DATABASE_URL 指向的一次性临时库（别指向开发库）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { Op, TROOP_KINDS, type AccountTroopPoolsCityView, type InitiatorRole } from '../common/src/protocol';
import { CITY_SCOPED_OPS } from '../api/src/city-scope';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import { handleMessage, type HandlerContext } from '../api/src/handlers';
import { createTempDatabase, type TempDatabase } from './season-test-db';

test('GET_TROOP_POOLS 不按 cityId 作用域（返回的就是账号全部城）', () => {
  assert.equal(CITY_SCOPED_OPS.has(Op.GET_TROOP_POOLS), false);
  assert.equal(Op.GET_TROOP_POOLS, 147);
});

const dbUrl = process.env.TEST_DATABASE_URL;

describe('GET_TROOP_POOLS 与逐城处理（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let otherAccountId: string;
  let mainId: string;
  let branch1Id: string;
  let branch2Id: string;
  let branch3Id: string;
  let otherCityId: string;

  function makeSink() {
    const frames: Array<{ op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }> = [];
    const pushes: Array<{ op: number; data?: Record<string, unknown> }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { op?: number; ok?: boolean; data?: Record<string, unknown>; error?: { code: string; message?: string } }) => {
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

  /** 以指定账号发一个协议（经 handleMessage：覆盖分发层与 cityId 归属校验） */
  async function send(account: string, op: number, data: Record<string, unknown>) {
    const sink = makeSink();
    const conn = { accountId: account, role: 'player' as InitiatorRole } as unknown as ConnInfo;
    await handleMessage(sink.ctx, conn, JSON.stringify({ op, seq: 11, data }));
    return { res: sink.frames[sink.frames.length - 1], pushes: sink.pushes };
  }

  async function allPools(account = accountId): Promise<AccountTroopPoolsCityView[]> {
    const { res } = await send(account, Op.GET_TROOP_POOLS, {});
    assert.equal(res.ok, true, JSON.stringify(res.error));
    return (res.data?.cities ?? []) as AccountTroopPoolsCityView[];
  }

  async function getCity(cityId: string) {
    const { res } = await send(accountId, Op.GET_STATE, { cityId });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    return res.data?.city as {
      id: string;
      name: string;
      starveAt: string | null;
      wounded: AccountTroopPoolsCityView['wounded'];
      captives: AccountTroopPoolsCityView['captives'];
      deserters: AccountTroopPoolsCityView['deserters'];
      army: Record<string, number>;
      resources: Record<string, number>;
      population: { current: number };
    };
  }

  async function addPool(cityId: string, poolName: 'wounded' | 'captive' | 'deserter', troops: Record<string, number>, hours: number): Promise<void> {
    await pool.query(
      `INSERT INTO city_troop_pools (city_id, pool, troops, expires_at)
       VALUES ($1, $2, $3::jsonb, now() + make_interval(secs => $4))`,
      [cityId, poolName, JSON.stringify(troops), hours * 3600],
    );
  }

  async function cityRow(cityId: string) {
    return (
      await pool.query(`SELECT gold, wood, food, stone, iron, population FROM cities WHERE id = $1`, [cityId])
    ).rows[0] as { gold: number; wood: number; food: number; stone: number; iron: number; population: number };
  }

  async function armyOf(cityId: string): Promise<Record<string, number>> {
    const rows = (await pool.query(`SELECT troop, count FROM city_army WHERE city_id = $1`, [cityId])).rows as Array<{ troop: string; count: number }>;
    return Object.fromEntries(rows.map((row) => [row.troop, row.count]));
  }

  /** 每个用例前：清池子 / 驻军 / 事件，资源与粮食恢复固定值（无军队 → 净产粮为正 → 不断粮） */
  async function reset(): Promise<void> {
    await pool.query(`DELETE FROM city_troop_pools`);
    await pool.query(`DELETE FROM city_army WHERE city_id = ANY($1::uuid[])`, [[mainId, branch1Id, branch2Id, branch3Id]]);
    await pool.query(`DELETE FROM events WHERE account_id = ANY($1::uuid[])`, [[accountId, otherAccountId]]);
    await pool.query(
      `UPDATE cities SET gold = 10000, wood = 10000, food = 5000, stone = 10000, iron = 10000,
                         population = 500, population_rem = 0, settled_at = now(),
                         gold_rem = 0, wood_rem = 0, food_rem = 0, stone_rem = 0, iron_rem = 0,
                         mutiny_next_at = NULL, starve_warned_at = NULL
       WHERE id = ANY($1::uuid[])`,
      [[mainId, branch1Id, branch2Id, branch3Id, otherCityId]],
    );
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'troopall');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    const mk = async (label: string): Promise<string> =>
      (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`])).rows[0].id as string;
    accountId = await mk('troopall');
    otherAccountId = await mk('troopall-other');
    // created_at 显式错开：主城 = 创建时间最早（与 lockCitySnapshot 的主城口径一致）
    const mkCity = async (account: string, name: string, x: number, y: number, hoursAgo: number): Promise<string> => {
      const id = (
        await pool.query(
          `INSERT INTO cities (account_id, name, gold, wood, food, x, y, created_at)
           VALUES ($1, $2, 10000, 10000, 5000, $3, $4, now() - make_interval(hours => $5)) RETURNING id`,
          [account, name, x, y, hoursAgo],
        )
      ).rows[0].id as string;
      await pool.query(
        `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
         VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)
         ON CONFLICT (x, y) DO UPDATE SET kind = EXCLUDED.kind, owner_city_id = EXCLUDED.owner_city_id`,
        [x, y, id],
      );
      return id;
    };
    mainId = await mkCity(accountId, '主城', 620, 620, 48);
    branch1Id = await mkCity(accountId, '分城甲', 621, 621, 24);
    branch2Id = await mkCity(accountId, '分城乙', 622, 622, 12);
    branch3Id = await mkCity(accountId, '分城丙', 623, 623, 1);
    otherCityId = await mkCity(otherAccountId, '别人的城', 624, 624, 30);
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('返回账号全部 4 座城（主城在前、三池全空的城也在），池子与 starveAt 与 GET_STATE 逐字段一致', async () => {
    await reset();
    // 其中 2 座城有伤兵：分城甲 3 民兵（晚批）+ 2 弓箭兵俘虏，主城 10 长枪兵；分城丙有逃兵
    await addPool(mainId, 'wounded', { pikeman: 10 }, 5);
    await addPool(branch1Id, 'wounded', { militia: 3 }, 30);
    await addPool(branch1Id, 'captive', { archer: 2 }, 20);
    await addPool(branch3Id, 'deserter', { militia: 4 }, 8);
    // 别人的城也有伤兵：不可见
    await addPool(otherCityId, 'wounded', { pikeman: 99 }, 10);

    const cities = await allPools();
    assert.equal(cities.length, 4, '只返回本账号的 4 座城');
    assert.deepEqual(
      cities.map((city) => city.cityId),
      [mainId, branch1Id, branch2Id, branch3Id],
      '主城在前，其余按创建时间',
    );
    assert.deepEqual(
      cities.map((city) => city.isMain),
      [true, false, false, false],
    );
    assert.ok(!cities.some((city) => city.cityId === otherCityId));
    // 三池全空的城也返回，且给空结构（troops 全 0、earliestExpireAt 为 null）
    const empty = cities.find((city) => city.cityId === branch2Id);
    assert.ok(empty);
    assert.equal(empty.wounded.earliestExpireAt, null);
    for (const kind of TROOP_KINDS) {
      assert.equal(empty.wounded.troops[kind], 0);
      assert.equal(empty.captives.troops[kind], 0);
      assert.equal(empty.deserters.troops[kind], 0);
    }
    // 与 GET_STATE 对应城的 city.wounded / captives / deserters 完全一致
    for (const city of cities) {
      const state = await getCity(city.cityId);
      assert.equal(state.id, city.cityId);
      assert.equal(state.name, city.name);
      assert.deepEqual(city.wounded, state.wounded, `${city.name} 伤兵池`);
      assert.deepEqual(city.captives, state.captives, `${city.name} 俘虏池`);
      assert.deepEqual(city.deserters, state.deserters, `${city.name} 逃兵池`);
      // starveAt 同口径：不会断粮两边都是 null；会断粮两边都是同一时刻（毫秒级误差内）
      if (state.starveAt === null) {
        assert.equal(city.starveAt, null, `${city.name} 不应断粮`);
      } else {
        assert.ok(city.starveAt !== null, `${city.name} 应断粮`);
        const diff = Math.abs(Date.parse(city.starveAt as string) - Date.parse(state.starveAt));
        assert.ok(diff <= 5000, `${city.name} 断粮时刻应一致（差 ${diff}ms）`);
      }
    }
    assert.deepEqual(cities[1].wounded.troops.militia, 3);
    assert.deepEqual(cities[1].captives.troops.archer, 2);
    assert.equal(cities[3].deserters.troops.militia, 4);
  });

  test('断粮中的城 starveAt 非 null（与 GET_STATE 一致）', async () => {
    await reset();
    await addPool(branch2Id, 'deserter', { militia: 2 }, 8);
    // 分城乙：粮食归零 + 驻军吃粮 → 净产量为负，已断粮
    await pool.query(`UPDATE cities SET food = 0, settled_at = now() WHERE id = $1`, [branch2Id]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'pikeman', 100)`, [branch2Id]);
    const [city] = (await allPools()).filter((item) => item.cityId === branch2Id);
    const state = await getCity(branch2Id);
    assert.ok(state.starveAt !== null, 'GET_STATE 应报告断粮');
    assert.ok(city.starveAt !== null, 'GET_TROOP_POOLS 应报告断粮');
    const diff = Math.abs(Date.parse(city.starveAt as string) - Date.parse(state.starveAt));
    assert.ok(diff <= 5000, `断粮时刻应一致（差 ${diff}ms）`);
    // 未断粮的城仍为 null
    const main = (await allPools()).find((item) => item.cityId === mainId);
    assert.equal(main?.starveAt, null);
  });

  test('过期行不返回，也不影响 earliestExpireAt', async () => {
    await reset();
    await addPool(branch1Id, 'wounded', { pikeman: 7 }, 10);
    await addPool(branch1Id, 'wounded', { pikeman: 50 }, -3); // 已过期 3 小时
    const city = (await allPools()).find((item) => item.cityId === branch1Id);
    assert.ok(city);
    assert.equal(city.wounded.troops.pikeman, 7, '过期的 50 不应计入');
    const remainHours = (Date.parse(city.wounded.earliestExpireAt as string) - Date.now()) / 3_600_000;
    assert.ok(remainHours > 9 && remainHours <= 10, `earliestExpireAt 应取未过期的 10 小时那批（实际剩 ${remainHours.toFixed(2)}h）`);
  });

  test('站在主城对分城 cityId 发 RESTORE_TROOPS：只扣分城资源、兵回分城驻军，当前城（主城）不变', async () => {
    await reset();
    await addPool(mainId, 'wounded', { pikeman: 10 }, 20);
    await addPool(branch1Id, 'wounded', { pikeman: 20 }, 5);
    const mainBefore = await cityRow(mainId);
    const branchBefore = await cityRow(branch1Id);
    // 不带 cityId 时作用域是主城；这里显式带分城 cityId（前端「全部治疗」逐城发的那条）
    const { res, pushes } = await send(accountId, Op.RESTORE_TROOPS, { cityId: branch1Id, pool: 'wounded', troops: { pikeman: 20 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    assert.equal((res.data?.city as { id: string }).id, branch1Id, '响应里的 city 应是被处理的分城');
    // 分城：扣 20 长枪兵 × 50% 征兵资源（金 1500 / 木 800 / 粮 1000 / 铁 500），兵回分城驻军
    assert.deepEqual(res.data?.cost, { gold: 1500, wood: 800, food: 1000, stone: 0, iron: 500 });
    const branchAfter = await cityRow(branch1Id);
    assert.equal(branchBefore.gold - branchAfter.gold, 1500);
    assert.equal(branchBefore.wood - branchAfter.wood, 800);
    assert.equal(branchBefore.iron - branchAfter.iron, 500);
    assert.deepEqual(await armyOf(branch1Id), { pikeman: 20 });
    // 主城：资源与驻军一点未动，池子里的 10 个伤兵还在
    const mainAfter = await cityRow(mainId);
    assert.deepEqual({ ...mainAfter }, { ...mainBefore });
    assert.deepEqual(await armyOf(mainId), {});
    const cities = await allPools();
    assert.equal(cities.find((city) => city.cityId === mainId)?.wounded.troops.pikeman, 10);
    assert.equal(cities.find((city) => city.cityId === branch1Id)?.wounded.troops.pikeman, 0);
    // 推送带 cityId 与池子
    assert.ok(pushes.some((push) => push.op === Op.PUSH_CITY_STATE && push.data?.cityId === branch1Id));
  });

  test('一城资源不足只影响该城：失败返回 INSUFFICIENT_RESOURCES 且该城伤兵保留', async () => {
    await reset();
    await addPool(branch1Id, 'wounded', { pikeman: 20 }, 20);
    await addPool(branch2Id, 'wounded', { pikeman: 20 }, 20);
    await pool.query(`UPDATE cities SET gold = 0 WHERE id = $1`, [branch2Id]);
    const ok = await send(accountId, Op.RESTORE_TROOPS, { cityId: branch1Id, pool: 'wounded', troops: { pikeman: 20 } });
    const fail = await send(accountId, Op.RESTORE_TROOPS, { cityId: branch2Id, pool: 'wounded', troops: { pikeman: 20 } });
    assert.equal(ok.res.ok, true);
    assert.equal(fail.res.ok, false);
    assert.equal(fail.res.error?.code, 'INSUFFICIENT_RESOURCES');
    assert.ok((fail.res.data?.shortfall as Record<string, number>).gold > 0, '应附资源缺口');
    const cities = await allPools();
    assert.equal(cities.find((city) => city.cityId === branch1Id)?.wounded.troops.pikeman, 0);
    assert.equal(cities.find((city) => city.cityId === branch2Id)?.wounded.troops.pikeman, 20, '失败的城伤兵保留');
    assert.deepEqual(await armyOf(branch2Id), {});
  });

  test('断粮中的城劝回逃兵被拒（前端「全部劝回」据此跳过该城）', async () => {
    await reset();
    await addPool(branch2Id, 'deserter', { militia: 6 }, 8);
    await pool.query(`UPDATE cities SET food = 0, settled_at = now() WHERE id = $1`, [branch2Id]);
    await pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'pikeman', 100)`, [branch2Id]);
    const { res } = await send(accountId, Op.RESTORE_TROOPS, { cityId: branch2Id, pool: 'deserter', troops: { militia: 6 } });
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'CITY_STARVING');
    const city = (await allPools()).find((item) => item.cityId === branch2Id);
    assert.equal(city?.deserters.troops.militia, 6, '被拒后逃兵还在');
  });

  test('RELEASE_TROOPS 带分城 cityId：免费、池子清空、资源不变', async () => {
    await reset();
    await addPool(branch1Id, 'captive', { archer: 5 }, 20);
    const before = await cityRow(branch1Id);
    const { res } = await send(accountId, Op.RELEASE_TROOPS, { cityId: branch1Id, pool: 'captive', troops: { archer: 5 } });
    assert.equal(res.ok, true, JSON.stringify(res.error));
    const after = await cityRow(branch1Id);
    assert.deepEqual({ ...after }, { ...before }, '放弃 / 释放免费，不扣任何资源');
    const city = (await allPools()).find((item) => item.cityId === branch1Id);
    assert.equal(city?.captives.troops.archer, 0);
  });
});
