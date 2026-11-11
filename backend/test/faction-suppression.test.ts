// 势力压制档（v107，AISLG-249）：老巢被打掉的营越多，这家越虚——围城军更弱、吞 NPC 城更慢、
// 3 档时每周吞玩家分城上限从 2 降到 1。压制档完全由剩余营数算出，营恢复后自动降档。
// 纯规则部分始终执行；事务 / Worker 部分需要真实 PostgreSQL（TEST_DATABASE_URL，一次性临时库，
// 别指向开发库），否则跳过。夹具复用 faction-siege-fixture / faction-lair-fixture。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  FACTIONS,
  FACTION_SWALLOW_INTERVAL_MS,
  factionSwallowIntervalMs,
} from '../common/src/faction';
import {
  FACTION_SIEGE_WEEKLY_CAP,
  FACTION_SIEGE_WEEKLY_CAP_AT_MAX_SUPPRESSION,
  factionSiegeArmy,
  factionSiegeSuppressedPower,
  factionSiegeWeeklyCap,
} from '../common/src/faction-siege';
import {
  FACTION_SUPPRESSION_MAX_LEVEL,
  suppressionLevel,
  suppressionSiegePercent,
  suppressionSwallowIntervalHours,
  suppressionSwallowIntervalMs,
  suppressionView,
  suppressionWeeklyBranchCap,
} from '../common/src/faction-suppression';
import { setTimeScaleCache } from '../common/src/time-scale';
import { setFactionEnabledCache } from '../common/src/faction-config';
import { loadFactionLairRow } from '../common/src/faction-lair-db';
import { loadFactionView } from '../common/src/faction-db';
import { runFactionSiegeTick } from '../worker/src/faction-siege-tick';
import { runFactionTick } from '../worker/src/faction-tick';
import { runFactionLairTick } from '../worker/src/faction-lair-tick';
import { createSiegeFixture, type SiegeFixture } from './faction-siege-fixture';
import {
  attackLair,
  createFlowFixture,
  HOUR,
  insertPlayer,
  NANMAN,
  setCityArmy,
  type FlowFixture,
} from './faction-lair-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;
const SHANYUE = FACTIONS[3];
const WUHUAN = FACTIONS[1];

