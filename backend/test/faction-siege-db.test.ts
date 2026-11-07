// 势力出兵的节奏与结算（v100，AISLG-240）：袭击打旗号、第 8 天起发起围攻、只围分城、
// 一次只围一座、预警提前 60 分钟、打赢扣 35 城防 + 4 小时免战、打输 24 小时内不再打同一座城、
// 同城 6 小时最多打一次、每周上限 2 座、目标失效作废。需要 TEST_DATABASE_URL（临时库），否则跳过。
// 吞城的第三节清理见 faction-siege-swallow.test.ts；纯规则见 faction-siege.test.ts。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { EventType } from '../common/src/protocol';
import { setFactionEnabledCache } from '../common/src/faction-config';
import { FACTION_SIEGE_WEEKLY_CAP, factionSiegeLossCooldownMs } from '../common/src/faction-siege';
import { DURABILITY_DAMAGE_PER_WIN, DURABILITY_MAX, PVP_CITY_TRUCE_MS } from '../common/src/protection';
import { countWeekSwallows, hasActiveSiege, pickSiegeTarget } from '../common/src/faction-siege-db';
import { createNpcAttack } from '../worker/src/npc-attack';
import { runFactionSiegeTick } from '../worker/src/faction-siege-tick';
import { FACTIONS } from '../common/src/faction';
import { createSiegeFixture, HOUR, NANMAN, type SiegeFixture } from './faction-siege-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('势力围攻的节奏与结算（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: SiegeFixture;

  before(async () => {
    fx = await createSiegeFixture(dbUrl as string, 'siege_tempo');
    // 南蛮范围内的一块野地（袭击打旗号用）
    await fx.pool.query(
      `INSERT INTO world_tiles (x, y, terrain, kind, level, owner_city_id, npc) VALUES ($1, $2, 'plain', 'wilderness', 1, $3, NULL)`,
      [NANMAN.lair.x + 4, NANMAN.lair.y + 4, fx.defenderMainId],
    );
  });

  after(async () => {
    await fx?.close();
  });

  test('开关关闭：不发起围攻、袭击也不带旗号（与上线前一致）', async () => {
    setFactionEnabledCache(false);
    const tick = await runFactionSiegeTick(fx.pool);
    assert.equal(tick.started, 0);
    assert.equal(tick.resolved, 0);
    const rows = await fx.pool.query(`SELECT count(*)::int AS n FROM faction_sieges`);
    assert.equal(rows.rows[0].n, 0);
    for (let i = 0; i < 6; i += 1) {
      await createNpcAttack(fx.pool);
    }
    const attacks = await fx.pool.query(`SELECT faction FROM npc_attacks`);
    for (const row of attacks.rows as Array<{ faction: string | null }>) {
      assert.equal(row.faction, null, '开关关闭时不打旗号');
    }
  });

  test('开关打开：势力范围内的袭击打上旗号（npc_attacks 记势力与出发老巢，预警事件带势力名）', async () => {
    setFactionEnabledCache(true);
    const before = (await fx.pool.query(`SELECT count(*)::int AS n FROM npc_attacks WHERE faction IS NOT NULL`)).rows[0].n as number;
    // 只走野地分支（20% 主城分支不进），保证目标是南蛮范围内的那块野地
    const originalRandom = Math.random;
    Math.random = () => 0.9;
    try {
      await createNpcAttack(fx.pool);
    } finally {
      Math.random = originalRandom;
    }
    const after = (await fx.pool.query(`SELECT count(*)::int AS n FROM npc_attacks WHERE faction IS NOT NULL`)).rows[0].n as number;
    assert.equal(after, before + 1, '发起频率不变（仍然是一次袭击），只是打上了旗号');
    const row = (
      await fx.pool.query(`SELECT faction, from_x, from_y FROM npc_attacks WHERE faction = $1 ORDER BY arrive_at DESC LIMIT 1`, [NANMAN.key])
    ).rows[0] as { faction: string; from_x: number; from_y: number } | undefined;
    assert.equal(row?.faction, NANMAN.key);
    assert.equal(row?.from_x, NANMAN.lair.x, '记下出发老巢');
    assert.equal(row?.from_y, NANMAN.lair.y);
    const events = await fx.pool.query(
      `SELECT detail FROM events WHERE type = $1 AND account_id = $2 ORDER BY id DESC LIMIT 1`,
      [EventType.NPC_ATTACK_WARNING, fx.defenderId],
    );
    const detail = events.rows[0].detail as { faction: { key: string; name: string }; lair: { x: number; y: number } };
    assert.equal(detail.faction.key, NANMAN.key);
    assert.equal(detail.faction.name, '南蛮', '预警文案里能写出「南蛮来袭」');
    assert.deepEqual(detail.lair, { x: NANMAN.lair.x, y: NANMAN.lair.y });
  });

  test('第 8 天起每家发起一次围攻：选离老巢最近的分城、提前 60 分钟预警；主城 / 名城 / 免战中的城不入池', async () => {
    setFactionEnabledCache(true);
    const truceBranch = await fx.insertCity({
      accountId: fx.defenderId,
      name: '免战分城',
      x: NANMAN.lair.x + 3,
      y: NANMAN.lair.y + 3,
      gov: 4,
      createdAt: new Date(Date.now() - 2 * 24 * HOUR),
    });
    await fx.pool.query(`UPDATE cities SET truce_until = now() + interval '4 hours' WHERE id = $1`, [truceBranch]);
    const nearest = await fx.insertCity({
      accountId: fx.defenderId,
      name: '最近的分城',
      x: NANMAN.lair.x + 6,
      y: NANMAN.lair.y + 6,
      gov: 5,
      wall: 5,
      createdAt: new Date(Date.now() - 1 * 24 * HOUR),
      originLevel: 2,
    });
    await fx.setGarrison(nearest, { militia: 150, archer: 40 });
    const before = Date.now();
    const tick = await runFactionSiegeTick(fx.pool);
    assert.ok(tick.started >= 1, '至少南蛮发起了围攻');
    const siege = await fx.pool.query(`SELECT city_id, arrive_at, power FROM faction_sieges WHERE faction = $1`, [NANMAN.key]);
    assert.equal(siege.rowCount, 1, '同一时间最多围 1 座城');
    const row = siege.rows[0] as { city_id: string; arrive_at: Date; power: number };
    assert.equal(row.city_id, nearest, '选中范围内离老巢最近的玩家分城（跳过免战中的城与主城）');
    const lead = new Date(row.arrive_at).getTime() - before;
    assert.ok(lead >= 60 * 60 * 1000 - 5000 && lead <= 60 * 60 * 1000 + 5000, `预警提前 60 分钟（实际 ${lead}ms）`);
    assert.equal(row.power, 5 * 100, '围城军战力 = 官府 5 级 × 100');
    const events = await fx.pool.query(`SELECT detail FROM events WHERE type = $1 AND account_id = $2`, [
      EventType.FACTION_SIEGE_WARNING,
      fx.defenderId,
    ]);
    assert.equal(events.rowCount, 1);
    const detail = events.rows[0].detail as { faction: { name: string }; durability: number; power: number };
    assert.equal(detail.faction.name, '南蛮');
    assert.equal(detail.durability, 100, '预警给出当前城防值');
    assert.equal(detail.power, 500);
    // 已在围一座 → 这一轮不再发起第二座
    const again = await runFactionSiegeTick(fx.pool);
    assert.equal(await hasActiveSiege(fx.pool, NANMAN.key), true);
    const count = await fx.pool.query(`SELECT count(*)::int AS n FROM faction_sieges WHERE faction = $1`, [NANMAN.key]);
    assert.equal(count.rows[0].n, 1, `仍在围 1 座（tick started=${again.started}）`);
  });

  test('势力打赢：扣 35 城防、进入 4 小时被动免战、不掠夺资源', async () => {
    const siege = await fx.pool.query(`SELECT id, city_id FROM faction_sieges WHERE faction = $1 AND resolved_at IS NULL`, [NANMAN.key]);
    const row = siege.rows[0] as { id: string; city_id: string };
    const goldBefore = (await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [row.city_id])).rows[0].gold as number;
    await fx.setGarrison(row.city_id, {});
    const outcome = await fx.resolveSiege(row.id, new Date());
    assert.equal(outcome, 'hit');
    const city = await fx.cityRow(row.city_id);
    assert.equal(city?.durability, DURABILITY_MAX - DURABILITY_DAMAGE_PER_WIN);
    const truceLeft = (city?.truce_until?.getTime() ?? 0) - Date.now();
    assert.ok(truceLeft > 3.5 * HOUR && truceLeft <= PVP_CITY_TRUCE_MS + 5000, `4 小时被动免战（${truceLeft}ms）`);
    const goldAfter = (await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [row.city_id])).rows[0].gold as number;
    assert.equal(goldAfter, goldBefore, '围攻不掠夺资源');
    const events = await fx.pool.query(`SELECT detail FROM events WHERE type = $1 AND account_id = $2`, [
      EventType.FACTION_SIEGE,
      fx.defenderId,
    ]);
    const last = events.rows[(events.rowCount ?? 1) - 1].detail as { outcome: string; damage: number; durabilityAfter: number };
    assert.equal(last.outcome, 'hit');
    assert.equal(last.damage, 35);
    assert.equal(last.durabilityAfter, 65);
  });

  test('势力打输：守方守住，该势力 24 小时内不再打这座城（改选下一座）', async () => {
    const strong = await fx.insertCity({
      accountId: fx.defenderId,
      name: '重兵分城',
      x: NANMAN.lair.x + 4,
      y: NANMAN.lair.y + 2,
      gov: 5,
      wall: 10,
      createdAt: new Date(Date.now() - 12 * HOUR),
      originLevel: 2,
    });
    await fx.setGarrison(strong, { militia: 4000, archer: 2000 });
    const fresh = await fx.insertCity({
      accountId: fx.defenderId,
      name: '下一座分城',
      x: NANMAN.lair.x + 9,
      y: NANMAN.lair.y + 3,
      gov: 5,
      createdAt: new Date(Date.now() - 30 * HOUR),
      originLevel: 2,
    });
    const siegeId = await fx.insertSiegeRow({
      cityId: strong,
      accountId: fx.defenderId,
      x: NANMAN.lair.x + 4,
      y: NANMAN.lair.y + 2,
      level: 5,
    });
    assert.equal(await fx.resolveSiege(siegeId, new Date()), 'repelled');
    const city = await fx.cityRow(strong);
    assert.equal(city?.durability, null, '守住不扣城防（从未被打过的城没有落值）');
    const pick = await pickSiegeTarget(fx.pool, {
      faction: NANMAN.key,
      lair: NANMAN.lair,
      radius: 250,
      intervalMs: 6 * HOUR,
      maxLeadMs: 0,
      lossCooldownMs: factionSiegeLossCooldownMs(),
    });
    assert.equal(pick?.cityId, fresh, '改选下一座（24 小时内不再打刚守住的那座）');
  });

  test('同一座城 6 小时最多打一次；守方守住后 24 小时内不再打（只有打输才吃 24 小时）', async () => {
    // 山越老巢 (920,920) 周围只放这一家的目标，避免别的势力干扰
    const SHANYUE = FACTIONS[3];
    const soloId = await fx.insertAccount(`solo-${Date.now()}`);
    await fx.insertCity({
      accountId: soloId,
      name: '山越范围内的主城',
      x: SHANYUE.lair.x - 2,
      y: SHANYUE.lair.y - 2,
      gov: 6,
      createdAt: new Date(Date.now() - 4 * 24 * HOUR),
    });
    const branch = await fx.insertCity({
      accountId: soloId,
      name: '山越范围内的分城',
      x: SHANYUE.lair.x - 6,
      y: SHANYUE.lair.y - 6,
      gov: 5,
      createdAt: new Date(Date.now() - 2 * 24 * HOUR),
      originLevel: 2,
    });
    const rowId = (
      await fx.pool.query(
        `INSERT INTO faction_sieges (faction, city_id, account_id, x, y, level, army, power, arrive_at, resolved_at, outcome, durability_before, durability_after, week_index)
         VALUES ($1, $2, $3, $4, $5, 5, '{}'::jsonb, 500, now() - interval '4 hours', now() - interval '3 hours', 'hit', 100, 65, 0)
         RETURNING id`,
        [SHANYUE.key, branch, soloId, SHANYUE.lair.x - 6, SHANYUE.lair.y - 6],
      )
    ).rows[0].id as string;
    const pick = (): Promise<{ cityId: string } | null> =>
      pickSiegeTarget(fx.pool, {
        faction: SHANYUE.key,
        lair: SHANYUE.lair,
        radius: 250,
        intervalMs: 6 * HOUR,
        maxLeadMs: 0,
        lossCooldownMs: factionSiegeLossCooldownMs(),
      });
    assert.equal(await pick(), null, '4 小时前到达过一次 → 6 小时内不再打同一座城');
    await fx.pool.query(`UPDATE faction_sieges SET arrive_at = now() - interval '7 hours' WHERE id = $1`, [rowId]);
    assert.equal((await pick())?.cityId, branch, '距上次到达过了 6 小时可以再打');
    await fx.pool.query(`UPDATE faction_sieges SET outcome = 'repelled', resolved_at = now() - interval '7 hours' WHERE id = $1`, [rowId]);
    assert.equal(await pick(), null, '7 小时前打输过 → 24 小时内不再打这座城');
    await fx.pool.query(`UPDATE faction_sieges SET resolved_at = now() - interval '25 hours' WHERE id = $1`, [rowId]);
    assert.equal((await pick())?.cityId, branch, '超过 24 小时可以再打');
  });

  test('每周上限 2 座：吞满后本周不再发起围攻', async () => {
    for (let i = 0; i < FACTION_SIEGE_WEEKLY_CAP; i += 1) {
      await fx.pool.query(
        `INSERT INTO faction_sieges (faction, city_id, account_id, x, y, level, army, power, arrive_at, resolved_at, outcome, swallowed_at, week_index)
         VALUES ($1, NULL, $2, $3, $4, 5, '{}'::jsonb, 500, now(), now(), 'swallowed', now(), 0)`,
        [NANMAN.key, fx.defenderId, NANMAN.lair.x + 90 + i * 2, NANMAN.lair.y + 90],
      );
    }
    assert.equal(await countWeekSwallows(fx.pool, NANMAN.key, 0), FACTION_SIEGE_WEEKLY_CAP);
    const idsBefore = new Set(((await fx.pool.query(`SELECT id FROM faction_sieges`)).rows as Array<{ id: string }>).map((row) => row.id));
    const tick = await runFactionSiegeTick(fx.pool);
    const rowsAfter = (await fx.pool.query(`SELECT id, faction FROM faction_sieges`)).rows as Array<{ id: string; faction: string }>;
    const added = rowsAfter.filter((row) => !idsBefore.has(row.id) && row.faction === NANMAN.key);
    assert.equal(added.length, 0, `本周已吞满 2 座后不再发起（tick started=${tick.started}）`);
    await fx.pool.query(`DELETE FROM faction_sieges WHERE faction = $1 AND outcome = 'swallowed'`, [NANMAN.key]);
  });

  test('目标失效（城已易主）时本次围攻作废、不战斗', async () => {
    const owner = await fx.insertAccount(`gone-${Date.now()}`);
    const stolen = await fx.insertCity({
      accountId: owner,
      name: '会被易手的分城',
      x: NANMAN.lair.x + 12,
      y: NANMAN.lair.y + 12,
      gov: 4,
      createdAt: new Date(Date.now() - 3 * HOUR),
      originLevel: 1,
    });
    const siegeId = await fx.insertSiegeRow({
      cityId: stolen,
      accountId: owner,
      x: NANMAN.lair.x + 12,
      y: NANMAN.lair.y + 12,
      level: 4,
    });
    await fx.pool.query(`UPDATE cities SET account_id = $2 WHERE id = $1`, [stolen, fx.defenderId]);
    const before = await fx.cityRow(stolen);
    assert.equal(await fx.resolveSiege(siegeId, new Date()), 'cancelled');
    const after = await fx.cityRow(stolen);
    assert.equal(after?.durability, before?.durability, '作废时不扣城防');
    const row = await fx.pool.query(`SELECT outcome FROM faction_sieges WHERE id = $1`, [siegeId]);
    assert.equal(row.rows[0].outcome, 'cancelled');
  });
});
