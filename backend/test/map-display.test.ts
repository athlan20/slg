// 大地图显示增强（AISLG-216）的纯函数单元测试：
// 行军进度插值（含返程反向 / 截击停在埋伏点 / 夹 0～1）、视野外箭头的方向与位置、
// 领地外圈边界判定（L 形 / 口字形中间留空 / 两个账号相邻 / 贴视野边缘）、领地关系色与金边。
// 产出表与后端的数值一致性在 yield-table.test.ts。
// 组件与像素级渲染不在本文件覆盖（靠 e2e 截图），这里只钉住算法与数值口径。
// 运行：cd backend && npx tsx --test test/map-display.test.ts

import assert from 'node:assert/strict';
import test from 'node:test';
import type { CityRefView, MarchView, TileView } from '../../frontend/src/api/protocol';
import { edgeArrow, formatMarchLeft, gridMetrics, mapMarchers, marchProgress } from '../../frontend/src/components/map/marchGeometry';
import { borderEdges, seamEdges, territoryCells } from '../../frontend/src/components/map/territoryBorders';

/** 毫秒基准时刻：所有用例用相对时间，避免依赖真实时钟 */
const T0 = Date.parse('2026-01-01T00:00:00.000Z');
const iso = (msFromStart: number): string => new Date(T0 + msFromStart).toISOString();

function marchBase(overrides: Partial<MarchView>): MarchView {
  return {
    id: 'm1',
    fromCityId: 'c1',
    x: 13,
    y: 10,
    troops: {} as unknown as MarchView['troops'],
    purpose: 'scout',
    status: 'marching',
    initiator: 'player',
    startedAt: iso(0),
    arriveAt: iso(3000),
    resolvedAt: null,
    cargo: null,
    targetId: null,
    ambushAt: null,
    heroId: null,
    stratagemUsed: false,
    ...overrides,
  };
}

function city(id: string, x: number | null, y: number | null): CityRefView {
  return { id, name: id, level: 1, x, y, isMain: true, title: '县城', nobility: { index: 0, name: '平民' } };
}

function tileBase(overrides: Partial<TileView>): TileView {
  return {
    x: 0,
    y: 0,
    terrain: 'plain',
    kind: 'wilderness',
    level: 1,
    owner: null,
    garrison: 0,
    npcStockTier: null,
    famous: null,
    camp: null,
    protection: null,
    durability: null,
    wildFamous: false,
    reserve: null,
    ...overrides,
  };
}

function owned(x: number, y: number, accountId: string, relation: NonNullable<TileView['owner']>['relation']): TileView {
  return tileBase({
    x,
    y,
    owner: { accountId, username: accountId, cityId: `city-${accountId}`, cityName: `城-${accountId}`, nobility: 0, nobilityName: '平民', ally: relation === 'ally', relation },
  });
}

async function borders(tiles: TileView[], accountId: string, win: { x: number; y: number; w: number; h: number }) {
  return borderEdges(territoryCells(tiles, accountId), win);
}

test('行军进度：线性插值、夹在 0～1、返程按 arriveAt 走', () => {
  const scout = marchBase({ startedAt: iso(0), arriveAt: iso(10_000) });
  assert.equal(marchProgress(scout, T0), 0);
  assert.equal(marchProgress(scout, T0 + 5000), 0.5);
  assert.equal(marchProgress(scout, T0 + 10_000), 1);
  // 时间过了到达时刻、或还没出发，都不越界
  assert.equal(marchProgress(scout, T0 + 60_000), 1);
  assert.equal(marchProgress(scout, T0 - 60_000), 0);

  const back = marchBase({ purpose: 'return', startedAt: iso(0), arriveAt: iso(2000) });
  assert.equal(marchProgress(back, T0 + 1000), 0.5);
});

test('截击：用 ambushAt 代替 arriveAt 算进度，过了埋伏点停在目标格', () => {
  const intercept = marchBase({ purpose: 'intercept', startedAt: iso(0), arriveAt: iso(10_000), ambushAt: iso(4000) });
  // 埋伏点之前的进度按埋伏点算（4000 毫秒到目标）
  assert.equal(marchProgress(intercept, T0 + 2000), 0.5);
  // 过了埋伏点保持 1（图标停在目标格），不会因为 arriveAt 还没到又往前走
  assert.equal(marchProgress(intercept, T0 + 4000), 1);
  assert.equal(marchProgress(intercept, T0 + 9000), 1);

  const cities = [city('c1', 10, 10)];
  const atAmbush = mapMarchers([intercept], cities, T0 + 6000)[0];
  assert.deepEqual(atAmbush.pos, { x: 13, y: 10 });
  assert.equal(atAmbush.ambushing, true);
  // 埋伏中显示的是到接战（arriveAt）的倒计时
  assert.equal(atAmbush.leftMs, 4000);
});

