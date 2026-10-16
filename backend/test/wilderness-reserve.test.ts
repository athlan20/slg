import test from 'node:test';
import assert from 'node:assert/strict';
import { getTimeScale, setTimeScaleCache } from '../common/src/time-scale';
import {
  advanceReserve,
  advanceTile,
  applyReserveUpdates,
  effectiveGatherOf,
  projectEmptyHours,
  projectFullHours,
  reserveCapOf,
  reserveTierOf,
  settleTerritoryReserves,
  territoryDisplayRates,
} from '../common/src/wilderness-reserve';
import type { TerritoryRow } from '../common/src/world';

// 本文件断言基准口径（储量与速率均为基准单位，时间缩放只作用于产出，见 production.ts）
setTimeScaleCache(1);

const T0 = new Date('2026-10-15T00:00:00Z');
const hoursLater = (hours: number): Date => new Date(T0.getTime() + hours * 3_600_000);

test('储量上限：基准 1500 + 3500 × 等级，±20% 固定哈希，金矿 ×0.4', () => {
  // Lv1 基准 5000、Lv10 基准 36500（需求表）；实际值落在 ±20% 之内
  for (const [level, base] of [[1, 5000], [5, 19000], [10, 36500]] as const) {
    const cap = reserveCapOf(10, 20, 'plain', level);
    assert.ok(cap >= base * 0.8 - 1 && cap <= base * 1.2 + 1, `Lv${level} 上限 ${cap} 应落在 ±20% 内`);
  }
  // 同一块地（x, y, 等级）永远得到同一上限
  assert.equal(reserveCapOf(10, 20, 'plain', 5), reserveCapOf(10, 20, 'plain', 5));
  // 金矿上限 = 同地块基准 × 0.4（同一哈希取值，比例严格成立）
  assert.equal(reserveCapOf(10, 20, 'gold_mine', 5), reserveCapOf(10, 20, 'plain', 5) * 0.4);
});

test('储量推进：采集不超过恢复时储量净增并封顶于上限，产出等于采集', () => {
  const step = advanceReserve(1000, 5000, 50, 100, 10);
  assert.equal(step.reserve, 1000 + (100 - 50) * 10);
  assert.equal(step.yielded, 50 * 10);
  assert.equal(step.depletedAfterHours, null);
  // 净增越过上限时封顶
  assert.equal(advanceReserve(4990, 5000, 0, 100, 10).reserve, 5000);
});

test('储量推进：采集高于恢复时按净流出下降，触底后只按恢复产出（留兵不停）', () => {
  // 储量 1000、采集 500、恢复 100：净流出 400/h，2.5 小时采空
  const drained = advanceReserve(1000, 5000, 500, 100, 2);
  assert.equal(drained.reserve, 200);
  assert.equal(drained.yielded, 1000);
  assert.equal(drained.depletedAfterHours, null);

  const emptied = advanceReserve(1000, 5000, 500, 100, 10);
  assert.equal(emptied.reserve, 0);
  assert.equal(emptied.depletedAfterHours, 2.5, '在第 2.5 小时采空');
  // 2.5 小时采集 1250，之后 7.5 小时按恢复速度 100/h 产出
  assert.equal(emptied.yielded, 1250 + 100 * 7.5);
});

test('储量推进：分段推进与一次推进结果一致（结算频率不影响产出）', () => {
  const whole = advanceReserve(1000, 5000, 500, 100, 10);
  const first = advanceReserve(1000, 5000, 500, 100, 3);
  const second = advanceReserve(first.reserve, 5000, 500, 100, 7);
  assert.equal(second.reserve, whole.reserve);
  assert.ok(Math.abs(first.yielded + second.yielded - whole.yielded) < 1e-9);
});

test('储量推进：储量已空且采集高于恢复时，产出为恢复速度并保持为 0', () => {
  const step = advanceReserve(0, 5000, 800, 100, 5);
  assert.equal(step.reserve, 0);
  assert.equal(step.yielded, 500);
  assert.equal(step.depletedAfterHours, null, '已空不再触发采空事件');
});

