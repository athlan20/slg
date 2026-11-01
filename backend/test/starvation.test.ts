// 断粮哗变（v34，AISLG-107）：预计断粮推算 / 哗变减员 / 减员速度

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MUTINY_LOSS_PERCENT,
  applyMutiny,
  mutinyIntervalMs,
  nextStarvationCheckMs,
  projectStarvation,
  starveWarningLeadMs,
} from '../common/src/starvation';
import { setTimeScaleCache } from '../common/src/time-scale';

const HOUR = 3_600_000;

test('预计断粮：净产量不为负不会断粮；有存粮按净消耗推算；粮 0 且净负即已断粮', () => {
  assert.deepEqual(projectStarvation(1000, 0, 5), { starving: false, starveAtMs: null });
  assert.deepEqual(projectStarvation(0, 100, 5), { starving: false, starveAtMs: null }, '粮 0 但净产量为正：不断粮');
  assert.deepEqual(projectStarvation(0, -1, 5), { starving: true, starveAtMs: 5 });
  const p = projectStarvation(500, -250, 1_000);
  assert.equal(p.starving, false);
  assert.equal(p.starveAtMs, 1_000 + 2 * HOUR, '500 ÷ 250/h = 2 小时后');
});

test('哗变：每兵种减 ceil(10%)，至少 1 个，不超过现有；只动传入的城内驻军', () => {
  assert.equal(MUTINY_LOSS_PERCENT, 10);
  const r = applyMutiny({ militia: 100, archer: 5, porter: 1, cavalry: 0 });
  assert.deepEqual(r.losses, { porter: 1, militia: 10, archer: 1 });
  assert.deepEqual(r.remaining, { militia: 90, archer: 4 }, '全灭兵种剔除');
  assert.equal(r.total, 12);
  assert.deepEqual(applyMutiny({}), { losses: {}, remaining: {}, total: 0 });
});

test('减员速度（需求表）：持续断粮 1 小时剩 90%、约 6.6 小时剩约 50%、约 22 小时约 10%', () => {
  const remaining = (hours: number): number => {
    let army = { militia: 1_000_000 };
    for (let h = 0; h < hours; h += 1) {
      army = { militia: applyMutiny(army).remaining.militia ?? 0 } as typeof army;
    }
    return army.militia / 1_000_000;
  };
  assert.ok(Math.abs(remaining(1) - 0.9) < 0.001);
  assert.ok(Math.abs(remaining(7) - 0.478) < 0.01, `7 小时 ≈ 48%（${remaining(7)}）`);
  assert.ok(Math.abs(remaining(22) - 0.098) < 0.01, `22 小时 ≈ 10%（${remaining(22)}）`);
});

test('哗变间隔与预警提前量随全局倍速缩放（基准 1 小时）', () => {
  setTimeScaleCache(1);
  assert.equal(mutinyIntervalMs(), HOUR);
  assert.equal(starveWarningLeadMs(), HOUR);
  setTimeScaleCache(50);
  assert.equal(mutinyIntervalMs(), HOUR / 50);
  assert.equal(starveWarningLeadMs(), HOUR / 50);
});

test('复查排期：不会断粮按上限间隔；离预警线远则折半；窗口内等到断粮；已断粮等到下次哗变；倍速下收紧', () => {
  const lead = HOUR; // 1 小时预警提前量 → 上限 min(5 分钟, 15 分钟) = 5 分钟
  const cap = 300_000;
  const now = 1_000_000;
  assert.equal(nextStarvationCheckMs(now, null, false, null, lead), now + cap, '不会断粮：上限间隔');
  assert.equal(nextStarvationCheckMs(now, now + 100 * HOUR, false, null, lead), now + cap, '很远：折半后仍封顶');
  assert.equal(nextStarvationCheckMs(now, now + lead + 40_000, false, null, lead), now + 20_000, '离预警线 40 秒：折半 20 秒');
  assert.equal(nextStarvationCheckMs(now, now + lead + 1_000, false, null, lead), now + 10_000, '不低于 10 秒下限');
  assert.equal(nextStarvationCheckMs(now, now + 120_000, false, null, lead), now + 120_000, '预警窗口内：等到预计断粮');
  assert.equal(nextStarvationCheckMs(now, now, true, now + 30_000, lead), now + 30_000, '已断粮：等到下次哗变');
  assert.equal(nextStarvationCheckMs(now, now, true, now + 50 * HOUR, lead), now + cap, '哗变排期过远仍封顶');
  // 倍速 360：预警提前量 10 秒 → 上限收紧到下限 10 秒，与每轮扫描同频
  assert.equal(nextStarvationCheckMs(now, null, false, null, 10_000), now + 10_000);
});
