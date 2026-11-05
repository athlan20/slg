// 领地色块与边界判定（AISLG-216）：按占领者账号分片，只在一片领地的最外圈画线。
// 纯函数（只用 import type），供 WorldMapGrid 铺色 / 边界 SVG 与 backend/test 的单元测试共用。

import type { TileView } from '../../api/protocol';

/** 四种关系色（自己 / 盟友·友好 / 敌对 / 其他玩家），不给每个玩家单独分配颜色 */
export type TerritoryRelation = 'own' | 'ally' | 'hostile' | 'other';

export interface TerritoryCell {
  x: number;
  y: number;
  /** 占领者账号 id（同一账号四向相邻即同一片） */
  accountId: string;
  relation: TerritoryRelation;
  /** 自己的地且属于有连片加成的一片（3 块以上同地形相连）→ 外圈画金边 */
  gold: boolean;
}

export interface TerritoryWindow {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BorderSide = 'top' | 'right' | 'bottom' | 'left';

export interface BorderEdge {
  x: number;
  y: number;
  side: BorderSide;
  relation: TerritoryRelation;
  /** 金边（连片加成） */
  gold: boolean;
  accountId: string;
}

const SIDES: BorderSide[] = ['top', 'right', 'bottom', 'left'];
const NEIGHBOUR: Record<BorderSide, [number, number]> = {
  top: [0, -1],
  right: [1, 0],
  bottom: [0, 1],
  left: [-1, 0],
};

/** 格子的领地关系：无主（含野地未占领）返回 null；城池有主也算领地 */
export function tileRelation(tile: TileView, accountId: string | null): TerritoryRelation | null {
  const owner = tile.owner;
  if (!owner) {
    return null;
  }
  if (accountId !== null && owner.accountId === accountId) {
    return 'own';
  }
  if (owner.relation === 'ally' || owner.relation === 'friendly' || owner.ally) {
    return 'ally';
  }
  return owner.relation === 'hostile' ? 'hostile' : 'other';
}

/** 本窗口内的领地格：键 "x,y"；gold = 自己的地且有连片加成（与现有金边同口径） */
export function territoryCells(tiles: TileView[], accountId: string | null, goldKeys?: Set<string>): Map<string, TerritoryCell> {
  const cells = new Map<string, TerritoryCell>();
  for (const tile of tiles) {
    const relation = tileRelation(tile, accountId);
    if (!relation || !tile.owner) {
      continue;
    }
    const key = `${tile.x},${tile.y}`;
    cells.set(key, {
      x: tile.x,
      y: tile.y,
      accountId: tile.owner.accountId,
      relation,
      gold: relation === 'own' && (goldKeys?.has(key) ?? false),
    });
  }
  return cells;
}

export function inWindow(x: number, y: number, win: TerritoryWindow): boolean {
  return x >= win.x && y >= win.y && x < win.x + win.w && y < win.y + win.h;
}

/**
 * 一片领地的外圈边：某格的某条边，对面的格子不属于同一个账号（无主或别人的）就画线。
 * 对面在窗口外时不画——视野外的格子不知道是谁的，画了会让人误以为领地到此为止。
 */
export function borderEdges(cells: Map<string, TerritoryCell>, win: TerritoryWindow): BorderEdge[] {
  const edges: BorderEdge[] = [];
  for (const cell of cells.values()) {
    if (!inWindow(cell.x, cell.y, win)) {
      continue;
    }
    for (const side of SIDES) {
      const [dx, dy] = NEIGHBOUR[side];
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!inWindow(nx, ny, win)) {
        continue;
      }
      const neighbour = cells.get(`${nx},${ny}`);
      if (neighbour && neighbour.accountId === cell.accountId) {
        continue;
      }
      edges.push({ x: cell.x, y: cell.y, side, relation: cell.relation, gold: cell.gold, accountId: cell.accountId });
    }
  }
  return edges;
}

/** 同一片领地之间要铺成色块的格间缝隙：只取右 / 下两条边，避免同一条缝隙画两次 */
export interface SeamEdge {
  x: number;
  y: number;
  side: 'right' | 'bottom';
  relation: TerritoryRelation;
}

export function seamEdges(cells: Map<string, TerritoryCell>, win: TerritoryWindow): SeamEdge[] {
  const seams: SeamEdge[] = [];
  for (const cell of cells.values()) {
    if (!inWindow(cell.x, cell.y, win)) {
      continue;
    }
    for (const side of ['right', 'bottom'] as const) {
      const [dx, dy] = NEIGHBOUR[side];
      const nx = cell.x + dx;
      const ny = cell.y + dy;
      if (!inWindow(nx, ny, win)) {
        continue;
      }
      const neighbour = cells.get(`${nx},${ny}`);
      if (neighbour && neighbour.accountId === cell.accountId) {
        seams.push({ x: cell.x, y: cell.y, side, relation: cell.relation });
      }
    }
  }
  return seams;
}