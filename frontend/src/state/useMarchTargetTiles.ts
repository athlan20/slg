// 行军目的地名称的取数钩子（AISLG-268）：先查世界地图当前窗口已缓存的地块，缺的坐标用 GET_TILE 静取一次，
// 结果按 "x,y" 缓存在前端内存里——同一坐标只请求一次、在途请求去重、迷雾结果 30 秒后重试、失败 10 秒后重试。
// 窗口里的地块每次渲染都优先（刷新后以新的为准）。取不到时表里没有这个坐标，行军行保持原样。
// 名称怎么显示（tileTitle / 「迷雾中」）留给组件；这里只返回 TileView 或 'fog'。

import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarchView, WorldMapResponseData } from '../api/protocol';
import {
  resolveTargetTiles,
  shouldFetchTarget,
  targetCoordsOf,
  targetKey,
  type TargetTileEntry,
  type TargetTileMark,
} from './marchTargetTiles';
import type { TargetTileResult } from './targetTile';

/**
 * @param marches 行军列表（只看 x / y；列表刷新会让失败 / 迷雾结果按 TTL 重新尝试）
 * @param mapWindow 世界地图当前窗口（tiles 里能找到的坐标直接复用，不请求）
 * @param fetchTargetTile 静取一格地块（会话里的 world.fetchTargetTile；不覆盖地图详情面板）
 */
export function useMarchTargetTiles(
  marches: ReadonlyArray<Pick<MarchView, 'x' | 'y'>>,
  mapWindow: WorldMapResponseData | null,
  fetchTargetTile: (x: number, y: number) => Promise<TargetTileResult>,
): Map<string, TargetTileMark> {
  const cacheRef = useRef(new Map<string, TargetTileEntry>());
  const inflightRef = useRef(new Set<string>());
  const aliveRef = useRef(true);
  /** 请求回来时靠它触发重渲染（缓存本体放 ref，不作为渲染依赖） */
  const [version, setVersion] = useState(0);
  const coords = useMemo(() => targetCoordsOf(marches), [marches]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const windowKeys = new Set((mapWindow?.tiles ?? []).map((tile) => targetKey(tile.x, tile.y)));
    const now = Date.now();
    for (const key of coords) {
      if (windowKeys.has(key) || inflightRef.current.has(key) || !shouldFetchTarget(cacheRef.current.get(key), now)) {
        continue;
      }
      const [x, y] = key.split(',').map(Number);
      inflightRef.current.add(key);
      void (async () => {
        let result: TargetTileResult;
        try {
          result = await fetchTargetTile(x, y);
        } catch {
          result = { kind: 'failed' };
        }
        const at = Date.now();
        cacheRef.current.set(
          key,
          result.kind === 'tile' ? { kind: 'tile', tile: result.tile, at } : { kind: result.kind, at },
        );
        inflightRef.current.delete(key);
        if (aliveRef.current) {
          setVersion((prev) => prev + 1);
        }
      })();
    }
    // marches 每次刷新都是新数组：失败 / 迷雾结果到这里按 TTL 自然重试（迷雾里部队走近后就能拿到地块名）
  }, [coords, marches, mapWindow, fetchTargetTile]);

  return useMemo(
    () => resolveTargetTiles(coords, mapWindow?.tiles, cacheRef.current),
    [coords, mapWindow, version],
  );
}