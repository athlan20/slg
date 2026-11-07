// 五方势力骨架（v99，AISLG-239）：纯规则 + 事务规则（半径随天数 / 重叠格归属 / 1.5 倍快照 /
// 开季吞城排除名城与玩家城 / 每 6 小时随机吞一座 / 落位与迁城避开老巢 / 开关关闭时无变化）。
// 无数据库的部分始终执行；事务部分需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），
// 否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import { setTimeScaleCache } from '../common/src/time-scale';
import {
  FACTIONS,
  FACTION_CITY_MULTIPLIER,
  FACTION_INITIAL_RADIUS,
  FACTION_LAIR_CLEAR_RADIUS,
  FACTION_RADIUS_STEPS,
  FACTION_SWALLOW_INTERVAL_MS,
  chebyshevDistance,
  factionAt,
  factionDayAt,
  factionDefOf,
  factionLairAt,
  factionRadiusAt,
  factionRadiusForDay,
  factionOwnsTileSql,
  factionSnapshot,
  factionSwallowIntervalMs,
  inFactionLairClearance,
  undoFactionSnapshot,
} from '../common/src/faction';
import { setFactionEnabledCache } from '../common/src/faction-config';
import {
  ensureFactions,
  factionCityCounts,
  loadFactionView,
  swallowRandom,
  swallowWithin,
} from '../common/src/faction-db';
import { runFactionTick } from '../worker/src/faction-tick';
import { getCurrentSeason } from '../common/src/season-db';
import { NPC_CITY_PROFILE, npcSnapshot, WORLD_SIZE } from '../common/src/world';
import { claimCityTile, loadTile } from '../common/src/world-db';
import { buildScoutIntel } from '../worker/src/battle-tick';
import { convertNpcCityToBranch } from '../worker/src/npc-occupy';
import type { TroopKind } from '../common/src/protocol';
import { Op } from '../common/src/protocol';
import type { ConnectionRegistry, ConnInfo } from '../api/src/connections';
import type { HandlerContext } from '../api/src/handlers';
import { handleGetFactions } from '../api/src/handlers-faction';
import { loadWorldWindow } from '../api/src/views-world';
import { factionAtCell } from '../../frontend/src/components/map/factionLayer';

import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;

