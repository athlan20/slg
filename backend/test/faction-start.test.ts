// 势力当季启用（AISLG-243，v102）：势力起点函数、当季启用下的天数 / 半径 / 围攻起算日、老巢落点跳过规则、
// 启用公告文案，以及「当季启用」的一次性落位与换季对齐。
// 无数据库的部分始终执行；事务部分需要真实 PostgreSQL：设置 TEST_DATABASE_URL（一次性临时库，别指向开发库），
// 否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import pg from 'pg';
import { ensureSchema } from '../common/src/db';
import {
  FACTIONS,
  FACTION_LAIR_CLEAR_RADIUS,
  FACTION_RADIUS_STEPS,
  factionDayAt,
  factionDefOf,
  factionEpochStart,
  factionLairBlocked,
  factionLairClearanceBox,
  factionRadiusAt,
} from '../common/src/faction';
import { FACTION_SIEGE_START_DAY, factionSiegeMultiplierForDay, factionSiegeWeekOf } from '../common/src/faction-siege';
import { setFactionEnabledCache } from '../common/src/faction-config';
import { inactiveFactionKeys, loadFactionRows, loadFactionView } from '../common/src/faction-db';
import { alignFactionStartedAtForSeason, loadFactionEpochStart, loadFactionStartedAt } from '../common/src/faction-start';
import { loadFactionLairs } from '../common/src/faction-lair-db';
import { getCurrentSeason } from '../common/src/season-db';
import { npcSnapshot } from '../common/src/world';
import { ensureFactionSeasonStart, factionStartAnnouncement, runFactionStart } from '../worker/src/faction-start';
import { createTempDatabase, type TempDatabase } from './season-test-db';

const dbUrl = process.env.TEST_DATABASE_URL;
const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