describe('压制档的纯规则（无需数据库）', () => {
  test('压制档 = clamp(floor((20 − 剩余) ÷ 5), 0, 3)：剩余 20/16/15/11/10/6/5/1 → 0/0/1/1/2/2/3/3', () => {
    const expected: Array<[number, number]> = [
      [20, 0],
      [16, 0],
      [15, 1],
      [11, 1],
      [10, 2],
      [6, 2],
      [5, 3],
      [1, 3],
    ];
    for (const [remaining, level] of expected) {
      assert.equal(suppressionLevel(20, remaining), level, `剩 ${remaining} 营`);
    }
    // 边界与脏值：满营 0 档、0 营（灭亡）夹到 3 档、负数 / NaN 不炸
    assert.equal(suppressionLevel(20, 20), 0);
    assert.equal(suppressionLevel(20, 0), FACTION_SUPPRESSION_MAX_LEVEL);
    assert.equal(suppressionLevel(20, -5), FACTION_SUPPRESSION_MAX_LEVEL);
    assert.equal(suppressionLevel(20, Number.NaN), 0, '脏值按无压制算');
    assert.equal(suppressionLevel(Number.NaN, 5), 0);
    assert.equal(suppressionLevel(0, 0), 0);
  });

  test('各档围城军比例 100 / 75 / 50 / 25，压制后的战力向下取整、不低于 1', () => {
    assert.deepEqual([0, 1, 2, 3].map(suppressionSiegePercent), [100, 75, 50, 25]);
    // 满级官府、第 22 天起的倍率 200 → 4,000 战力
    const base = 20 * 200;
    assert.equal(factionSiegeSuppressedPower(base, suppressionSiegePercent(0)), 4000);
    assert.equal(factionSiegeSuppressedPower(base, suppressionSiegePercent(1)), 3000);
    assert.equal(factionSiegeSuppressedPower(base, suppressionSiegePercent(2)), 2000);
    assert.equal(factionSiegeSuppressedPower(base, suppressionSiegePercent(3)), 1000);
    // 向下取整 + 不低于 1（官府 1 级 × 倍率 100 = 100，3 档 25% 仍有 25；极小的战力也至少 1）
    assert.equal(factionSiegeSuppressedPower(101, 75), 75);
    assert.equal(factionSiegeSuppressedPower(1, 25), 1);
    assert.equal(factionSiegeSuppressedPower(0, 25), 1);
  });

  test('各档吞 NPC 城间隔 6 / 9 / 12 / 15 小时（0 档与 AISLG-240 现状一致），仍随 time_scale 缩放、不低于 1 秒', () => {
    assert.deepEqual([0, 1, 2, 3].map(suppressionSwallowIntervalHours), [6, 9, 12, 15]);
    // 0 档必须与 faction.ts 的基准一致（单一数值来源，不各写一套）
    assert.equal(suppressionSwallowIntervalHours(0) * 60 * 60 * 1000, FACTION_SWALLOW_INTERVAL_MS);
    assert.equal(suppressionSwallowIntervalMs(0, 1), factionSwallowIntervalMs(1));
    assert.equal(suppressionSwallowIntervalMs(2, 1), 12 * HOUR);
    assert.equal(suppressionSwallowIntervalMs(3, 10), (15 * HOUR) / 10);
    assert.equal(suppressionSwallowIntervalMs(3, 1e9), 1000, '缩放到极小时钳 1 秒');
  });

  test('每周吞分城上限：0~2 档 2 座、3 档 1 座（FACTION_SIEGE_WEEKLY_CAP 保持现状 2）', () => {
    assert.equal(FACTION_SIEGE_WEEKLY_CAP, 2);
    assert.equal(FACTION_SIEGE_WEEKLY_CAP_AT_MAX_SUPPRESSION, 1);
    assert.deepEqual([0, 1, 2, 3].map(suppressionWeeklyBranchCap), [2, 2, 2, 1]);
    assert.deepEqual([0, 1, 2, 3].map(factionSiegeWeeklyCap), [2, 2, 2, 1]);
  });

  test('面板视图：档位 + 三项效果一起给（剩余 15 营 = 1 档）', () => {
    assert.deepEqual(suppressionView(20, 15), {
      level: 1,
      siegePercent: 75,
      swallowIntervalHours: 9,
      weeklyBranchCap: 2,
    });
    assert.deepEqual(suppressionView(20, 20), {
      level: 0,
      siegePercent: 100,
      swallowIntervalHours: 6,
      weeklyBranchCap: 2,
    });
    assert.deepEqual(suppressionView(20, 5), {
      level: 3,
      siegePercent: 25,
      swallowIntervalHours: 15,
      weeklyBranchCap: 1,
    });
  });
});

