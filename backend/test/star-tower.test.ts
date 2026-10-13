// 将星塔规则（v55，AISLG-146）的单元测试：层数与 Boss 层、敌方人数与属性递增、同一层敌方固定、
// 首通奖励、下一层与全部通关边界，以及沿用竞技场三局两胜的对战。不碰数据库（数据库链路另行验证）。
import test from 'node:test';
import assert from 'node:assert/strict';

import { playArenaMatch, seededRng, type ArenaFighter } from '../common/src/arena';
import {
  STAR_TOWER_BOSS_EVERY,
  STAR_TOWER_FLOORS,
  isStarTowerBossFloor,
  nextStarTowerFloor,
  starTowerBaseAttr,
  STAR_TOWER_ENEMY_COUNT,
  starTowerFloorEnemies,
  starTowerReward,
} from '../common/src/star-tower';

test('每 10 层一个 Boss 层，共 100 层', () => {
  assert.equal(STAR_TOWER_FLOORS, 100);
  assert.equal(STAR_TOWER_BOSS_EVERY, 10);
  assert.equal(isStarTowerBossFloor(10), true);
  assert.equal(isStarTowerBossFloor(100), true);
  assert.equal(isStarTowerBossFloor(9), false);
  assert.equal(isStarTowerBossFloor(0), false);
});

test('敌方固定 3 名，与三个号位一一对应（不出现缺人轮空）', () => {
  assert.equal(STAR_TOWER_ENEMY_COUNT, 3);
  for (let floor = 1; floor <= STAR_TOWER_FLOORS; floor += 1) {
    assert.equal(starTowerFloorEnemies(floor).length, 3, `第 ${floor} 层人数`);
  }
});

test('同一层的敌方阵容固定（不入库，按层号重算结果一致）', () => {
  for (const floor of [1, 7, 10, 42, 100]) {
    assert.deepEqual(starTowerFloorEnemies(floor), starTowerFloorEnemies(floor), `第 ${floor} 层`);
  }
});

test('敌方属性都是正整数，三项属性各不相同（号位有偏向）', () => {
  for (let floor = 1; floor <= STAR_TOWER_FLOORS; floor += 1) {
    for (const e of starTowerFloorEnemies(floor)) {
      for (const v of [e.lead, e.force, e.wit, e.level]) {
        assert.ok(Number.isInteger(v) && v >= 1, `第 ${floor} 层属性 ${v}`);
      }
    }
  }
  const [a, b, c] = starTowerFloorEnemies(10);
  assert.ok(a.lead > a.force && b.force > b.lead && c.wit > c.lead);
});

test('Boss 层敌将用名将的幻影名，普通层用随机武将名', () => {
  for (const e of starTowerFloorEnemies(20)) {
    assert.ok(e.name.endsWith('·幻影'), e.name);
  }
  for (const e of starTowerFloorEnemies(3)) {
    assert.ok(!e.name.endsWith('·幻影'), e.name);
  }
});

test('首通奖励随层数增加；Boss 层金币与经验更厚', () => {
  assert.ok(starTowerReward(2).gold > starTowerReward(1).gold);
  assert.ok(starTowerReward(2).exp > starTowerReward(1).exp);
  const plain = starTowerReward(9);
  const boss = starTowerReward(10);
  assert.ok(boss.gold > plain.gold + 10_000, '金币含 Boss 额外奖励');
  assert.ok(boss.exp >= plain.exp * 2 - 10, '经验 Boss 层翻倍');
});

test('下一层：从已通过的最高层 + 1 开始，全部通关后为 null', () => {
  assert.equal(nextStarTowerFloor(0), 1);
  assert.equal(nextStarTowerFloor(9), 10);
  assert.equal(nextStarTowerFloor(99), 100);
  assert.equal(nextStarTowerFloor(100), null);
  assert.equal(nextStarTowerFloor(-3), 1);
});

test('对战沿用三局两胜：强的一方赢，弱的一方输', () => {
  const strong: ArenaFighter[] = [
    { name: 'A', lead: 90, force: 90, wit: 90, level: 30 },
    { name: 'B', lead: 90, force: 90, wit: 90, level: 30 },
    { name: 'C', lead: 90, force: 90, wit: 90, level: 30 },
  ];
  const weak: ArenaFighter[] = [
    { name: 'a', lead: 5, force: 5, wit: 5, level: 1 },
    { name: 'b', lead: 5, force: 5, wit: 5, level: 1 },
    { name: 'c', lead: 5, force: 5, wit: 5, level: 1 },
  ];
  assert.equal(playArenaMatch(strong, weak, seededRng(7)).challengerWon, true);
  assert.equal(playArenaMatch(weak, strong, seededRng(7)).challengerWon, false);
});

test('弱阵容打第 1 层不再必胜：敌方 3 名，三个弱将的胜率远低于 100%', () => {
  const mine: ArenaFighter[] = [
    { name: 'x', lead: 1, force: 1, wit: 1, level: 1 },
    { name: 'y', lead: 1, force: 1, wit: 1, level: 1 },
    { name: 'z', lead: 1, force: 1, wit: 1, level: 1 },
  ];
  const enemies = starTowerFloorEnemies(1);
  let wins = 0;
  for (let seed = 1; seed <= 200; seed += 1) {
    if (playArenaMatch(mine, enemies, seededRng(seed)).challengerWon) {
      wins += 1;
    }
  }
  assert.ok(wins < 200, `胜场 ${wins}/200 不应全胜`);
});
