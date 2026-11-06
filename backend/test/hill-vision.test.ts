// 丘陵视野（AISLG-233，随 v97 一起交付）：占领的**丘陵**野地作为视野来源时半径 +2
// （没望楼 3 → 5，1 / 2 / 3 级望楼 6 / 8 / 10 → 8 / 10 / 12），上限 12、与主城持平；
// 其他地形不变；主城、分城、行军中的部队即使脚下是丘陵也不加成；丢地后原主人立刻失去这份视野。
// 纯规则不需要数据库；实时视野 / 领地视图需要真实 PostgreSQL：设置 TEST_DATABASE_URL
// （一次性临时库，别指向开发库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFogEnabledCache } from '../common/src/fog-config';
import { TERRAIN_KINDS } from '../common/src/protocol';
import {
  FOG_VISION,
  FOG_VISION_MAX,
  HILL_VISION_BONUS,
  builtFacilityVisionRadius,
  inAnyVision,
  marchVisionSource,
  wildernessVisionRadius,
} from '../common/src/fog';
import { ownVisionSources } from '../common/src/fog-db';
import { facilityVisionRadiusOf } from '../common/src/facility';
import { loadFogWindow } from '../api/src/fog-view';
import { loadCityState } from '../api/src/views';

import {
  HILL_VISION_BONUS as FE_HILL_BONUS,
  WILDERNESS_VISION_BASE as FE_BASE,
  WILDERNESS_VISION_MAX as FE_MAX,
  builtFacilityVisionRadius as feBuiltFacilityVisionRadius,
  isHill as feIsHill,
  wildernessVisionRadius as feWildernessVisionRadius,
} from '../../frontend/src/components/map/wildernessVision';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
/** 除丘陵外的其余地形（都不加成） */
const NON_HILL_TERRAINS = TERRAIN_KINDS.filter((terrain) => terrain !== 'hill');

