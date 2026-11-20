// 五方势力记仇的纯规则（v116，AISLG-264）：基础仇恨公式、报复仇恨的半衰期折算、档位划分、
// 围城军强度 max(官府 × 倍率, 目标战力 × k) × 压制档、候选排序（仇恨 → 战力榜名次 → 距离）。
// 数据库流程（榜快照、选目标、档位只给请求者、同账号只被一家围）见 faction-hatred-db.test.ts，
// 需要 TEST_DATABASE_URL 时才会跑。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FACTION_HATRED_BASE_RANKS,
  FACTION_HATRED_HALF_LIFE_MS,
  factionHatredBase,
  factionHatredDecayedRetaliation,
  factionHatredHalfLifeMs,
  factionHatredLeaderboard,
  factionHatredSiegeOrder,
  factionHatredTier,
} from '../common/src/faction-hatred';
import {
  factionSiegeStrength,
  factionSiegeSuppressedPower,
  factionSiegeTargetPercentForDay,
} from '../common/src/faction-siege';
import { suppressionSiegePercent } from '../common/src/faction-suppression';
import { setTimeScaleCache } from '../common/src/time-scale';

const DAY = 24 * 60 * 60 * 1000;

describe('势力记仇的纯规则（无需数据库）', () => {
  test('基础仇恨：第 k 名 = G1 × (21 − k) ÷ 20（向下取整），榜外为 0', () => {
    const g1 = 21000;
    for (let rank = 1; rank <= FACTION_HATRED_BASE_RANKS; rank += 1) {
      assert.equal(factionHatredBase(rank, g1), Math.floor((g1 * (21 - rank)) / 20), `第 ${rank} 名`);
    }
    assert.equal(factionHatredBase(1, g1), g1, '榜首的基础仇恨 = G1（相当于清掉第 1 营的歼灭量）');
    assert.equal(factionHatredBase(20, g1), Math.floor(g1 / 20), '第 20 名 = G1 ÷ 20');
    assert.equal(factionHatredBase(21, g1), 0, '榜外为 0');
    assert.equal(factionHatredBase(0, g1), 0, '脏名次按榜外');
    assert.equal(factionHatredBase(1, 0), 0, 'G1 为 0 时没有基础仇恨');
    // 向下取整（不是四舍五入）：10001 × 19 / 20 = 9500.95
    assert.equal(factionHatredBase(2, 10001), 9500);
    assert.equal(factionHatredBase(1, FACTION_HATRED_BASE_RANKS === 20 ? 10000 : 0), 10000, 'G1 下限 1 万');
  });

  test('报复仇恨按半衰期 3 天折算（随缩放），折算后小于 1 视为 0', () => {
    const halfLifeMs = 3 * DAY;
    const now = new Date('2026-11-08T00:00:00Z');
    const decay = (retaliation: number, daysAgo: number): number =>
      factionHatredDecayedRetaliation({
        retaliation,
        updatedAt: new Date(now.getTime() - daysAgo * DAY),
        now,
        halfLifeMs,
      });
    assert.equal(decay(20000, 0), 20000, '刚打完不衰减');
    assert.equal(decay(20000, 3), 10000, '3 天后减半');
    assert.equal(decay(20000, 6), 5000, '6 天后剩四分之一');
    // 一周后剩约 20%（0.5^(7/3) ≈ 0.1984）
    assert.equal(decay(20000, 7), Math.floor(20000 * Math.pow(0.5, 7 / 3)));
    assert.ok(decay(20000, 7) >= 3900 && decay(20000, 7) <= 4000, `一周后约 20%（${decay(20000, 7)}）`);
    assert.equal(decay(1, 3), 0, '折算后小于 1 视为 0');
    assert.equal(decay(0, 0), 0);
    // 时钟回拨不放大仇恨
    assert.equal(
      factionHatredDecayedRetaliation({
        retaliation: 1000,
        updatedAt: new Date(now.getTime() + DAY),
        now,
        halfLifeMs,
      }),
      1000,
    );
  });

  test('半衰期随 time_scale 缩放（与围攻间隔同口径）', () => {
    setTimeScaleCache(1);
    assert.equal(factionHatredHalfLifeMs(), FACTION_HATRED_HALF_LIFE_MS, '未缩放时就是 3 天');
    setTimeScaleCache(50);
    assert.equal(factionHatredHalfLifeMs(), Math.max(1000, Math.floor(FACTION_HATRED_HALF_LIFE_MS / 50)));
    const now = new Date('2026-11-08T00:00:00Z');
    const scaledHalf = factionHatredHalfLifeMs();
    assert.equal(
      factionHatredDecayedRetaliation({
        retaliation: 1000,
        updatedAt: new Date(now.getTime() - scaledHalf),
        now,
      }),
      500,
      '指针走过一个（缩放后的）半衰期就减半',
    );
    setTimeScaleCache(1);
  });

  test('档位：前 5 名 target、第 6~20 名 noticed、其余 none；仇恨为 0 一律 none', () => {
    for (let rank = 1; rank <= 5; rank += 1) {
      assert.equal(factionHatredTier(rank, 1000), 'target', `第 ${rank} 名`);
    }
    for (let rank = 6; rank <= 20; rank += 1) {
      assert.equal(factionHatredTier(rank, 1000), 'noticed', `第 ${rank} 名`);
    }
    assert.equal(factionHatredTier(21, 1000), 'none', '榜外 none');
    assert.equal(factionHatredTier(1, 0), 'none', '仇恨为 0 一律 none');
    assert.equal(factionHatredTier(null, 1000), 'none', '不在榜上 none');
  });

  test('仇恨榜 = 基础仇恨 + 折算后的报复仇恨，按仇恨 → 战力榜名次排序（仇恨为 0 的不在榜上）', () => {
    const now = new Date('2026-11-08T00:00:00Z');
    const g1 = 21000;
    const entries = factionHatredLeaderboard({
      baseRanks: [
        { accountId: 'top1', rank: 1 },
        { accountId: 'top6', rank: 6 },
      ],
      rows: [
        // 3 天前打过一次老巢、歼灭 20,000：折算后 10,000，排在基础仇恨 15,750 的第 6 名之后
        { accountId: 'raider', retaliation: 20000, updatedAt: new Date(now.getTime() - 3 * DAY) },
        // 10 天前只歼灭 1 点：折算后小于 1，视为 0、不进榜
        { accountId: 'ghost', retaliation: 1, updatedAt: new Date(now.getTime() - 10 * DAY) },
      ],
      g1,
      now,
      halfLifeMs: 3 * DAY,
    });
    assert.deepEqual(
      entries.map((entry) => [entry.accountId, entry.hatred, entry.powerRank]),
      [
        ['top1', 21000, 1],
        ['top6', 15750, 6],
        ['raider', 10000, null],
      ],
      '榜首 21,000 > 第 6 名 15,750（21,000 × 15 ÷ 20）> 打完 3 天前老巢的 10,000',
    );
    assert.ok(!entries.some((entry) => entry.accountId === 'ghost'), '折算后为 0 的不进榜');
  });

  test('候选排序：仇恨 → 战力榜名次（榜外垫底）→ 离老巢距离 → 账号 id', () => {
    const base = { distance: 50, accountId: 'a' };
    const sort = (list: Array<{ hatred: number; powerRank: number | null; distance: number; accountId: string }>) =>
      [...list].sort(factionHatredSiegeOrder).map((entry) => entry.accountId);
    assert.deepEqual(
      sort([
        { ...base, accountId: 'low', hatred: 100, powerRank: 1 },
        { ...base, accountId: 'high', hatred: 200, powerRank: null },
      ]),
      ['high', 'low'],
      '仇恨高的先，哪怕不在战力榜上',
    );
    assert.deepEqual(
      sort([
        { ...base, accountId: 'rank6', hatred: 100, powerRank: 6 },
        { ...base, accountId: 'rank2', hatred: 100, powerRank: 2 },
        { ...base, accountId: 'rankOut', hatred: 100, powerRank: null },
      ]),
      ['rank2', 'rank6', 'rankOut'],
      '仇恨相同按战力榜名次，榜外垫底',
    );
    assert.deepEqual(
      sort([
        { ...base, accountId: 'far', hatred: 100, powerRank: null, distance: 90 },
        { ...base, accountId: 'near', hatred: 100, powerRank: null, distance: 10 },
      ]),
      ['near', 'far'],
      '再相同按分城离老巢距离',
    );
  });

  test('围城军强度 = max(官府等级 × 倍率, 目标账号战力 × k)：榜前 20 的 k 随天数 10% / 14% / 18%', () => {
    assert.equal(factionSiegeTargetPercentForDay(7), 0, '第 8 天前不围攻');
    assert.equal(factionSiegeTargetPercentForDay(8), 10);
    assert.equal(factionSiegeTargetPercentForDay(14), 10);
    assert.equal(factionSiegeTargetPercentForDay(15), 14);
    assert.equal(factionSiegeTargetPercentForDay(21), 14);
    assert.equal(factionSiegeTargetPercentForDay(22), 18);
    assert.equal(factionSiegeTargetPercentForDay(40), 18);

    // 榜首：账号战力 161.9 万、官府 20 级、第 22 天起（本单需求第四节模拟的榜首）
    const topAccountPower = 1_619_000;
    for (const [day, multiplier, percent] of [
      [8, 100, 10],
      [15, 150, 14],
      [22, 200, 18],
    ] as const) {
      const strength = factionSiegeStrength({ governmentLevel: 20, multiplier, targetPower: topAccountPower, day });
      assert.equal(strength, Math.max(20 * multiplier, Math.floor((topAccountPower * percent) / 100)), `第 ${day} 天`);
    }
    const top22 = factionSiegeStrength({ governmentLevel: 20, multiplier: 200, targetPower: topAccountPower, day: 22 });
    assert.ok(Math.abs(top22 - 291_420) <= 1, `榜首第 22 天起围城军约 29.1 万（实际 ${top22}）`);
    // 压制 3 档（25%）：大户面对的围城军只有四分之一
    assert.equal(
      factionSiegeSuppressedPower(top22, suppressionSiegePercent(3)),
      Math.floor((top22 * 25) / 100),
      '3 档压制后为 25%',
    );

    // 中小玩家：账号战力乘 k 后远小于原公式，行为与 v107 完全一致（不会更惨）
    for (const [gov, multiplier, targetPower] of [
      [5, 100, 500],
      [5, 150, 900],
      [10, 200, 1500],
    ] as const) {
      const day = multiplier === 100 ? 8 : multiplier === 150 ? 15 : 22;
      assert.equal(
        factionSiegeStrength({ governmentLevel: gov, multiplier, targetPower, day }),
        gov * multiplier,
        `官府 ${gov} 级、账号战力 ${targetPower}：仍是官府 × 倍率`,
      );
    }
    // 取 max 而不是相加：官府 20 级（第 8 天 2,000 / 第 22 天起 4,000）与目标战力乘 k 里更大的那个
    assert.equal(factionSiegeStrength({ governmentLevel: 20, multiplier: 100, targetPower: 100_000, day: 8 }), 10_000);
    assert.equal(factionSiegeStrength({ governmentLevel: 20, multiplier: 100, targetPower: 10_000, day: 8 }), 2_000);
    assert.equal(factionSiegeStrength({ governmentLevel: 20, multiplier: 200, targetPower: 10_000, day: 22 }), 4_000);
    assert.equal(factionSiegeStrength({ governmentLevel: 20, multiplier: 100, targetPower: Number.NaN, day: 8 }), 2_000, '脏战力按 0');
  });
});