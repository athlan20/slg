// 全局时间缩放（AISLG-38，v20）的单元测试：耗时 ÷ scale 钳 1 秒下限（作用于总时长）、速率 × scale、
// 环境变量显式覆盖优先于缩放。默认值（库无记录）为 50；运行时读 settings 表的
// 刷新链路（refreshTimeScale / TTL）依赖数据库，不在单测覆盖，由冒烟流程验证。
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeconds, DEFAULT_BUILD_SECONDS, populationGrowthPerHour, upgradeSeconds } from '../common/src/rules';
import { recruitBatchSeconds, recruitUnitSeconds, TROOP_INFO } from '../common/src/troops';
import { marchTravelSeconds } from '../common/src/world';
import { inPlunderCooldown, PLUNDER_COOLDOWN_MS, plunderCooldownMs } from '../common/src/plunder';
import { productionPerHour } from '../common/src/production';
import { atBaseTimeScale, DEFAULT_TIME_SCALE, getTimeScale, scaledMs, scaledRate, scaledSeconds, setTimeScaleCache } from '../common/src/time-scale';

test('默认缩放为 50（库无记录即加速，AISLG-38 紧急需求）', () => {
  setTimeScaleCache(DEFAULT_TIME_SCALE);
  assert.equal(DEFAULT_TIME_SCALE, 50);
});

test('scaledSeconds / scaledMs：÷ scale 钳 1 秒下限；scaledRate × scale', () => {
  setTimeScaleCache(50);
  assert.equal(scaledSeconds(60), 1, '60s ÷ 50 = 1.2 → floor 1');
  assert.equal(scaledSeconds(300), 6);
  assert.equal(scaledSeconds(10), 1, '钳 1 秒下限');
  assert.equal(scaledMs(PLUNDER_COOLDOWN_MS), 24 * 60 * 60 * 1000 / 50);
  assert.equal(scaledMs(1000), 1000, '毫秒类同样钳 1 秒');
  assert.equal(scaledRate(120), 6000, '速率 × scale');

  setTimeScaleCache(1);
  assert.equal(scaledSeconds(60), 60, 'scale=1 恢复基准');
  assert.equal(scaledRate(120), 120);
});

test('建造 / 行军 / 征兵时长随缩放，显式环境变量覆盖优先', () => {
  setTimeScaleCache(50);
  assert.equal(buildSeconds(), Math.max(1, Math.floor(DEFAULT_BUILD_SECONDS / 50)));
  const troop = 'militia' as const;
  // v22（AISLG-39）：单兵值为未缩放基准，缩放与 1 秒下限作用于批次总时长
  assert.equal(recruitUnitSeconds(troop), TROOP_INFO[troop].unitSeconds, '单兵基准不缩放');
  assert.equal(recruitBatchSeconds(troop, 10), 2, '10 义兵：基准 100s ÷ 50 = 2s（总时长模型）');
  assert.equal(recruitBatchSeconds(troop, 5), 1, '5 义兵：基准 50s ÷ 50 = 1s（下限作用于总时长）');
  assert.equal(recruitBatchSeconds(troop, 1), 1, '1 义兵：0.2s → 总时长钳 1s');

  delete process.env.BUILD_SECONDS;
  process.env.BUILD_SECONDS = '7';
  assert.equal(buildSeconds(), 7, '显式 env 覆盖优先于缩放');
  delete process.env.BUILD_SECONDS;

  setTimeScaleCache(2);
  assert.equal(buildSeconds(), DEFAULT_BUILD_SECONDS / 2);
});

