// 竞技场规则（v53，AISLG-145）的单元测试：挑战名次范围、每日 / 首次进档奖励、三局两胜的
// 轮空与提前结束、同一种子可复算、竞技日边界、守擂者强度顺序。不碰数据库（数据库链路由冒烟流程验证）。
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ARENA_ARMY_BASE,
  ARENA_ARMY_PER_LEAD,
  ARENA_DAILY_CHALLENGES,
  ARENA_NPC_COUNT,
  ARENA_SLOTS,
  arenaDayIndex,
  arenaNextDayAt,
  canChallengeRank,
  dailyRewardForRank,
  milestoneRewards,
  npcBaseAttr,
  npcLineup,
  playArenaMatch,
  seededRng,
  standardArmy,
  standardArmySize,
  type ArenaFighter,
} from '../common/src/arena';

const fighter = (lead: number, force = 50, wit = 50): ArenaFighter => ({ name: `将${lead}`, lead, force, wit, level: 10 });

test('挑战范围：只能打比自己靠前、差距不超过 10 名的席位', () => {
  assert.equal(canChallengeRank(21, 11), true, '差 10 名可以挑');
  assert.equal(canChallengeRank(21, 10), false, '差 11 名不行');
  assert.equal(canChallengeRank(5, 5), false, '不能挑自己的名次');
  assert.equal(canChallengeRank(5, 6), false, '不能挑比自己靠后的');
  assert.equal(canChallengeRank(2, 1), true);
});

test('每日奖励按名次档：1 名 / 2–10 / 11–50 / 51–200 / 其余', () => {
  assert.equal(dailyRewardForRank(1), 50_000);
  assert.equal(dailyRewardForRank(2), 30_000);
  assert.equal(dailyRewardForRank(10), 30_000);
  assert.equal(dailyRewardForRank(11), 15_000);
  assert.equal(dailyRewardForRank(50), 15_000);
  assert.equal(dailyRewardForRank(51), 5_000);
  assert.equal(dailyRewardForRank(200), 5_000);
  assert.equal(dailyRewardForRank(201), 1_000);
});

test('首次进档奖励：历史最好名次跨过档位时发一次，合计金币与新档位列表', () => {
  assert.deepEqual(milestoneRewards(60, 9), { gold: 150_000, tiers: [50, 10] });
  assert.deepEqual(milestoneRewards(60, 60), { gold: 0, tiers: [] }, '没有新进档不发');
  assert.deepEqual(milestoneRewards(10, 9), { gold: 0, tiers: [] }, '已在前 10 时再进前 10 以内不重复发');
  assert.deepEqual(milestoneRewards(10, 1), { gold: 300_000, tiers: [1] }, '首次进第 1 名发第 1 档');
  assert.deepEqual(milestoneRewards(1, 1), { gold: 0, tiers: [] }, '同一档不重复发');
});

test('进档只在名次升进新档时发：入榜基线之内的上升不发，入榜时已在的档不补发', () => {
  assert.deepEqual(milestoneRewards(21, 21), { gold: 0, tiers: [] }, '入榜名次即基线，入榜不发');
  assert.deepEqual(milestoneRewards(30, 25), { gold: 0, tiers: [] }, '同在前 50 档内上升不发');
  assert.deepEqual(milestoneRewards(60, 30), { gold: 50_000, tiers: [50] }, '从档外升进前 50 才发前 50 档');
});

test('标准军队：人数 = 基础兵数 + 统率 × 每点兵数，刀盾 / 弓箭各一半（相差不超过 1）', () => {
  assert.equal(standardArmySize(0), ARENA_ARMY_BASE);
  assert.equal(standardArmySize(30), ARENA_ARMY_BASE + 30 * ARENA_ARMY_PER_LEAD);
  assert.ok(standardArmySize(90) > standardArmySize(30), '统率高兵多');
  const army = standardArmy(30);
  assert.equal((army.swordsman ?? 0) + (army.archer ?? 0), standardArmySize(30));
  assert.ok(Math.abs((army.swordsman ?? 0) - (army.archer ?? 0)) <= 1);
});