describe('五方势力的纯规则（无需数据库）', () => {
  test('五家的名字 / 首领 / 老巢与需求表一致，老巢不落在世界边缘外', () => {
    assert.equal(FACTIONS.length, 5);
    assert.deepEqual(
      FACTIONS.map((def) => [def.key, def.name, def.nameEn, def.leader, def.lair.x, def.lair.y]),
      [
        ['liangzhou', '凉州军', 'Liangzhou Rebels', '韩遂', 80, 80],
        ['wuhuan', '乌桓', 'Wuhuan', '蹋顿', 920, 80],
        ['nanman', '南蛮', 'Nanman', '孟获', 80, 920],
        ['shanyue', '山越', 'Shanyue', '费栈', 920, 920],
        ['heishan', '黑山军', 'Heishan Army', '张燕', 500, 500],
      ],
    );
    for (const def of FACTIONS) {
      assert.ok(def.lair.x >= FACTION_LAIR_CLEAR_RADIUS && def.lair.x < WORLD_SIZE - FACTION_LAIR_CLEAR_RADIUS);
      assert.ok(def.lair.y >= FACTION_LAIR_CLEAR_RADIUS && def.lair.y < WORLD_SIZE - FACTION_LAIR_CLEAR_RADIUS);
    }
    assert.equal(factionDefOf('liangzhou')?.name, '凉州军');
    assert.equal(factionDefOf('nope'), null);
    assert.equal(factionLairAt(500, 500)?.key, 'heishan');
    assert.equal(factionLairAt(501, 500), null);
  });

  test('半径随本季天数变化：第 1~7 天 100、8~14 天 150、15~21 天 200、22 天起 250', () => {
    assert.deepEqual(
      FACTION_RADIUS_STEPS.map((step) => [step.fromDay, step.radius]),
      [
        [1, 100],
        [8, 150],
        [15, 200],
        [22, 250],
      ],
    );
    const expected = (day: number): number => (day < 8 ? 100 : day < 15 ? 150 : day < 22 ? 200 : 250);
    for (let day = 1; day <= 40; day += 1) {
      assert.equal(factionRadiusForDay(day), expected(day), `第 ${day} 天`);
    }
  });

  test('半径按本季实际开始时间算（天数不随 time_scale 变化）', () => {
    const start = new Date('2026-11-01T00:00:00Z');
    assert.equal(factionDayAt(start, new Date(start.getTime() + 1000)), 1);
    assert.equal(factionDayAt(start, new Date(start.getTime() - 5 * DAY)), 1, '开季前按第 1 天');
    assert.equal(factionDayAt(start, new Date(start.getTime() + 7 * DAY - 1)), 7);
    assert.equal(factionDayAt(start, new Date(start.getTime() + 7 * DAY)), 8);
    assert.equal(factionDayAt(start, new Date(start.getTime() + 14 * DAY)), 15);
    assert.equal(factionDayAt(start, new Date(start.getTime() + 21 * DAY)), 22);

    const scaleBefore = factionSwallowIntervalMs(50);
    setTimeScaleCache(1);
    const atDay9 = factionRadiusAt(start, new Date(start.getTime() + 8 * DAY + 3600_000));
    setTimeScaleCache(50);
    const atDay9Scaled = factionRadiusAt(start, new Date(start.getTime() + 8 * DAY + 3600_000));
    assert.equal(atDay9, 150);
    assert.equal(atDay9Scaled, 150, '半径不随缩放变化');
    assert.equal(scaleBefore, FACTION_SWALLOW_INTERVAL_MS / 50);
    setTimeScaleCache(1);
    assert.equal(factionSwallowIntervalMs(1), FACTION_SWALLOW_INTERVAL_MS);
  });

  test('重叠格归离老巢更近的一家，距离相同时按需求表顺序取先出现的一家', () => {
    // 凉州军 (80,80) 与黑山军 (500,500) 在半径 250 时有重叠带
    // (290,290)：到两家都是 210 格 → 平局，取先出现的凉州军
    assert.equal(chebyshevDistance({ x: 290, y: 290 }, FACTIONS[0].lair), 210);
    assert.equal(chebyshevDistance({ x: 290, y: 290 }, FACTIONS[4].lair), 210);
    assert.equal(factionAt(290, 290, 250), 'liangzhou');
    // 偏黑山军一侧：离黑山军更近
    assert.equal(factionAt(295, 295, 250), 'heishan');
    // 偏凉州军一侧
    assert.equal(factionAt(285, 285, 250), 'liangzhou');
    // 范围之外
    assert.equal(factionAt(300, 300, 100), null);
    // 老巢自己恒归自己
    for (const def of FACTIONS) {
      assert.equal(factionAt(def.lair.x, def.lair.y, 1), def.key);
    }
    // 上/左两角在半径 250 时不相交
    assert.equal(factionAt(900, 80, 250), 'wuhuan');
    assert.equal(factionAt(80, 900, 250), 'nanman');
  });

  test('老巢周围 5 格内不放玩家（含老巢本身），第 6 格之外不受限', () => {
    for (const def of FACTIONS) {
      for (let dx = -FACTION_LAIR_CLEAR_RADIUS; dx <= FACTION_LAIR_CLEAR_RADIUS; dx += 1) {
        assert.equal(inFactionLairClearance(def.lair.x + dx, def.lair.y), true, `${def.key} x+${dx}`);
        assert.equal(inFactionLairClearance(def.lair.x, def.lair.y + dx), true, `${def.key} y+${dx}`);
      }
      assert.equal(inFactionLairClearance(def.lair.x + FACTION_LAIR_CLEAR_RADIUS + 1, def.lair.y), false);
      assert.equal(inFactionLairClearance(def.lair.x, def.lair.y - FACTION_LAIR_CLEAR_RADIUS - 1), false);
    }
  });

  test('前端镜像的势力范围判定（map/factionLayer）与后端完全一致', () => {
    // 前端铺色用的是同一套规则（范围 + 最近老巢 + 平局按顺序）：这里逐档半径扫一遍全图确认没有漂移
    const views = FACTIONS.map((def) => ({
      key: def.key,
      name: def.name,
      nameEn: def.nameEn,
      leader: def.leader,
      leaderEn: def.leaderEn,
      lair: { ...def.lair },
      radius: 0,
      cityCount: 0,
      destroyed: false,
      campsTotal: 20,
      campsRemaining: 20,
      campRemainingPercent: 100,
      campPower: 10000,
    }));
    for (const radius of [100, 150, 200, 250]) {
      for (const view of views) {
        view.radius = radius;
      }
      for (let x = 0; x < WORLD_SIZE; x += 11) {
        for (let y = 0; y < WORLD_SIZE; y += 11) {
          assert.equal(factionAtCell(views, x, y), factionAt(x, y, radius), `(${x},${y}) radius ${radius}`);
        }
      }
    }
    // v101（AISLG-241）：本季已灭亡的势力不画范围——两家镜像同样一致（最近的是灭亡势力时归无主）
    for (const destroyedKey of ['nanman', 'heishan'] as const) {
      const marked = views.map((view) => ({ ...view, radius: 250, destroyed: view.key === destroyedKey }));
      for (let x = 0; x < WORLD_SIZE; x += 11) {
        for (let y = 0; y < WORLD_SIZE; y += 11) {
          assert.equal(
            factionAtCell(marked, x, y),
            factionAt(x, y, 250, (key) => key === destroyedKey),
            `灭亡 ${destroyedKey}：(${x},${y})`,
          );
        }
      }
    }
  });

  test('灭亡势力仍占着原来那块地的判定：最近的是灭亡势力时归无主，不改归第二近的一家', () => {
    // (730, 300)：离乌桓 (920,80) 220 格、离黑山军 (500,500) 230 格，两家都在半径 250 内
    assert.equal(factionAt(730, 300, 250), 'wuhuan');
    assert.equal(factionAt(730, 300, 250, (key) => key === 'wuhuan'), null);
    // 别家的「可吞」SQL 条件对它为假（其他势力的范围不因此扩大）
    assert.ok(factionOwnsTileSql('heishan', '730', '300').includes('<'));
    // 与灭亡势力无关的格不受影响
    assert.equal(factionAt(500, 500, 250, (key) => key === 'wuhuan'), 'heishan');
  });

  test('势力灭亡时把势力城变回普通 NPC 城：普通的除回 1 倍，被吞的玩家分城原样保留', () => {
    const base = npcSnapshot(2);
    const scaled = factionSnapshot(base, 'wuhuan');
    const undone = undoFactionSnapshot(scaled);
    assert.equal(undone.faction, undefined);
    for (const [kind, count] of Object.entries(base.garrison)) {
      assert.equal(undone.garrison[kind as keyof typeof undone.garrison], count, `守军 ${kind}`);
    }
    for (const [key, value] of Object.entries(base.stock)) {
      assert.equal(undone.stock[key as keyof typeof undone.stock], value, `库存 ${key}`);
    }
    // 被吞的玩家分城：建筑与库存原样保留，只去掉归属
    const swallowed = { ...scaled, buildings: { government: 4, wall: 3 }, stock: { ...scaled.stock, gold: 777 }, fromPlayer: true };
    const kept = undoFactionSnapshot(swallowed);
    assert.equal(kept.faction, undefined);
    assert.equal(kept.fromPlayer, undefined);
    assert.equal(kept.stock.gold, 777);
    assert.deepEqual(kept.buildings, { government: 4, wall: 3 });
  });

  test('势力城快照：守军与库存 × 1.5（逐兵种 / 逐资源四舍五入），并记下势力标识', () => {
    const base = npcSnapshot(2);
    const faction = factionSnapshot(base, 'wuhuan');
    assert.equal(faction.faction, 'wuhuan');
    assert.equal(faction.level, base.level);
    assert.deepEqual(faction.buildings, base.buildings);
    for (const [kind, count] of Object.entries(NPC_CITY_PROFILE[2].garrison)) {
      assert.equal(faction.garrison[kind as keyof typeof faction.garrison], Math.round((count as number) * FACTION_CITY_MULTIPLIER));
    }
    for (const [key, value] of Object.entries(NPC_CITY_PROFILE[2].stockScale)) {
      assert.equal(faction.stock[key as keyof typeof faction.stock], Math.round(value * FACTION_CITY_MULTIPLIER));
    }
    // 原快照不被改动（纯函数）
    assert.equal(base.faction, undefined);
    // 名城标记等其余字段原样保留
    assert.equal(faction.famous, base.famous);
  });
});

