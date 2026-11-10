// 老巢的战力锚点每天刷新（v106，AISLG-247，需 TEST_DATABASE_URL）：R10 / R3 = 全服战力第 10 / 第 3 名
// 账号的单人战力（口径同 v101：城内 + 野地驻军 + 行军中 + 协防），G1 = max(10,000, R10 × 0.35)、
// G20 = max(G1, R3 × 0.35)；每天一次、两个锚点各自只升不降、最低 10,000；当前营的残血按新旧 Gk 比例缩放；
// 旧库（v101 的单一 camp_power）迁移后行为不变（G1 = G20 = camp_power），迁移可重复执行。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { TROOP_POWER } from '../common/src/battle';
import {
  FACTION_LAIR_CAMPS,
  factionLairAnchorPower,
  factionLairCampPowerAt,
  factionLairCurrentCampPower,
  factionLairGarrison,
  factionLairRemainingPercent,
} from '../common/src/faction-lair';
import { FACTION_LAIR_SCHEMA_SQL } from '../common/src/faction-lair-schema';
import { loadFactionLairRow, refreshFactionLairPower } from '../common/src/faction-lair-db';
import { serverAnchorPowers, serverPowerRank } from '../common/src/faction-lair-rank-db';
import { FACTIONS } from '../common/src/faction';
import { createFlowFixture, HOUR, type FlowFixture } from './faction-lair-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;
const KEY = FACTIONS[0].key;
const MIN = 10_000;

