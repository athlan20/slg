// 移动目标（v28，AISLG-78）的纯规则：路线 / 时刻表 / 位置 / 数量调节 / 截击发起参数

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  INTERCEPT_REACH,
  MOVING_TARGETS_MAX,
  MOVING_TARGETS_MIN,
  ROUTE_STEPS,
  cellDistance,
  desiredMovingCount,
  generateRoute,
  movingStepMs,
  movingStock,
  pickMovingKindAndLevel,
  reachWindowOf,
  routeIndexAt,
  routeIndexOfCell,
  scheduleOf,
  MOVING_KIND_INFO,
} from '../common/src/moving-target';
import { WORLD_SIZE } from '../common/src/world';
import { readMarchParams } from '../api/src/march-target';
import { movingTargetView, type MovingTargetRow } from '../common/src/moving-target-db';

/** 可复现的伪随机序列（线性同余） */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

test('路线：24 格、相邻格 Chebyshev 距离 ≤ 1、全部落在世界内', () => {
  for (let seed = 1; seed <= 50; seed += 1) {
    const route = generateRoute(seeded(seed), 500, 500);
    assert.equal(route.length, ROUTE_STEPS);
    for (const [x, y] of route) {
      assert.ok(x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE);
    }
    for (let i = 1; i < route.length; i += 1) {
      assert.ok(cellDistance(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]) <= 1);
    }
  }
});

test('路线贴边也不越界（锚点在世界角落）', () => {
  for (let seed = 1; seed <= 30; seed += 1) {
    const route = generateRoute(seeded(seed), 0, WORLD_SIZE - 1);
    assert.ok(route.every(([x, y]) => x >= 0 && x < WORLD_SIZE && y >= 0 && y < WORLD_SIZE));
  }
});

test('位置按时刻推进：第 i 格从 start + i × 步长起占据，存在期外为 null', () => {
  const start = 1_000_000;
  const life = 24 * 60_000;
  const step = movingStepMs(life);
  assert.equal(step, 60_000);
  const end = start + life;
  assert.equal(routeIndexAt(start, end, start - 1, step), null, '未出发');
  assert.equal(routeIndexAt(start, end, start, step), 0);
  assert.equal(routeIndexAt(start, end, start + 59_999, step), 0);
  assert.equal(routeIndexAt(start, end, start + 60_000, step), 1);
  assert.equal(routeIndexAt(start, end, end - 1, step), ROUTE_STEPS - 1);
  assert.equal(routeIndexAt(start, end, end, step), null, '存在期结束');
});

test('公开时刻表：每格带进入时刻', () => {
  const route = generateRoute(seeded(7), 100, 100);
  const schedule = scheduleOf(route, Date.parse('2026-10-01T00:00:00.000Z'), 60_000);
  assert.equal(schedule.length, ROUTE_STEPS);
  assert.equal(schedule[0].at, '2026-10-01T00:00:00.000Z');
  assert.equal(schedule[3].at, '2026-10-01T00:03:00.000Z');
  assert.deepEqual([schedule[5].x, schedule[5].y], route[5]);
});

test('截击选格：必须是尚未过去的路线格；已过去的格拒绝', () => {
  const route: Array<[number, number]> = Array.from({ length: ROUTE_STEPS }, (_, i) => [10 + i, 20]);
  assert.equal(routeIndexOfCell(route, 15, 20, 0), 5);
  assert.equal(routeIndexOfCell(route, 15, 20, 5), 5, '正在这一格也可以');
  assert.equal(routeIndexOfCell(route, 15, 20, 6), -1, '已过去');
  assert.equal(routeIndexOfCell(route, 99, 99, 0), -1, '不在路线上');
});

test('截击判定半径：正在这一格或相邻一格', () => {
  assert.equal(INTERCEPT_REACH, 1);
  assert.ok(cellDistance(5, 5, 6, 6) <= INTERCEPT_REACH);
  assert.ok(cellDistance(5, 5, 7, 5) > INTERCEPT_REACH);
});

test('埋伏窗口（v35 AISLG-112）：直线路线的相邻范围窗口 = 前一格进入 .. 后一格离开', () => {
  const start = 1_000_000;
  const step = 60_000;
  const route: Array<[number, number]> = Array.from({ length: ROUTE_STEPS }, (_, i) => [10 + i, 20]);
  // 选定格 route[5]=(15,20)：目标在 route[4]（14,20）进入相邻范围、route[6]（16,20）仍在、route[7]（17,20）走出
  const win = reachWindowOf(route, 15, 20, start, step, 0);
  assert.deepEqual(win, { from: start + 4 * step, to: start + 7 * step });
  // minIndex 已越过范围 → null（不会再经过）
  assert.equal(reachWindowOf(route, 15, 20, start, step, 8), null);
  // minIndex=6（目标正相邻）→ 窗口从当前格起算
  assert.deepEqual(reachWindowOf(route, 15, 20, start, step, 6), { from: start + 6 * step, to: start + 7 * step });
});

