// 每营战力每天刷新（v101，AISLG-241，需 TEST_DATABASE_URL）：全服战力前 10 名合计 ÷ 15，
// 全服战力要算城内 + 野地驻军 + 行军中 + 协防；每天一次、只升不降、最低 10,000；
// 开季全服没有部队时就是下限 10,000。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { TROOP_POWER } from '../common/src/battle';
import { FACTION_LAIR_TOP_PLAYERS, factionLairCampPower } from '../common/src/faction-lair';
import {
  loadFactionLairRow,
  refreshFactionLairPower,
  serverTopPowerTotal,
} from '../common/src/faction-lair-db';
import { FACTIONS } from '../common/src/faction';
import { createFlowFixture, HOUR, type FlowFixture } from './faction-lair-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('每营战力每天刷新（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: FlowFixture;

  before(async () => {
    fx = await createFlowFixture(dbUrl as string, 'faction_lair_power');
  });

  after(async () => {
    await fx?.close();
  });

  /** 在事务里跑一次刷新（Worker 的定时器也是单独一个事务） */
  async function refresh(now: Date): Promise<{ refreshed: number; power: number }> {
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

  test('全服前 10 名合计 ÷ 15（城内 + 野地 + 行军 + 协防），每天一次、只升不降、最低 10,000', async () => {
    // 开季全是下限 10,000（全服没有部队）
    assert.equal(FACTION_LAIR_TOP_PLAYERS, 10);
    assert.equal((await loadFactionLairRow(fx.pool, FACTIONS[0].key))?.camp_power, 10_000);

    const mk = async (name: string): Promise<{ accountId: string; cityId: string }> => {
      const acc = await fx.pool.query(`INSERT INTO accounts (username, password_hash) VALUES ($1, 'x') RETURNING id`, [name]);
      const accountId = acc.rows[0].id as string;
      const city = await fx.pool.query(
        `INSERT INTO cities (account_id, name, gold, wood, food, stone, iron) VALUES ($1, $2, 0, 0, 0, 0, 0) RETURNING id`,
        [accountId, name],
      );
      return { accountId, cityId: city.rows[0].id as string };
    };
    const a = await mk(`power-a-${Date.now()}`);
    const b = await mk(`power-b-${Date.now()}`);

    // 城内 10,000 义兵（城内驻军）
    await fx.pool.query(`INSERT INTO city_army (city_id, troop, count) VALUES ($1, 'militia', 10000)`, [a.cityId]);
    // 野地驻军（经 world_tiles.owner_city_id 归到 a 的城）：1,000 骑兵
    await fx.pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES (10, 10, 'plain', 'wilderness', 1, $1, NULL)`,
      [a.cityId],
    );
    await fx.pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES (10, 10, 'cavalry', 1000)`);
    // 行军中的部队（b）：5,000 弓箭兵
    await fx.pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
       VALUES ($1, $2, 20, 20, '{"archer":5000}'::jsonb, 'plunder', 'marching', 'player', now() + interval '1 hour')`,
      [b.accountId, b.cityId],
    );
    // 协防部队（b 派到 a 的城）：2,000 刀盾
    await fx.pool.query(
      `INSERT INTO city_assist (city_id, account_id, from_city_id, troops, initiator) VALUES ($1, $2, $3, '{"swordsman":2000}'::jsonb, 'player')`,
      [a.cityId, b.accountId, b.cityId],
    );

    const expectedA = 10000 * TROOP_POWER.militia + 1000 * TROOP_POWER.cavalry;
    const expectedB = 5000 * TROOP_POWER.archer + 2000 * TROOP_POWER.swordsman;
    assert.equal(await serverTopPowerTotal(fx.pool), expectedA + expectedB, '城内 + 野地 + 行军 + 协防都算');
    assert.equal((await loadFactionLairRow(fx.pool, FACTIONS[0].key))?.camp_power, 10_000, '刷新前是开季下限');

    const now = new Date();
    const first = await refresh(now);
    assert.equal(first.refreshed, 5, '五家一起刷新');
    const expectedPower = factionLairCampPower(expectedA + expectedB);
    assert.equal(first.power, expectedPower);
    assert.equal((await loadFactionLairRow(fx.pool, FACTIONS[0].key))?.camp_power, expectedPower);

    // 不到一天再跑：不重算
    assert.equal((await refresh(new Date(now.getTime() + HOUR))).refreshed, 0);

    // 第二天：部队变多 → 每营战力上升（只升不降的反面）
    await fx.pool.query(`UPDATE city_army SET count = 90000 WHERE city_id = $1 AND troop = 'militia'`, [a.cityId]);
    const bigger = await serverTopPowerTotal(fx.pool);
    const nextDay = new Date(now.getTime() + 25 * HOUR);
    assert.equal((await refresh(nextDay)).refreshed, 5);
    assert.equal((await loadFactionLairRow(fx.pool, FACTIONS[0].key))?.camp_power, factionLairCampPower(bigger));
    assert.ok(factionLairCampPower(bigger) > expectedPower);

    // 部队打光：下一刷新日仍是旧值（只升不降），全服没有部队时也不低于下限
    await fx.pool.query(`DELETE FROM city_army`);
    await fx.pool.query(`DELETE FROM tile_army`);
    await fx.pool.query(`DELETE FROM marches`);
    await fx.pool.query(`DELETE FROM city_assist`);
    assert.equal(await serverTopPowerTotal(fx.pool), 0);
    assert.equal(factionLairCampPower(0), 10_000);
    await refresh(new Date(nextDay.getTime() + 25 * HOUR));
    assert.equal((await loadFactionLairRow(fx.pool, FACTIONS[0].key))?.camp_power, factionLairCampPower(bigger));
  });
});
