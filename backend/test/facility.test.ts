// 野地设施·望楼（v96，AISLG-232）：数值与纯规则 + 事务规则（新建 / 升级 / 每城 2 座上限 / 满级 /
// 建造中 / 非自己的地 / 资源不足不扣 / 到期完成 / 野地丢失即毁 / 视野半径 / 别人看得到的范围）。
// 规则部分不需要数据库；事务部分需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import {
  FACILITY_MAX_LEVEL,
  FACILITY_PER_CITY_LIMIT,
  facilityTotalCost,
  facilityUpgradeCost,
  facilityUpgradeSeconds,
  watchtowerVisionRadius,
} from '../common/src/facility';
import { FOG_VISION, wildernessVisionRadius } from '../common/src/fog';
import { ownVisionSources } from '../common/src/fog-db';
import { loadFacility } from '../common/src/facility-db';
import { processDueFacilities } from '../worker/src/facility-tick';
import { clearTileOccupation } from '../common/src/world-db';
import { Op, type InitiatorRole } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { runWithCity } from '../api/src/city-scope';
import { handleFacilityBuild } from '../api/src/handlers-facility';
import { loadTileDetail, loadWorldWindow } from '../api/src/views-world';
import { loadCityState } from '../api/src/views';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('望楼的数值与纯规则（无需数据库）', () => {
  test('三级视野 6 / 8 / 10，取代野地原来的 3 格而不叠加', () => {
    assert.deepEqual([1, 2, 3].map((level) => watchtowerVisionRadius(level)), [6, 8, 10]);
    assert.equal(wildernessVisionRadius(null), FOG_VISION.wilderness);
    assert.equal(wildernessVisionRadius(0), FOG_VISION.wilderness);
    assert.equal(wildernessVisionRadius(1), 6);
    assert.equal(wildernessVisionRadius(3), 10);
  });

  test('每级花费与需求表一致，满级累计 金 1800 / 木 1200 / 石 600', () => {
    assert.deepEqual(facilityUpgradeCost('watchtower', 0), { gold: 300, wood: 200, food: 0, stone: 100, iron: 0 });
    assert.deepEqual(facilityUpgradeCost('watchtower', 1), { gold: 600, wood: 400, food: 0, stone: 200, iron: 0 });
    assert.deepEqual(facilityUpgradeCost('watchtower', 2), { gold: 900, wood: 600, food: 0, stone: 300, iron: 0 });
    assert.equal(facilityUpgradeCost('watchtower', FACILITY_MAX_LEVEL), null);
    assert.deepEqual(facilityTotalCost('watchtower'), { gold: 1800, wood: 1200, stone: 600 });
  });

  test('耗时 = 基准 ÷ time_scale、不低于 1 秒（120 / 240 / 360 基准）', () => {
    assert.equal(facilityUpgradeSeconds('watchtower', 0, 1), 120);
    assert.equal(facilityUpgradeSeconds('watchtower', 1, 1), 240);
    assert.equal(facilityUpgradeSeconds('watchtower', 2, 1), 360);
    assert.equal(facilityUpgradeSeconds('watchtower', 2, 50), 7); // 360 ÷ 50 向下取整
    assert.equal(facilityUpgradeSeconds('watchtower', 0, 1000), 1); // 不低于 1 秒
    assert.equal(facilityUpgradeSeconds('watchtower', FACILITY_MAX_LEVEL, 1), null);
  });

  test('每座城最多 2 座、最高 3 级', () => {
    assert.equal(FACILITY_PER_CITY_LIMIT, 2);
    assert.equal(FACILITY_MAX_LEVEL, 3);
  });
});

