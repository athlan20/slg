// 按坐标静取一格地块（AISLG-268 行军目的地名称）：行军卡在标题后补目的地名称用。
// 与 worldSession 的 fetchDetail（GET_TILE 并 setDetail 覆盖地图详情面板）分开：这里只取 TileView，
// 不碰 selected / detail，失败也不写地图错误条。战争迷雾下 GET_TILE 对「未探索且不在视野内」的格
// 返回错误码 TILE_UNEXPLORED（AISLG-224，不改协议），按现有错误码判断后交给调用方显示「迷雾中」。

import { Op, type TileView } from '../api/protocol';
import type { ApiClient } from '../api/client';

/** 取一格地块的结果：拿到地块 / 迷雾未探索（可显示「迷雾中」）/ 其他失败（行内不显示名称） */
export type TargetTileResult =
  | { kind: 'tile'; tile: TileView }
  | { kind: 'unexplored' }
  | { kind: 'failed' };

/** 请求一格地块（不重试：重试节奏由调用方的缓存 TTL 决定）；离线 / 超时 / 断线都归为 failed */
export async function requestTargetTile(
  client: Pick<ApiClient, 'connected' | 'request'> | null,
  x: number,
  y: number,
): Promise<TargetTileResult> {
  if (!client?.connected) {
    return { kind: 'failed' };
  }
  try {
    const res = await client.request(Op.GET_TILE, { x, y });
    if (res.ok) {
      const tile = res.data?.tile as TileView | undefined;
      return tile ? { kind: 'tile', tile } : { kind: 'failed' };
    }
    // 前端 ErrorCode 联合里没有这个码（地图详情面板按窗口缺格判断迷雾），按字符串比对即可
    const code: string | undefined = res.error?.code;
    return code === 'TILE_UNEXPLORED' ? { kind: 'unexplored' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}