// 世界地图缩放（AISLG-103）：缩放档位 size（5..20，缺省 10）决定单格目标像素，窗口格数由容器尺寸推出
// （GET_WORLD_MAP 的 w / h，上限 20）。档位越小格子越大（zoom in），越大看得越广（zoom out）。本文件放常量、限幅、
// 「缩放中心保持不动」的原点换算与本地记忆；手势（滚轮 / 捏合）在 useMapZoomGestures。

/** 缩放上下限（窗口边长，格）：最近 5×5、最远 20×20（服务端 MAX_MAP_WINDOW = 20，越界会被当作缺省） */
export const MAP_ZOOM_MIN = 5;
export const MAP_ZOOM_MAX = 20;
/** 缺省窗口边长（与服务端 DEFAULT_MAP_WINDOW 一致） */
export const MAP_ZOOM_DEFAULT = 10;

const STORAGE_KEY = 'slg.worldMapZoom';

export function clampZoom(size: number): number {
  if (!Number.isFinite(size)) {
    return MAP_ZOOM_DEFAULT;
  }
  return Math.min(MAP_ZOOM_MAX, Math.max(MAP_ZOOM_MIN, Math.round(size)));
}

/** 读本地记忆的缩放（无 / 不可读回落缺省）；localStorage 在隐私模式等场景可能抛错，一律吞掉 */
export function loadSavedZoom(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw === null ? MAP_ZOOM_DEFAULT : clampZoom(Number(raw));
  } catch {
    return MAP_ZOOM_DEFAULT;
  }
}

export function saveZoom(size: number): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // 记忆失败不影响缩放本身
  }
}

/**
 * 窗口尺寸变化后的原点：让焦点（视口内比例位置 fx / fy ∈ [0,1]）下的世界格保持在原来的位置不动
 * （缩放中心跟随光标 / 焦点，不跳变），再钳在世界边界内。宽高可以不同（窗口按容器长宽比取格数）。
 */
export function resizedOrigin(
  origin: { x: number; y: number },
  old: { w: number; h: number },
  next: { w: number; h: number },
  focus: { fx: number; fy: number },
  worldSize: number,
): { x: number; y: number } {
  const worldX = origin.x + focus.fx * old.w;
  const worldY = origin.y + focus.fy * old.h;
  return {
    x: Math.min(Math.max(0, worldSize - next.w), Math.max(0, Math.round(worldX - focus.fx * next.w))),
    y: Math.min(Math.max(0, worldSize - next.h), Math.max(0, Math.round(worldY - focus.fy * next.h))),
  };
}

/** 单格目标像素（缩放档 10 = 44px；档位越小格子越大）：地图格数 = 容器尺寸 ÷ 它 */
export const MAP_TILE_TARGET_PX = 44;

/**
 * 地图窗口格数（docs/frontend-nav-layout.md 第 6 节）：列 = round(宽 / 格宽)、行 = round(高 / 格宽)，
 * 容器变化时重算，地图永远刚好铺满。格宽取「目标像素」与「让两边都不超过服务端上限 20 格」中较大者，
 * 保证格子近似方形；最少 5 列 3 行。
 */
export function viewportDims(width: number, height: number, zoom: number): { w: number; h: number } {
  const target = (MAP_TILE_TARGET_PX * MAP_ZOOM_DEFAULT) / clampZoom(zoom);
  const tile = Math.max(target, width / MAP_ZOOM_MAX, height / MAP_ZOOM_MAX, 1);
  return {
    w: Math.min(MAP_ZOOM_MAX, Math.max(5, Math.round(width / tile))),
    h: Math.min(MAP_ZOOM_MAX, Math.max(3, Math.round(height / tile))),
  };
}

/** 一次滚轮 / 按键 / 手柄步进的格数：约 10% 窗口边长，至少 1 格（大窗口走得快一点，保持观感平滑） */
export function zoomStep(size: number): number {
  return Math.max(1, Math.round(size * 0.1));
}
