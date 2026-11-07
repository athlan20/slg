// 灭亡的联动（v101，AISLG-241，需 TEST_DATABASE_URL）：需求第三节逐条——
// 势力城全部变回普通 NPC 城（普通的势力城守军与库存从 1.5 倍除回 1 倍）、被吞的玩家分城保留建筑与库存、
// 在途围攻作废、未结算的 NPC 袭击去掉旗号（全服袭击频率不变）、老巢地块变废墟、
// 地图范围消失且不改归别家（其他势力的范围不因此扩大）。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { factionAt, factionOwnsTileSql, factionSnapshot } from '../common/src/faction';
import { loadFactionView } from '../common/src/faction-db';
import { loadFactionLairRow } from '../common/src/faction-lair-db';
import { npcSnapshot } from '../common/src/world';
import { attackLair, createFlowFixture, HOUR, insertPlayer, setCityArmy, WUHUAN, type FlowFixture } from './faction-lair-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('灭亡的联动（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: FlowFixture;

  before(async () => {
    fx = await createFlowFixture(dbUrl as string, 'faction_lair_destroy');
  });

  after(async () => {
    await fx?.close();
  });

  test('势力城变回普通 NPC 城、被吞分城保留建筑、围攻作废、袭击去旗号、范围不改归别家', async () => {
    const now = new Date(Date.now() - HOUR);
    const p = await insertPlayer(fx, `lair-b-${Date.now()}`, WUHUAN.lair.x - 12, WUHUAN.lair.y + 12);
    await setCityArmy(fx, p.cityId, { militia: 200_000 });

    // 一家普通的势力城（守军 / 库存 ×1.5）与一座被吞的玩家分城（建筑与库存原样、fromPlayer）
    const base = npcSnapshot(2);
    const factionCity = factionSnapshot(base, WUHUAN.key);
    await fx.pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       VALUES ($1, $2, 'plain', 'npc_city', 2, NULL, $3::jsonb)`,
      [WUHUAN.lair.x + 30, WUHUAN.lair.y + 30, JSON.stringify(factionCity)],
    );
    const swallowedStock = { gold: 777, wood: 888, food: 999, stone: 111, iron: 222 };
    const swallowed = {
      ...npcSnapshot(2),
      garrison: { militia: 40 },
      stock: swallowedStock,
      buildings: { government: 4, wall: 3 },
      faction: WUHUAN.key,
      fromPlayer: true,
    };
    await fx.pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc)
       VALUES ($1, $2, 'plain', 'npc_city', 2, NULL, $3::jsonb)`,
      [WUHUAN.lair.x + 32, WUHUAN.lair.y + 32, JSON.stringify(swallowed)],
    );
    // 在途围攻（应作废）与未结算的势力袭击（应去掉旗号）
    await fx.pool.query(
      `INSERT INTO faction_sieges (faction, city_id, account_id, x, y, level, army, power, arrive_at)
       VALUES ($1, $2, $3, $4, $5, 5, '{"militia":100}'::jsonb, 500, now() + interval '1 hour')`,
      [WUHUAN.key, p.cityId, p.accountId, WUHUAN.lair.x - 12, WUHUAN.lair.y + 12],
    );
    await fx.pool.query(
      `INSERT INTO npc_attacks (account_id, target_city_id, x, y, target, level, army, arrive_at, faction, from_x, from_y)
       VALUES ($1, $2, $3, $4, 'city', 3, '{"militia":30}'::jsonb, now() + interval '10 minutes', $5, $6, $7)`,
      [p.accountId, p.cityId, WUHUAN.lair.x - 12, WUHUAN.lair.y + 12, WUHUAN.key, WUHUAN.lair.x, WUHUAN.lair.y],
    );

    // 打掉乌桓的 20 营
    let clock = now.getTime();
    let last = null as Awaited<ReturnType<typeof attackLair>> | null;
    for (let camp = 0; camp < 20; camp += 1) {
      clock += 10 * 60 * 1000;
      last = await attackLair(fx, {
        accountId: p.accountId,
        cityId: p.cityId,
        troops: { militia: 200_000 },
        now: new Date(clock),
        key: WUHUAN.key,
        trackTroops: false,
      });
    }
    assert.equal(last?.outcome, 'destroyed');
    assert.ok((await loadFactionLairRow(fx.pool, WUHUAN.key))?.destroyed_at);

    // 势力城变回普通 NPC 城：普通的守军 / 库存除回 1 倍，被吞的玩家分城保留建筑与库存
    const plain = (await fx.pool.query(`SELECT npc FROM world_tiles WHERE x = $1 AND y = $2`, [WUHUAN.lair.x + 30, WUHUAN.lair.y + 30])).rows[0].npc;
    assert.equal(plain.faction, undefined);
    assert.equal(plain.fromPlayer, undefined);
    for (const [kind, count] of Object.entries(base.garrison)) {
      assert.equal(plain.garrison[kind as string], count, `守军除回 1 倍：${kind}`);
    }
    for (const [key, value] of Object.entries(base.stock)) {
      assert.equal(plain.stock[key as string], value, `库存除回 1 倍：${key}`);
    }
    const kept = (await fx.pool.query(`SELECT npc FROM world_tiles WHERE x = $1 AND y = $2`, [WUHUAN.lair.x + 32, WUHUAN.lair.y + 32])).rows[0].npc;
    assert.equal(kept.faction, undefined, '归属消失');
    assert.deepEqual(kept.buildings, { government: 4, wall: 3 }, '被吞的玩家分城保留建筑');
    assert.deepEqual(kept.stock, swallowedStock, '被吞的玩家分城保留库存');

    // 在途围攻作废、未结算的袭击去掉旗号（全服袭击频率不变，只是没有旗号）
    const siege = (await fx.pool.query(`SELECT resolved_at, outcome FROM faction_sieges WHERE faction = $1`, [WUHUAN.key])).rows[0];
    assert.ok(siege.resolved_at);
    assert.equal(siege.outcome, 'cancelled');
    const attackRow = (await fx.pool.query(`SELECT faction, from_x, from_y FROM npc_attacks WHERE target_city_id = $1`, [p.cityId])).rows[0];
    assert.equal(attackRow.faction, null);
    assert.equal(attackRow.from_x, null);
    assert.equal(attackRow.from_y, null);

    // 范围消失：最近的是灭亡势力时归无主（不改归第二近的一家），别家的「可吞」条件对它为假
    const x = 730;
    const y = 300;
    const radius = 250;
    const distWuhuan = Math.max(Math.abs(WUHUAN.lair.x - x), Math.abs(WUHUAN.lair.y - y));
    assert.ok(distWuhuan <= radius, '测试点应在乌桓范围内');
    assert.equal(factionAt(x, y, radius), WUHUAN.key, '灭亡前归乌桓');
    assert.equal(factionAt(x, y, radius, (key) => key === WUHUAN.key), null, '灭亡后不归任何一家');
    const owns = (await fx.pool.query(`SELECT (${factionOwnsTileSql('heishan', '$1', '$2')}) AS owns`, [x, y])).rows[0].owns as boolean;
    assert.equal(owns, false, '原属灭亡势力的格不得改归别家');

    // 被灭亡的势力不再持城、不再有范围（面板数据与地图图层都用它）
    const view = await loadFactionView(fx.pool, fx.seasonStart, new Date());
    const viewOf = view.factions.find((faction) => faction.key === WUHUAN.key);
    assert.equal(viewOf?.destroyed, true);
    assert.equal(viewOf?.cityCount, 0);
  });
});
