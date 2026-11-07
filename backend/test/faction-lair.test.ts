// 攻破老巢的纯规则（v101，AISLG-241）：20 营、每营战力公式、编成比例、歼灭奖励 / 声望、
// 灭亡榜单（黄巾之乱同名次的 3 倍）、24 小时恢复、每天刷新后的残血比例。
// 事务流程见 faction-lair-flow.test.ts（需 TEST_DATABASE_URL）。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FACTION_LAIR_CAMPS,
  FACTION_LAIR_DESTROY_TIERS,
  FACTION_LAIR_MIN_CAMP_POWER,
  FACTION_LAIR_PRESTIGE_PERCENT,
  FACTION_LAIR_RECOVER_MS,
  FACTION_LAIR_WALL_PERCENT,
  factionLairCampNo,
  factionLairCampPower,
  factionLairDestroyReward,
  factionLairGarrison,
  factionLairRecoveredCamps,
  factionLairRemainingPercent,
  factionLairScoutGarrison,
  factionLairKillReward,
  factionLairPrestige,
  rescaledLairRemaining,
} from '../common/src/faction-lair';
import { factionSiegeArmy } from '../common/src/faction-siege';
import { YT_REWARD_TIERS } from '../common/src/yellow-turban';
import { armyPower } from '../common/src/battle';