describe('望楼的事务规则（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountId: string;
  let otherId: string;
  let mainId: string;
  let branchId: string;
  /** 主城（10,10）与分城（500,500）；主城名下三块野地、分城名下两块 */
  const HOME = { x: 10, y: 10 };
  const BRANCH = { x: 500, y: 500 };
  const W = [
    { x: 11, y: 10 },
    { x: 12, y: 10 },
    { x: 13, y: 10 },
    { x: 501, y: 500 },
    { x: 502, y: 500 },
  ];

  const sent: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string }; seq?: number }> = [];
  const registry = {
    send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
      sent.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
    },
    broadcast: () => 0,
  } as unknown as ConnectionRegistry;
  const ctx = { pool: undefined as unknown as pg.Pool, registry, passwordDisabledHosts: new Set<string>() } as unknown as HandlerContext;
  const conn = { accountId: null as string | null, role: 'player' as InitiatorRole } as unknown as ConnInfo;

  /** 以指定城池身份发起建造 / 升级，返回最后一帧响应 */
  async function build(x: number, y: number, cityId = mainId) {
    sent.length = 0;
    await runWithCity(cityId, () => handleFacilityBuild(ctx, conn, Op.FACILITY_BUILD, 1, x, y));
    return sent[sent.length - 1];
  }

  async function resourcesOf(cityId: string): Promise<{ gold: number; wood: number; stone: number }> {
    const row = (await pool.query(`SELECT gold, wood, stone FROM cities WHERE id = $1`, [cityId])).rows[0] as {
      gold: number;
      wood: number;
      stone: number;
    };
    return { gold: Number(row.gold), wood: Number(row.wood), stone: Number(row.stone) };
  }

  async function eventsOf(account: string, type: string): Promise<Array<Record<string, unknown>>> {
    const res = await pool.query(`SELECT detail FROM events WHERE account_id = $1 AND type = $2 ORDER BY id`, [account, type]);
    return (res.rows as Array<{ detail: Record<string, unknown> }>).map((row) => row.detail);
  }

  /** 把进行中的工程推到已到期（不等真实时间） */
  async function makeDue(x: number, y: number): Promise<void> {
    await pool.query(`UPDATE wilderness_facilities SET finish_at = now() - interval '1 second' WHERE x = $1 AND y = $2`, [x, y]);
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'facility');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    (ctx as { pool: pg.Pool }).pool = pool;
    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`facility-${Date.now()}`]))
      .rows[0].id as string;
    otherId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`facility-other-${Date.now()}`]))
      .rows[0].id as string;
    (conn as { accountId: string }).accountId = accountId;

    mainId = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y)
         VALUES ($1, '主城', 5000, 5000, 5000, 5000, 5000, $2, $3) RETURNING id`,
        [accountId, HOME.x, HOME.y],
      )
    ).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 6)`, [mainId]);
    branchId = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y, origin_level)
         VALUES ($1, '分城', 5000, 5000, 5000, 5000, 5000, $2, $3, 3) RETURNING id`,
        [accountId, BRANCH.x, BRANCH.y],
      )
    ).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 3)`, [branchId]);

    // 城池格 + 名下野地（主城前 3 块、分城后 2 块）
    for (const point of [HOME, BRANCH]) {
      await pool.query(
        `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
         VALUES ($1, $2, 'plain', 'city', 0, $3, NULL)`,
        [point.x, point.y, point === HOME ? mainId : branchId],
      );
    }
    for (const [index, tile] of W.entries()) {
      await pool.query(
        `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
         VALUES ($1, $2, 'plain', 'wilderness', 2, $3, NULL)`,
        [tile.x, tile.y, index < 3 ? mainId : branchId],
      );
    }
    // 无主野地、别人的野地、NPC 城（用于「非自己的地」校验）
    await pool.query(`INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (20, 10, 'plain', 'wilderness', 1, NULL, NULL)`);
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (21, 10, 'plain', 'wilderness', 1, NULL, NULL)`,
    );
    const otherCity = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y)
         VALUES ($1, '别人的城', 1000, 1000, 1000, 1000, 1000, 30, 10) RETURNING id`,
        [otherId],
      )
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (30, 10, 'plain', 'city', 0, $1, NULL)`,
      [otherCity],
    );
    await pool.query(`UPDATE world_tiles SET owner_city_id = $1 WHERE x = 21 AND y = 10`, [otherCity]);
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('只认自己占领的野地：城池 / NPC 城 / 无主地 / 别人的野地都拒绝，且不扣资源', async () => {
    const before = await resourcesOf(mainId);
    for (const target of [HOME, { x: 30, y: 10 }, { x: 20, y: 10 }, { x: 21, y: 10 }]) {
      const res = await build(target.x, target.y);
      assert.equal(res.ok, false, `${target.x},${target.y} 应被拒`);
      assert.equal(res.error?.code, 'FACILITY_TILE_INVALID');
    }
    assert.deepEqual(await resourcesOf(mainId), before);
  });

  test('新建 1 级望楼：扣 300 / 200 / 100，120 秒后完成', async () => {
    const before = await resourcesOf(mainId);
    const res = await build(W[0].x, W[0].y);
    assert.equal(res.ok, true);
    const facility = res.data?.facility as { kind: string; level: number; visionRadius: number; building: { toLevel: number; finishAt: string } | null };
    assert.equal(facility.kind, 'watchtower');
    assert.equal(facility.level, 0); // 第一级还在建
    assert.equal(facility.building?.toLevel, 1);
    const after = await resourcesOf(mainId);
    assert.equal(before.gold - after.gold, 300);
    assert.equal(before.wood - after.wood, 200);
    assert.equal(before.stone - after.stone, 100);
    const row = await loadFacility(pool, W[0].x, W[0].y);
    assert.equal(row?.building_to, 1);
    const seconds = ((row?.finish_at as Date).getTime() - Date.now()) / 1000;
    assert.ok(seconds > 110 && seconds <= 121, `预计完成时刻应约 120 秒后，实际 ${seconds}`);

    // 建造中再点建造 / 升级被拒，且不扣资源
    const again = await build(W[0].x, W[0].y);
    assert.equal(again.ok, false);
    assert.equal(again.error?.code, 'FACILITY_BUILDING');
    assert.deepEqual(await resourcesOf(mainId), after);
  });

  test('到期由 Worker 完成：等级 1、写 facility_completed 事件、视野半径 6', async () => {
    await makeDue(W[0].x, W[0].y);
    const done = await processDueFacilities(pool);
    assert.ok(done >= 1);
    const row = await loadFacility(pool, W[0].x, W[0].y);
    assert.equal(row?.level, 1);
    assert.equal(row?.finish_at, null);
    assert.equal(row?.building_to, null);
    const events = await eventsOf(accountId, 'facility_completed');
    assert.ok(events.some((detail) => detail.x === W[0].x && detail.y === W[0].y && detail.level === 1));

    const sources = await ownVisionSources(pool, accountId);
    const tileSource = sources.find((source) => source.x === W[0].x && source.y === W[0].y);
    assert.equal(tileSource?.radius, 6);
    const plainSource = sources.find((source) => source.x === W[1].x && source.y === W[1].y);
    assert.equal(plainSource?.radius, FOG_VISION.wilderness);
  });

  test('升到 2、3 级：花费与耗时与表一致，视野 8 / 10 格', async () => {
    for (const [level, cost, seconds, radius] of [
      [2, { gold: 600, wood: 400, stone: 200 }, 240, 8],
      [3, { gold: 900, wood: 600, stone: 300 }, 360, 10],
    ] as const) {
      const before = await resourcesOf(mainId);
      const res = await build(W[0].x, W[0].y);
      assert.equal(res.ok, true);
      const facility = res.data?.facility as { level: number; building: { toLevel: number } | null };
      assert.equal(facility.level, level - 1);
      assert.equal(facility.building?.toLevel, level);
      const after = await resourcesOf(mainId);
      assert.equal(before.gold - after.gold, cost.gold, `${level} 级金币`);
      assert.equal(before.wood - after.wood, cost.wood, `${level} 级木材`);
      assert.equal(before.stone - after.stone, cost.stone, `${level} 级石料`);
      const row = await loadFacility(pool, W[0].x, W[0].y);
      const left = ((row?.finish_at as Date).getTime() - Date.now()) / 1000;
      assert.ok(left > seconds - 10 && left <= seconds + 1, `${level} 级耗时约 ${seconds} 秒，实际 ${left}`);
      await makeDue(W[0].x, W[0].y);
      await processDueFacilities(pool);
      const sources = await ownVisionSources(pool, accountId);
      assert.equal(sources.find((source) => source.x === W[0].x && source.y === W[0].y)?.radius, radius);
    }
    // 已满级：再点被拒
    const maxed = await build(W[0].x, W[0].y);
    assert.equal(maxed.ok, false);
    assert.equal(maxed.error?.code, 'FACILITY_MAX_LEVEL');
  });

  test('同一座城第 3 座被拒，另一座分城还能盖', async () => {
    // 主城已有 1 座望楼（W0），再盖 W1 后占满 2 个名额
    assert.equal((await build(W[1].x, W[1].y)).ok, true);
    const third = await build(W[2].x, W[2].y);
    assert.equal(third.ok, false);
    assert.equal(third.error?.code, 'FACILITY_LIMIT');
    assert.equal(third.data?.limit, FACILITY_PER_CITY_LIMIT);
    // 分城的名额独立
    assert.equal((await build(W[3].x, W[3].y, branchId)).ok, true);
    // 已占名的望楼仍可升级（升级不受名额限制）
    await makeDue(W[1].x, W[1].y);
    await processDueFacilities(pool);
    assert.equal((await build(W[1].x, W[1].y)).ok, true);
  });

  test('资源不足被拒且不扣', async () => {
    await pool.query(`UPDATE cities SET gold = 10, wood = 10, stone = 10`);
    const before = await resourcesOf(branchId);
    const res = await build(W[4].x, W[4].y, branchId);
    assert.equal(res.ok, false);
    assert.equal(res.error?.code, 'INSUFFICIENT_RESOURCES');
    assert.deepEqual(await resourcesOf(branchId), before);
    await pool.query(`UPDATE cities SET gold = 5000, wood = 5000, stone = 5000`);
  });

  test('别人看得到望楼与等级、看不到进度；进度只有主人看得到', async () => {
    // 先造一座并完成，再开始升级（有进行中的工程）
    assert.equal((await build(W[4].x, W[4].y, branchId)).ok, true);
    await makeDue(W[4].x, W[4].y);
    await processDueFacilities(pool);
    assert.equal((await build(W[4].x, W[4].y, branchId)).ok, true); // 2 级在建

    const otherView = (await loadWorldWindow(pool, W[4].x, W[4].y, 1, 1, otherId))[0];
    assert.deepEqual(otherView.facility, { kind: 'watchtower', level: 1 });
    const otherDetail = await loadTileDetail(pool, W[4].x, W[4].y, otherId);
    assert.equal(otherDetail?.facilityBuilding, null);

    const ownDetail = await loadTileDetail(pool, W[4].x, W[4].y, accountId);
    assert.deepEqual(ownDetail?.facility, { kind: 'watchtower', level: 1 });
    assert.equal(ownDetail?.facilityBuilding?.toLevel, 2);

    // 主城视角的领地列表带等级 / 视野半径 / 进度
    const city = await loadCityState(pool, accountId, branchId);
    const item = city?.territory.find((tile) => tile.x === W[4].x && tile.y === W[4].y);
    assert.equal(item?.facility?.level, 1);
    assert.equal(item?.facility?.visionRadius, 6);
    assert.equal(item?.facility?.building?.toLevel, 2);
  });

  test('野地被抢 / 放弃占领：望楼毁掉，原主人收到 facility_lost，构造中的工程作废', async () => {
    // W1 已经 1 级、且 2 级正在建
    const row = await loadFacility(pool, W[1].x, W[1].y);
    assert.equal(row?.level, 1);
    assert.equal(row?.building_to, 2);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await clearTileOccupation(client, W[1].x, W[1].y, 'conquest');
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    assert.equal(await loadFacility(pool, W[1].x, W[1].y), null);
    const lost = await eventsOf(accountId, 'facility_lost');
    assert.ok(lost.some((detail) => detail.x === W[1].x && detail.y === W[1].y && detail.cause === 'conquest'));
    // 下一轮 tick 不会把作废的工程补上
    await processDueFacilities(pool);
    assert.equal(await loadFacility(pool, W[1].x, W[1].y), null);
    const otherView = (await loadWorldWindow(pool, W[1].x, W[1].y, 1, 1, otherId))[0];
    assert.equal(otherView.facility, null);
  });
});