test('三局两胜：挑战方前两局全胜，第三局不再进行', () => {
  const challengers = [fighter(1), fighter(1), fighter(1)];
  const defenders: Array<ArenaFighter | null> = [null, null, null];
  const result = playArenaMatch(challengers, defenders, seededRng(1));
  assert.equal(result.challengerWon, true);
  assert.equal(result.rounds.length, 2, '决出胜负后不打第三局');
  assert.deepEqual(result.rounds.map((r) => r.reason), ['bye_defender', 'bye_defender']);
  assert.equal(result.challengerWins, 2);
  assert.equal(result.defenderWins, 0);
});

test('轮空：一方缺人的号位判对方胜，双方都缺判守擂方胜', () => {
  const result = playArenaMatch([fighter(1), null, fighter(1)], [null, fighter(1), null], seededRng(2));
  assert.deepEqual(result.rounds.map((r) => r.winner), ['challenger', 'defender', 'challenger']);
  assert.deepEqual(result.rounds.map((r) => r.reason), ['bye_defender', 'bye_challenger', 'bye_defender']);
  assert.equal(result.challengerWon, true);

  const bothEmpty = playArenaMatch([null, null, null], [null, null, null], seededRng(3));
  assert.equal(bothEmpty.challengerWon, false);
  assert.equal(bothEmpty.defenderWins, 2);
  assert.equal(bothEmpty.rounds.length, 2, '守擂方先赢两局即结束');
  assert.equal(bothEmpty.rounds[0].reason, 'none');
});

test('同一种子复算结果一致（战报存种子即可重放）', () => {
  const mine = [fighter(40, 60, 30), fighter(30, 40, 50), fighter(20, 70, 20)];
  const theirs = [fighter(35, 50, 40), fighter(45, 30, 30), fighter(25, 60, 60)];
  const a = playArenaMatch(mine, theirs, seededRng(424242));
  const b = playArenaMatch(mine, theirs, seededRng(424242));
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.rounds.every((r) => r.reason === 'fought'), true, '三人满阵都会交战');
  assert.ok(a.rounds.length >= 2 && a.rounds.length <= ARENA_SLOTS);
});

test('竞技日边界：东八区 0 点（缩放为 1 时），次日开始时刻严格晚于当前', () => {
  // 2026-10-12T10:00Z = 东八区 18:00，下一个竞技日 = 2026-10-13 00:00 东八区 = 2026-10-12T16:00Z
  const now = new Date('2026-10-12T10:00:00Z');
  assert.equal(arenaNextDayAt(now, 1).toISOString(), '2026-10-12T16:00:00.000Z');
  assert.equal(arenaDayIndex(new Date('2026-10-12T15:59:59Z'), 1) + 1, arenaDayIndex(new Date('2026-10-12T16:00:00Z'), 1));
  // 缩放 50：一个竞技日 = 24h ÷ 50 = 28.8 分钟，次日开始时刻在 (now, now + 一天]
  const next = arenaNextDayAt(now, 50).getTime();
  assert.ok(next > now.getTime());
  assert.ok(next - now.getTime() <= (24 * 60 * 60 * 1000) / 50);
});

test('守擂者强度：名次越靠前越强，1 号 ≈ 名将，20 号 ≈ 普通将', () => {
  let prev = Number.POSITIVE_INFINITY;
  for (let i = 1; i <= ARENA_NPC_COUNT; i += 1) {
    const v = npcBaseAttr(i);
    assert.ok(v <= prev, `第 ${i} 名不应强于第 ${i - 1} 名`);
    prev = v;
  }
  assert.equal(npcBaseAttr(1), 60);
  assert.equal(npcBaseAttr(ARENA_NPC_COUNT), 22);
  const lineup = npcLineup(1, seededRng(7_001));
  assert.equal(lineup.length, ARENA_SLOTS);
  assert.ok(lineup[0].lead > lineup[0].force, '1 号位统率型');
  assert.ok(lineup[1].force > lineup[1].lead, '2 号位武力型');
  assert.ok(lineup[2].wit > lineup[2].lead, '3 号位智力型');
});

test('规则常量：每日挑战上限为 5', () => {
  assert.equal(ARENA_DAILY_CHALLENGES, 5);
});
