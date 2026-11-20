// 势力记仇的数据库流程（v116，AISLG-264）：打老巢结算加报复仇恨（写时折算）、基础仇恨的前 20 名榜快照、
// 仇恨选目标（不要求势力范围 / 同账号只被一家围 / 候选排序）、GET_FACTIONS 的 hatredTier 只给请求者。
// 需要 TEST_DATABASE_URL（临时库），否则跳过。纯规则见 faction-hatred.test.ts。
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { chebyshevDistance } from '../common/src/faction';
import { factionHatredDecayedRetaliation } from '../common/src/faction-hatred';
import { loadFactionView } from '../common/src/faction-db';
import { factionSiegeLossCooldownMs } from '../common/src/faction-siege';
import {
  FACTION_HATRED_RANKS_KEY,
  addFactionHatred,
  loadFactionHatredRows,
  loadHatredBaseRanks,
  pickHatredSiegeTarget,
} from '../common/src/faction-hatred-db';
import { setFactionEnabledCache } from '../common/src/faction-config';
import { setTimeScaleCache } from '../common/src/time-scale';
import { createSiegeFixture, DAY, HOUR, NANMAN, type SiegeFixture } from './faction-siege-fixture';
import { attackLair, createFlowFixture, insertPlayer, setCityArmy, type FlowFixture } from './faction-lair-fixture';

const dbUrl = process.env.TEST_DATABASE_URL;

describe('打老巢结算记仇（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: FlowFixture;
  let player: { accountId: string; cityId: string };

  before(async () => {
    setTimeScaleCache(1);
    setFactionEnabledCache(true);
    fx = await createFlowFixture(dbUrl as string, 'hatred_lair');
    player = await insertPlayer(fx, `记仇玩家-${Date.now()}`, NANMAN.lair.x + 10, NANMAN.lair.y + 10);
  });

  after(async () => {
    await fx?.close();
  });

  test('打老巢一场加同等歼灭战力的报复仇恨（打输也加）；贡献榜仍是同一口径的累计值', async () => {
    const troops = { militia: 5000, archer: 1000, swordsman: 500 };
    await setCityArmy(fx, player.cityId, troops);
    const result = await attackLair(fx, {
      accountId: player.accountId,
      cityId: player.cityId,
      troops,
      now: new Date(),
      key: NANMAN.key,
    });
    assert.ok(result.killedPower > 0, `这一场歼灭战力 ${result.killedPower}`);
    const row = (await loadFactionHatredRows(fx.pool, [NANMAN.key])).get(NANMAN.key)?.find((entry) => entry.accountId === player.accountId);
    assert.equal(row?.retaliation, result.killedPower, '报复仇恨 1:1 累加这场歼灭的守军战力');
    const contrib = await fx.pool.query(`SELECT power FROM faction_contrib WHERE key = $1 AND account_id = $2`, [
      NANMAN.key,
      player.accountId,
    ]);
    assert.equal(Number(contrib.rows[0].power), result.killedPower, '灭亡榜单的贡献同口径（不衰减，保持原样）');
  });

  test('报复仇恨写时折算：4 天前的累计值按半衰期减半多一点后再累加（半衰期 3 天）', async () => {
    const now = new Date();
    const staleAt = new Date(now.getTime() - 4 * DAY);
    await fx.pool.query(`UPDATE faction_hatred SET updated_at = $3 WHERE key = $1 AND account_id = $2`, [
      NANMAN.key,
      player.accountId,
      staleAt,
    ]);
    const before = (await loadFactionHatredRows(fx.pool, [NANMAN.key])).get(NANMAN.key)?.find(
      (entry) => entry.accountId === player.accountId,
    );
    assert.ok((before?.retaliation ?? 0) > 1, '上一条已写入一段累计值');
    // 写侧折算与读侧同一个纯函数：旧值按半衰期折算后再加上新一场的歼灭战力
    const kept = factionHatredDecayedRetaliation({ retaliation: before?.retaliation ?? 0, updatedAt: staleAt, now });
    assert.ok(kept > 0 && kept < (before?.retaliation ?? 0), `4 天前的一段已衰减（${kept}）`);
    const troops = { militia: 5000, archer: 1000, swordsman: 500 };
    await setCityArmy(fx, player.cityId, troops);
    const result = await attackLair(fx, {
      accountId: player.accountId,
      cityId: player.cityId,
      troops,
      now,
      key: NANMAN.key,
    });
    const after = (await loadFactionHatredRows(fx.pool, [NANMAN.key])).get(NANMAN.key)?.find(
      (entry) => entry.accountId === player.accountId,
    );
    assert.equal(after?.retaliation, kept + result.killedPower, '旧值按半衰期折算后再加上这一场');
  });
});

