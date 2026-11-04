// 迷雾刷新的判定（AISLG-224 复核）：只有在途行军的路线与当前窗口相交时才需要定时重拉窗口。
// 纯函数，不碰 React；backend/test 可直接导入做单元测试。
import type { MapMarch } from './marchGeometry';

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 行军路线（出发城 ↔ 目标）的包围盒与窗口是否相交（包围盒近似：只会多拉、不会漏拉） */
export function marchRouteHitsWindow(march: Pick<MapMarch, 'from' | 'to'>, win: WindowRect): boolean {
  const minX = Math.min(march.from.x, march.to.x);
  const maxX = Math.max(march.from.x, march.to.x);
  const minY = Math.min(march.from.y, march.to.y);
  const maxY = Math.max(march.from.y, march.to.y);
  return maxX >= win.x && minX <= win.x + win.w - 1 && maxY >= win.y && minY <= win.y + win.h - 1;
}

/** 是否需要定时刷新窗口：存在任一在途行军的路线与窗口相交 */
export function needsFogRefresh(marches: ReadonlyArray<Pick<MapMarch, 'from' | 'to'>>, win: WindowRect | null): boolean {
  if (!win) {
    return false;
  }
  return marches.some((march) => marchRouteHitsWindow(march, win));
}