describe('攻破老巢的纯规则（无需数据库）', () => {
  test('老巢共 20 营，城墙减伤 50%，每营战力下限 10,000', () => {
    assert.equal(FACTION_LAIR_CAMPS, 20);
    assert.equal(FACTION_LAIR_WALL_PERCENT, 50);
    assert.equal(FACTION_LAIR_MIN_CAMP_POWER, 10_000);
  });

  test('每营战力 = 全服前 10 名合计 ÷ 15（向下取整），不低于 10,000', () => {
    // 需求「线上实测」：前 10 名合计约 385 万 → 约 25.6 万
    assert.equal(factionLairCampPower(3_850_000), Math.floor(3_850_000 / 15));
    assert.equal(factionLairCampPower(0), 10_000);
    assert.equal(factionLairCampPower(149_999), 10_000);
    assert.equal(factionLairCampPower(150_000), 10_000);
    assert.equal(factionLairCampPower(150_001), 10_000);
    assert.equal(factionLairCampPower(Number.NaN), 10_000);
  });

  test('编成按 义兵 100 : 刀盾 30 : 弓箭 40 : 轻骑 12 缩放（与势力围城军同一比例）', () => {
    const power = 250_000;
    const army = factionLairGarrison(power);
    assert.deepEqual(army, factionSiegeArmy(power));
    const militia = army.militia as number;
    assert.ok(militia > 0);
    assert.equal(army.swordsman, Math.max(1, Math.round((30 * power) / armyPower({ militia: 100, swordsman: 30, archer: 40, cavalry: 12 }))));
    // 不带冲车 / 运输 / 斥候
    for (const kind of ['siege_ram', 'porter', 'scout'] as const) {
      assert.equal(army[kind], undefined, kind);
    }
  });

  test('歼灭奖励：每 1 点守军战力金币 2、木粮石铁各 10（打输也按歼灭数发）', () => {
    const reward = factionLairKillReward(1234);
    assert.deepEqual(reward, { gold: 2468, wood: 12340, food: 12340, stone: 12340, iron: 12340 });
    assert.deepEqual(factionLairKillReward(0), { gold: 0, wood: 0, food: 0, stone: 0, iron: 0 });
  });

  test('声望按歼灭战力的 1%（不是世界地图战斗的 1:1）', () => {
    assert.equal(FACTION_LAIR_PRESTIGE_PERCENT, 1);
    assert.equal(factionLairPrestige(250_000), 2_500);
    assert.equal(factionLairPrestige(99), 0);
    assert.equal(factionLairPrestige(100), 1);
  });

  test('灭亡榜单 = 黄巾之乱同名次的 3 倍（第 1 / 2~3 / 4~10 / 其余参与者）', () => {
    const yt = (rank: number): (typeof YT_REWARD_TIERS)[number] =>
      YT_REWARD_TIERS.find((tier) => rank <= tier.maxRank) as (typeof YT_REWARD_TIERS)[number];
    for (const rank of [1, 2, 3, 4, 10, 11, 250]) {
      const lair = factionLairDestroyReward(rank).reward;
      const base = yt(rank).reward;
      assert.equal(lair.gold, base.gold * 3, `rank ${rank} gold`);
      for (const key of ['wood', 'food', 'stone', 'iron'] as const) {
        assert.equal(lair[key], base[key] * 3, `rank ${rank} ${key}`);
      }
    }
    // 需求表的数值：第 1 名 18,000 + 各 90,000；2~3 名 12,000 + 各 60,000；4~10 名 7,500 + 各 36,000；其余 2,400 + 各 9,000
    assert.deepEqual(factionLairDestroyReward(1).reward, { gold: 18000, wood: 90000, food: 90000, stone: 90000, iron: 90000 });
    assert.deepEqual(factionLairDestroyReward(2).reward, { gold: 12000, wood: 60000, food: 60000, stone: 60000, iron: 60000 });
    assert.deepEqual(factionLairDestroyReward(10).reward, { gold: 7500, wood: 36000, food: 36000, stone: 36000, iron: 36000 });
    assert.deepEqual(factionLairDestroyReward(11).reward, { gold: 2400, wood: 9000, food: 9000, stone: 9000, iron: 9000 });
    assert.equal(FACTION_LAIR_DESTROY_TIERS.length, 4);
  });

  test('当前营剩余百分比与营号：20 营全在打第 1 营，只剩 1 营打第 20 营', () => {
    const power = 100_000;
    const full = factionLairGarrison(power);
    assert.equal(factionLairRemainingPercent(null, power), 100);
    assert.equal(factionLairRemainingPercent(full, power), 100);
    const half = Object.fromEntries(Object.entries(full).map(([kind, count]) => [kind, Math.floor((count as number) / 2)]));
    const percent = factionLairRemainingPercent(half, power);
    assert.ok(percent > 45 && percent < 55, `half = ${percent}`);
    assert.equal(factionLairCampNo(20, 20), 1);
    assert.equal(factionLairCampNo(20, 19), 2);
    assert.equal(factionLairCampNo(20, 1), 20);
  });

  test('侦察老巢看到的是当前营守军：满营给满编、打输给残血、废墟给空编队', () => {
    const power = 100_000;
    const full = factionLairGarrison(power);
    assert.deepEqual(factionLairScoutGarrison({ remaining: null, camp_power: power, destroyed_at: null }), full);
    const half = { militia: 10 };
    assert.deepEqual(factionLairScoutGarrison({ remaining: half, camp_power: power, destroyed_at: null }), half);
    assert.deepEqual(factionLairScoutGarrison({ remaining: half, camp_power: power, destroyed_at: new Date() }), {});
    assert.deepEqual(factionLairScoutGarrison(null), {});
  });

  test('24 小时没人进攻恢复 1 营：从最后一次战斗算起，从没打过不恢复，最多回到 20 营', () => {
    const now = new Date('2026-11-20T00:00:00Z');
    const hour = 60 * 60 * 1000;
    const idle = (hours: number): Date => new Date(now.getTime() - hours * hour);
    // 从没被打过：不恢复
    assert.equal(factionLairRecoveredCamps({ campsRemaining: 15, campsTotal: 20, lastBattleAt: null, now, recoverMs: FACTION_LAIR_RECOVER_MS }), 0);
    // 不到 24 小时：不恢复
    assert.equal(factionLairRecoveredCamps({ campsRemaining: 15, campsTotal: 20, lastBattleAt: idle(23), now, recoverMs: FACTION_LAIR_RECOVER_MS }), 0);
    // 满 24 小时：恢复 1 营
    assert.equal(factionLairRecoveredCamps({ campsRemaining: 15, campsTotal: 20, lastBattleAt: idle(24), now, recoverMs: FACTION_LAIR_RECOVER_MS }), 1);
    // 48 小时：恢复 2 营；但不超过总数
    assert.equal(factionLairRecoveredCamps({ campsRemaining: 3, campsTotal: 20, lastBattleAt: idle(48), now, recoverMs: FACTION_LAIR_RECOVER_MS }), 2);
    assert.equal(factionLairRecoveredCamps({ campsRemaining: 19, campsTotal: 20, lastBattleAt: idle(240), now, recoverMs: FACTION_LAIR_RECOVER_MS }), 1);
    // 已满营：不恢复
    assert.equal(factionLairRecoveredCamps({ campsRemaining: 20, campsTotal: 20, lastBattleAt: idle(240), now, recoverMs: FACTION_LAIR_RECOVER_MS }), 0);
  });

  test('每天刷新后当前营保留残血比例（按新满编战力缩放），残血极小也至少留 1 人', () => {
    const oldPower = 100_000;
    const newPower = 200_000;
    const fullOld = factionLairGarrison(oldPower);
    const half = Object.fromEntries(Object.entries(fullOld).map(([kind, count]) => [kind, Math.floor((count as number) / 2)]));
    const scaled = rescaledLairRemaining(half, oldPower, newPower) as Record<string, number>;
    const ratio = armyPower(scaled) / armyPower(factionLairGarrison(newPower));
    assert.ok(ratio > 0.45 && ratio < 0.55, `ratio = ${ratio}`);
    // 满营仍是满营
    assert.equal(rescaledLairRemaining(null, oldPower, newPower), null);
    // 只剩 1 名义兵：缩放到新战力后至少保留 1 名
    const last = rescaledLairRemaining({ militia: 1 }, oldPower, newPower) as Record<string, number>;
    assert.ok(armyPower(last) > 0);
  });
});
