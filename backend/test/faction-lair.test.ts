// 攻破老巢的纯规则（v101，AISLG-241；v106，AISLG-247 改为 20 营由弱到强）：20 营、两个锚点与营序号的
// 战力公式、编成比例、歼灭奖励 / 声望、灭亡榜单（黄巾之乱同名次的 3 倍）、24 小时恢复、每天刷新后的残血比例。
// 事务流程见 faction-lair-flow.test.ts（需 TEST_DATABASE_URL）。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FACTION_LAIR_ANCHOR_PERCENT,
  FACTION_LAIR_CAMPS,
  FACTION_LAIR_DESTROY_TIERS,
  FACTION_LAIR_MIN_CAMP_POWER,
  FACTION_LAIR_PRESTIGE_PERCENT,
  FACTION_LAIR_R10_RANK,
  FACTION_LAIR_R3_RANK,
  FACTION_LAIR_RECOVER_MS,
  FACTION_LAIR_WALL_PERCENT,
  factionLairAnchorPower,
  factionLairCampNo,
  factionLairCampPowerAt,
  factionLairCurrentCampPower,
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
  test('老巢共 20 营，城墙减伤 50%，每营战力下限 10,000，锚点排名第 10 / 第 3 名，系数 0.35', () => {
    assert.equal(FACTION_LAIR_CAMPS, 20);
    assert.equal(FACTION_LAIR_WALL_PERCENT, 50);
    assert.equal(FACTION_LAIR_MIN_CAMP_POWER, 10_000);
    assert.equal(FACTION_LAIR_R10_RANK, 10);
    assert.equal(FACTION_LAIR_R3_RANK, 3);
    assert.equal(FACTION_LAIR_ANCHOR_PERCENT, 35);
  });

  test('两个锚点：G1 = max(10,000, R10 × 0.35)、G20 = max(G1, R3 × 0.35)', () => {
    // 需求验收：线上快照 R10 = 47,068、R3 = 443,174 → G1 = 16,474、G20 = 155,111
    const anchors = factionLairAnchorPower(47_068, 443_174);
    assert.equal(anchors.g1, 16_474);
    assert.equal(anchors.g20, 155_111);
    // 系数为 0.35、结果四舍五入到整数：47,068 × 0.35 = 16,473.8 → 16,474；443,174 × 0.35 = 155,110.9 → 155,111
    assert.deepEqual(factionLairAnchorPower(100_000, 200_000), { g1: 35_000, g20: 70_000 });
    // 全服无兵：两个锚点都是下限 10,000
    assert.deepEqual(factionLairAnchorPower(0, 0), { g1: 10_000, g20: 10_000 });
    assert.deepEqual(factionLairAnchorPower(Number.NaN, Number.NaN), { g1: 10_000, g20: 10_000 });
    // R3 < R10（榜单异常 / 只有一两个人有兵）：G20 不低于 G1，不会出现后一营比前一营弱
    assert.deepEqual(factionLairAnchorPower(50_000, 10_000), { g1: 17_500, g20: 17_500 });
    // 低于下限的小榜单：都是 10,000（除法取整后也不低于下限）
    assert.deepEqual(factionLairAnchorPower(1_000, 2_000), { g1: 10_000, g20: 10_000 });
  });

  test('第 k 营战力 Gk = G1 × (G20 ÷ G1)^((k−1) ÷ 19)，向下取整，第 1 营最弱、第 20 营最强', () => {
    const { g1, g20 } = factionLairAnchorPower(47_068, 443_174);
    assert.equal(factionLairCampPowerAt(g1, g20, 1), 16_474, '第 1 营 = G1');
    assert.equal(factionLairCampPowerAt(g1, g20, 20), 155_111, '第 20 营 = G20');
    // 需求表里的近似值：第 5 营约 26,400、第 10 营约 47,500、第 15 营约 86,000
    assert.equal(factionLairCampPowerAt(g1, g20, 5), 26_413);
    assert.equal(factionLairCampPowerAt(g1, g20, 10), 47_653);
    assert.equal(factionLairCampPowerAt(g1, g20, 15), 85_974);
    // 单调递增、20 营各不相同（锚点拉开时）
    const powers = Array.from({ length: FACTION_LAIR_CAMPS }, (_, index) => factionLairCampPowerAt(g1, g20, index + 1));
    for (let index = 1; index < powers.length; index += 1) {
      assert.ok(powers[index] > powers[index - 1], `第 ${index + 1} 营应比第 ${index} 营强`);
    }
    // 两个锚点相同时（开季 / 旧库回填）：20 营同一强度，等于下限
    for (let campNo = 1; campNo <= FACTION_LAIR_CAMPS; campNo += 1) {
      assert.equal(factionLairCampPowerAt(10_000, 10_000, campNo), 10_000);
    }
    // 营序号越界按 1 / 20 夹住；G20 < G1 时按 G1 兜底
    assert.equal(factionLairCampPowerAt(g1, g20, 0), g1);
    assert.equal(factionLairCampPowerAt(g1, g20, 99), g20);
    assert.equal(factionLairCampPowerAt(120_000, 30_000, 20), 120_000);
  });

  test('当前营战力按剩余营数取 Gk：20 营全在是第 1 营，只剩 1 营是第 20 营', () => {
    const row = (campsRemaining: number) => ({
      camps_total: 20,
      camps_remaining: campsRemaining,
      camp_power_g1: 16_474,
      camp_power_g20: 155_111,
    });
    assert.equal(factionLairCurrentCampPower(row(20)), 16_474);
    assert.equal(factionLairCurrentCampPower(row(19)), 18_537);
    assert.equal(factionLairCurrentCampPower(row(1)), 155_111);
    assert.equal(factionLairCampNo(20, 19), 2);
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

  test('侦察老巢看到的是当前营守军：满营给当前营的满编、打输给残血、废墟给空编队', () => {
    const lair = (campsRemaining: number, remaining: Record<string, number> | null, destroyed: Date | null = null) => ({
      camps_total: 20,
      camps_remaining: campsRemaining,
      remaining,
      camp_power_g1: 16_474,
      camp_power_g20: 155_111,
      destroyed_at: destroyed,
    });
    // 20 营全在 → 第 1 营（最弱）；只剩 1 营 → 第 20 营（最强）
    assert.deepEqual(factionLairScoutGarrison(lair(20, null)), factionLairGarrison(16_474));
    assert.deepEqual(factionLairScoutGarrison(lair(1, null)), factionLairGarrison(155_111));
    const half = { militia: 10 };
    assert.deepEqual(factionLairScoutGarrison(lair(20, half)), half);
    assert.deepEqual(factionLairScoutGarrison(lair(20, half, new Date())), {});
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