describe('仇恨选目标与档位（需 TEST_DATABASE_URL）', { skip: dbUrl ? false : '未设置 TEST_DATABASE_URL' }, () => {
  let fx: SiegeFixture;
  /** 战力榜前列的大户：主城在远东、两座分城都在南蛮范围（半径 150）之外 */
  let farAccountId: string;
  let farNearBranchId: string;
  let farFarBranchId: string;
  /** 打过南蛮老巢的玩家（没部队、不在战力榜上，靠报复仇恨排到前面） */
  let raiderId: string;
  let raiderBranchId: string;
  const g1 = 10000;
  const siegeArgs = (): Parameters<typeof pickHatredSiegeTarget>[1] => ({
    faction: NANMAN.key,
    lair: NANMAN.lair,
    g1,
    intervalMs: 6 * HOUR,
    maxLeadMs: 0,
    lossCooldownMs: factionSiegeLossCooldownMs(),
    now: new Date(),
  });

  before(async () => {
    setTimeScaleCache(1);
    setFactionEnabledCache(true);
    fx = await createSiegeFixture(dbUrl as string, 'hatred_siege');
    farAccountId = await fx.insertAccount(`far-${Date.now()}`);
    await fx.insertCity({
      accountId: farAccountId,
      name: '远东主城',
      x: 700,
      y: 700,
      gov: 6,
      createdAt: new Date(Date.now() - 3 * DAY),
    });
    farNearBranchId = await fx.insertCity({
      accountId: farAccountId,
      name: '远东分城甲',
      x: 300,
      y: 700,
      gov: 5,
      createdAt: new Date(Date.now() - 2 * DAY),
      originLevel: 1,
    });
    farFarBranchId = await fx.insertCity({
      accountId: farAccountId,
      name: '远东分城乙',
      x: 600,
      y: 600,
      gov: 5,
      createdAt: new Date(Date.now() - 1 * DAY),
      originLevel: 1,
    });
  });

  after(async () => {
    await fx?.close();
  });

  test('基础仇恨：前 20 名榜单快照写 settings，一天内复用、过期或换季重算', async () => {
    // 全服只有这个大户有兵 → 他排第 1，基础仇恨 = G1
    await fx.setGarrison(farNearBranchId, { militia: 2000, archer: 500 });
    const now = new Date();
    const ranks = await loadHatredBaseRanks(fx.pool, now, fx.seasonStart);
    assert.equal(ranks.length, 1, '只有一个账号有兵');
    assert.equal(ranks[0].accountId, farAccountId);
    assert.equal(ranks[0].rank, 1);
    const snapshot = await fx.pool.query(`SELECT value FROM settings WHERE key = $1`, [FACTION_HATRED_RANKS_KEY]);
    assert.deepEqual(snapshot.rows[0].value.ranks, ranks, '快照落库（settings，不入库 faction_hatred）');
    assert.equal(new Date(snapshot.rows[0].value.at).getTime(), now.getTime(), '快照记下重算时刻');
    const cached = await loadHatredBaseRanks(fx.pool, new Date(now.getTime() + 60_000), fx.seasonStart);
    assert.deepEqual(cached, ranks, '一天内复用快照');
    // 把快照改成两天前：下一次读会重算（这边兵没变，结果相同）
    const staleAt = new Date(now.getTime() - 2 * DAY).toISOString();
    await fx.pool.query(`UPDATE settings SET value = jsonb_set(value, '{at}', to_jsonb($2::text)) WHERE key = $1`, [
      FACTION_HATRED_RANKS_KEY,
      staleAt,
    ]);
    const stale = await loadHatredBaseRanks(fx.pool, new Date(now.getTime() + 60_000), fx.seasonStart);
    assert.deepEqual(stale, ranks, '过期后重算');
    const refreshed = await fx.pool.query(`SELECT value FROM settings WHERE key = $1`, [FACTION_HATRED_RANKS_KEY]);
    assert.equal(new Date(refreshed.rows[0].value.at).getTime(), now.getTime() + 60_000, '重算后刷新快照时刻');
    // 快照早于本季开始：立即重算（换季后不会给上季的榜发基础仇恨）
    const nextSeasonStart = new Date(now.getTime() + 30_000);
    const nextSeason = await loadHatredBaseRanks(fx.pool, new Date(now.getTime() + 60_000), nextSeasonStart);
    assert.deepEqual(nextSeason, ranks, '换季后的第一次读立即重算');
  });

  test('榜前 20 的账号即使分城不在势力范围内，也会被仇恨选中（围他离老巢最近的合格分城）', async () => {
    assert.ok(
      chebyshevDistance(NANMAN.lair, { x: 300, y: 700 }) > 150,
      '这座分城在南蛮范围（半径 150）之外——仇恨选目标不看范围',
    );
    const pick = await pickHatredSiegeTarget(fx.pool, siegeArgs());
    assert.equal(pick?.candidate.accountId, farAccountId, '仇恨榜上的大户被选中');
    assert.equal(pick?.candidate.cityId, farNearBranchId, '围他离老巢最近的合格分城（不是主城、也不是更远的那座）');
    assert.ok((pick?.hatred ?? 0) > 0);
    assert.equal(pick?.powerRank, 1, '榜前 20 带名次');
    assert.notEqual(pick?.candidate.cityId, farFarBranchId);
  });

  test('打过老巢的账号排到榜前账号前面（报复仇恨高于基础仇恨就优先围）', async () => {
    raiderId = await fx.insertAccount(`raider-${Date.now()}`);
    await fx.insertCity({
      accountId: raiderId,
      name: '记仇者主城',
      x: 650,
      y: 750,
      gov: 6,
      createdAt: new Date(Date.now() - 3 * DAY),
    });
    raiderBranchId = await fx.insertCity({
      accountId: raiderId,
      name: '记仇者分城',
      x: 640,
      y: 760,
      gov: 5,
      createdAt: new Date(Date.now() - 1 * DAY),
      originLevel: 1,
    });
    // 没有部队（不在战力榜上），但打过这家老巢：报复仇恨 20,000 > 榜首的基础仇恨 10,000
    await addFactionHatred(fx.pool, { key: NANMAN.key, accountId: raiderId, power: 20000, now: new Date() });
    const pick = await pickHatredSiegeTarget(fx.pool, siegeArgs());
    assert.equal(pick?.candidate.accountId, raiderId, '仇恨高的先围（哪怕不在战力榜上）');
    assert.equal(pick?.candidate.cityId, raiderBranchId, '围他离老巢最近的合格分城');
    assert.equal(pick?.powerRank, null, '榜外没有名次');
    assert.ok((pick?.hatred ?? 0) >= 20000);
  });

  test('同一账号同一时间最多被 1 家势力围：已被别家围中的跳过、换下一个', async () => {
    // 让记仇者被山越围住（未结算 → 另一家必须换人）
    const city = (await fx.pool.query(`SELECT x, y FROM cities WHERE id = $1`, [raiderBranchId])).rows[0] as { x: number; y: number };
    await fx.insertSiegeRow({
      faction: 'shanyue',
      cityId: raiderBranchId,
      accountId: raiderId,
      x: city.x,
      y: city.y,
      level: 5,
    });
    const pick = await pickHatredSiegeTarget(fx.pool, siegeArgs());
    assert.equal(pick?.candidate.accountId, farAccountId, '被别家围住的账号跳过（换下一个），回到榜前的大户');
    assert.equal(pick?.candidate.cityId, farNearBranchId);
  });

  test('GET_FACTIONS 的 hatredTier 只给请求者自己：前 5 名 target、其余 none', async () => {
    const now = new Date();
    // 南蛮的仇恨榜：记仇者（20,000）第 1、大户（基础 10,000）第 2 → 两人都是 target（前 5）
    const view = await loadFactionView(fx.pool, fx.seasonStart, now, farAccountId);
    const nanman = view.factions.find((faction) => faction.key === NANMAN.key);
    assert.equal(nanman?.hatredTier, 'target', '仇恨榜前 5 名 = 重点目标');
    const strangerId = await fx.insertAccount(`stranger-${Date.now()}`);
    const strangerView = await loadFactionView(fx.pool, fx.seasonStart, now, strangerId);
    for (const faction of strangerView.factions) {
      assert.equal(faction.hatredTier, 'none', `没有仇恨的账号在 ${faction.key} 一律 none`);
    }
    const anonymous = await loadFactionView(fx.pool, fx.seasonStart, now);
    for (const faction of anonymous.factions) {
      assert.equal(faction.hatredTier, 'none', '未登录（不传账号）时一律 none');
    }
  });
});