describe('势力起点与当季启用的计算（无需数据库）', () => {
  test('势力起点 = max(本季开始时间, 启用时间)；没有启用时间时等于本季开始时间', () => {
    const seasonStart = new Date('2026-11-01T00:00:00.000Z');
    const enabledAt = new Date('2026-11-16T08:00:00.000Z');
    // 当季启用：启用时间更晚 → 用它（从启用当天算第 1 天）
    assert.equal(factionEpochStart(seasonStart, enabledAt).getTime(), enabledAt.getTime());
    // 换季启用：两者相同 → 本季开始时间（行为不变）
    assert.equal(factionEpochStart(seasonStart, seasonStart).getTime(), seasonStart.getTime());
    // 启用时间早于本季开始（上一季留下的记录）：仍按本季开始时间
    assert.equal(factionEpochStart(seasonStart, new Date('2026-10-01T00:00:00.000Z')).getTime(), seasonStart.getTime());
    // 没启用过 / 脏值
    assert.equal(factionEpochStart(seasonStart, null).getTime(), seasonStart.getTime());
    assert.equal(factionEpochStart(seasonStart, new Date('nope')).getTime(), seasonStart.getTime());
  });

  test('当季启用：启用当天算第 1 天（半径 100、不围攻），满 7 天第 8 天起围攻（倍率 100、半径 150），第 15 天 200、第 22 天 250', () => {
    const seasonStart = new Date('2026-11-01T00:00:00.000Z');
    // 线上第 16 天打开开关：不按赛季天数，从启用当天重新算
    const enabledAt = new Date(seasonStart.getTime() + 15 * DAY + 5 * HOUR);
    const epoch = factionEpochStart(seasonStart, enabledAt);

    assert.equal(factionDayAt(seasonStart, enabledAt), 16, '前提：按赛季天数已经是第 16 天');
    assert.equal(factionDayAt(epoch, enabledAt), 1);
    assert.equal(factionRadiusAt(epoch, enabledAt), 100);
    assert.equal(factionSiegeMultiplierForDay(factionDayAt(epoch, enabledAt)), 0);
    assert.equal(factionSiegeWeekOf(epoch, enabledAt), null, '第 1 天没有可围攻周');

    const day7 = new Date(enabledAt.getTime() + 6 * DAY + 23 * HOUR);
    assert.equal(factionDayAt(epoch, day7), FACTION_SIEGE_START_DAY - 1);
    assert.equal(factionRadiusAt(epoch, day7), 100);
    assert.equal(factionSiegeWeekOf(epoch, day7), null, '不满 7 天不发生围攻');
    assert.equal(factionSiegeMultiplierForDay(factionDayAt(epoch, day7)), 0);

    const day8 = new Date(enabledAt.getTime() + 7 * DAY);
    assert.equal(factionDayAt(epoch, day8), 8);
    assert.equal(factionRadiusAt(epoch, day8), 150);
    assert.equal(factionSiegeMultiplierForDay(factionDayAt(epoch, day8)), 100, '第 8 天的倍率 100');
    const week1 = factionSiegeWeekOf(epoch, day8);
    assert.equal(week1?.index, 0);
    assert.equal(week1?.start.getTime(), day8.getTime(), '第一周从第 8 天起算（启用当天 + 7 天）');

    const day15 = new Date(enabledAt.getTime() + 14 * DAY);
    assert.equal(factionDayAt(epoch, day15), 15);
    assert.equal(factionRadiusAt(epoch, day15), 200);
    assert.equal(factionSiegeMultiplierForDay(factionDayAt(epoch, day15)), 150);
    assert.equal(factionSiegeWeekOf(epoch, day15)?.index, 1);

    const day22 = new Date(enabledAt.getTime() + 21 * DAY);
    assert.equal(factionDayAt(epoch, day22), 22);
    assert.equal(factionRadiusAt(epoch, day22), 250);
    assert.equal(factionSiegeMultiplierForDay(factionDayAt(epoch, day22)), 200);
    assert.equal(factionSiegeWeekOf(epoch, day22)?.index, 2);
  });

  test('换季启用时起点就是本季开始时间：天数 / 半径与改动前完全一致', () => {
    const seasonStart = new Date('2026-11-01T00:00:00.000Z');
    const epoch = factionEpochStart(seasonStart, seasonStart);
    assert.equal(factionDayAt(epoch, new Date(seasonStart.getTime() + 7 * DAY)), 8);
    assert.equal(factionRadiusAt(epoch, new Date(seasonStart.getTime() + 7 * DAY)), 150);
    assert.equal(factionRadiusAt(epoch, new Date(seasonStart.getTime() + 21 * DAY)), 250);
    assert.deepEqual(
      FACTION_RADIUS_STEPS.map((step) => factionRadiusAt(epoch, new Date(seasonStart.getTime() + (step.fromDay - 1) * DAY))),
      FACTION_RADIUS_STEPS.map((step) => step.radius),
    );
  });

  test('老巢落点跳过规则：老巢格或周围 5 格（切比雪夫）内有玩家城就不放，6 格外照常放', () => {
    const def = factionDefOf('liangzhou');
    assert.ok(def);
    assert.deepEqual(factionLairClearanceBox(def), {
      minX: def.lair.x - FACTION_LAIR_CLEAR_RADIUS,
      maxX: def.lair.x + FACTION_LAIR_CLEAR_RADIUS,
      minY: def.lair.y - FACTION_LAIR_CLEAR_RADIUS,
      maxY: def.lair.y + FACTION_LAIR_CLEAR_RADIUS,
    });
    assert.equal(factionLairBlocked(def, []), false, '没有玩家城就照常放');
    assert.equal(factionLairBlocked(def, [{ x: def.lair.x, y: def.lair.y }]), true, '老巢格本身有玩家城');
    assert.equal(factionLairBlocked(def, [{ x: def.lair.x + 5, y: def.lair.y - 5 }]), true, '切比雪夫距离 5');
    assert.equal(factionLairBlocked(def, [{ x: def.lair.x - 5, y: def.lair.y }]), true);
    assert.equal(factionLairBlocked(def, [{ x: def.lair.x + 6, y: def.lair.y }]), false, '6 格外不影响');
    // 别的势力老巢附近的城不影响这家
    const far = FACTIONS.find((faction) => faction.key !== def.key && faction.lair.x !== def.lair.x);
    assert.ok(far);
    assert.equal(factionLairBlocked(def, [far.lair]), false);
  });

  test('启用公告：说明天数从开启当天算第 1 天，并写明本季没放的势力与原因', () => {
    const nanman = factionDefOf('nanman');
    assert.ok(nanman);
    const partial = factionStartAnnouncement({ started: true, placed: 4, skipped: [nanman] });
    assert.ok(partial.bodyZh.includes('第 1 天'));
    assert.ok(partial.bodyZh.includes('南蛮'));
    assert.ok(partial.bodyZh.includes('该处已有玩家城'));
    const full = factionStartAnnouncement({ started: true, placed: 5, skipped: [] });
    assert.ok(full.bodyZh.includes('全部登场'));
    assert.ok(!full.bodyZh.includes('该处已有玩家城'));
  });
});

