// 战争迷雾纯函数（AISLG-224 第一步）：区块下标与位图、视野半径、路线视野带、行军当前位置。无需数据库。
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  FOG_BITMAP_BYTES,
  FOG_CHUNK_COUNT,
  chunkIndexOf,
  chunksCoveredBySquare,
  exploredChunkCount,
  exploredPercentOf,
  fogBitsFrom,
  inAnyVision,
  isCellExplored,
  markRoute,
  markSquare,
  marchPositionAt,
  marchVisionSource,
  newFogBits,
  routeBandKeys,
  routeCells,
  scoutVisionRadius,
  setChunkExplored,
  walkedFractionOf,
  walkedRoute,
  type MarchGeometry,
} from '../common/src/fog';

describe('区块位图', () => {
  test('区块下标与位图字节数', () => {
    assert.equal(FOG_CHUNK_COUNT, 10000);
    assert.equal(FOG_BITMAP_BYTES, 1250);
    assert.equal(chunkIndexOf(0, 0), 0);
    assert.equal(chunkIndexOf(9, 9), 0);
    assert.equal(chunkIndexOf(10, 0), 1);
    assert.equal(chunkIndexOf(0, 10), 100);
    assert.equal(chunkIndexOf(999, 999), 9999);
  });

  test('第 i 块在字节 i>>3、掩码 1<<(i&7)', () => {
    const bits = newFogBits();
    assert.equal(setChunkExplored(bits, 9), true);
    assert.equal(bits[1], 1 << 1);
    assert.equal(setChunkExplored(bits, 9), false);
    assert.equal(exploredChunkCount(bits), 1);
  });

  test('格子所在区块的探索判定', () => {
    const bits = newFogBits();
    markSquare(bits, 500, 500, 0);
    assert.equal(isCellExplored(bits, 500, 500), true);
    assert.equal(isCellExplored(bits, 509, 509), true, '同一区块内任何一格都算已探索');
    assert.equal(isCellExplored(bits, 510, 500), false);
  });

  test('探索进度保留 1 位小数', () => {
    const bits = newFogBits();
    for (let i = 0; i < 32; i += 1) {
      setChunkExplored(bits, i);
    }
    assert.equal(exploredPercentOf(bits), 0.3);
    assert.equal(exploredPercentOf(newFogBits()), 0);
  });

  test('库里的坏长度字节按空位图处理', () => {
    assert.equal(fogBitsFrom(null).length, FOG_BITMAP_BYTES);
    assert.equal(fogBitsFrom(new Uint8Array(3)).length, FOG_BITMAP_BYTES);
    assert.equal(exploredChunkCount(fogBitsFrom(new Uint8Array(3))), 0);
  });
});

describe('视野方块与边界', () => {
  test('方块覆盖的区块裁到世界边界内', () => {
    const corner = chunksCoveredBySquare(0, 0, 3);
    assert.deepEqual(corner, [0]);
    const edge = chunksCoveredBySquare(999, 999, 30);
    assert.ok(edge.every((index) => index >= 0 && index < FOG_CHUNK_COUNT));
    assert.ok(edge.includes(9999));
  });

  test('方块只要碰到区块任一格，整块记为已探索', () => {
    // 中心 (15,15) 半径 3 覆盖 x 12..18，全在区块 (1,1) 内
    const bits = newFogBits();
    assert.deepEqual(markSquare(bits, 15, 15, 3), [101]);
    // 中心 (19,15) 半径 3 跨到 x=22，碰到区块 (2,1)=102，(1,1) 已在前一次记过
    const fresh = markSquare(bits, 19, 15, 3);
    assert.deepEqual(fresh, [102]);
  });

  test('视野来源的 Chebyshev 半径', () => {
    const sources = [{ x: 100, y: 100, radius: 3 }];
    assert.equal(inAnyVision(sources, 103, 103), true);
    assert.equal(inAnyVision(sources, 104, 100), false);
    assert.equal(inAnyVision(sources, 97, 98), true);
  });

  test('侦察科技门槛：Lv0–2 为 5，Lv3 起 6，Lv6 起 7', () => {
    assert.equal(scoutVisionRadius(0), 5);
    assert.equal(scoutVisionRadius(2), 5);
    assert.equal(scoutVisionRadius(3), 6);
    assert.equal(scoutVisionRadius(5), 6);
    assert.equal(scoutVisionRadius(6), 7);
    assert.equal(scoutVisionRadius(9), 7);
  });
});

