// 赛季预告阶段的纯规则（AISLG-134，docs/season-system.md §4）：阶段判定、晚部署只发最近一个、
// 已发阶段不重发、改结束时间后的重新布防。不需要数据库。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { crossedStages, planNotice, rearmNotified } from '../common/src/season-stages';

const H = 3600 * 1000;
const D = 24 * H;
const END = Date.UTC(2026, 9, 25, 12, 0, 0);

describe('预告阶段判定', () => {
  test('剩余时间 ≤ 阈值才算到达；结束后一个阶段都不算', () => {
    assert.deepEqual(crossedStages(END, END - 4 * D), []);
    assert.deepEqual(crossedStages(END, END - 3 * D), ['T-3d']);
    assert.deepEqual(crossedStages(END, END - 2 * D), ['T-3d']);
    assert.deepEqual(crossedStages(END, END - 0.5 * D), ['T-3d', 'T-1d']);
    assert.deepEqual(crossedStages(END, END - 30 * 60 * 1000), ['T-3d', 'T-1d', 'T-1h']);
    assert.deepEqual(crossedStages(END, END - 5 * 60 * 1000), ['T-3d', 'T-1d', 'T-1h', 'T-10m']);
    assert.deepEqual(crossedStages(END, END), []);
    assert.deepEqual(crossedStages(END, END + 1000), []);
  });

  test('正常节奏：每个阶段恰好发一次，且发的是该阶段', () => {
    let notified: string[] = [];
    const sent: string[] = [];
    for (const offset of [4 * D, 3 * D, 2 * D, 1 * D, 0.5 * D, 3600 * 1000, 30 * 60 * 1000, 10 * 60 * 1000, 5 * 60 * 1000]) {
      const plan = planNotice(END, END - offset, notified);
      if (plan.send) {
        sent.push(plan.send);
      }
      notified = [...notified, ...plan.markNotified];
    }
    assert.deepEqual(sent, ['T-3d', 'T-1d', 'T-1h', 'T-10m']);
  });

  test('晚部署（已进入 T-1h 之内）只发最近的一个，更早的阶段一并记为已发，之后不再连发', () => {
    const plan = planNotice(END, END - 30 * 60 * 1000, []);
    assert.equal(plan.send, 'T-1h');
    assert.deepEqual(plan.markNotified, ['T-3d', 'T-1d', 'T-1h']);
    const next = planNotice(END, END - 29 * 60 * 1000, plan.markNotified);
    assert.equal(next.send, null, '同一阶段已发，不重发');
  });

  test('已发过的更近阶段：更远阶段不补发（不会倒着发）', () => {
    const plan = planNotice(END, END - 2 * D, ['T-3d']);
    assert.equal(plan.send, null);
    assert.deepEqual(plan.markNotified, []);
  });

  test('结束之后不再发任何预告', () => {
    const plan = planNotice(END, END + 60_000, []);
    assert.equal(plan.send, null);
  });
});

describe('改结束时间后的重新布防（运维 set-end）', () => {
  test('结束时间被推后：不再到达的阶段移出已发集合，之后到点重新发', () => {
    const notified = ['T-3d', 'T-1d'];
    // 新结束时间离现在还有 2 天：T-3d 仍到达（保留），T-1d 未到达（移出）
    const rearmed = rearmNotified(END, END - 2 * D, notified);
    assert.deepEqual(rearmed, ['T-3d']);
    assert.equal(planNotice(END, END - 0.5 * D, rearmed).send, 'T-1d');
  });

  test('结束时间被提前到已过：全部移出', () => {
    assert.deepEqual(rearmNotified(END, END + 1000, ['T-3d', 'T-1d']), []);
  });
});
