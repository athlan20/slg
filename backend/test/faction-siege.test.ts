// 势力围攻的纯规则（v100，AISLG-240）：倍率 / 围攻周 / 围城军编成 / 城防 35 × 6 次 / 入池条件 / 节奏常数，
// 以及第 8~14 天官府 5 级分城的胜率模拟（与需求表一致）。事务流程见 faction-siege-db.test.ts 与
// faction-siege-swallow.test.ts（需 TEST_DATABASE_URL）。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { setTimeScaleCache } from '../common/src/time-scale';
import {
  FACTION_SIEGE_LOSS_COOLDOWN_MS,
  FACTION_SIEGE_WEEKLY_CAP,
  FACTION_SIEGE_WARNING_MS,
  factionSiegeArmy,
  factionSiegeDenial,
  factionSiegeLossCooldownMs,
  factionSiegeMultiplierForDay,
  factionSiegePower,
  factionSiegeWeekOf,
} from '../common/src/faction-siege';
import { DURABILITY_DAMAGE_PER_WIN, DURABILITY_MAX, PVP_CITY_TRUCE_MS, settleDurability, siegeDamage } from '../common/src/protection';
import { armyPower, resolveBattle, wallDefensePercent } from '../common/src/battle';

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** 确定性随机源（与 battle-calibration 同实现）：同一批模拟可复算 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('势力围攻的纯规则（无需数据库）', () => {
  test('倍率按本季天数：第 8~14 天 100、15~21 天 150、22 天起 200，第 8 天前为 0（不围攻）', () => {
    for (let day = 1; day <= 7; day += 1) {
      assert.equal(factionSiegeMultiplierForDay(day), 0, `第 ${day} 天`);
    }
    for (let day = 8; day <= 14; day += 1) {
      assert.equal(factionSiegeMultiplierForDay(day), 100, `第 ${day} 天`);
    }
    for (let day = 15; day <= 21; day += 1) {
      assert.equal(factionSiegeMultiplierForDay(day), 150, `第 ${day} 天`);
    }
    for (const day of [22, 28, 40]) {
      assert.equal(factionSiegeMultiplierForDay(day), 200, `第 ${day} 天`);
    }
  });

  test('围攻周按本季第 8、15、22 天起算，第 8 天前没有周（不能围攻）', () => {
    const start = new Date('2026-11-01T00:00:00Z');
    assert.equal(factionSiegeWeekOf(start, new Date(start.getTime() + 6 * DAY)), null);
    const week1 = factionSiegeWeekOf(start, new Date(start.getTime() + 7 * DAY));
    assert.equal(week1?.index, 0);
    assert.equal(week1?.start.toISOString(), new Date(start.getTime() + 7 * DAY).toISOString());
    assert.equal(week1?.end.toISOString(), new Date(start.getTime() + 14 * DAY).toISOString());
    const week2 = factionSiegeWeekOf(start, new Date(start.getTime() + 14 * DAY));
    assert.equal(week2?.index, 1);
    assert.equal(week2?.start.toISOString(), new Date(start.getTime() + 14 * DAY).toISOString());
    const week3 = factionSiegeWeekOf(start, new Date(start.getTime() + 21 * DAY));
    assert.equal(week3?.index, 2);
    assert.equal(factionSiegeWeekOf(start, new Date(start.getTime() + 27 * DAY))?.index, 2, '第 28 天仍属第 3 周');
    assert.equal(factionSiegeWeekOf(start, new Date(start.getTime() + 28 * DAY))?.index, 3);
  });

  test('围城军战力 = 官府等级 × 倍率，编成按 3 级 NPC 城守军的比例缩放、不带冲车', () => {
    const basePower = 100 * 2 + 30 * 5 + 40 * 5 + 12 * 8;
    for (const [gov, multiplier] of [[5, 100], [10, 150], [20, 200]] as const) {
      const power = factionSiegePower(gov, multiplier);
      assert.equal(power, gov * multiplier);
      const army = factionSiegeArmy(power);
      assert.deepEqual(Object.keys(army).sort(), ['archer', 'cavalry', 'militia', 'swordsman'], '不带冲车 / 床弩');
      // 参考战力对齐目标（逐兵种四舍五入带来的误差不超过 1 个兵种单位）
      assert.ok(Math.abs(armyPower(army) - power) <= 10, `${gov} 级战力 ${armyPower(army)} ≈ ${power}`);
      // 比例仍是 100 : 30 : 40 : 12
      const scale = power / basePower;
      assert.ok(Math.abs((army.militia ?? 0) - 100 * scale) <= 1);
      assert.ok(Math.abs((army.swordsman ?? 0) - 30 * scale) <= 1);
      assert.ok(Math.abs((army.archer ?? 0) - 40 * scale) <= 1);
      assert.ok(Math.abs((army.cavalry ?? 0) - 12 * scale) <= 1);
    }
    assert.deepEqual(factionSiegeArmy(0), {}, '第 8 天前没有围城军');
  });

  test('第 8~14 天：官府 5 级分城满编驻军多数守得住、驻军一半时多数失守（与需求模拟一致）', () => {
    const gov = 5;
    const wall = wallDefensePercent(Math.min(gov, 10));
    const full = { militia: 30 * gov, archer: 8 * gov };
    const half = { militia: 15 * gov, archer: 4 * gov };
    const siegeArmy = factionSiegeArmy(factionSiegePower(gov, 100));
    const winRate = (garrison: { militia: number; archer: number }): number => {
      const rng = mulberry32(20261107);
      let wins = 0;
      const rounds = 200;
      for (let i = 0; i < rounds; i += 1) {
        if (resolveBattle(siegeArmy, garrison, { siege: true, wallDefensePercent: wall, rng }).attackerWon) {
          wins += 1;
        }
      }
      return wins / rounds;
    };
    assert.ok(winRate(full) <= 0.05, `满编驻军守住（势力胜率 ${winRate(full)}）`);
    assert.ok(winRate(half) >= 0.9, `驻军一半多数失守（势力胜率 ${winRate(half)}）`);
  });

  test('城防 100 → 65 → 50 → 35 → 20 → 5 → 0：隔 6 小时打一次、每次打赢扣 35，跨 30 小时（约 6 次）', () => {
    setTimeScaleCache(1);
    let durability: number | null = DURABILITY_MAX;
    let settledAt: Date | null = null;
    let truceUntil: Date | null = null;
    const start = new Date('2026-11-08T00:00:00Z');
    const trail: number[] = [];
    let hits = 0;
    for (let i = 0; i < 6; i += 1) {
      const now = new Date(start.getTime() + i * 6 * HOUR);
      const before = settleDurability(durability, settledAt, truceUntil, now);
      trail.push(before);
      const { damage, ramBonus } = siegeDamage(0, 500);
      assert.equal(damage, DURABILITY_DAMAGE_PER_WIN, '围城军不带冲车 → 恒 35');
      assert.equal(ramBonus, 0);
      durability = Math.max(0, before - damage);
      settledAt = now;
      truceUntil = new Date(now.getTime() + PVP_CITY_TRUCE_MS);
      hits += 1;
      if (durability === 0) {
        break;
      }
    }
    assert.deepEqual(trail, [100, 85, 70, 55, 40, 25], '每次先回涨 2 小时共 20 再扣 35');
    assert.equal(durability, 0);
    assert.equal(hits, 6, '连赢 6 次');
    // 第 6 次结算发生在发起后 30 小时
    assert.equal((6 - 1) * 6, 30);
  });

  test('入池条件：满 7 天、不是主城、不是名城、不在新手保护 / 主动免战 / 被动免战', () => {
    const now = new Date('2026-11-10T00:00:00Z');
    const base = {
      day: 8,
      isMainCity: false,
      famous: false,
      newbieUntil: null,
      selfTruceUntil: null,
      cityTruceUntil: null,
      now,
    };
    assert.equal(factionSiegeDenial(base), null);
    assert.equal(factionSiegeDenial({ ...base, day: 7 }), 'SEASON_TOO_EARLY');
    assert.equal(factionSiegeDenial({ ...base, isMainCity: true }), 'MAIN_CITY');
    assert.equal(factionSiegeDenial({ ...base, famous: true }), 'FAMOUS_CITY');
    assert.equal(factionSiegeDenial({ ...base, newbieUntil: new Date(now.getTime() + HOUR) }), 'TARGET_PROTECTED');
    assert.equal(factionSiegeDenial({ ...base, selfTruceUntil: new Date(now.getTime() + HOUR) }), 'TARGET_PROTECTED');
    assert.equal(factionSiegeDenial({ ...base, cityTruceUntil: new Date(now.getTime() + HOUR) }), 'TARGET_IN_TRUCE');
    assert.equal(factionSiegeDenial({ ...base, cityTruceUntil: new Date(now.getTime() - HOUR) }), null, '免战已过');
  });

  test('节奏常数：预警 60 分钟、同城 6 小时、打输 24 小时、每周 2 座（随缩放）', () => {
    assert.equal(FACTION_SIEGE_WARNING_MS, HOUR);
    assert.equal(FACTION_SIEGE_LOSS_COOLDOWN_MS, 24 * HOUR);
    assert.equal(FACTION_SIEGE_WEEKLY_CAP, 2);
    setTimeScaleCache(1);
    assert.equal(factionSiegeLossCooldownMs(), 24 * HOUR);
    setTimeScaleCache(50);
    assert.equal(factionSiegeLossCooldownMs(), Math.floor((24 * HOUR) / 50));
    setTimeScaleCache(1);
  });
});
