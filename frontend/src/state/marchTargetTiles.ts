// 行军目的地名称的取数决策（AISLG-268）：纯函数，不碰 React、不发请求，单测直接跑
// （marchTargetTiles.test.mjs，Node 原生去除类型）。名称本身由 components/worldMapTip.tsx 的
// tileTitle 拼装（与地图悬浮卡第一行一字不差），这里只管「这一格从哪来、现在要不要请求」。

import type { TileView } from '../api/protocol';

/** 迷雾未探索结果的缓存有效期：部队走近后目标会进入视野，过一会儿重新试一次 */
export const TARGET_UNEXPLORED_TTL_MS = 30_000;
/** 失败（断线 / 超时 / 其他错误码）之后的最短重试间隔：避免请求风暴 */
export const TARGET_FAILED_RETRY_MS = 10_000;

/** 前端内存缓存的一条（键为 "x,y"）；tile 不设过期（地形 / 等级基本不变，窗口拿到新值时优先用窗口的） */
export type TargetTileEntry =
  | { kind: 'tile'; tile: TileView; at: number }
  | { kind: 'unexplored'; at: number }
  | { kind: 'failed'; at: number };

/** 行军卡上可显示的两种结果：地块本身，或战争迷雾下的「迷雾中」占位 */
export type TargetTileMark = TileView | 'fog';

/** 坐标键（缓存 / 索引统一用它） */
export function targetKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** 行军列表里出现的目的地键（去重、保持首次出现顺序）：同一坐标只请求一次 */
export function targetCoordsOf(marches: ReadonlyArray<{ x: number; y: number }>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const march of marches) {
    const key = targetKey(march.x, march.y);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

/** 该坐标现在要不要再请求一次：没缓存 / 迷雾结果过期 / 失败已过重试间隔；拿到地块后不再请求 */
export function shouldFetchTarget(entry: TargetTileEntry | undefined, now: number): boolean {
  if (!entry) {
    return true;
  }
  if (entry.kind === 'tile') {
    return false;
  }
  const age = now - entry.at;
  return entry.kind === 'unexplored' ? age >= TARGET_UNEXPLORED_TTL_MS : age >= TARGET_FAILED_RETRY_MS;
}

/** 拼出行军卡要用的表（键 → 地块或 'fog'）：窗口里已有的优先（刷新后以新的为准），缓存兜底；
 *  失败 / 还没回来的坐标不进表——行军行保持原样，不占位、不闪烁 */
export function resolveTargetTiles(
  coords: readonly string[],
  windowTiles: readonly TileView[] | null | undefined,
  entries: ReadonlyMap<string, TargetTileEntry>,
): Map<string, TargetTileMark> {
  const fromWindow = new Map<string, TileView>();
  for (const tile of windowTiles ?? []) {
    fromWindow.set(targetKey(tile.x, tile.y), tile);
  }
  const marks = new Map<string, TargetTileMark>();
  for (const key of coords) {
    const windowTile = fromWindow.get(key);
    if (windowTile) {
      marks.set(key, windowTile);
      continue;
    }
    const entry = entries.get(key);
    if (entry?.kind === 'tile') {
      marks.set(key, entry.tile);
    } else if (entry?.kind === 'unexplored') {
      marks.set(key, 'fog');
    }
  }
  return marks;
}