// 行军目的地名称取数决策的单元测试（AISLG-268，纯函数 / 不连网、不连库）。
// Node 原生去除类型直接跑 .ts（见 package.json 的 test 脚本 src/state/*.test.mjs）；
// 只覆盖「哪个坐标要请求、窗口与缓存怎么拼」，名称拼装由 tileTitle 负责（本次不改）。

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTargetTiles,
  shouldFetchTarget,
  targetCoordsOf,
  targetKey,
  TARGET_FAILED_RETRY_MS,
  TARGET_UNEXPLORED_TTL_MS,
} from './marchTargetTiles.ts';

/** 最小地块桩：只带 resolveTargetTiles 会用到的坐标与等级 */
function tile(x, y, level = 2) {
  return { x, y, level };
}

const NOW = Date.parse('2025-06-01T00:00:00.000Z');

test('targetCoordsOf 按 (x,y) 去重并保持首次出现顺序', () => {
  const marches = [
    { x: 508, y: 499 },
    { x: 499, y: 489 },
    { x: 508, y: 499 },
    { x: 1, y: 2 },
    { x: 499, y: 489 },
  ];
  assert.deepEqual(targetCoordsOf(marches), ['508,499', '499,489', '1,2']);
});

test('targetCoordsOf 空列表返回空数组', () => {
  assert.deepEqual(targetCoordsOf([]), []);
});

test('targetKey 是 x,y 逗号格式', () => {
  assert.equal(targetKey(508, 499), '508,499');
});

test('shouldFetchTarget：没缓存要请求，拿到地块后不再请求', () => {
  assert.equal(shouldFetchTarget(undefined, NOW), true);
  assert.equal(shouldFetchTarget({ kind: 'tile', tile: tile(1, 1), at: NOW - 86_400_000 }, NOW), false);
});

test('shouldFetchTarget：迷雾未探索结果 30 秒内不重复请求', () => {
  assert.equal(shouldFetchTarget({ kind: 'unexplored', at: NOW - (TARGET_UNEXPLORED_TTL_MS - 1) }, NOW), false);
  assert.equal(shouldFetchTarget({ kind: 'unexplored', at: NOW - TARGET_UNEXPLORED_TTL_MS }, NOW), true);
});

test('shouldFetchTarget：失败后至少间隔 10 秒再试', () => {
  assert.equal(shouldFetchTarget({ kind: 'failed', at: NOW - (TARGET_FAILED_RETRY_MS - 1) }, NOW), false);
  assert.equal(shouldFetchTarget({ kind: 'failed', at: NOW - TARGET_FAILED_RETRY_MS }, NOW), true);
});

test('resolveTargetTiles：窗口里的地块优先于缓存（刷新后以新的为准）', () => {
  const cached = new Map([['1,1', { kind: 'tile', tile: tile(1, 1, 2), at: NOW }]]);
  const marks = resolveTargetTiles(['1,1'], [tile(1, 1, 5)], cached);
  assert.equal(marks.get('1,1').level, 5);
});

test('resolveTargetTiles：窗口里没有时用缓存的地块', () => {
  const cached = new Map([['7,8', { kind: 'tile', tile: tile(7, 8, 4), at: NOW }]]);
  const marks = resolveTargetTiles(['7,8'], [], cached);
  assert.equal(marks.get('7,8').level, 4);
});

test('resolveTargetTiles：迷雾未探索 → fog 占位', () => {
  const cached = new Map([['2,3', { kind: 'unexplored', at: NOW }]]);
  const marks = resolveTargetTiles(['2,3'], null, cached);
  assert.equal(marks.get('2,3'), 'fog');
});

test('resolveTargetTiles：失败与还没回来的坐标不进表（行内不显示、不占位）', () => {
  const cached = new Map([['4,4', { kind: 'failed', at: NOW }]]);
  const marks = resolveTargetTiles(['4,4', '5,5'], [], cached);
  assert.equal(marks.has('4,4'), false);
  assert.equal(marks.has('5,5'), false);
  assert.equal(marks.size, 0);
});

test('resolveTargetTiles：多条行军同一目的地只占一条', () => {
  const cached = new Map([['9,9', { kind: 'tile', tile: tile(9, 9, 1), at: NOW }]]);
  const coords = targetCoordsOf([
    { x: 9, y: 9 },
    { x: 9, y: 9 },
  ]);
  const marks = resolveTargetTiles(coords, [], cached);
  assert.equal(marks.size, 1);
  assert.equal(marks.get('9,9').level, 1);
});