describe('五方势力的事务规则（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  let client: pg.PoolClient;

  /** 服务端的现在（与视图 / 定时器同口径） */
  const now = (): Date => new Date();

  /** 造一块 NPC 城；famous 为 true 时带上名城标记 */
  async function insertNpcCity(x: number, y: number, level = 2, famous = false): Promise<void> {
    const npc = npcSnapshot(level);
    if (famous) {
      (npc as { famous?: unknown }).famous = { name: `名城${x}`, outerGarrison: {}, outerClearedAt: null };
    }
    await client.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       VALUES ($1, $2, 'plain', 'npc_city', $3, NULL, $4::jsonb)`,
      [x, y, level, JSON.stringify(npc)],
    );
  }

  async function insertWilderness(x: number, y: number, level = 1): Promise<void> {
    await client.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       VALUES ($1, $2, 'plain', 'wilderness', $3, NULL, NULL)`,
      [x, y, level],
    );
  }

  async function factionOf(x: number, y: number): Promise<string | null> {
    const res = await pool.query(`SELECT npc->>'faction' AS f FROM world_tiles WHERE x = $1 AND y = $2`, [x, y]);
    return (res.rows[0] as { f: string | null } | undefined)?.f ?? null;
  }

  let accountId: string;
  let cityId: string;

  before(async () => {
    setTimeScaleCache(1);
    tmp = await createTempDatabase(dbUrl as string, 'faction');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    client = await pool.connect();

    accountId = (await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [`faction-${Date.now()}`]))
      .rows[0].id as string;
    cityId = (
      await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron) VALUES ($1, '主城', 100, 100, 100, 100, 100) RETURNING id`, [
        accountId,
      ])
    ).rows[0].id as string;

    // 凉州军老巢 (80,80) 周围：3 座可吞的 NPC 城（25 格内）、1 座 25 格外但 100 格内的 NPC 城
    await insertNpcCity(85, 85, 2);
    await insertNpcCity(90, 78, 1);
    await insertNpcCity(74, 96, 3);
    await insertNpcCity(170, 80, 2); // 距老巢 90 格：开季（25 格）不吞，半径 100 时由定时器吞到
    // 名城：不吞
    await insertNpcCity(88, 88, 3, true);
    // 玩家城（kind='city'）：不吞
    const playerCity = (
      await pool.query(`INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y) VALUES ($1, '玩家城', 0, 0, 0, 0, 0, 92, 92) RETURNING id`, [
        accountId,
      ])
    ).rows[0].id as string;
    await client.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (92, 92, 'plain', 'city', 0, $1, NULL)`,
      [playerCity],
    );
  });

  after(async () => {
    client?.release();
    await pool?.end();
    await tmp?.drop();
  });

  test('开关关闭时什么都没有：不生成老巢、不吞城、面板 enabled=false', async () => {
    setFactionEnabledCache(false);
    assert.equal(await ensureFactions(client), 0);
    const lairs = await pool.query(`SELECT count(*)::int AS n FROM world_tiles WHERE faction_lair IS NOT NULL`);
    assert.equal(lairs.rows[0].n, 0, '关闭时不放老巢');
    const rows = await pool.query(`SELECT count(*)::int AS n FROM factions`);
    assert.equal(rows.rows[0].n, 0);
    assert.equal(await factionOf(85, 85), null, '关闭时不吞城');
    const view = await loadFactionView(pool, new Date(), now());
    assert.deepEqual(view.factions, []);
    assert.equal(view.enabled, false);
    assert.equal(view.radius, 0);
    // 地块视图里也没有势力字段（开关关闭时）
    const tiles = await loadWorldWindow(pool, 80, 80, 20, 20, accountId);
    for (const tile of tiles) {
      assert.equal(tile.faction, null);
    }
  });

  test('打开开关后放五个老巢：地块标记对得上、不是 NPC 城、不占名城', async () => {
    setFactionEnabledCache(true);
    assert.equal(await ensureFactions(client), 5);
    const started = await client.query(`SELECT DISTINCT last_radius FROM factions`);
    assert.deepEqual(started.rows, [{ last_radius: 100 }], '起始半径不算扩大，第 1 天不播报');
    for (const def of FACTIONS) {
      const res = await pool.query(`SELECT kind, level, npc, faction_lair FROM world_tiles WHERE x = $1 AND y = $2`, [def.lair.x, def.lair.y]);
      assert.equal(res.rowCount, 1, `${def.key} 老巢地块应存在`);
      const row = res.rows[0] as { kind: string; level: number; npc: unknown; faction_lair: string };
      assert.equal(row.faction_lair, def.key);
      assert.equal(row.kind, 'wilderness', '老巢是独立地块，不是 NPC 城');
      assert.equal(row.npc, null);
      assert.equal(row.level, 0);
    }
    // 幂等：再跑一次不再生成
    assert.equal(await ensureFactions(client), 0);
    const rows = await loadFactionRowsForTest(pool);
    assert.equal(rows.length, 5);
  });

  test('开季：老巢周围 25 格内的 NPC 城全归该势力，名城与玩家城不在其中', async () => {
    assert.equal(await factionOf(85, 85), 'liangzhou');
    assert.equal(await factionOf(90, 78), 'liangzhou');
    assert.equal(await factionOf(74, 96), 'liangzhou');
    assert.equal(await factionOf(170, 80), null, '25 格之外的城开季不吞');
    assert.equal(await factionOf(88, 88), null, '名城不吞');
    assert.equal(await factionOf(92, 92), null, '玩家城不吞');
    // 吞下的城守军与库存都是同级普通 NPC 城的 1.5 倍
    const res = await pool.query(`SELECT npc FROM world_tiles WHERE x = 85 AND y = 85`);
    const npc = (res.rows[0] as { npc: { garrison: Record<string, number>; stock: Record<string, number>; faction: string } }).npc;
    assert.equal(npc.faction, 'liangzhou');
    assert.equal(npc.garrison.militia, Math.round(NPC_CITY_PROFILE[2].garrison.militia as number * 1.5));
    assert.equal(npc.stock.gold, Math.round(NPC_CITY_PROFILE[2].stockScale.gold * 1.5));
    const counts = await factionCityCounts(pool);
    assert.equal(counts.liangzhou, 3);
  });

  test('面板数据：天数 / 半径 / 首领 / 老巢 / 持城数', async () => {
    const season = await pool.query(
      `INSERT INTO seasons (name, status, start_at, end_at, seed, time_scale, ended_at)
       VALUES ($1, 'active', now() - interval '8 days', now() + interval '20 days', 7, 1, NULL) RETURNING start_at`,
      [`faction-season-${Date.now()}`],
    );
    const startAt = season.rows[0].start_at as Date;
    const view = await loadFactionView(pool, startAt, new Date(startAt.getTime() + 8 * DAY + 60_000));
    assert.equal(view.enabled, true);
    assert.equal(view.day, 9);
    assert.equal(view.radius, 150);
    assert.equal(view.factions.length, 5);
    const liangzhou = view.factions.find((f) => f.key === 'liangzhou');
    assert.equal(liangzhou?.leader, '韩遂');
    assert.equal(liangzhou?.nameEn, 'Liangzhou Rebels');
    assert.deepEqual(liangzhou?.lair, { x: 80, y: 80 });
    assert.equal(liangzhou?.radius, 150);
    assert.equal(liangzhou?.cityCount, 3);
    assert.equal(view.factions.find((f) => f.key === 'heishan')?.cityCount, 0);
    await pool.query(`DELETE FROM seasons WHERE name LIKE 'faction-season-%'`);
  });

  test('每 6 小时（随缩放）在当前范围内随机吞一座：到点才吞，且不重复吞已属于势力的城', async () => {
    // 到点前：不吞
    const early = await runFactionTick(pool, now());
    assert.equal(early.swallowed, 0);
    // 把五家的上次吞城时刻推到 7 小时前（基准间隔 6 小时）
    await pool.query(`UPDATE factions SET last_swallow_at = now() - interval '7 hours'`);
    const due = await runFactionTick(pool, now());
    // 只有凉州军在范围内有可吞的城（170,80，老巢 90 格内、半径 100 内）
    assert.equal(due.swallowed, 1);
    assert.equal(await factionOf(170, 80), 'liangzhou');
    // 再来一轮：范围内已没有可吞的城 → 不再增加，但也不会重复吞名城 / 玩家城
    await pool.query(`UPDATE factions SET last_swallow_at = now() - interval '7 hours'`);
    const again = await runFactionTick(pool, now());
    assert.equal(again.swallowed, 0);
    assert.equal(await factionOf(88, 88), null);
    assert.equal(await factionOf(92, 92), null);
    const counts = await factionCityCounts(pool);
    assert.equal(counts.liangzhou, 4);
  });

  test('半径扩大时写一条全服播报，每周最多一次；吞城失败也不重复播', async () => {
    await pool.query(`DELETE FROM server_broadcasts`);
    await pool.query(`UPDATE factions SET last_radius = 0`);
    const broadcast = await runFactionTick(pool, now());
    assert.equal(broadcast.broadcast, true);
    const rows = await pool.query(`SELECT type, detail FROM server_broadcasts WHERE type = 'faction_expanded'`);
    assert.equal(rows.rowCount, 1);
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    assert.equal((rows.rows[0] as { detail: { radius: number } }).detail.radius, factionRadiusAt(season.startAt, now()));
    // 同一半径不重复播
    const second = await runFactionTick(pool, now());
    assert.equal(second.broadcast, false);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM server_broadcasts WHERE type = 'faction_expanded'`)).rows[0].n, 1);
    await pool.query(`DELETE FROM server_broadcasts`);
  });

  test('范围外没有可吞的城时吞城返回 null（不报错、不写脏数据）', async () => {
    const def = factionDefOf('heishan');
    assert.ok(def);
    assert.equal(await swallowRandom(client, def, 10), null);
    assert.equal(await swallowWithin(client, def, 0), 0);
  });

  test('重叠区的城只归更近的一家：半径 250 时 (300,300) 归黑山军，凉州军吞不到', async () => {
    const liangzhou = factionDefOf('liangzhou');
    const heishan = factionDefOf('heishan');
    assert.ok(liangzhou && heishan);
    assert.equal(factionAt(300, 300, 250), 'heishan', '前提：离中央 200 格，离左上老巢 220 格');
    await insertNpcCity(300, 300);
    assert.equal(await swallowWithin(client, liangzhou, 250), 0, '开季批量吞城不跨到别家的格');
    assert.equal(await swallowRandom(client, liangzhou, 250), null, '随机吞城也选不到别家的格');
    assert.deepEqual(await swallowRandom(client, heishan, 250), { x: 300, y: 300 });
    await client.query(`DELETE FROM world_tiles WHERE x = 300 AND y = 300`);
  });

  test('距离相同时归表里靠前的一家（SQL 与 factionAt 同口径）', async () => {
    const liangzhou = factionDefOf('liangzhou');
    const heishan = factionDefOf('heishan');
    assert.ok(liangzhou && heishan);
    // (290,290) 到 (80,80) 与 (500,500) 都是 210 格
    assert.equal(factionAt(290, 290, 250), 'liangzhou');
    await insertNpcCity(290, 290);
    assert.equal(await swallowRandom(client, heishan, 250), null);
    assert.deepEqual(await swallowRandom(client, liangzhou, 250), { x: 290, y: 290 });
    await client.query(`DELETE FROM world_tiles WHERE x = 290 AND y = 290`);
  });

  test('落位避开老巢周围 5 格：中央老巢那一格选不上，关闭开关时照旧可选', async () => {
    // 只留一格可选空地：黑山军老巢 (500,500)（正？世界中心，落位的采样点里必有它）。
    // 把 Math.random 固定成 0.5，采样点就全是 (500,500)，判定完全确定。
    await client.query(`DELETE FROM world_tiles`);
    await insertWilderness(500, 500, 0);
    const originalRandom = Math.random;
    Math.random = () => 0.5;
    try {
      setFactionEnabledCache(true);
      assert.equal(await claimCityTile(client, cityId), null, '老巢周围 5 格内不放玩家');
      setFactionEnabledCache(false);
      const placed = await claimCityTile(client, cityId);
      assert.ok(placed, '关闭开关时与原来一致，照常在空地里落位');
      assert.deepEqual(placed, { x: 500, y: 500 });
    } finally {
      Math.random = originalRandom;
    }
    await client.query(`UPDATE cities SET x = NULL, y = NULL WHERE id = $1`, [cityId]);
    setFactionEnabledCache(true);
  });

  test('GET_FACTIONS：开关关闭返回空；打开返回五家（老巢坐标公开，不做迷雾裁剪）', async () => {
    const sent: Array<{ ok: boolean; data?: Record<string, unknown>; error?: { code: string } }> = [];
    const registry = {
      send: (_conn: ConnInfo, frame: { ok?: boolean; data?: Record<string, unknown>; error?: { code: string } }) => {
        sent.push({ ok: frame.ok ?? true, data: frame.data, error: frame.error });
      },
      broadcast: () => 0,
    } as unknown as ConnectionRegistry;
    const ctx = { pool, registry } as unknown as HandlerContext;
    const conn = { accountId, role: 'player' } as unknown as ConnInfo;

    setFactionEnabledCache(false);
    await handleGetFactions(ctx, conn, Op.GET_FACTIONS, 1);
    assert.equal(sent.at(-1)?.ok, true);
    assert.equal(sent.at(-1)?.data?.enabled, false);
    assert.deepEqual(sent.at(-1)?.data?.factions, []);

    setFactionEnabledCache(true);
    await handleGetFactions(ctx, conn, Op.GET_FACTIONS, 2);
    const data = sent.at(-1)?.data as { enabled: boolean; factions: Array<{ key: string; lair: { x: number; y: number } }> };
    assert.equal(data.enabled, true);
    assert.equal(data.factions.length, 5);
    assert.deepEqual(
      data.factions.map((f) => [f.key, f.lair.x, f.lair.y]),
      FACTIONS.map((def) => [def.key, def.lair.x, def.lair.y]),
    );
  });

  test('势力城的守军与库存真的翻 1.5 倍：侦察读到的是放大后的驻军与库存，玩家占下后不再属于势力', async () => {
    // 直接写一座「已被黑山军吞下」的 3 级 NPC 城（等价于吞城结果）
    const npc = factionSnapshot(npcSnapshot(3), 'heishan');
    await client.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       VALUES (300, 300, 'plain', 'npc_city', 3, NULL, $1::jsonb)`,
      [JSON.stringify(npc)],
    );
    const tile = await loadTile(pool, 300, 300);
    assert.ok(tile?.npc);
    const base = NPC_CITY_PROFILE[3];
    // 掠夺 / 占领的守方就是这份快照（resolvePlunderArrival / resolveNpcOccupyArrival 读 npc.garrison）
    for (const [kind, count] of Object.entries(base.garrison)) {
      assert.equal(tile.npc.garrison[kind as TroopKind], Math.round((count as number) * FACTION_CITY_MULTIPLIER), `守军 ${kind}`);
    }
    // 侦察（SCOUT 到达）的库存取快照的 npc.stock：情报里的库存同样是放大后的值
    const intel = buildScoutIntel(tile, tile.npc.garrison, null, new Date().toISOString());
    for (const [key, value] of Object.entries(base.stockScale)) {
      assert.equal(intel.npcStock?.[key as keyof typeof intel.npcStock], Math.round(value * FACTION_CITY_MULTIPLIER), `库存 ${key}`);
    }
    // 占领（rival 路径）后地块转城池、快照清空 → 这座城不再属于势力
    const branchId = await convertNpcCityToBranch(client, accountId, tile, tile.npc, { militia: 1 }, '势力分城');
    const after = await pool.query(`SELECT kind, npc FROM world_tiles WHERE x = 300 AND y = 300`);
    assert.equal((after.rows[0] as { kind: string }).kind, 'city');
    assert.equal((after.rows[0] as { npc: unknown }).npc, null);
    const counts = await factionCityCounts(pool);
    assert.equal(counts.heishan ?? 0, 0);
    await client.query(`DELETE FROM cities WHERE id = $1`, [branchId]);
  });
});

/** 只取老巢行（测试里断言生成结果用） */
async function loadFactionRowsForTest(q: pg.Pool): Promise<Array<{ key: string }>> {
  const res = await q.query(`SELECT key FROM factions ORDER BY key`);
  return res.rows as Array<{ key: string }>;
}