describe('老巢的战力锚点每天刷新（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: FlowFixture;

  before(async () => {
    fx = await createFlowFixture(dbUrl as string, 'faction_lair_power');
  });

  after(async () => {
    await fx?.close();
  });

  /** 在事务里跑一次刷新（Worker 的定时器也是单独一个事务） */
  async function refresh(now: Date): Promise<{ refreshed: number; g1: number; g20: number }> {
    const client = await fx.pool.connect();
    try {
      await client.query('BEGIN');
      const res = await refreshFactionLairPower(client, now);
      await client.query('COMMIT');
      return res;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
  }

  async function row(): Promise<{ g1: number; g20: number; campPower: number; campsRemaining: number }> {
    const lair = await loadFactionLairRow(fx.pool, KEY);
    assert.ok(lair);
    return {
      g1: lair.camp_power_g1,
      g20: lair.camp_power_g20,
      campPower: factionLairCurrentCampPower(lair),
      campsRemaining: lair.camps_remaining,
    };
  }

  test('排名战力取第 3 / 第 10 名的单人战力；不足 10 人取最后一名；全服无兵为 0', async () => {
    // 开季：全服没有部队
    assert.equal(await serverPowerRank(fx.pool, 10), 0);
    assert.equal((await row()).g1, MIN, '刷新前是开季下限');
    assert.equal((await row()).g20, MIN);

    // 12 个账号，战力从高到低（militia 每人 200 参考战力：城内驻军 + 野地驻军 + 行军 + 协防都要算）
    const mk = async (name: string): Promise<{ accountId: string; cityId: string }> => {
      const acc = await fx.pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name]);
      const accountId = acc.rows[0].id as string;
      const city = await fx.pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron) VALUES ($1, $2, 0, 0, 0, 0, 0) RETURNING id`,
        [accountId, name],
      );
      return { accountId, cityId: city.rows[0].id as string };
    };
    const stamp = Date.now();
    const players: Array<{ accountId: string; cityId: string; power: number }> = [];
    for (let index = 0; index < 12; index += 1) {
      const player = await mk(`power-${index}-${stamp}`);
      const power = (12 - index) * 100_000 * TROOP_POWER.militia;
      await fx.pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', $2)`, [
        player.cityId,
        100_000 * (12 - index),
      ]);
      players.push({ ...player, power });
    }
    // 口径覆盖：第 2 名的兵分四份（城内 1,000,000 / 野地 50,000 / 行军 40,000 / 协防 10,000 = 1,100,000 义兵），
    // 战力仍是 2,200,000
    const second = players[1];
    await fx.pool.query(`UPDATE city_army SET count = 1000000 WHERE city_id = $1`, [second.cityId]);
    await fx.pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (10, 10, 'plain', 'wilderness', 1, $1, NULL)`,
      [second.cityId],
    );
    await fx.pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES (10, 10, 'militia', 50000)`);
    await fx.pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, 20, 20, '{"militia":40000}'::jsonb, 'plunder', 'marching', 'player', now() + interval '1 hour')`,
      [second.accountId, second.cityId],
    );
    await fx.pool.query(
      `INSERT INTO city_assist (city_id, account_id, from_city_id, troops, initiator) VALUES ($1, $2, $3, '{"militia":10000}'::jsonb, 'player')`,
      [second.cityId, second.accountId, second.cityId],
    );

    const powers = players.map((player) => player.power).sort((a, b) => b - a);
    assert.equal(await serverPowerRank(fx.pool, 1), powers[0], '第 1 名');
    assert.equal(await serverPowerRank(fx.pool, 3), powers[2], '第 3 名（锚点 G20 用）');
    assert.equal(await serverPowerRank(fx.pool, 10), powers[9], '第 10 名（锚点 G1 用）');
    assert.equal(await serverPowerRank(fx.pool, 12), powers[11], '正好第 12 名');
    assert.equal(await serverPowerRank(fx.pool, 50), powers[11], '不足 50 人时取最后一名');
    assert.equal(players[1].power, powers[1], '城内 + 野地 + 行军 + 协防都算一个人的战力');

    // 第一次刷新：G1 按第 10 名、G20 按第 3 名
    const now = new Date();
    const first = await refresh(now);
    assert.equal(first.refreshed, 5, '五家一起刷新');
    const expected = factionLairAnchorPower(powers[9], powers[2]);
    assert.equal(first.g1, expected.g1);
    assert.equal(first.g20, expected.g20);
    assert.ok(expected.g20 > expected.g1, '两个锚点之间是梯度');
    const after_first = await row();
    assert.equal(after_first.g1, expected.g1);
    assert.equal(after_first.g20, expected.g20);
    assert.equal(after_first.campPower, expected.g1, '20 营全在时当前营是第 1 营（= G1）');

    // 不到一天再跑：不重算
    assert.equal((await refresh(new Date(now.getTime() + HOUR))).refreshed, 0);

    // 榜单上涨 → 次日刷新后两个锚点都变大
    await fx.pool.query(`UPDATE city_army SET count = count * 2 WHERE troop = 'militia'`);
    const grown = await serverPowerRank(fx.pool, 10);
    const grownTop = await serverPowerRank(fx.pool, 3);
    const nextDay = new Date(now.getTime() + 25 * HOUR);
    assert.equal((await refresh(nextDay)).refreshed, 5);
    const after_second = await row();
    assert.ok(after_second.g1 > after_first.g1, 'G1 跟着榜单涨');
    assert.ok(after_second.g20 > after_first.g20, 'G20 跟着榜单涨');
    assert.equal(after_second.g1, Math.max(expected.g1, factionLairAnchorPower(grown, grownTop).g1));
    assert.equal(after_second.g20, Math.max(expected.g20, factionLairAnchorPower(grown, grownTop).g20));

    // 部队打光 → 再刷新仍是旧值（只升不降），全服无兵时也不低于下限
    await fx.pool.query(`DELETE FROM city_army`);
    await fx.pool.query(`DELETE FROM tile_army`);
    await fx.pool.query(`DELETE FROM marches`);
    await fx.pool.query(`DELETE FROM city_assist`);
    assert.equal(await serverPowerRank(fx.pool, 10), 0);
    assert.deepEqual(factionLairAnchorPower(0, 0), { g1: MIN, g20: MIN });
    await refresh(new Date(nextDay.getTime() + 25 * HOUR));
    const after_empty = await row();
    assert.equal(after_empty.g1, after_second.g1, '榜单掉下去老巢不降');
    assert.equal(after_empty.g20, after_second.g20);

    // 当前营往后走（只剩 1 营）→ 当前营战力变成 G20；中间按等比递增
    await fx.pool.query(`UPDATE faction_lairs SET camps_remaining = 1 WHERE key = $1`, [KEY]);
    assert.equal((await row()).campPower, after_empty.g20);
    await fx.pool.query(`UPDATE faction_lairs SET camps_remaining = 10 WHERE key = $1`, [KEY]);
    assert.equal((await row()).campPower, factionLairCampPowerAt(after_empty.g1, after_empty.g20, 11));
  });

  test('刷新后当前营的残血按新旧 Gk 比例缩放，不会白送一营', async () => {
    const before = await row();
    // 当前营（第 11 营）打到半血
    const full = factionLairGarrison(before.campPower);
    const half = Object.fromEntries(Object.entries(full).map(([kind, count]) => [kind, Math.floor((count as number) / 2)]));
    await fx.pool.query(`UPDATE faction_lairs SET remaining = $2::jsonb WHERE key = $1`, [KEY, JSON.stringify(half)]);
    const percentBefore = factionLairRemainingPercent(half, before.campPower);
    assert.ok(percentBefore > 45 && percentBefore < 55, `半血 = ${percentBefore}`);

    // 造一支大部队让锚点涨上去，再刷新
    const acc = await fx.pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [
      `rescale-${Date.now()}`,
    ]);
    const city = await fx.pool.query(
      `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron) VALUES ($1, 'rescale', 0, 0, 0, 0, 0) RETURNING id`,
      [acc.rows[0].id],
    );
    await fx.pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 5000000)`, [city.rows[0].id]);
    // 上一轮 power_at 在 now + 50h，等满一个刷新间隔再刷
    await refresh(new Date(Date.now() + 80 * HOUR));

    const after = await row();
    assert.ok(after.g1 > before.g1, '锚点涨上去了');
    assert.equal(after.campsRemaining, 10, '残血缩放不动营数（不白送一营）');
    const remaining = (await loadFactionLairRow(fx.pool, KEY))?.remaining;
    assert.ok(remaining, '残血还在');
    const percentAfter = factionLairRemainingPercent(remaining, after.campPower);
    assert.ok(Math.abs(percentAfter - percentBefore) <= 1, `残血比例保持（${percentBefore} → ${percentAfter}）`);
  });

  test('迁移向后兼容、可重复执行：旧行用旧 camp_power 回填 G1 = G20', async () => {
    await fx.pool.query(`UPDATE faction_lairs SET camp_power = 90000000 WHERE key = $1`, [KEY]);
    // 模拟 v101 的旧表：只有 camp_power，没有两个锚点列
    await fx.pool.query(`ALTER TABLE faction_lairs DROP COLUMN camp_power_g1`);
    await fx.pool.query(`ALTER TABLE faction_lairs DROP COLUMN camp_power_g20`);
    for (let time = 0; time < 2; time += 1) {
      // 跑第二遍确认幂等（ALTER ... IF NOT EXISTS + 回填）
      await fx.pool.query(FACTION_LAIR_SCHEMA_SQL);
      const lair = await loadFactionLairRow(fx.pool, KEY);
      assert.equal(lair?.camp_power_g1, 90_000_000, '旧行的 G1 = 旧 camp_power');
      assert.equal(lair?.camp_power_g20, 90_000_000, '旧行的 G20 = 旧 camp_power');
    }
    // 旧库行为：两个锚点相同 → 20 营同一强度（与升级前一致）
    for (let campNo = 1; campNo <= FACTION_LAIR_CAMPS; campNo += 1) {
      assert.equal(factionLairCampPowerAt(90_000_000, 90_000_000, campNo), 90_000_000);
    }
    // 回填后 power_at 置空，Worker 下一轮立刻刷新；旧的 23.8 万级平坦强度不被“只升不降”锁住，
    // 第一次刷新直接换成新锚点（一次性下调），之后才各自只升不降
    assert.equal((await loadFactionLairRow(fx.pool, KEY))?.power_at, null, '回填的旧行等着立刻刷新');
    const now = new Date();
    const anchors = await serverAnchorPowers(fx.pool);
    const expected = factionLairAnchorPower(anchors.r10, anchors.r3);
    assert.ok(expected.g20 < 90_000_000, '测试前提：新锚点低于旧的平坦强度');
    const refreshed = await refresh(now);
    assert.equal(refreshed.refreshed >= 1, true);
    const after = await row();
    assert.equal(after.g1, expected.g1, '旧行第一次刷新换成新的 G1');
    assert.equal(after.g20, expected.g20, '旧行第一次刷新换成新的 G20');
    // 新行用默认值（下限 10,000）补齐
    const nexKey = FACTIONS[4].key;
    await fx.pool.query(`DELETE FROM faction_lairs WHERE key = $1`, [nexKey]);
    await fx.pool.query(`INSERT INTO faction_lairs (key) VALUES ($1)`, [nexKey]);
    const fresh = await loadFactionLairRow(fx.pool, nexKey);
    assert.equal(fresh?.camp_power_g1, MIN);
    assert.equal(fresh?.camp_power_g20, MIN);
  });
});