describe('压制档在围攻 / 吞城 / 老巢里的实际取值（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let siege: SiegeFixture;
  let flow: FlowFixture;

  before(async () => {
    setTimeScaleCache(1);
    siege = await createSiegeFixture(dbUrl as string, 'suppression_siege');
    flow = await createFlowFixture(dbUrl as string, 'suppression_lair');
    setFactionEnabledCache(true);
  });

  after(async () => {
    setFactionEnabledCache(false);
    await siege?.close();
    await flow?.close();
  });

  /** 把一家的剩余营数写成 camps（压制档由它现算） */
  const setCamps = async (key: string, camps: number): Promise<void> => {
    await siege.pool.query(
      `INSERT INTO faction_lairs (key, camps_total, camps_remaining) VALUES ($1, 20, $2)
       ON CONFLICT (key) DO UPDATE SET camps_total = 20, camps_remaining = $2, remaining = NULL, remaining_at = NULL`,
      [key, camps],
    );
  };

  test('1 档：围城军战力 = 原值 × 75%（发起那一刻定，编成按压制后的战力缩放）', async () => {
    await setCamps(NANMAN.key, 15);
    const owner = await siege.insertAccount(`sup-branch-${Date.now()}`);
    // 选目标只打玩家分城：先给这个账号造一座更早创建的主城，再造成分城
    await siege.insertCity({
      accountId: owner,
      name: '南蛮范围内的主城',
      x: NANMAN.lair.x + 4,
      y: NANMAN.lair.y - 4,
      gov: 6,
      createdAt: new Date(Date.now() - 4 * 24 * HOUR),
    });
    const branch = await siege.insertCity({
      accountId: owner,
      name: '南蛮范围内的分城',
      x: NANMAN.lair.x + 8,
      y: NANMAN.lair.y - 8,
      gov: 5,
      createdAt: new Date(Date.now() - 2 * 24 * HOUR),
      originLevel: 2,
    });
    await runFactionSiegeTick(siege.pool, new Date());
    const rows = await siege.pool.query(
      `SELECT power, level, army FROM faction_sieges WHERE faction = $1 AND city_id = $2`,
      [NANMAN.key, branch],
    );
    assert.equal(rows.rowCount, 1, '发起了围攻');
    const row = rows.rows[0] as { power: number; level: number; army: Record<string, number> };
    assert.equal(row.level, 5);
    assert.equal(row.power, 375, '官府 5 级 × 倍率 100 × 75% = 375');
    assert.equal(row.power, factionSiegeSuppressedPower(5 * 100, suppressionSiegePercent(1)));
    assert.deepEqual(row.army, factionSiegeArmy(375), '编成按压制后的战力缩放');
  });

  test('3 档：每周吞玩家分城上限降为 1 座（本周已吞满就不发起）', async () => {
    // 上一轮留下的在途围攻会挡住发起（同一时间最多围 1 座），这里先清掉
    await siege.pool.query(`DELETE FROM faction_sieges`);
    // 这家打成 3 档（剩 5 营 = 打掉 15 营）
    await setCamps(NANMAN.key, 5);
    // 本周（第 8 天起的第 1 周）已吞 1 座
    await siege.pool.query(
      `INSERT INTO faction_sieges (faction, city_id, account_id, x, y, level, army, power, arrive_at, resolved_at, outcome, swallowed_at, week_index)
       VALUES ($1, NULL, $2, $3, $4, 5, '{}'::jsonb, 500, now(), now(), 'swallowed', now(), 0)`,
      [NANMAN.key, siege.defenderId, NANMAN.lair.x + 90, NANMAN.lair.y + 90],
    );
    const owner = await siege.insertAccount(`sup-cap-${Date.now()}`);
    await siege.insertCity({
      accountId: owner,
      name: '3 档范围内的主城',
      x: NANMAN.lair.x + 5,
      y: NANMAN.lair.y - 5,
      gov: 6,
      createdAt: new Date(Date.now() - 4 * 24 * HOUR),
    });
    await siege.insertCity({
      accountId: owner,
      name: '3 档范围内的分城',
      x: NANMAN.lair.x + 6,
      y: NANMAN.lair.y - 6,
      gov: 5,
      createdAt: new Date(Date.now() - 2 * 24 * HOUR),
      originLevel: 2,
    });
    // 对照组：同样本周已吞 1 座，但这家没被压制（0 档，上限 2 座），应该照常发起
    await setCamps(SHANYUE.key, 20);
    const shanOwner = await siege.insertAccount(`sup-cap2-${Date.now()}`);
    await siege.insertCity({
      accountId: shanOwner,
      name: '山越范围内的主城',
      x: SHANYUE.lair.x - 5,
      y: SHANYUE.lair.y - 5,
      gov: 6,
      createdAt: new Date(Date.now() - 4 * 24 * HOUR),
    });
    await siege.insertCity({
      accountId: shanOwner,
      name: '山越范围内的分城',
      x: SHANYUE.lair.x - 6,
      y: SHANYUE.lair.y - 6,
      gov: 5,
      createdAt: new Date(Date.now() - 2 * 24 * HOUR),
      originLevel: 2,
    });
    await siege.pool.query(
      `INSERT INTO faction_sieges (faction, city_id, account_id, x, y, level, army, power, arrive_at, resolved_at, outcome, swallowed_at, week_index)
       VALUES ($1, NULL, $2, $3, $4, 5, '{}'::jsonb, 500, now(), now(), 'swallowed', now(), 0)`,
      [SHANYUE.key, siege.defenderId, SHANYUE.lair.x - 90, SHANYUE.lair.y - 90],
    );
    const before = new Set(
      ((await siege.pool.query(`SELECT id FROM faction_sieges`)).rows as Array<{ id: string }>).map((row) => row.id),
    );
    await runFactionSiegeTick(siege.pool, new Date());
    const after = (await siege.pool.query(`SELECT id, faction FROM faction_sieges`)).rows as Array<{
      id: string;
      faction: string;
    }>;
    const added = after.filter((row) => !before.has(row.id));
    assert.equal(
      added.filter((row) => row.faction === NANMAN.key).length,
      0,
      '3 档本周已吞 1 座 → 达到上限 1 座，不再发起',
    );
    assert.equal(
      added.filter((row) => row.faction === SHANYUE.key).length,
      1,
      '0 档（未被压制）本周已吞 1 座 → 上限 2 座，仍会发起',
    );
    await siege.pool.query(`DELETE FROM faction_sieges WHERE outcome = 'swallowed'`);
  });

  test('吞 NPC 城间隔按这一家的压制档取 6 / 9 / 12 / 15 小时；档位变了下一次按新间隔往后算（不补吞）', async () => {
    const lastSwallow = async (): Promise<number> => {
      const res = await flow.pool.query(`SELECT last_swallow_at FROM factions WHERE key = $1`, [NANMAN.key]);
      return (res.rows[0] as { last_swallow_at: Date }).last_swallow_at.getTime();
    };
    const setFlowCamps = async (camps: number): Promise<void> => {
      await flow.pool.query(`UPDATE faction_lairs SET camps_remaining = $2, remaining = NULL WHERE key = $1`, [
        NANMAN.key,
        camps,
      ]);
    };
    // 7 小时前吞过一次
    await flow.pool.query(`UPDATE factions SET last_swallow_at = now() - interval '7 hours' WHERE key = $1`, [NANMAN.key]);

    // 2 档（剩 10 营）= 12 小时：还没到点，不吞、也不推进时刻
    await setFlowCamps(10);
    const before2 = await lastSwallow();
    await runFactionTick(flow.pool);
    assert.equal(await lastSwallow(), before2, '2 档 12 小时内不吞');
    assert.equal((await loadFactionLairRow(flow.pool, NANMAN.key))?.camps_remaining, 10);

    // 3 档（剩 5 营）= 15 小时：7 小时前那次还没到，同样不吞
    await setFlowCamps(5);
    const before3 = await lastSwallow();
    await runFactionTick(flow.pool);
    assert.equal(await lastSwallow(), before3, '3 档 15 小时内不吞');

    // 营恢复回 20 营 = 0 档（6 小时）：7 小时前那次已经到点 → 立刻吞（档降后按新间隔往后算）
    await setFlowCamps(20);
    await runFactionTick(flow.pool);
    assert.ok((await lastSwallow()) > before3, '0 档 6 小时的间隔下，7 小时前那次已到点');

    // 3 档但已过 16 小时：到点就吞（15 小时的间隔生效，不是 6 小时）
    await setFlowCamps(5);
    await flow.pool.query(`UPDATE factions SET last_swallow_at = now() - interval '16 hours' WHERE key = $1`, [NANMAN.key]);
    const beforeLate = await lastSwallow();
    await runFactionTick(flow.pool);
    assert.ok((await lastSwallow()) > beforeLate, '3 档过了 15 小时就到点');

    // 3 档且只过了 7 小时：6 小时档虽然到点，但 3 档没到
    await flow.pool.query(`UPDATE factions SET last_swallow_at = now() - interval '7 hours' WHERE key = $1`, [NANMAN.key]);
    const before7 = await lastSwallow();
    await runFactionTick(flow.pool);
    assert.equal(await lastSwallow(), before7, '3 档 7 小时不吞');
    await flow.pool.query(`UPDATE faction_lairs SET camps_remaining = 20 WHERE key = $1`, [NANMAN.key]);
  });

  test('打掉一营跨档（升档）时发全服播报，面板的 suppression 跟着变', async () => {
    const player = await insertPlayer(flow, `sup-up-${Date.now()}`, NANMAN.lair.x + 12, NANMAN.lair.y + 12);
    await setCityArmy(flow, player.cityId, { militia: 200_000 });
    // 剩 16 营 = 0 档（已打掉 4 营）；打掉 1 营 → 15 营 = 1 档
    await flow.pool.query(
      `UPDATE faction_lairs SET camps_remaining = 16, remaining = NULL, last_battle_at = NULL WHERE key = $1`,
      [NANMAN.key],
    );
    const viewBefore = await loadFactionView(flow.pool, flow.seasonStart, new Date());
    assert.equal(viewBefore.factions.find((faction) => faction.key === NANMAN.key)?.suppression.level, 0);

    const won = await attackLair(flow, {
      accountId: player.accountId,
      cityId: player.cityId,
      troops: { militia: 200_000 },
      now: new Date(),
    });
    assert.equal(won.outcome, 'won');
    const viewAfter = await loadFactionView(flow.pool, flow.seasonStart, new Date());
    const suppression = viewAfter.factions.find((faction) => faction.key === NANMAN.key)?.suppression;
    assert.equal(won.campsRemaining, 15);
    assert.deepEqual(suppression, { level: 1, siegePercent: 75, swallowIntervalHours: 9, weeklyBranchCap: 2 });

    const broadcast = await flow.pool.query(
      `SELECT detail FROM server_broadcasts WHERE type = 'faction_suppressed' ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(broadcast.rowCount, 1, '升档播报');
    const detail = broadcast.rows[0].detail as {
      faction: { key: string };
      level: number;
      previousLevel: number;
      direction: string;
      campsRemaining: number;
    };
    assert.equal(detail.faction.key, NANMAN.key);
    assert.equal(detail.level, 1);
    assert.equal(detail.previousLevel, 0);
    assert.equal(detail.direction, 'up');
    assert.equal(detail.campsRemaining, 15);
  });

  test('营恢复导致降档时也播一次，面板的 suppression 跟着降', async () => {
    // 剩 5 营 = 已打掉 15 营 = 3 档；一天没人打恢复 1 营 → 6 营 = 2 档
    await flow.pool.query(
      `UPDATE faction_lairs SET camps_remaining = 5, remaining = NULL, last_battle_at = now() - interval '25 hours'
       WHERE key = $1`,
      [NANMAN.key],
    );
    const viewBefore = await loadFactionView(flow.pool, flow.seasonStart, new Date());
    assert.equal(viewBefore.factions.find((faction) => faction.key === NANMAN.key)?.suppression.level, 3);

    const tick = await runFactionLairTick(flow.pool, new Date());
    assert.ok(tick.recovered >= 1, '24 小时没人进攻恢复 1 营');
    const row = await loadFactionLairRow(flow.pool, NANMAN.key);
    assert.equal(row?.camps_remaining, 6, '5 → 6 营');
    const viewAfter = await loadFactionView(flow.pool, flow.seasonStart, new Date());
    assert.equal(viewAfter.factions.find((faction) => faction.key === NANMAN.key)?.suppression.level, 2, '3 档 → 2 档');

    const broadcast = await flow.pool.query(
      `SELECT detail FROM server_broadcasts WHERE type = 'faction_suppressed' AND (detail->>'direction') = 'down'
       ORDER BY id DESC LIMIT 1`,
    );
    assert.equal(broadcast.rowCount, 1, '降档播报');
    const detail = broadcast.rows[0].detail as { level: number; previousLevel: number; campsRemaining: number };
    assert.equal(detail.previousLevel, 3);
    assert.equal(detail.level, 2);
    assert.equal(detail.campsRemaining, 6);
  });

  test('势力灭亡后不再有压制：面板四项都是 0 档的值', async () => {
    await flow.pool.query(
      `UPDATE faction_lairs SET camps_remaining = 0, destroyed_at = now() WHERE key = $1`,
      [WUHUAN.key],
    );
    const view = await loadFactionView(flow.pool, flow.seasonStart, new Date());
    const wuhuan = view.factions.find((faction) => faction.key === WUHUAN.key);
    assert.equal(wuhuan?.destroyed, true);
    assert.deepEqual(wuhuan?.suppression, { level: 0, siegePercent: 100, swallowIntervalHours: 6, weeklyBranchCap: 2 });
    await flow.pool.query(`UPDATE faction_lairs SET destroyed_at = NULL, camps_remaining = 20 WHERE key = $1`, [WUHUAN.key]);
  });
});