test('返程行军方向反过来：从目标格回出发城，快照只取 status = marching', () => {
  const cities = [city('c1', 10, 10)];
  const back = marchBase({ purpose: 'return', startedAt: iso(0), arriveAt: iso(6000) });
  const [item] = mapMarchers([back], cities, T0 + 3000);
  assert.deepEqual(item.from, { x: 13, y: 10 });
  assert.deepEqual(item.to, { x: 10, y: 10 });
  assert.deepEqual(item.pos, { x: 11.5, y: 10 });

  const out = mapMarchers([marchBase({ purpose: 'scout' })], cities, T0 + 1500)[0];
  assert.deepEqual(out.from, { x: 10, y: 10 });
  assert.deepEqual(out.to, { x: 13, y: 10 });
  assert.deepEqual(out.pos, { x: 11.5, y: 10 });

  // 已到达的不上图；出发城没有坐标（分城未定位）的也不上图
  assert.equal(mapMarchers([marchBase({ status: 'arrived' })], cities, T0).length, 0);
  assert.equal(mapMarchers([marchBase({})], [city('c1', null, null)], T0).length, 0);
});

test('倒计时标签：不足 1 小时 mm:ss，1 小时及以上 h:mm:ss', () => {
  assert.equal(formatMarchLeft(0), '00:00');
  assert.equal(formatMarchLeft(59_000), '00:59');
  assert.equal(formatMarchLeft(59_999), '01:00');
  assert.equal(formatMarchLeft(3_600_000), '1:00:00');
  assert.equal(formatMarchLeft(3_661_000), '1:01:01');
  assert.equal(formatMarchLeft(-5000), '00:00');
});

test('视野外箭头：在边框上取最近点，方向指向图标真实位置', () => {
  const win = { x: 0, y: 0, w: 10, h: 10 };
  const m = gridMetrics(win, { w: 1000, h: 500 });
  // 视野内（格子中心）不画箭头
  assert.equal(edgeArrow({ x: 5, y: 5 }, { x: 0, y: 0 }, win, m), null);
  // 左侧视野外：贴左边框（pad 14），方向朝左（180°）
  const left = edgeArrow({ x: -2, y: 5 }, { x: 0, y: 0 }, win, m);
  assert.ok(left);
  assert.equal(Math.round(left.px), 14);
  assert.equal(Math.round(left.py), Math.round(5 * m.stepH + m.cellH / 2));
  assert.equal(Math.round(Math.abs(left.angle)), 180);
  // 右下视野外：夹到右下角内沿，方向指向右下方（0 < angle < 90）
  const corner = edgeArrow({ x: 12, y: 12 }, { x: 0, y: 0 }, win, m);
  assert.ok(corner);
  assert.equal(corner.px, 1000 - 14);
  assert.equal(corner.py, 500 - 14);
  assert.ok(corner.angle > 0 && corner.angle < 90);
  // 窗口原点不是 0 时按渲染原点换算
  const shifted = edgeArrow({ x: 21, y: 21 }, { x: 10, y: 10 }, win, m);
  assert.ok(shifted && shifted.angle > 0 && shifted.angle < 90);
});

test('领地外圈：L 形 5 块只有外圈有边，内部相邻处没有线', async () => {
  const tiles = [owned(1, 1, 'me', 'self'), owned(2, 1, 'me', 'self'), owned(3, 1, 'me', 'self'), owned(1, 2, 'me', 'self'), owned(1, 3, 'me', 'self')];
  const edges = await borders(tiles, 'me', { x: 0, y: 0, w: 5, h: 5 });
  // 5 块 × 4 条边 − 内部相邻 4 对 × 2 = 12
  assert.equal(edges.length, 12);
  const has = (x: number, y: number, side: string) => edges.some((edge) => edge.x === x && edge.y === y && edge.side === side);
  // 内部相邻的两侧都不画
  assert.equal(has(1, 1, 'right'), false);
  assert.equal(has(2, 1, 'left'), false);
  assert.equal(has(1, 1, 'bottom'), false);
  // 外圈都画
  assert.ok(has(1, 1, 'top') && has(1, 1, 'left') && has(3, 1, 'right') && has(1, 3, 'bottom'));
});