test('预计时刻：采空 = 储量 ÷（采集 − 恢复）；回满 = 缺口 ÷（恢复 − 采集）；无此类事件为 null', () => {
  assert.equal(projectEmptyHours(1000, 500, 100), 2.5);
  assert.equal(projectEmptyHours(1000, 80, 100), null, '采集不高于恢复不会采空');
  assert.equal(projectEmptyHours(0, 500, 100), null);
  assert.equal(projectFullHours(0, 5000, 0, 100), 50, '无驻军时 50 小时回满');
  assert.equal(projectFullHours(5000, 5000, 0, 100), null);
  assert.equal(projectFullHours(0, 5000, 150, 100), null, '采集高于恢复不会回满');
});

test('档位：>60% 充足，20%–60% 一般，<20% 枯竭', () => {
  assert.equal(reserveTierOf(610, 1000), 'ample');
  assert.equal(reserveTierOf(600, 1000), 'normal');
  assert.equal(reserveTierOf(200, 1000), 'normal');
  assert.equal(reserveTierOf(199, 1000), 'depleted');
  assert.equal(reserveTierOf(0, 1000), 'depleted');
});

test('采集上限：每小时采走的量不超过储量的 10%，满储量下约 12.5 小时采空', () => {
  // Lv5 大量驻军：采集潜力远超上限，实际采集被钳到 10%
  const tile = { x: 3, y: 4, terrain: 'plain' as const, level: 5, garrison: 1000, reserve: null, reserve_at: null };
  const step = advanceTile(tile, T0, T0, true);
  assert.ok(Math.abs(step.drain - step.cap * 0.1) < 1e-9, '采集潜力封顶于上限的 10%');
  // 净流出 = 10% − 2% = 8%/h，满储量 12.5 小时采空（需求：从满到空至少 10 小时）
  const emptyHours = (step.emptyAt!.getTime() - T0.getTime()) / 3_600_000;
  assert.ok(Math.abs(emptyHours - 12.5) < 1e-6, `满储量采空时长 ${emptyHours} 应为 12.5 小时`);
});

test('结算区间：归属变化前的空档只按恢复计算，采集只从归属时刻起算', () => {
  // 地块 Lv1 有驻军，归属方在 T0+2h 才结算到此刻；之前的 2 小时无人采集，只恢复
  const tile = { x: 1, y: 1, terrain: 'plain' as const, level: 1, garrison: 1, reserve: 4000, reserve_at: T0 };
  const sofar = advanceTile(tile, hoursLater(2), hoursLater(2), true);
  const cap = sofar.cap;
  assert.ok(Math.abs(sofar.reserve - Math.min(cap, 4000 + cap * 0.02 * 2)) < 1e-6, '空档仅恢复');
  assert.equal(sofar.yielded, 0);
});

test('城池结算：连片加成放大产出但不额外扣储量', () => {
  const forest = (x: number, y: number): TerritoryRow => ({ x, y, terrain: 'forest', level: 3, garrison: 40 });
  const single = settleTerritoryReserves([forest(1, 1)], T0, hoursLater(1));
  const cluster = settleTerritoryReserves([forest(1, 1), forest(2, 1), forest(3, 1)], T0, hoursLater(1));
  // 单块采集 = 3×40 = 120/h（上限足够）；3 块连片 ×1.1 放大产出
  assert.ok(Math.abs(single.gather.wood! - 120) < 1e-9);
  assert.ok(Math.abs(cluster.gather.wood! - 3 * 120 * 1.1) < 1e-9);
  // 每块的储量扣减与单块一致（连片不额外扣减）
  assert.equal(cluster.updates[0].reserve, single.updates[0].reserve);
});

