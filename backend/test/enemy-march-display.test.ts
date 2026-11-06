// 他人部队图层的纯函数单元测试（AISLG-230）：位置外推（上限 6 秒）、规模对应的图标大小、
// 关系 / 来袭的颜色映射、来袭连线。纯函数（frontend/src/components/map/enemyMarchGeometry.ts），无需数据库。
// 运行：cd backend && npx tsx --test test/enemy-march-display.test.ts
import assert from 'node:assert/strict';
import test from 'node:test';
import type { VisibleMarchView } from '../../frontend/src/api/protocol';
import {
  ENEMY_MARCH_EXTRAPOLATE_MAX_MS,
  ENEMY_MARCH_TONE_COLOR,
  enemyMarchHeading,
  enemyMarchIconSize,
  enemyMarchPos,
  enemyMarchTone,
  extrapolateMs,
  raidLines,
  relationTone,
} from '../../frontend/src/components/map/enemyMarchGeometry';

function march(overrides: Partial<VisibleMarchView> = {}): VisibleMarchView {
  return {
    id: 'm1',
    x: 100,
    y: 200,
    vx: 1,
    vy: 0,
    returning: false,
    scale: 'medium',
    owner: { username: 'u', allianceName: null, relation: 'neutral' },
    ...overrides,
  };
}

const T0 = 1_700_000_000_000;

test('外推：按 vx / vy 线性推进，1 秒走 vx 格', () => {
  const pos = enemyMarchPos(march({ vx: 0.5, vy: -0.25 }), T0, T0 + 2000);
  assert.equal(pos.x, 101);
  assert.equal(pos.y, 199.5);
});

test('外推上限 6 秒：超过 6 秒（或本地时钟倒退）都停在界内', () => {
  assert.equal(extrapolateMs(T0, T0 + 4000), 4000);
  assert.equal(extrapolateMs(T0, T0 + 60_000), ENEMY_MARCH_EXTRAPOLATE_MAX_MS);
  assert.equal(extrapolateMs(T0, T0 - 5000), 0, '时钟倒退不外推');
  // 断网停止刷新：停在 6 秒处，不会一直跑
  const pos = enemyMarchPos(march({ vx: 1 }), T0, T0 + 120_000);
  assert.equal(pos.x, 106);
});

test('规模图标大小：小股 80%、中军 100%、大军 125%', () => {
  assert.equal(enemyMarchIconSize(20, 'small'), 16);
  assert.equal(enemyMarchIconSize(20, 'medium'), 20);
  assert.equal(enemyMarchIconSize(20, 'large'), 25);
  assert.equal(enemyMarchIconSize(14, 'small'), 11, '小屏也至少看得见');
});

test('颜色映射：同盟 / 友盟绿、中立灰、敌对橙、来袭自己红', () => {
  assert.equal(relationTone('ally'), 'friend');
  assert.equal(relationTone('friendly'), 'friend');
  assert.equal(relationTone('neutral'), 'neutral');
  assert.equal(relationTone('hostile'), 'hostile');
  assert.equal(enemyMarchTone(march({ owner: { username: 'u', allianceName: null, relation: 'hostile' } }), new Set()), 'hostile');
  // 来袭的优先级最高：敌对联盟也一样标红
  assert.equal(enemyMarchTone(march({ id: 'raid-1', owner: { username: 'u', allianceName: null, relation: 'hostile' } }), new Set(['raid-1'])), 'incoming');
  assert.equal(enemyMarchTone(march({ id: 'raid-1' }), new Set(['other'])), 'neutral');
  assert.deepEqual(Object.keys(ENEMY_MARCH_TONE_COLOR).sort(), ['friend', 'hostile', 'incoming', 'neutral']);
});

test('前进方向：按速度给角度，零速度不画箭头', () => {
  assert.equal(enemyMarchHeading(1, 0), 0);
  assert.equal(enemyMarchHeading(0, 1), 90);
  assert.equal(enemyMarchHeading(-1, 0), 180);
  assert.equal(enemyMarchHeading(0, 0), null);
  assert.equal(enemyMarchHeading(Number.NaN, 1), null);
});

test('来袭连线：只连进了视野、且还没到达的来袭部队', () => {
  const positions = new Map([['raid-1', { x: 10.5, y: 12 }]]);
  const warnings = [
    { attackId: 'raid-1', x: 20, y: 12, arriveAt: new Date(T0 + 60_000).toISOString() },
    { attackId: 'raid-2', x: 30, y: 30, arriveAt: new Date(T0 + 60_000).toISOString() },
    { attackId: 'raid-1', x: 20, y: 12, arriveAt: new Date(T0 - 1).toISOString() },
  ];
  assert.deepEqual(raidLines(positions, warnings, T0), [{ id: 'raid-1', from: { x: 10.5, y: 12 }, to: { x: 20, y: 12 } }]);
  assert.deepEqual(raidLines(new Map(), warnings, T0), [], '部队没进视野就只有原来的来袭红标');
});
