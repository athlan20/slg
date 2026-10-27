// 洛阳争夺（v79，AISLG-200）：周六 21:00–23:00 窗口、下次开放、政令效果与洛阳协防上限。

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  currentLuoyangWindow,
  decreeMarchSpeedPercent,
  decreeTimeMultiplier,
  luoyangClosedError,
  luoyangWindowOpen,
  nextLuoyangOpen,
} from '../common/src/luoyang';
import { assistCap } from '../common/src/city-assist';

const CST = (iso: string): Date => new Date(iso);

test('窗口：北京时间每周六 21:00–23:00', () => {
  assert.equal(luoyangWindowOpen(CST('2026-10-31T20:59:59+08:00')), false);
  assert.equal(luoyangWindowOpen(CST('2026-10-31T21:00:00+08:00')), true);
  assert.equal(luoyangWindowOpen(CST('2026-10-31T22:59:59+08:00')), true);
  assert.equal(luoyangWindowOpen(CST('2026-10-31T23:00:00+08:00')), false);
  assert.equal(luoyangWindowOpen(CST('2026-10-30T21:00:00+08:00')), false, '周五不开');
  const window = currentLuoyangWindow(CST('2026-10-31T22:00:00+08:00'));
  assert.equal(window?.startAt.toISOString(), CST('2026-10-31T21:00:00+08:00').toISOString());
  assert.equal(window?.endAt.toISOString(), CST('2026-10-31T23:00:00+08:00').toISOString());
});

test('下次开放：周二指向本周六 21:00；窗口内返回本次开始', () => {
  assert.equal(
    nextLuoyangOpen(CST('2026-10-27T10:00:00+08:00')).toISOString(),
    CST('2026-10-31T21:00:00+08:00').toISOString(),
  );
  assert.equal(
    nextLuoyangOpen(CST('2026-10-31T21:30:00+08:00')).toISOString(),
    CST('2026-10-31T21:00:00+08:00').toISOString(),
  );
  assert.equal(
    nextLuoyangOpen(CST('2026-10-31T23:30:00+08:00')).toISOString(),
    CST('2026-11-07T21:00:00+08:00').toISOString(),
  );
  const closed = luoyangClosedError(CST('2026-10-27T10:00:00+08:00'));
  assert.equal(closed.nextOpenAt, CST('2026-10-31T21:00:00+08:00').toISOString());
  assert.ok(closed.retryAfterSeconds > 0);
});

test('政令：征兵 / 研究时长 ×0.85，行军速度 +10；过期或非洛阳之主为 0', () => {
  const now = CST('2026-10-27T10:00:00+08:00');
  const until = CST('2026-10-30T10:00:00+08:00');
  assert.equal(decreeTimeMultiplier('recruit', 'recruit', until, now), 0.85);
  assert.equal(decreeTimeMultiplier('research', 'research', until, now), 0.85);
  assert.equal(decreeTimeMultiplier('march', 'march', until, now), 1);
  assert.equal(decreeMarchSpeedPercent('march', until, now), 10);
  assert.equal(decreeMarchSpeedPercent('recruit', until, now), 0);
  assert.equal(decreeTimeMultiplier('recruit', 'recruit', CST('2026-10-26T10:00:00+08:00'), now), 1);
  assert.equal(decreeTimeMultiplier('recruit', null, null, now), 1);
});

test('洛阳可接收 10 支协防（普通城 5 支）', () => {
  assert.equal(assistCap('洛阳'), 10);
  assert.equal(assistCap('长安'), 5);
  assert.equal(assistCap(null), 5);
});
