// 攻破老巢的主流程（v101，AISLG-241，需 TEST_DATABASE_URL）：多名玩家连续进攻，从 20 营打到 0 营。
// 覆盖需求第一节与第二节：首次进攻打输保留残血、歼灭奖励与 1% 声望照发；营清空进下一营、已清的营不回来；
// 24 小时没人进攻恢复 1 营；灭亡时全服播报带最后一击玩家名、首领名将给最后一击的玩家、
// 贡献榜按歼灭战力排名并按需求表发灭亡奖；之后老巢变废墟（视图标废墟、出征被拒、再打不战斗也不发奖）。
// 灭亡的其余联动（势力城变回、围攻作废、袭击去旗号、范围不改归别家）见 faction-lair-destroy.test.ts。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import {
  loadFactionContributions,
  loadFactionLairRow,
  recoverFactionLairs,
} from '../common/src/faction-lair-db';
import { loadFactionView } from '../common/src/faction-db';
import {
  factionLairCampPowerAt,
  factionLairDestroyReward,
  factionLairGarrison,
  factionLairKillReward,
  factionLairScoutGarrison,
} from '../common/src/faction-lair';
import { armyPower } from '../common/src/battle';
import { resolveMarchTarget } from '../api/src/march-target';
import { loadTileDetail } from '../api/src/views-world';
import { FACTIONS } from '../common/src/faction';
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

