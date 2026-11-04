// 迷雾窗口刷新的判定（AISLG-224 复核第 9 项）：只有在途行军的路线与窗口相交时才定时重拉。
// 纯函数（frontend/src/components/map/fogPolling.ts），无需数据库。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { marchRouteHitsWindow, needsFogRefresh } from '../../frontend/src/components/map/fogPolling';

const win = { x: 100, y: 100, w: 20, h: 20 };

describe('迷雾窗口刷新判定', () => {
  test('路线完全在窗口外：不刷新', () => {
    assert.equal(marchRouteHitsWindow({ from: { x: 0, y: 0 }, to: { x: 50, y: 50 } }, win), false);
  });

  test('路线穿过窗口：刷新', () => {
    assert.equal(marchRouteHitsWindow({ from: { x: 0, y: 110 }, to: { x: 300, y: 110 } }, win), true);
  });

  test('路线端点在窗口内：刷新', () => {
    assert.equal(marchRouteHitsWindow({ from: { x: 105, y: 105 }, to: { x: 500, y: 500 } }, win), true);
  });

  test('没有在途行军或没有窗口：不刷新', () => {
    assert.equal(needsFogRefresh([], win), false);
    assert.equal(needsFogRefresh([{ from: { x: 105, y: 105 }, to: { x: 110, y: 110 } }], null), false);
  });

  test('多条行军里任一条相交即刷新', () => {
    const marches = [{ from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }, { from: { x: 110, y: 90 }, to: { x: 110, y: 400 } }];
    assert.equal(needsFogRefresh(marches, win), true);
  });
});
