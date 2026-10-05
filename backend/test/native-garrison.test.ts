// 野地原住守军存量恢复与进攻口径（v24，AISLG-48）

import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeGarrison } from '../common/src/battle';
import { atBaseTimeScale } from '../common/src/time-scale';
import { currentNativeGarrison, recoveredGarrison } from '../common/src/native-garrison';
import { nativeAttackGuide } from '../common/src/native-guide';
import { INITIAL_RESOURCES } from '../common/src/rules';
import { TROOP_INFO } from '../common/src/troops';

const HOUR = 60 * 60 * 1000;

test('战后恢复：每小时恢复基准 25%（× 倍速），上限满编', () => {
  const full = { militia: 40, archer: 4 };
  assert.deepEqual(recoveredGarrison(full, {}, 0, 1), {}, '刚打完全灭 = 0');
  assert.deepEqual(recoveredGarrison(full, {}, HOUR, 1), { militia: 10, archer: 1 }, '1 小时 +25%');
  assert.deepEqual(recoveredGarrison(full, { militia: 5 }, 2 * HOUR, 1), { militia: 25, archer: 2 }, '残存 5 + 2 小时 +50%');
  assert.deepEqual(recoveredGarrison(full, {}, 10 * HOUR, 1), full, '4 小时回满，不超过满编');
  assert.deepEqual(recoveredGarrison(full, {}, HOUR / 10, 10), { militia: 10, archer: 1 }, '10 倍速下 6 分钟 = 1 小时');
});

test('当前存量：无状态 = 满编（含坐标浮动）；有状态按 updatedAt 恢复', () => {
  const at = { x: 12, y: 34 };
  const full = nativeGarrison(2, at);
  const now = new Date('2026-10-01T12:00:00Z');
  assert.deepEqual(currentNativeGarrison(2, at, { remaining: null, updatedAt: null }, now), full);
  const state = { remaining: {}, updatedAt: new Date(now.getTime() - HOUR) };
  const cur = atBaseTimeScale(() => currentNativeGarrison(2, at, state, now));
  assert.ok((cur.militia ?? 0) > 0 && (cur.militia ?? 0) < (full.militia ?? 0), '1 小时后部分恢复、未满');
});

test('进攻口径：Lv1–5 推荐兵力净收益全部为正且胜率 ≥ 90%；新号开局资源足以稳赢 Lv1', () => {
  const guide = nativeAttackGuide();
  assert.equal(guide.length, 10);
  for (const row of guide) {
    assert.ok(row.winRate >= 0.9, `Lv${row.level} ×${row.multiple} 胜率 ${row.winRate}`);
    assert.ok(row.expectedNet > 0, `Lv${row.level} ×${row.multiple} 净收益 ${row.expectedNet} > 0`);
  }
  const lv1x2 = guide.find((r) => r.level === 1 && r.multiple === 2)!;
  const affordable = Math.floor((INITIAL_RESOURCES.gold - 150) / TROOP_INFO.militia.cost.gold);
  assert.ok(affordable >= (lv1x2.army.militia ?? 0), `开局可征 ${affordable} 义兵 ≥ Lv1 推荐 ${lv1x2.army.militia}`);
});