describe('攻破老巢的主流程（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: FlowFixture;

  before(async () => {
    fx = await createFlowFixture(dbUrl as string, 'faction_lair_flow');
  });

  after(async () => {
    await fx?.close();
  });

  test('打完 20 营：残血 / 奖励 / 声望 / 恢复 / 灭亡 / 名将 / 灭亡奖 / 废墟', async () => {
    const now = new Date(Date.now() - 2 * HOUR);
    const big = { militia: 200_000 };
    const p1 = await insertPlayer(fx, `lair-a1-${Date.now()}`, NANMAN.lair.x + 12, NANMAN.lair.y + 12);
    const p2 = await insertPlayer(fx, `lair-a2-${Date.now()}`, NANMAN.lair.x + 20, NANMAN.lair.y + 16);
    const p3 = await insertPlayer(fx, `lair-a3-${Date.now()}`, NANMAN.lair.x + 28, NANMAN.lair.y + 20);
    for (const player of [p1, p2, p3]) {
      await setCityArmy(fx, player.cityId, big);
    }

    // 开季就是 20 营、每营战力下限 10,000
    const startRow = await loadFactionLairRow(fx.pool, NANMAN.key);
    assert.equal(startRow?.camps_total, 20);
    assert.equal(startRow?.camps_remaining, 20);
    assert.equal(startRow?.camp_power, 10_000);
    assert.equal(startRow?.destroyed_at, null);

    // 0) 出征校验：本季未灭亡的老巢可以出征（plunder），占领仍拒绝
    const lairTile = (await fx.pool.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2`, [NANMAN.lair.x, NANMAN.lair.y])).rows[0];
    const client = await fx.pool.connect();
    try {
      const plunder = await resolveMarchTarget(client, p1.accountId, p1.cityId, lairTile, 'plunder', 5, now);
      assert.equal(plunder.purpose, 'plunder');
      assert.equal(plunder.pvp, undefined, '打老巢不算攻击玩家（不破新手保护、不发来袭预警）');
      const occupy = await resolveMarchTarget(client, p1.accountId, p1.cityId, lairTile, 'occupy', 5, now);
      assert.equal(occupy.reason, 'FACTION_LAIR_TARGET');
    } finally {
      client.release();
    }

    // 1) 打输也保留残血、照发歼灭奖励与 1% 声望
    const goldBefore = Number((await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [p1.cityId])).rows[0].gold);
    const lost = await attackLair(fx, { accountId: p1.accountId, cityId: p1.cityId, troops: { militia: 6000 }, now });
    assert.equal(lost.outcome, 'lost');
    assert.ok(lost.killedPower > 0);
    const afterLost = await loadFactionLairRow(fx.pool, NANMAN.key);
    assert.equal(afterLost?.camps_remaining, 20, '打输不掉营');
    assert.ok(afterLost?.remaining, '打输保留当前营残血');
    const goldAfter = Number((await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [p1.cityId])).rows[0].gold);
    assert.equal(goldAfter - goldBefore, factionLairKillReward(lost.killedPower).gold, '歼灭奖励当场入账到出征城（不占负重）');
    const prestige = Number((await fx.pool.query(`SELECT prestige FROM accounts WHERE id = $1`, [p1.accountId])).rows[0].prestige);
    assert.equal(prestige, Math.floor(lost.killedPower / 100), '声望按歼灭战力的 1%');

    // 2) 打赢清空当前营 → 进入下一营（满营），已清的营不回来
    const won = await attackLair(fx, {
      accountId: p2.accountId,
      cityId: p2.cityId,
      troops: big,
      now: new Date(now.getTime() + 10 * 60 * 1000),
    });
    assert.equal(won.outcome, 'won');
    const afterWin = await loadFactionLairRow(fx.pool, NANMAN.key);
    assert.equal(afterWin?.camps_remaining, 19);
    assert.equal(afterWin?.remaining, null, '下一营是满营');

    // 3) 连续 24 小时没人进攻 → 恢复 1 营、残血回满，总数不超过 20
    const recoveredAt = new Date((afterWin?.last_battle_at as Date).getTime() + 25 * HOUR);
    assert.equal(await recoverFactionLairs(fx.pool, recoveredAt), 1);
    const afterRecover = await loadFactionLairRow(fx.pool, NANMAN.key);
    assert.equal(afterRecover?.camps_remaining, 20);
    assert.equal(afterRecover?.remaining, null);
    // 从没被打过的老巢不恢复（另一家）
    const otherBefore = await loadFactionLairRow(fx.pool, FACTIONS[0].key);
    await recoverFactionLairs(fx.pool, new Date(Date.now() + 100 * HOUR));
    assert.deepEqual(await loadFactionLairRow(fx.pool, FACTIONS[0].key), otherBefore);

    // 4) 三人轮流把 20 营全部打掉（打到只剩 1 营，最后一击固定给 p3）
    let clock = recoveredAt.getTime() + 60 * 60 * 1000;
    const attackers = [p1, p2, p3];
    let turns = 0;
    while ((await loadFactionLairRow(fx.pool, NANMAN.key))!.camps_remaining > 1 && turns < 40) {
      const who = attackers[turns % attackers.length];
      turns += 1;
      clock += 10 * 60 * 1000;
      const res = await attackLair(fx, { accountId: who.accountId, cityId: who.cityId, troops: big, now: new Date(clock) });
      assert.equal(res.outcome, 'won', `第 ${turns} 次进攻应清掉一营`);
      assert.ok((res.campsRemaining ?? 0) >= 1, '还没灭亡');
    }
    assert.ok(turns >= 10, '至少要打 10 营');

    // 最后一击：p3（记录灭亡前的金币——灭亡奖励按名次再发一次，最后一击另有本场歼灭奖励）
    const goldBeforeDestroy = new Map<string, number>();
    for (const player of attackers) {
      const row = await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [player.cityId]);
      goldBeforeDestroy.set(player.accountId, Number(row.rows[0].gold));
    }
    clock += 10 * 60 * 1000;
    const last = await attackLair(fx, { accountId: p3.accountId, cityId: p3.cityId, troops: big, now: new Date(clock) });
    assert.equal(last.outcome, 'destroyed');

    // 5) 灭亡：本季灭亡、营数归零、最后一击的玩家记下
    const destroyedRow = await loadFactionLairRow(fx.pool, NANMAN.key);
    assert.ok(destroyedRow?.destroyed_at, '本季灭亡');
    assert.equal(destroyedRow?.camps_remaining, 0);
    assert.equal(destroyedRow?.destroyed_by, p3.accountId);
    const hero = (await fx.pool.query(`SELECT owner_account_id FROM famous_heroes WHERE name = '孟获'`)).rows[0];
    assert.equal(hero?.owner_account_id, p3.accountId, '首领名将归最后一击的玩家');
    const broadcast = await fx.pool.query(`SELECT detail FROM server_broadcasts WHERE type = 'faction_lair_destroyed'`);
    assert.equal(broadcast.rowCount, 1);
    const broadcastUsername = String((broadcast.rows[0].detail as { username: string }).username ?? '');
    assert.ok(broadcastUsername.includes('lair-a3-'), `全服播报带最后一击的玩家名（实际 ${broadcastUsername}）`);

    // 6) 贡献榜按歼灭战力排名；灭亡奖励按需求表发到各人主城
    const contributions = await loadFactionContributions(fx.pool, NANMAN.key);
    assert.equal(contributions.length, 3, '三名进攻者都在贡献榜上');
    assert.deepEqual(
      [...contributions].sort((a, b) => b.power - a.power),
      contributions,
      '贡献榜按歼灭战力倒序',
    );
    const lastKill = factionLairKillReward(last.killedPower).gold;
    for (const [index, row] of contributions.entries()) {
      const player = attackers.find((candidate) => candidate.accountId === row.accountId) as { accountId: string; cityId: string };
      const goldNow = Number((await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [player.cityId])).rows[0].gold);
      const tierGold = factionLairDestroyReward(index + 1).reward.gold;
      const expected = tierGold + (player.accountId === p3.accountId ? lastKill : 0);
      assert.equal(goldNow - (goldBeforeDestroy.get(player.accountId) as number), expected, `名次 ${index + 1} 的灭亡奖励`);
    }
    assert.ok(contributions[0].power > 0);

    // 7) 势力面板：已灭亡、不再有营
    const view = await loadFactionView(fx.pool, fx.seasonStart, new Date());
    const nanmanView = view.factions.find((faction) => faction.key === NANMAN.key);
    assert.equal(nanmanView?.destroyed, true);
    assert.equal(nanmanView?.campsRemaining, 0);
    assert.equal(nanmanView?.campRemainingPercent, 0);

    // 8) 老巢变废墟：不能再出征 / 侦察 / 占领（视图也标成废墟），再打不战斗也不发奖
    const ruinsTile = (await fx.pool.query(`SELECT * FROM world_tiles WHERE x = $1 AND y = $2`, [NANMAN.lair.x, NANMAN.lair.y])).rows[0];
    const afterClient = await fx.pool.connect();
    try {
      const verdict = await resolveMarchTarget(afterClient, p1.accountId, p1.cityId, ruinsTile, 'plunder', 5, new Date());
      assert.equal(verdict.reason, 'FACTION_LAIR_TARGET');
    } finally {
      afterClient.release();
    }
    const detail = await loadTileDetail(fx.pool, NANMAN.lair.x, NANMAN.lair.y, p1.accountId);
    assert.equal(detail?.faction?.isLair, true);
    assert.equal(detail?.faction?.destroyed, true, '老巢格视图标成废墟');
    const goldBeforeRuins = Number((await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [p1.cityId])).rows[0].gold);
    const onRuins = await attackLair(fx, {
      accountId: p1.accountId,
      cityId: p1.cityId,
      troops: { militia: 100 },
      now: new Date(clock + HOUR),
    });
    assert.equal(onRuins.outcome, 'gone');
    assert.equal(onRuins.killedPower, 0);
    const goldAfterRuins = Number((await fx.pool.query(`SELECT gold FROM cities WHERE id = $1`, [p1.cityId])).rows[0].gold);
    assert.equal(goldAfterRuins, goldBeforeRuins, '废墟不发奖');
  });

  test('面板与侦察的当前营守军按营序号取 Gk（20 营由弱到强）', async () => {
    // 换一家没被打过的（凉州军），直接写入一次每日刷新后的锚点：
    // 第 1 营 16,474、第 20 营 155,111（需求验收用的线上快照口径）
    const key = FACTIONS[0].key;
    await fx.pool.query(`UPDATE faction_lairs SET camp_power_g1 = $2, camp_power_g20 = $3 WHERE key = $1`, [
      key,
      16_474,
      155_111,
    ]);
    const view = async () =>
      (await loadFactionView(fx.pool, fx.seasonStart, new Date())).factions.find((faction) => faction.key === key);

    // 20 营全在 → 当前营是第 1 营（最弱）
    assert.equal((await view())?.campsRemaining, 20);
    assert.equal((await view())?.campPower, 16_474);
    assert.equal((await view())?.campRemainingPercent, 100);

    // 打掉 9 营 → 当前营是第 10 营（约 47,500）
    await fx.pool.query(`UPDATE faction_lairs SET camps_remaining = 11 WHERE key = $1`, [key]);
    assert.equal((await view())?.campPower, 47_653);
    assert.equal((await view())?.campPower, factionLairCampPowerAt(16_474, 155_111, 10));

    // 侦察：满营 = 当前营的满编守军，战力对上 Gk
    const lairRow = await loadFactionLairRow(fx.pool, key);
    const garrison = factionLairScoutGarrison(lairRow);
    assert.deepEqual(garrison, factionLairGarrison(47_653));
    assert.equal(armyPower(garrison), armyPower(factionLairGarrison(47_653)));

    // 半血：面板百分比按当前营的满编算
    const full = factionLairGarrison(47_653);
    const half = Object.fromEntries(Object.entries(full).map(([kind, count]) => [kind, Math.floor((count as number) / 2)]));
    await fx.pool.query(`UPDATE faction_lairs SET remaining = $2::jsonb WHERE key = $1`, [key, JSON.stringify(half)]);
    const percent = (await view())?.campRemainingPercent as number;
    assert.ok(percent > 45 && percent < 55, `半血 = ${percent}`);
    assert.deepEqual(factionLairScoutGarrison(await loadFactionLairRow(fx.pool, key)), half, '侦察给残血实况');

    // 只剩 1 营 → 当前营是第 20 营（最强）
    await fx.pool.query(`UPDATE faction_lairs SET camps_remaining = 1, remaining = NULL WHERE key = $1`, [key]);
    assert.equal((await view())?.campPower, 155_111);
    assert.deepEqual(factionLairScoutGarrison(await loadFactionLairRow(fx.pool, key)), factionLairGarrison(155_111));
  });
});