describe('路线与视野带', () => {
  test('路线为 Chebyshev 步进，步数等于切比雪夫距离', () => {
    const cells = routeCells(0, 0, 4, 2);
    assert.equal(cells.length, 5);
    assert.deepEqual(cells[0], { x: 0, y: 0 });
    assert.deepEqual(cells[cells.length - 1], { x: 4, y: 2 });
    for (let i = 1; i < cells.length; i += 1) {
      assert.ok(Math.abs(cells[i].x - cells[i - 1].x) <= 1 && Math.abs(cells[i].y - cells[i - 1].y) <= 1);
    }
  });

  test('同一点只返回一格', () => {
    assert.deepEqual(routeCells(5, 5, 5, 5), [{ x: 5, y: 5 }]);
  });

  test('撤回 / 中途的路线只到走过的比例', () => {
    const half = walkedRoute(0, 0, 100, 0, 0.5);
    assert.equal(half[half.length - 1].x, 50);
    const full = walkedRoute(0, 0, 100, 0, 1);
    assert.equal(full[full.length - 1].x, 100);
    const none = walkedRoute(0, 0, 100, 0, 0);
    assert.deepEqual(none, [{ x: 0, y: 0 }]);
  });

  test('沿途视野带：全程走完后中途区块也被探索，目标附近不误伤', () => {
    const bits = newFogBits();
    // 从 (5,5) 到 (405,5)，半径 3：经过的区块应全部探索，远处 (800,800) 不动
    markRoute(bits, routeCells(5, 5, 405, 5), 3);
    assert.equal(isCellExplored(bits, 205, 5), true);
    assert.equal(isCellExplored(bits, 405, 5), true);
    assert.equal(isCellExplored(bits, 800, 800), false);
  });

  test('撤回只探索走过的一段：目标附近仍是黑雾', () => {
    const bits = newFogBits();
    markRoute(bits, walkedRoute(0, 0, 400, 0, 0.25), 3);
    assert.equal(isCellExplored(bits, 100, 0), true);
    assert.equal(isCellExplored(bits, 400, 0), false);
  });

  test('路线视野带的格集合与方块并集一致', () => {
    const band = routeBandKeys([{ x: 50, y: 50 }], 2);
    assert.equal(band.size, 25);
    assert.ok(band.has('48,48') && band.has('52,52') && !band.has('53,50'));
  });
});

describe('行军当前位置（与前端 marchGeometry 一致）', () => {
  const going: MarchGeometry = { homeX: 0, homeY: 0, targetX: 100, targetY: 0, returning: false, startMs: 1000, endMs: 11000 };
  const back: MarchGeometry = { ...going, returning: true };

  test('去程从出发城向目标插值，返程从目标向出发城插值', () => {
    assert.deepEqual(marchPositionAt(going, 6000), { x: 50, y: 0 });
    assert.deepEqual(marchPositionAt(back, 6000), { x: 50, y: 0 });
    assert.deepEqual(marchPositionAt(going, 1000), { x: 0, y: 0 });
    assert.deepEqual(marchPositionAt(back, 1000), { x: 100, y: 0 });
  });

  test('进度夹在 0～1，结束后停在终点', () => {
    assert.deepEqual(marchPositionAt(going, 99999), { x: 100, y: 0 });
    assert.deepEqual(marchPositionAt(going, 0), { x: 0, y: 0 });
  });

  test('斥候编队用斥候半径，其余用行军半径', () => {
    assert.equal(marchVisionSource(going, 6000, false, 0).radius, 3);
    assert.equal(marchVisionSource(going, 6000, true, 0).radius, 5);
    assert.equal(marchVisionSource(going, 6000, true, 6).radius, 7);
  });

  test('已走比例按 startedAt 与到达时刻计算', () => {
    assert.equal(walkedFractionOf(0, 100, 25), 0.25);
    assert.equal(walkedFractionOf(0, 100, 500), 1);
    assert.equal(walkedFractionOf(0, 100, -5), 0);
  });
});
