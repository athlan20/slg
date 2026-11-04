// 城池迁移（AISLG-220，v91）的纯规则：道具选择、距离、拦截顺序、旧格去向、出征限制时长、
// 空野地判定与近邻判定、回归 NPC 城等级与重抽野地等级。不碰数据库。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  MOVE_CITY_ATTACK_LOCK_MS,
  MOVE_CITY_MIN_GAP,
  drawWildernessLevel,
  isMoveCityMode,
  moveAttackLockUntil,
  moveCityDenial,
  moveCityDenials,
  moveCityItemOf,
  moveDistance,
  moveNpcLevelOf,
  moveOldTileOf,
  moveTileUsable,
  moveTooClose,
} from '../common/src/move-city';
import { setTimeScaleCache } from '../common/src/time-scale';
import { FAMOUS_CITY_LEVEL } from '../common/src/famous-city';
import { WILDERNESS_LEVEL_MAX } from '../common/src/world';

const CLEAR = { famous: false, armyOutside: 0, allyForce: 0, inBattle: false };

describe('迁城方式与道具', () => {
  test('random 消耗迁城令，pointing 消耗高级迁城令', () => {
    assert.equal(moveCityItemOf('random'), 'city_order');
    assert.equal(moveCityItemOf('pointing'), 'city_order_adv');
  });

  test('只认 random / pointing 两种方式', () => {
    assert.equal(isMoveCityMode('random'), true);
    assert.equal(isMoveCityMode('pointing'), true);
    assert.equal(isMoveCityMode('teleport'), false);
    assert.equal(isMoveCityMode(undefined), false);
    assert.equal(isMoveCityMode(1), false);
  });
});

describe('拦截判定（顺序即提示优先级）', () => {
  test('全部通过时没有拦截', () => {
    assert.deepEqual(moveCityDenials(CLEAR), []);
    assert.equal(moveCityDenial(CLEAR), null);
  });

  test('名城 → 军队在外 → 盟友驻军 → 战乱，逐条命中', () => {
    assert.equal(moveCityDenial({ ...CLEAR, famous: true })?.code, 'MOVE_CITY_FAMOUS');
    assert.deepEqual(moveCityDenial({ ...CLEAR, armyOutside: 2 }), { code: 'MOVE_CITY_ARMY_OUTSIDE', data: { count: 2 } });
    assert.deepEqual(moveCityDenial({ ...CLEAR, allyForce: 1 }), { code: 'MOVE_CITY_HAS_ALLY_FORCE', data: { count: 1 } });
    assert.equal(moveCityDenial({ ...CLEAR, inBattle: true })?.code, 'MOVE_CITY_IN_BATTLE');
  });

  test('多条同时不满足时，首条按顺序返回，全部条件在 denials 里按顺序列出', () => {
    const facts = { famous: true, armyOutside: 1, allyForce: 1, inBattle: true };
    assert.equal(moveCityDenial(facts)?.code, 'MOVE_CITY_FAMOUS');
    assert.deepEqual(
      moveCityDenials(facts).map((d) => d.code),
      ['MOVE_CITY_FAMOUS', 'MOVE_CITY_ARMY_OUTSIDE', 'MOVE_CITY_HAS_ALLY_FORCE', 'MOVE_CITY_IN_BATTLE'],
    );
    assert.equal(moveCityDenial({ ...CLEAR, allyForce: 3, inBattle: true })?.code, 'MOVE_CITY_HAS_ALLY_FORCE');
  });
});

describe('目标格与近邻', () => {
  test('只有无主、无 NPC 的野地可迁入', () => {
    assert.equal(moveTileUsable({ kind: 'wilderness', owner_city_id: null, npc: null }), true);
    assert.equal(moveTileUsable({ kind: 'wilderness', owner_city_id: 'c1', npc: null }), false, '已被占领的野地');
    assert.equal(moveTileUsable({ kind: 'npc_city', owner_city_id: null, npc: {} }), false, 'NPC 城');
    assert.equal(moveTileUsable({ kind: 'city', owner_city_id: 'c1', npc: null }), false, '城池格');
    assert.equal(moveTileUsable({ kind: 'wilderness', owner_city_id: null, npc: {} }), false, '带 NPC 的野地');
    assert.equal(moveTileUsable(null), false, '越界 / 无地块');
  });

  test('离他人城池格 < 3 格（Chebyshev）即过近，= 3 格可以', () => {
    assert.equal(MOVE_CITY_MIN_GAP, 3);
    assert.equal(moveTooClose([]), false);
    assert.equal(moveTooClose([3, 4, 9]), false);
    assert.equal(moveTooClose([2]), true);
    assert.equal(moveTooClose([5, 1]), true);
  });

  test('距离是 Chebyshev：取两轴偏差的最大值', () => {
    assert.equal(moveDistance({ x: 10, y: 10 }, { x: 13, y: 14 }), 4);
    assert.equal(moveDistance({ x: 0, y: 0 }, { x: 0, y: 0 }), 0);
    assert.equal(moveDistance({ x: 5, y: 9 }, { x: 1, y: 2 }), 7);
  });
});

describe('旧格去向与等级', () => {
  test('主城变空野地，分城回归 NPC 城', () => {
    assert.equal(moveOldTileOf(true), 'wilderness');
    assert.equal(moveOldTileOf(false), 'npc_city');
  });

  test('回归 NPC 城的等级 = 来源等级，历史分城（NULL）按 1 级，钳制在 1..3', () => {
    assert.equal(moveNpcLevelOf(null), 1);
    assert.equal(moveNpcLevelOf(0), 1);
    assert.equal(moveNpcLevelOf(2), 2);
    assert.equal(moveNpcLevelOf(9), FAMOUS_CITY_LEVEL);
  });

  test('旧主城重抽野地等级：落在 1..10 之间，随机数取边界时仍合法', () => {
    assert.equal(drawWildernessLevel(() => 0), 1, '权重表第一项是 1 级');
    const top = drawWildernessLevel(() => 0.999999);
    assert.ok(top >= 1 && top <= WILDERNESS_LEVEL_MAX);
    for (let i = 0; i < 200; i += 1) {
      const level = drawWildernessLevel();
      assert.ok(Number.isInteger(level) && level >= 1 && level <= WILDERNESS_LEVEL_MAX, `level=${level}`);
    }
  });
});

describe('指定坐标迁后的出征限制时长', () => {
  test('基准 12 小时，按全局时间缩放换算（缩放 1 时为 12 小时整）', () => {
    setTimeScaleCache(1);
    assert.equal(MOVE_CITY_ATTACK_LOCK_MS, 12 * 60 * 60 * 1000);
    const now = new Date('2026-11-04T00:00:00.000Z');
    assert.equal(moveAttackLockUntil(now).toISOString(), '2026-11-04T12:00:00.000Z');
  });

  test('时间缩放 50 时缩短到 12 小时 / 50', () => {
    setTimeScaleCache(50);
    try {
      const now = new Date('2026-11-04T00:00:00.000Z');
      assert.equal(moveAttackLockUntil(now).getTime() - now.getTime(), Math.floor(MOVE_CITY_ATTACK_LOCK_MS / 50));
    } finally {
      setTimeScaleCache(1);
    }
  });
});