test('领地外圈：口字形中间留空，洞里那 4 条边照样画线', async () => {
  // 3×3 的环（中心空着），整体放在 5×5 窗口中间
  const cells: TileView[] = [];
  for (let x = 1; x <= 3; x += 1) {
    for (let y = 1; y <= 3; y += 1) {
      if (x === 2 && y === 2) {
        continue;
      }
      cells.push(owned(x, y, 'me', 'self'));
    }
  }
  // 8 块 × 4 边 − 内部相邻 8 对 × 2 = 16，其中 4 条围着中间的空格
  const edges = await borders(cells, 'me', { x: 0, y: 0, w: 5, h: 5 });
  assert.equal(edges.length, 16);
  const hole = edges.filter((edge) => (edge.x === 2 && edge.y === 1 && edge.side === 'bottom') || (edge.x === 2 && edge.y === 3 && edge.side === 'top') || (edge.x === 1 && edge.y === 2 && edge.side === 'right') || (edge.x === 3 && edge.y === 2 && edge.side === 'left'));
  assert.equal(hole.length, 4);
  // 窗口正好贴着环（3×3）：外圈全部在视野边缘（不画），只剩洞里 4 条
  const tight = await borders(cells, 'me', { x: 1, y: 1, w: 3, h: 3 });
  assert.deepEqual(tight.map((edge) => `${edge.x - 1},${edge.y - 1},${edge.side}`).sort(), ['0,1,right', '1,0,bottom', '1,2,top', '2,1,left']);
});

test('领地外圈：两个账号的地贴在一起，中间两条线各画自己的颜色', async () => {
  const tiles = [owned(1, 1, 'me', 'self'), owned(2, 1, 'them', 'neutral')];
  const edges = await borders(tiles, 'me', { x: 0, y: 0, w: 4, h: 4 });
  const mine = edges.find((edge) => edge.x === 1 && edge.side === 'right');
  const theirs = edges.find((edge) => edge.x === 2 && edge.side === 'left');
  assert.equal(mine?.relation, 'own');
  assert.equal(theirs?.relation, 'other');
  // 两账号相邻时没有缝隙色（色块只在自己这一片内铺）
  const seams = seamEdges(territoryCells(tiles, 'me'), { x: 0, y: 0, w: 4, h: 4 });
  assert.equal(seams.length, 0);
});

test('领地外圈：贴视野边缘的一侧不画线', async () => {
  // 窗口只有这一格：四面都在窗口外 → 一条线都不画
  assert.equal((await borders([owned(1, 1, 'me', 'self')], 'me', { x: 1, y: 1, w: 1, h: 1 })).length, 0);
  // 角落格：上 / 左在窗口外不画，只有右 / 下两条
  const corner = await borders([owned(0, 0, 'me', 'self')], 'me', { x: 0, y: 0, w: 5, h: 5 });
  assert.deepEqual(corner.map((edge) => edge.side).sort(), ['bottom', 'right']);
});

test('领地缝隙：同一片领地内部相邻处要铺色（只取右 / 下，避免画两次）', async () => {
  const cells = territoryCells([owned(2, 2, 'me', 'self'), owned(3, 2, 'me', 'self'), owned(2, 3, 'me', 'self')], 'me');
  const seams = seamEdges(cells, { x: 0, y: 0, w: 5, h: 5 });
  assert.equal(seams.length, 2);
  assert.deepEqual(seams.map((seam) => seam.side).sort(), ['bottom', 'right']);
});

test('关系色分类：自己 / 盟友 / 友好 / 敌对 / 其他，无主返回 null', async () => {
  const cells = territoryCells([owned(1, 1, 'me', 'self'), owned(2, 1, 'a', 'ally'), owned(3, 1, 'f', 'friendly'), owned(4, 1, 'h', 'hostile'), owned(5, 1, 'n', 'neutral'), tileBase({ x: 6, y: 1 })], 'me');
  assert.equal(cells.get('1,1')?.relation, 'own');
  assert.equal(cells.get('2,1')?.relation, 'ally');
  assert.equal(cells.get('3,1')?.relation, 'ally');
  assert.equal(cells.get('4,1')?.relation, 'hostile');
  assert.equal(cells.get('5,1')?.relation, 'other');
  assert.equal(cells.has('6,1'), false);
});

test('连片加成：自己的那片外圈改金色，其余仍是关系色', async () => {
  const goldKeys = new Set(['1,1', '2,1', '3,1']);
  const cells = territoryCells([owned(1, 1, 'me', 'self'), owned(2, 1, 'me', 'self'), owned(3, 1, 'me', 'self'), owned(1, 2, 'me', 'self')], 'me', goldKeys);
  const edges = borderEdges(cells, { x: 0, y: 0, w: 5, h: 5 });
  const gold = edges.filter((edge) => edge.gold);
  assert.ok(gold.length > 0);
  assert.ok(gold.every((edge) => edge.y === 1));
  assert.ok(edges.some((edge) => edge.y === 2 && !edge.gold));
});