test('埋伏窗口：路线终点格的窗口终点 = 存在截止时刻', () => {
  const start = 1_000_000;
  const step = 60_000;
  const end = start + ROUTE_STEPS * step;
  const route: Array<[number, number]> = Array.from({ length: ROUTE_STEPS }, (_, i) => [10 + i, 20]);
  const win = reachWindowOf(route, 10 + ROUTE_STEPS - 1, 20, start, step, 0);
  assert.deepEqual(win, { from: start + (ROUTE_STEPS - 2) * step, to: end });
});

test('埋伏窗口：路线绕回同一格只取首个连续窗口', () => {
  const start = 1_000_000;
  const step = 60_000;
  // 0→4 向东、5→6 向西绕回、之后向东离开：格 (12,20) 出现在下标 2 与 6
  const route: Array<[number, number]> = [
    [10, 20], [11, 20], [12, 20], [13, 20], [14, 20], [13, 20], [12, 20],
    ...Array.from({ length: ROUTE_STEPS - 7 }, (_, i): [number, number] => [15 + i, 20]),
  ];
  const win = reachWindowOf(route, 12, 20, start, step, 0);
  // 首个窗口：下标 1..3 相邻（(11,20) 到 (13,20)），下标 4 起走出
  assert.deepEqual(win, { from: start + 1 * step, to: start + 4 * step });
  // minIndex=5 时目标正在绕回途中，窗口取第二段（下标 5..6 相邻；下标 7 起的 15 列已走出范围）
  assert.deepEqual(reachWindowOf(route, 12, 20, start, step, 5), { from: start + 5 * step, to: start + 7 * step });
});

test('数量随活跃玩家数调整：无人不刷，其余按 ⌈人数 × 0.5⌉ 夹在 [2, 40]', () => {
  assert.equal(desiredMovingCount(0), 0);
  assert.equal(desiredMovingCount(1), MOVING_TARGETS_MIN);
  assert.equal(desiredMovingCount(10), 5);
  assert.equal(desiredMovingCount(1000), MOVING_TARGETS_MAX);
});

test('商队 / 流寇：流寇守军更强、携带更多；种类与等级抽样落在范围内', () => {
  const caravan = MOVING_KIND_INFO.caravan.garrison(3);
  const bandit = MOVING_KIND_INFO.bandit.garrison(3);
  const total = (army: Record<string, number | undefined>) => Object.values(army).reduce<number>((sum, n) => sum + (n ?? 0), 0);
  assert.ok(total(bandit) > total(caravan));
  const stockSum = (kind: 'caravan' | 'bandit') => Object.values(movingStock(kind, 3)).reduce((sum, n) => sum + n, 0);
  assert.ok(stockSum('bandit') > stockSum('caravan'));
  for (let seed = 1; seed <= 40; seed += 1) {
    const { kind, level } = pickMovingKindAndLevel(seeded(seed));
    assert.ok(kind === 'caravan' || kind === 'bandit');
    assert.ok(level >= 1 && level <= 5);
  }
});

test('视图只给大致范围：守军与携带量 ±20%，位置随时刻变化', () => {
  const start = Date.parse('2026-10-01T00:00:00.000Z');
  const row: MovingTargetRow = {
    id: '11111111-1111-4111-8111-111111111111',
    kind: 'caravan',
    level: 2,
    status: 'active',
    route: generateRoute(seeded(3), 200, 200),
    started_at: new Date(start),
    ends_at: new Date(start + 24 * 60_000),
    garrison: { militia: 10 },
    stock: { gold: 1000, wood: 1000 },
    passed_index: -1,
    defeated_by: null,
    resolved_at: null,
  };
  const view = movingTargetView(row, start + 3 * 60_000 + 10);
  assert.equal(view.label, '运粮商队');
  assert.deepEqual(view.garrisonTotal, { min: 8, max: 12 });
  assert.deepEqual(view.stockTotal, { min: 1600, max: 2400 });
  assert.equal(view.position?.index, 3);
  assert.equal(view.stepSeconds, 60);
  assert.equal(view.route.length, ROUTE_STEPS);
  assert.equal(movingTargetView(row, start + 25 * 60_000).position, null, '过时后无位置');
});

test('MARCH 带 targetId：合法 UUID 才行，task 忽略、cargo 不接受', () => {
  const base = { x: 3, y: 4, troops: { militia: 5 } };
  const id = '22222222-2222-4222-8222-222222222222';
  const ok = readMarchParams({ ...base, targetId: id, task: 'occupy' });
  assert.equal(ok?.targetId, id);
  assert.equal(ok?.task, 'plunder', 'task 被忽略');
  assert.equal(readMarchParams({ ...base, targetId: 'not-a-uuid' }), null);
  assert.equal(readMarchParams({ ...base, targetId: id, cargo: { food: 1 } }), null);
  assert.equal(readMarchParams(base)?.targetId, null);
});