describe('丘陵视野的数值与纯规则（无需数据库）', () => {
  test('丘陵野地视野 +2：没望楼 3 → 5，1 / 2 / 3 级望楼 6 / 8 / 10 → 8 / 10 / 12', () => {
    assert.equal(HILL_VISION_BONUS, 2);
    assert.equal(wildernessVisionRadius(null, 'hill'), 5);
    assert.equal(wildernessVisionRadius(0, 'hill'), 5);
    assert.equal(wildernessVisionRadius(1, 'hill'), 8);
    assert.equal(wildernessVisionRadius(2, 'hill'), 10);
    assert.equal(wildernessVisionRadius(3, 'hill'), 12);
  });

  test('其他地形不变：野地 3 格，望楼 6 / 8 / 10 格', () => {
    for (const terrain of NON_HILL_TERRAINS) {
      assert.equal(wildernessVisionRadius(null, terrain), FOG_VISION.wilderness, terrain);
      assert.equal(wildernessVisionRadius(1, terrain), 6, terrain);
      assert.equal(wildernessVisionRadius(2, terrain), 8, terrain);
      assert.equal(wildernessVisionRadius(3, terrain), 10, terrain);
    }
    // 地形缺省（旧调用方）按不加成处理
    assert.equal(wildernessVisionRadius(null), FOG_VISION.wilderness);
    assert.equal(wildernessVisionRadius(3), 10);
  });

  test('半径不超过 12，与主城持平（3 级望楼 10 + 2 正好封顶）', () => {
    assert.equal(FOG_VISION_MAX, 12);
    assert.equal(FOG_VISION_MAX, FOG_VISION.mainCity);
    assert.equal(wildernessVisionRadius(3, 'hill'), FOG_VISION_MAX);
    assert.ok(wildernessVisionRadius(3, 'hill') <= FOG_VISION_MAX);
  });

  test('下发给客户端的 facility.visionRadius：未建成 0，建成后是加成后的有效半径', () => {
    assert.equal(builtFacilityVisionRadius(null, 'hill'), 0);
    assert.equal(builtFacilityVisionRadius(0, 'hill'), 0);
    assert.equal(builtFacilityVisionRadius(1, 'hill'), 8);
    assert.equal(builtFacilityVisionRadius(1, 'plain'), 6);
    assert.equal(builtFacilityVisionRadius(3, 'hill'), 12);
    // 与「望楼等级 → 半径」的既有函数衔接：加成前的值仍在 facility.ts 里不变
    assert.equal(facilityVisionRadiusOf(1), 6);
    assert.equal(facilityVisionRadiusOf(3), 10);
  });

  test('主城、分城、行军中的部队的半径与改动前一致（行军不看脚下地形）', () => {
    assert.equal(FOG_VISION.mainCity, 12);
    assert.equal(FOG_VISION.branchCity, 8);
    const march = marchVisionSource(
      { homeX: 10, homeY: 10, targetX: 20, targetY: 10, returning: false, startMs: 0, endMs: 1000 },
      500,
      false,
      0,
    );
    assert.equal(march.radius, FOG_VISION.march);
    // 丘陵上的野地 5 格：只覆盖以它为中心的 11×11 方块
    const hill = { x: 30, y: 30, radius: wildernessVisionRadius(null, 'hill') };
    assert.equal(inAnyVision([hill], 35, 35), true);
    assert.equal(inAnyVision([hill], 36, 30), false);
  });

  test('前端镜像（wildernessVision）与后端数值完全一致', () => {
    assert.equal(FE_HILL_BONUS, HILL_VISION_BONUS);
    assert.equal(FE_MAX, FOG_VISION_MAX);
    assert.equal(FE_BASE, FOG_VISION.wilderness);
    assert.equal(feIsHill('hill'), true);
    assert.equal(feIsHill('plain'), false);
    for (const terrain of TERRAIN_KINDS) {
      for (const level of [null, 0, 1, 2, 3]) {
        assert.equal(
          feWildernessVisionRadius(level, terrain),
          wildernessVisionRadius(level, terrain),
          `${terrain} / ${level} 级`,
        );
        assert.equal(
          feBuiltFacilityVisionRadius(level, terrain),
          builtFacilityVisionRadius(level, terrain),
          `${terrain} / ${level} 级（设施字段）`,
        );
      }
    }
  });
});