describe('势力当季启用的事务规则（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let pool: pg.Pool;
  let tmp: TempDatabase | undefined;
  /** 赛季已经跑了 15 天，之后才打开开关 */
  const seasonStart = new Date(Date.now() - 15 * DAY);
  const enabledAt = new Date();

  before(async () => {
    tmp = await createTempDatabase(dbUrl as string, 'faction_start');
    pool = new pg.Pool({ connectionString: tmp.url, max: 4 });
    await ensureSchema(pool);
    setFactionEnabledCache(true);

    const accountId = (
      await pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
        `faction-start-${Date.now()}`,
      ])
    ).rows[0].id as string;
    // 南蛮老巢 (80,920) 上有一座玩家城：地块 kind='city'
    const onLair = (
      await pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y)
         VALUES ($1, '老巢上的城', 0, 0, 0, 0, 0, 80, 920) RETURNING id`,
        [accountId],
      )
    ).rows[0].id as string;
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (80, 920, 'plain', 'city', 0, $1, NULL)`,
      [onLair],
    );
    // 乌桓老巢 (920,80) 周围 2 格有一座玩家城，只在 cities 表里（地块缺行的存量城也算）
    await pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron, x, y)
       VALUES ($1, '紧挨乌桓老巢的城', 0, 0, 0, 0, 0, 918, 78)`,
      [accountId],
    );
    // 凉州军老巢 (80,80) 附近 25 格内有一座可吞的 NPC 城
    await pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       VALUES (85, 85, 'plain', 'npc_city', 2, NULL, $1::jsonb)`,
      [JSON.stringify(npcSnapshot(2))],
    );
  });

  after(async () => {
    await pool?.end();
    await tmp?.drop();
  });

  test('当季启用：一开始就放老巢，老巢格 / 周围 5 格内有玩家城的那几家本季不放', async () => {
    const result = await runFactionStart(pool, enabledAt);
    assert.equal(result.started, true);
    assert.equal(result.placed, 3);
    assert.deepEqual(result.skipped.map((def) => def.key), ['wuhuan', 'nanman'], '按需求表顺序，两家被跳过');

    // 启用时间记进 settings
    const startedAt = await loadFactionStartedAt(pool);
    assert.ok(startedAt);
    assert.ok(Math.abs(startedAt.getTime() - enabledAt.getTime()) < 2000);

    // 放下的三家：factions 行 + 老巢地块标记；跳过的两家什么都没有
    assert.deepEqual((await loadFactionRows(pool)).map((row) => row.key), ['liangzhou', 'shanyue', 'heishan']);
    const liangzhouLair = await pool.query(`SELECT faction_lair, kind, npc FROM world_tiles WHERE x = 80 AND y = 80`);
    assert.equal((liangzhouLair.rows[0] as { faction_lair: string }).faction_lair, 'liangzhou');
    assert.equal((await pool.query(`SELECT 1 FROM world_tiles WHERE faction_lair = 'wuhuan'`)).rowCount, 0);
    assert.equal((await pool.query(`SELECT 1 FROM world_tiles WHERE faction_lair = 'nanman'`)).rowCount, 0);
    // 跳过的势力连老巢战况行都没有
    assert.deepEqual((await loadFactionLairs(pool)).map((row) => row.key), ['liangzhou', 'shanyue', 'heishan']);

    // 放下的那家照常吞下老巢周围 25 格内的 NPC 城
    const swallowed = await pool.query(`SELECT npc->>'faction' AS f FROM world_tiles WHERE x = 85 AND y = 85`);
    assert.equal((swallowed.rows[0] as { f: string | null }).f, 'liangzhou');

    // 面板：势力第 1 天、半径 100、只有三家（赛季已过 15 天也不影响）
    const view = await loadFactionView(pool, seasonStart, enabledAt);
    assert.equal(view.enabled, true);
    assert.equal(view.day, 1);
    assert.equal(view.radius, 100);
    assert.deepEqual(view.factions.map((faction) => faction.key), ['liangzhou', 'shanyue', 'heishan']);
    // 本季不存在的势力：袭击不带旗号、不画范围
    assert.deepEqual([...(await inactiveFactionKeys(pool))].sort(), ['nanman', 'wuhuan']);
    // 启用公告
    const announcement = await pool.query(`SELECT title_zh, body_zh FROM announcements ORDER BY id DESC LIMIT 1`);
    assert.ok(announcement.rowCount);
    const body = (announcement.rows[0] as { body_zh: string }).body_zh;
    assert.ok(body.includes('第 1 天'));
    assert.ok(body.includes('乌桓') && body.includes('南蛮'));
    assert.ok(body.includes('该处已有玩家城'));
  });

  test('关掉再打开不重复放老巢，也不补放当初跳过的那家', async () => {
    // 玩家搬走了：南蛮 / 乌桓老巢周围已经没人
    await pool.query(`UPDATE cities SET x = NULL, y = NULL`);
    await pool.query(`UPDATE world_tiles SET kind = 'wilderness', owner_city_id = NULL WHERE kind = 'city'`);
    setFactionEnabledCache(false);
    setFactionEnabledCache(true);
    const again = await ensureFactionSeasonStart(pool, new Date(enabledAt.getTime() + HOUR));
    assert.equal(again.started, false, '以 faction_started_at 是否已有记录为准：只执行一次');
    assert.equal((await loadFactionRows(pool)).length, 3);
    assert.equal((await pool.query(`SELECT count(*)::int AS n FROM factions`)).rows[0].n, 3);
    assert.equal((await pool.query(`SELECT 1 FROM world_tiles WHERE faction_lair = 'nanman'`)).rowCount, 0, '不补放');
    assert.equal((await loadFactionStartedAt(pool))?.getTime(), enabledAt.getTime(), '启用时间不被覆盖');
  });

  test('换季对齐：开了势力设成新赛季开始时间（第 1 天），没开则删掉记录', async () => {
    const nextStart = new Date(enabledAt.getTime() + 13 * DAY);
    await alignFactionStartedAtForSeason(pool, nextStart, true);
    const epoch = await loadFactionEpochStart(pool, nextStart);
    assert.equal(epoch.getTime(), nextStart.getTime(), '换季启用时起点就是新赛季开始时间');
    assert.equal(factionDayAt(epoch, new Date(nextStart.getTime() + 7 * DAY)), 8, '新赛季第 8 天才开始围攻');

    // 换季时开关关着：删掉记录，下个赛季中途打开开关才算「当季启用」
    await alignFactionStartedAtForSeason(pool, nextStart, false);
    assert.equal(await loadFactionStartedAt(pool), null);
    const fallback = await loadFactionEpochStart(pool, nextStart);
    assert.equal(fallback.getTime(), nextStart.getTime(), '没有记录时就是本季开始时间');
    const restart = await ensureFactionSeasonStart(pool, new Date(nextStart.getTime() + 2 * DAY));
    assert.equal(restart.started, true, '新赛季可以重新当季启用');
  });
  test('存量势力（v102 前放下的老巢，没有启用时间）：只补记成本季开始时间，天数不被重置成第 1 天', async () => {
    await pool.query(`DELETE FROM settings WHERE key = 'faction_started_at'`);
    assert.ok((await loadFactionRows(pool)).length > 0, '前提：本季已有势力行');
    const season = await getCurrentSeason(pool);
    assert.ok(season);
    const later = new Date(season.startAt.getTime() + 20 * DAY);
    const result = await ensureFactionSeasonStart(pool, later);
    assert.equal(result.started, true);
    assert.equal(result.placed, 0, '不再放第二次老巢');
    assert.equal((await loadFactionStartedAt(pool))?.getTime(), season.startAt.getTime(), '记成本季开始时间，不是现在');
    const epoch = await loadFactionEpochStart(pool, season.startAt);
    assert.equal(factionDayAt(epoch, later), 21, '势力节奏与升级前一致');
  });
});
