// 城被势力吞下（v100，AISLG-240）：连赢 6 次、跨约 30 小时城防归零后，按需求第三节逐项处理。
// 覆盖：建筑与等级留在城里、剩余资源变成可掠夺库存、队列作废不退资源、城守卸任、名下野地变无主 +
// 望楼毁掉 + 驻军回主城、在外部队改从主城返程、协防部队返回各自的城、指向这座城的 NPC 袭击作废、
// 分城名额腾出 + 失城事件 + 全服播报、不写放弃冷却（原主人打回来不受限）、任何玩家都能按占 NPC 城的
// 流程打下来。需要 TEST_DATABASE_URL（临时库），否则跳过。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { EventType } from '../common/src/protocol';
import { factionSiegeArmy, factionSiegePower } from '../common/src/faction-siege';
import { armyPower } from '../common/src/battle';
import { checkOccupyNpcCity } from '../common/src/branch-city';
import { loadDiscardCooldownActive } from '../common/src/branch-city-db';
import { factionCityCounts } from '../common/src/faction-db';
import type { NpcCitySnapshot } from '../common/src/world';
import { createSiegeFixture, HOUR, NANMAN, type SiegeFixture } from './faction-siege-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('城被势力吞下（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: SiegeFixture;

  before(async () => {
    fx = await createSiegeFixture(dbUrl as string, 'siege_swallow');
  });

  after(async () => {
    await fx?.close();
  });

  test('连赢 6 次、跨 30 小时城防归零：城被吞后按需求第三节逐项处理', async () => {
    const target = await fx.insertCity({
      accountId: fx.defenderId,
      name: '待吞分城',
      x: NANMAN.lair.x + 8,
      y: NANMAN.lair.y + 8,
      gov: 5,
      wall: 5,
      createdAt: new Date(Date.now() - 6 * HOUR),
      originLevel: 2,
    });
    // 城内驻军（每次都会被围城军全灭）、排队中的建造 / 征兵、城防器械、名下野地与望楼
    await fx.setGarrison(target, { militia: 10 });
    await fx.pool.query(
      `INSERT INTO builds (account_id, city_id, kind, status, level, initiator) VALUES ($1, $2, 'farm', 'building', 2, 'player')`,
      [fx.defenderId, target],
    );
    await fx.pool.query(
      `INSERT INTO recruits (account_id, city_id, troop, count, status, initiator) VALUES ($1, $2, 'militia', 5, 'recruiting', 'player')`,
      [fx.defenderId, target],
    );
    await fx.pool.query(`INSERT INTO city_defenses (city_id, kind, count) VALUES ($1, 'trap', 10)`, [target]);
    await fx.pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', 2, $3, NULL)`,
      [NANMAN.lair.x + 9, NANMAN.lair.y + 9, target],
    );
    await fx.pool.query(`INSERT INTO tile_army (x, y, troop, count) VALUES ($1, $2, 'militia', 7)`, [NANMAN.lair.x + 9, NANMAN.lair.y + 9]);
    await fx.pool.query(
      `INSERT INTO wilderness_facilities (x, y, kind, level, city_id) VALUES ($1, $2, 'watchtower', 1, $3)`,
      [NANMAN.lair.x + 9, NANMAN.lair.y + 9, target],
    );
    // 该城发出的一支在外部队（应改从主城返程）
    const marchId = (
      await fx.pool.query(
        `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at)
         VALUES ($1, $2, $3, $4, '{"militia":3}'::jsonb, 'plunder', 'marching', 'player', now() + interval '1 hour') RETURNING id`,
        [fx.defenderId, target, NANMAN.lair.x + 20, NANMAN.lair.y + 20],
      )
    ).rows[0].id as string;
    // 指向这座城的运输（城池行消失后按现有失效路径返回）
    await fx.pool.query(
      `INSERT INTO marches (account_id, from_city_id, x, y, troops, purpose, status, initiator, arrive_at, cargo)
       VALUES ($1, $2, $3, $4, '{"porter":2}'::jsonb, 'transport', 'marching', 'player', now() + interval '1 hour', '{"gold":100}'::jsonb)`,
      [fx.defenderId, fx.defenderMainId, NANMAN.lair.x + 8, NANMAN.lair.y + 8],
    );
    // 针对这座城的 NPC 袭击（应作废）
    await fx.pool.query(
      `INSERT INTO npc_attacks (account_id, target_city_id, x, y, target, level, army, arrive_at)
       VALUES ($1, $2, $3, $4, 'city', 3, '{"militia":30}'::jsonb, now() + interval '10 minutes')`,
      [fx.defenderId, target, NANMAN.lair.x + 8, NANMAN.lair.y + 8],
    );
    // 协防部队（别的玩家驻扎进来）
    const helperId = await fx.insertAccount(`helper-${Date.now()}`);
    const helperCity = await fx.insertCity({
      accountId: helperId,
      name: '协防方的城',
      x: NANMAN.lair.x + 30,
      y: NANMAN.lair.y + 30,
      gov: 5,
      createdAt: new Date(Date.now() - 4 * 24 * HOUR),
    });
    await fx.pool.query(
      `INSERT INTO city_assist (city_id, account_id, from_city_id, troops, initiator) VALUES ($1, $2, $3, '{"militia":5}'::jsonb, 'player')`,
      [target, helperId, helperCity],
    );

    // 这座城派到别处协防的部队：城没了也要继续驻防，出发城改成主城
    const outbound = (
      await fx.pool.query(
        `INSERT INTO city_assist (city_id, account_id, from_city_id, troops, initiator)
         VALUES ($1, $2, $3, '{"militia":4}'::jsonb, 'player') RETURNING id`,
        [helperCity, fx.defenderId, target],
      )
    ).rows[0].id as string;
    // 挂单里托管的 300 铁：删城时挂单会级联消失，余量要并进库存
    await fx.pool.query(
      `INSERT INTO market_orders (account_id, city_id, sell_resource, buy_resource, total, remaining, unit_price, expires_at)
       VALUES ($1, $2, 'iron', 'gold', 500, 300, 1, now() + interval '1 day')`,
      [fx.defenderId, target],
    );

    // 连续 6 次（每次间隔 6 小时），守军 0：围城军必胜
    const outcomes: string[] = [];
    for (let i = 0; i < 6; i += 1) {
      await fx.setGarrison(target, {});
      const siegeId = await fx.insertSiegeRow({
        cityId: target,
        accountId: fx.defenderId,
        x: NANMAN.lair.x + 8,
        y: NANMAN.lair.y + 8,
        level: 5,
      });
      outcomes.push(await fx.resolveSiege(siegeId, new Date(Date.now() + i * 6 * HOUR)));
    }
    assert.deepEqual(outcomes.slice(0, 5), ['hit', 'hit', 'hit', 'hit', 'hit']);
    assert.equal(outcomes[5], 'swallowed', '第 6 次城防归零、城被吞');

    // ---- 需求第三节逐项 ----
    const cityGone = await fx.pool.query(`SELECT 1 FROM cities WHERE id = $1`, [target]);
    assert.equal(cityGone.rowCount, 0, '城池行删除（分城名额腾出）');
    const tile = await fx.pool.query(`SELECT kind, level, owner_city_id, npc FROM world_tiles WHERE x = $1 AND y = $2`, [
      NANMAN.lair.x + 8,
      NANMAN.lair.y + 8,
    ]);
    const tileRow = tile.rows[0] as { kind: string; level: number; owner_city_id: string | null; npc: NpcCitySnapshot };
    assert.equal(tileRow.kind, 'npc_city', '地块变成归属该势力的 NPC 城');
    assert.equal(tileRow.owner_city_id, null);
    assert.equal(tileRow.level, 2, '等级回到这座分城的来源等级（占城门槛用）');
    assert.equal(tileRow.npc.faction, NANMAN.key, '快照带势力归属');
    assert.deepEqual(tileRow.npc.buildings, { government: 5, wall: 5 }, '建筑和等级留在城里');
    assert.equal(tileRow.npc.stock.gold, 1000, '剩余资源变成可掠夺库存');
    assert.equal(tileRow.npc.stock.iron, 5300, '挂单托管的资源并进库存');
    const siegeArmy = factionSiegeArmy(factionSiegePower(5, 100));
    assert.deepEqual(tileRow.npc.garrison, siegeArmy, '守军 = 围城军编成（不再乘 1.5）');
    assert.equal(armyPower(tileRow.npc.garrison), armyPower(siegeArmy), '守军战力 = 围城军战力');
    assert.ok((await factionCityCounts(fx.pool))[NANMAN.key] >= 1, '势力持城数把被吞的城算进去');

    const builds = await fx.pool.query(`SELECT 1 FROM builds WHERE city_id = $1`, [target]);
    assert.equal(builds.rowCount, 0, '排队中的建造作废');
    const recruits = await fx.pool.query(`SELECT 1 FROM recruits WHERE city_id = $1`, [target]);
    assert.equal(recruits.rowCount, 0, '征兵作废');
    const fac = await fx.pool.query(`SELECT 1 FROM wilderness_facilities WHERE city_id = $1`, [target]);
    assert.equal(fac.rowCount, 0, '望楼毁掉');
    const wild = await fx.pool.query(`SELECT owner_city_id FROM world_tiles WHERE x = $1 AND y = $2`, [NANMAN.lair.x + 9, NANMAN.lair.y + 9]);
    assert.equal(wild.rows[0].owner_city_id, null, '名下野地变无主');
    const wildArmy = await fx.pool.query(`SELECT 1 FROM tile_army WHERE x = $1 AND y = $2`, [NANMAN.lair.x + 9, NANMAN.lair.y + 9]);
    assert.equal(wildArmy.rowCount, 0, '野地驻军撤回主城');
    const mainArmy = (await fx.pool.query(`SELECT troop, count FROM city_army WHERE city_id = $1`, [fx.defenderMainId])).rows as Array<{
      troop: string;
      count: number;
    }>;
    assert.ok(mainArmy.some((row) => row.troop === 'militia' && row.count >= 7), '野地驻军回到原主人主城');
    const march = await fx.pool.query(`SELECT from_city_id FROM marches WHERE id = $1`, [marchId]);
    assert.equal(march.rows[0].from_city_id, fx.defenderMainId, '在外部队改从原主人主城返程');
    const assist = await fx.pool.query(`SELECT 1 FROM city_assist WHERE city_id = $1`, [target]);
    assert.equal(assist.rowCount, 0, '协防部队返回各自的城');
    const kept = await fx.pool.query(`SELECT from_city_id, troops FROM city_assist WHERE id = $1`, [outbound]);
    assert.equal(kept.rowCount, 1, '派去别处协防的部队还在');
    assert.equal(kept.rows[0].from_city_id, fx.defenderMainId, '出发城改成主城');
    const attacks = await fx.pool.query(`SELECT resolved_at FROM npc_attacks WHERE target_city_id = $1`, [target]);
    for (const row of attacks.rows as Array<{ resolved_at: Date | null }>) {
      assert.ok(row.resolved_at, '针对这座城的 NPC 袭击作废');
    }

    // 事件与播报
    const lost = await fx.pool.query(`SELECT detail FROM events WHERE type = $1 AND account_id = $2`, [
      EventType.FACTION_CITY_LOST,
      fx.defenderId,
    ]);
    assert.equal(lost.rowCount, 1, '原主人收到失城事件');
    const lostDetail = lost.rows[0].detail as { faction: { name: string }; cityName: string };
    assert.equal(lostDetail.faction.name, '南蛮');
    assert.equal(lostDetail.cityName, '待吞分城');
    const broadcast = await fx.pool.query(`SELECT detail FROM server_broadcasts WHERE type = 'faction_city_swallowed'`);
    assert.equal(broadcast.rowCount, 1, '全服播报一条');
    assert.equal((broadcast.rows[0].detail as { factionName: string }).factionName, '南蛮');

    // 不写放弃冷却：原主人打回来不受限制，其他玩家也能按占 NPC 城的流程打下来
    assert.equal(await loadDiscardCooldownActive(fx.pool, fx.defenderId, NANMAN.lair.x + 8, NANMAN.lair.y + 8), false);
    const otherId = await fx.insertAccount(`other-${Date.now()}`);
    await fx.insertCity({
      accountId: otherId,
      name: '另一个玩家的主城',
      x: NANMAN.lair.x + 16,
      y: NANMAN.lair.y + 16,
      gov: 6,
      createdAt: new Date(Date.now() - 5 * 24 * HOUR),
    });
    for (const accountId of [fx.defenderId, otherId]) {
      const eligibility = await fx.pool.query(
        `SELECT count(*)::int AS n FROM cities WHERE account_id = $1 AND id <> $2`,
        [accountId, fx.defenderMainId],
      );
      assert.equal(
        checkOccupyNpcCity({
          mainGovernment: 6,
          fromGovernment: 6,
          branchCount: eligibility.rows[0].n as number,
          targetLevel: tileRow.level,
          discardCooldown: await loadDiscardCooldownActive(fx.pool, accountId, NANMAN.lair.x + 8, NANMAN.lair.y + 8),
        }),
        null,
        `账号 ${accountId} 可以立刻占下这座城（名额、门槛、冷却都放行）`,
      );
    }
  });
});