describe('丘陵视野的生效范围（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let accountA: string;
  let accountB: string;
  let cityA: string;
  let branchA: string;
  let cityB: string;
  const tag = `hill-${Date.now()}`;
  /** 两家的主城离野地很远：野地的视野只来自野地本身，不受开局 30 格影响 */
  const HOME_A = { x: 120, y: 120 };
  const BRANCH_A = { x: 160, y: 120 };
  const HOME_B = { x: 500, y: 500 };
  /** 丘陵野地（无望楼）、平原野地、丘陵野地（盖望楼）各一块，都在同一片窗口里 */
  const HILL = { x: 704, y: 704 };
  const PLAIN = { x: 714, y: 704 };
  const HILL_TOWER = { x: 724, y: 704 };

  async function tile(x: number, y: number, terrain: string, kind: string, ownerCityId: string | null): Promise<void> {
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, $3, $4, $5, $6, NULL)
       ON CONFLICT (x, y) DO UPDATE SET terrain = EXCLUDED.terrain, kind = EXCLUDED.kind, level = EXCLUDED.level,
         owner_city_id = EXCLUDED.owner_city_id, npc = NULL`,
      [x, y, terrain, kind, kind === 'city' ? 0 : 2, ownerCityId],
    );
  }

  /** 某账号的野地视野来源（按坐标取半径） */
  async function radiiOf(accountId: string): Promise<Map<string, number>> {
    const sources = await ownVisionSources(pool, accountId);
    return new Map(sources.map((source) => [`${source.x},${source.y}`, source.radius]));
  }

  /** 迷雾开启时的窗口：坐标 → fog 状态（absent = 窗口里没有这一格 = 未探索） */
  async function fogAt(accountId: string, x: number, y: number, probe: number): Promise<string> {
    const tiles = await loadFogWindow(pool, accountId, x, y, probe, probe);
    const out = new Map(tiles.map((item) => [`${item.x},${item.y}`, item.fog]));
    return out.get(`${x},${y}`) ?? 'absent';
  }

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'hill_vision');
    pool = new pg.Pool({ connectionString: tmp.url, max: 6 });
    await ensureSchema(pool);
    accountA = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-a`]))
      .rows[0].id as string;
    accountB = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`${tag}-b`]))
      .rows[0].id as string;
    // 主城脚下故意铺丘陵：城池不看地形（加成会变成看开局运气），半径仍是 12 / 8
    cityA = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, '主城', 5000, 5000, 5000, 5000, 5000, $2, $3) RETURNING id`,
        [accountA, HOME_A.x, HOME_A.y],
      )
    ).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 6)`, [cityA]);
    branchA = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y, origin_level)
         VALUES ($1, '分城', 5000, 5000, 5000, 5000, 5000, $2, $3, 3) RETURNING id`,
        [accountA, BRANCH_A.x, BRANCH_A.y],
      )
    ).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 3)`, [branchA]);
    cityB = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, '别人的城', 5000, 5000, 5000, 5000, 5000, $2, $3) RETURNING id`,
        [accountB, HOME_B.x, HOME_B.y],
      )
    ).rows[0].id as string;
    await pool.query(`INSERT INTO city_buildings (city_id, kind, level) VALUES ($1, 'government', 3)`, [cityB]);

    await tile(HOME_A.x, HOME_A.y, 'hill', 'city', cityA);
    await tile(BRANCH_A.x, BRANCH_A.y, 'hill', 'city', branchA);
    await tile(HOME_B.x, HOME_B.y, 'plain', 'city', cityB);
    await tile(HILL.x, HILL.y, 'hill', 'wilderness', cityA);
    await tile(PLAIN.x, PLAIN.y, 'plain', 'wilderness', cityA);
    await tile(HILL_TOWER.x, HILL_TOWER.y, 'hill', 'wilderness', cityA);
    // 探针格：丘陵 +5 / +6、平原 +3 / +4、丘陵望楼（3 级 12 格）+12 / +13（都是无主野地）
    for (const [x, y] of [
      [HILL.x + 5, HILL.y],
      [HILL.x + 6, HILL.y],
      [PLAIN.x + 3, PLAIN.y],
      [PLAIN.x + 4, PLAIN.y],
      [HILL_TOWER.x + 12, HILL_TOWER.y],
      [HILL_TOWER.x + 13, HILL_TOWER.y],
    ]) {
      await tile(x as number, y as number, 'plain', 'wilderness', null);
    }
  });

  after(async () => {
    setFogEnabledCache(null);
    await pool?.end();
    await tmp?.drop();
  });

  test('丘陵野地视野 5 格、平原仍是 3 格；主城 / 分城即使脚下是丘陵仍是 12 / 8', async () => {
    const radii = await radiiOf(accountA);
    assert.equal(radii.get(`${HILL.x},${HILL.y}`), 5);
    assert.equal(radii.get(`${PLAIN.x},${PLAIN.y}`), FOG_VISION.wilderness);
    assert.equal(radii.get(`${HILL_TOWER.x},${HILL_TOWER.y}`), 5);
    assert.equal(radii.get(`${HOME_A.x},${HOME_A.y}`), FOG_VISION.mainCity);
    assert.equal(radii.get(`${BRANCH_A.x},${BRANCH_A.y}`), FOG_VISION.branchCity);
  });

  test('实时视野：丘陵野地 5 格内 visible、6 格外不是；平原 3 格内 visible、4 格外不是', async () => {
    setFogEnabledCache(true);
    // 窗口取 20×20（覆盖 HILL 与 PLAIN 的探针格）
    assert.equal(await fogAt(accountA, HILL.x + 5, HILL.y, 20), 'visible');
    assert.notEqual(await fogAt(accountA, HILL.x + 6, HILL.y, 20), 'visible');
    assert.equal(await fogAt(accountA, PLAIN.x + 3, PLAIN.y, 20), 'visible');
    assert.notEqual(await fogAt(accountA, PLAIN.x + 4, PLAIN.y, 20), 'visible');
  });

  test('丘陵上的望楼 1 / 2 / 3 级视野 8 / 10 / 12；city.territory 下发的也是有效半径', async () => {
    for (const [level, radius] of [
      [1, 8],
      [2, 10],
      [3, 12],
    ] as const) {
      await pool.query(
        `INSERT INTO wilderness_facilities (x, y, kind, level, city_id) VALUES ($1, $2, 'watchtower', $3, $4)
         ON CONFLICT (x, y) DO UPDATE SET kind = 'watchtower', level = EXCLUDED.level, building_to = NULL, finish_at = NULL`,
        [HILL_TOWER.x, HILL_TOWER.y, level, cityA],
      );
      assert.equal((await radiiOf(accountA)).get(`${HILL_TOWER.x},${HILL_TOWER.y}`), radius, `${level} 级视野`);
      const city = await loadCityState(pool, accountA, cityA);
      const item = city?.territory.find((entry) => entry.x === HILL_TOWER.x && entry.y === HILL_TOWER.y);
      assert.equal(item?.facility?.visionRadius, radius, `${level} 级下发的 visionRadius`);
      // 平原上的望楼仍按 6 / 8 / 10
      await pool.query(
        `INSERT INTO wilderness_facilities (x, y, kind, level, city_id) VALUES ($1, $2, 'watchtower', $3, $4)
         ON CONFLICT (x, y) DO UPDATE SET kind = 'watchtower', level = EXCLUDED.level, building_to = NULL, finish_at = NULL`,
        [PLAIN.x, PLAIN.y, level, cityA],
      );
      assert.equal((await radiiOf(accountA)).get(`${PLAIN.x},${PLAIN.y}`), radius - 2, `平原 ${level} 级视野`);
    }
    // 探针：3 级望楼 + 丘陵 2 = 12 格（正好封顶），12 格内 visible、13 格外不是
    setFogEnabledCache(true);
    assert.equal(await fogAt(accountA, HILL_TOWER.x + 12, HILL_TOWER.y, 20), 'visible');
    assert.notEqual(await fogAt(accountA, HILL_TOWER.x + 13, HILL_TOWER.y, 20), 'visible');
  });

  test('迷雾关闭时不产生效果：视野不再裁剪，6 格外的格也照常返回', async () => {
    setFogEnabledCache(false);
    assert.equal(await fogAt(accountA, HILL.x + 6, HILL.y, 20), 'visible');
    setFogEnabledCache(true);
  });

  test('丘陵野地丢给别人：原主人立刻失去这份视野，新主人享有加成', async () => {
    // 望楼随野地毁掉（destroyFacility 的既有口径），这里只关心视野来源本身
    await pool.query(`DELETE FROM wilderness_facilities WHERE x = $1 AND y = $2`, [HILL_TOWER.x, HILL_TOWER.y]);
    await pool.query(`DELETE FROM wilderness_facilities WHERE x = $1 AND y = $2`, [PLAIN.x, PLAIN.y]);
    await pool.query(`UPDATE world_tiles SET owner_city_id = $3 WHERE x = $1 AND y = $2`, [HILL.x, HILL.y, cityB]);

    const oldOwner = await radiiOf(accountA);
    assert.equal(oldOwner.get(`${HILL.x},${HILL.y}`), undefined, '原主人不再有这块地的视野来源');
    const newOwner = await radiiOf(accountB);
    assert.equal(newOwner.get(`${HILL.x},${HILL.y}`), 5, '新主人拿到丘陵加成后的 5 格');

    setFogEnabledCache(true);
    // 原主人这边 5 格处已不是实时视野（已探索的区块仍在，只是不再实时）
    assert.notEqual(await fogAt(accountA, HILL.x + 5, HILL.y, 20), 'visible');
    // 新主人那边是实时视野
    assert.equal(await fogAt(accountB, HILL.x + 5, HILL.y, 20), 'visible');
  });
});