test('升级 / 行军：缩放与 1 秒下限作用于总时长（AISLG-38 复核修复）', () => {
  setTimeScaleCache(50);
  // 升级 Lv9→10 基准 540s ÷ 50 = 10.8 → 10s（旧实现先把每级钳成 1s 再 ×9 = 9s）；
  // v31（AISLG-85）10 级以后每级 ×1.3：Lv10→11 倍数 11.7 → 702s ÷ 50 = 14s
  assert.equal(upgradeSeconds(9), 10);
  assert.equal(upgradeSeconds(10), 14);
  assert.equal(upgradeSeconds(1), 1, '60s ÷ 50 = 1.2 → 1s');
  // 行军 10 格基准 150s ÷ 50 = 3s（旧实现每格钳 1s → 10s，慢 3.3 倍）
  assert.equal(marchTravelSeconds(0, 0, 10, 0), 3);
  assert.equal(marchTravelSeconds(0, 0, 1, 0), 1, '1 格 0.3s → 钳 1s');
  // 斥候速度 ×2：10 格基准 75s ÷ 50 = 1.5 → 向上取整 2s
  assert.equal(marchTravelSeconds(0, 0, 10, 0, { scout: 5 }), 2);

  setTimeScaleCache(10);
  // 10 倍速：行军 10 格 150s ÷ 10 = 15s（旧实现 10s，快 1.5 倍）
  assert.equal(marchTravelSeconds(0, 0, 10, 0), 15);
  assert.equal(marchTravelSeconds(0, 0, 3, 4), 6, 'Chebyshev 4 格：60s ÷ 10');
  assert.equal(upgradeSeconds(9), 54);
  assert.equal(upgradeSeconds(10), 70, '702s ÷ 10');

  setTimeScaleCache(7);
  // 不整除的倍率：Lv9→10 540 ÷ 7 = 77.1 → 77（旧实现 floor(60/7)=8 × 9 = 72）
  assert.equal(upgradeSeconds(9), 77);

  // 显式环境变量覆盖：不缩放
  process.env.MARCH_SECONDS_PER_TILE = '2';
  process.env.BUILD_SECONDS = '3';
  setTimeScaleCache(50);
  assert.equal(marchTravelSeconds(0, 0, 10, 0), 20, 'env 覆盖：10 格 × 2s，不缩放');
  assert.equal(upgradeSeconds(4), 12, 'env 覆盖：3s × 4，不缩放');
  delete process.env.MARCH_SECONDS_PER_TILE;
  delete process.env.BUILD_SECONDS;

  setTimeScaleCache(1);
  assert.equal(marchTravelSeconds(0, 0, 10, 0), 150, 'scale=1 恢复基准');
  assert.equal(upgradeSeconds(9), 540);
  assert.equal(upgradeSeconds(10), 702, 'v31：10 级以后 ×1.3 递增（11.7 × 60s）');
});

test('掠夺冷却窗口随缩放：判定时刻取当前值', () => {
  setTimeScaleCache(50);
  const windowMs = PLUNDER_COOLDOWN_MS / 50;
  assert.equal(plunderCooldownMs(), windowMs);
  const now = new Date('2026-09-30T12:00:00Z');
  const at = new Date(now.getTime() - windowMs + 60_000);
  assert.equal(inPlunderCooldown(at, now), true, '缩放窗口内 → 冷却中');
  const early = new Date(now.getTime() - windowMs - 60_000);
  assert.equal(inPlunderCooldown(early, now), false, '缩放窗口外 → 已过');
});

test('产出与人口增速随缩放（结算与下发同源出口）', () => {
  setTimeScaleCache(1);
  const base = productionPerHour({});
  setTimeScaleCache(50);
  const scaled = productionPerHour({});
  for (const key of ['gold', 'food', 'wood', 'stone', 'iron'] as const) {
    assert.equal(scaled[key], base[key] * 50, `${key} × scale`);
  }

  setTimeScaleCache(10);
  assert.equal(populationGrowthPerHour(1), 10 * 1 * 2 * 10, '基准 10×Lv×(Lv+1) × scale');
  assert.equal(populationGrowthPerHour(0), 0, '无民房不增长，缩放不改变零值');

  setTimeScaleCache(1);
});

test('atBaseTimeScale：文档示例按未加速基准计算，结束后恢复当前缩放', () => {
  setTimeScaleCache(50);
  assert.equal(atBaseTimeScale(() => marchTravelSeconds(0, 0, 10, 0)), 150);
  assert.equal(atBaseTimeScale(() => getTimeScale()), 1);
  assert.equal(getTimeScale(), 50, '退出后恢复');
  assert.throws(() => atBaseTimeScale(() => { throw new Error('x'); }));
  assert.equal(getTimeScale(), 50, '异常也恢复');
  setTimeScaleCache(1);
});