test('城池结算：采空时刻进入事件，并写回推进后的储量与下一次采空时刻', () => {
  // 驻军把采集推到上限（Lv1 基准 5000 → 上限约 4000–6000，采集 ≈ 10%，净流出 8%）
  const tile: TerritoryRow = { x: 9, y: 9, terrain: 'plain', level: 1, garrison: 10_000, reserve: null, reserve_at: null };
  const settled = settleTerritoryReserves([tile], T0, hoursLater(100));
  assert.equal(settled.depletions.length, 1, '100 小时内必然采空一次');
  const at = settled.depletions[0].at.getTime();
  assert.ok(at > T0.getTime() && at < hoursLater(100).getTime());
  // 采空后仍有驻军：储量为 0，下一次采空时刻为空（无可再触发的采空事件）
  assert.equal(settled.updates[0].reserve, 0);
  assert.equal(settled.updates[0].emptyAt, null);
});

test('城池结算：储量未空时写回的 emptyAt 为预计采空时刻', () => {
  const tile: TerritoryRow = { x: 9, y: 9, terrain: 'plain', level: 1, garrison: 50, reserve: 5000, reserve_at: T0 };
  // Lv1 采集 50/h（远低于 10% 上限），净流出 = 50 − 2% × cap；满储量不会采空
  const settled = settleTerritoryReserves([tile], T0, hoursLater(1));
  assert.equal(settled.depletions.length, 0);
  assert.equal(settled.updates[0].emptyAt, null, '采集低于恢复或尚未采空时无采空时刻');
});

test('展示口径：满储量时瞬时采集 = 采集潜力；采空时只按恢复速度；占领加成不受影响', () => {
  const full: TerritoryRow = { x: 5, y: 5, terrain: 'forest', level: 3, garrison: 18 };
  // 占领加成 240 + 采集 54（上限充足）
  assert.equal(territoryDisplayRates([full]).wood, 240 + 54);
  const empty: TerritoryRow = { ...full, reserve: 0, reserve_at: T0 };
  // 采空：占领加成照常 240；采集潜力 54 低于恢复速度，储量回升期间仍按 54 采集
  const cap = reserveCapOf(5, 5, 'forest', 3);
  assert.equal(territoryDisplayRates([empty]).wood, 240 + 54);
  // 采集潜力高于恢复时，采空后只剩恢复速度
  assert.equal(effectiveGatherOf(0, cap, cap * 0.1), cap * 0.02);
  assert.equal(effectiveGatherOf(1, cap, cap * 0.1), cap * 0.1);
});

test('applyReserveUpdates：结算后的储量同步回内存快照', () => {
  const tiles: TerritoryRow[] = [{ x: 1, y: 2, terrain: 'plain', level: 1, garrison: 0 }];
  applyReserveUpdates(tiles, [{ x: 1, y: 2, reserve: 1234, reserveAt: T0, emptyAt: null }]);
  assert.equal(tiles[0].reserve, 1234);
  assert.equal(tiles[0].reserve_at, T0);
});

test('时间缩放：采集与恢复速率按倍率放大，采空 / 回满真实时长缩短，储量上限不随缩放', () => {
  const prev = getTimeScale();
  setTimeScaleCache(50);
  try {
    const tile = { x: 3, y: 4, terrain: 'plain' as const, level: 5, garrison: 1000, reserve: null, reserve_at: null };
    const step = advanceTile(tile, T0, T0, true);
    // 基准 12.5 小时 ÷ 50 = 0.25 小时采空
    const emptyHours = (step.emptyAt!.getTime() - T0.getTime()) / 3_600_000;
    assert.ok(Math.abs(emptyHours - 0.25) < 1e-6, `缩放 50 下采空应为 0.25 小时，实际 ${emptyHours}`);
    // 对外速率仍是基准单位，上限不变
    assert.equal(step.cap, reserveCapOf(3, 4, 'plain', 5));
    assert.ok(Math.abs(step.drain - step.cap * 0.1) < 1e-9);
    // 产出为真实口径：采集 = 基准采集 × 50
    const settled = settleTerritoryReserves([tile], T0, hoursLater(0.1));
    assert.ok(Math.abs(settled.gather.food! - step.cap * 0.1 * 50 * 0.1) < 1e-6, '产出已含时间缩放');
  } finally {
    setTimeScaleCache(prev);
  }
});
