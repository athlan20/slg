/** 世界地图缩放控件（AISLG-103）：放大 / 缩小按钮 + 当前视野（一屏 N×N 格）+ 复位；
 *  手柄：LB / L2 缩小、RB / R2 放大（Gamepad API，边沿触发，缩放中心为视野中心）。
 *  滚轮 / 捏合 / 键盘 +- 在 WorldMapGrid；缩放逻辑与上下限在 state/mapZoom 与 worldSession.zoomTo。
 */

import { useEffect, useRef } from 'react';
import { MAP_ZOOM_DEFAULT, MAP_ZOOM_MAX, MAP_ZOOM_MIN, zoomStep } from '../state/mapZoom';

interface MapZoomControlsProps {
  /** 当前窗口格数（宽 × 高，仅用于显示「视野 w×h」）；未加载为 null（控件禁用） */
  dims: { w: number; h: number } | null;
  /** 当前缩放档位（world.viewSize，5..20；档位越小格子越大） */
  zoom: number;
  onZoom: (size: number, focus?: { fx: number; fy: number }) => void;
}

const TEXT = {
  zoomIn: '放大',
  zoomOut: '缩小',
  reset: '复位',
  view: (w: number, h: number) => `视野 ${w}×${h}`,
  atMin: '已放到最大',
  atMax: '已缩到最小',
};

const btn =
  'grid h-6 w-6 cursor-pointer place-items-center rounded border border-line bg-panel-2 font-mono text-[14px] leading-none text-dim transition-colors hover:border-accent-dim hover:text-fg disabled:cursor-not-allowed disabled:opacity-40';

export function MapZoomControls({ dims, zoom, onZoom }: MapZoomControlsProps) {
  const size = dims === null ? null : zoom;
  const sizeRef = useRef(size);
  const zoomRef = useRef(onZoom);
  sizeRef.current = size;
  zoomRef.current = onZoom;

  // 手柄：LB(4)/L2(6) 缩小、RB(5)/R2(7) 放大；只在按下沿触发一次
  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return undefined;
    }
    let raf = 0;
    const down = new Set<string>();
    const poll = () => {
      for (const pad of navigator.getGamepads()) {
        if (!pad) {
          continue;
        }
        for (const [index, dir] of [[4, 1], [6, 1], [5, -1], [7, -1]] as const) {
          const key = `${pad.index}:${index}`;
          const pressed = Boolean(pad.buttons[index]?.pressed);
          if (pressed && !down.has(key)) {
            down.add(key);
            const current = sizeRef.current;
            if (current !== null) {
              zoomRef.current(current + dir * zoomStep(current));
            }
          } else if (!pressed) {
            down.delete(key);
          }
        }
      }
      raf = window.requestAnimationFrame(poll);
    };
    raf = window.requestAnimationFrame(poll);
    return () => window.cancelAnimationFrame(raf);
  }, []);

  const current = size ?? MAP_ZOOM_DEFAULT;
  return (
    <div role="世界地图视图-缩放控件" className="flex items-center gap-1">
      <button
        type="button"
        role="世界地图视图-放大按钮"
        aria-label={TEXT.zoomIn}
        title={size !== null && size <= MAP_ZOOM_MIN ? TEXT.atMin : `${TEXT.zoomIn}（Ctrl+滚轮向上 / + / 双指张开）`}
        disabled={size === null || size <= MAP_ZOOM_MIN}
        onClick={() => onZoom(current - zoomStep(current))}
        className={btn}
      >
        ＋
      </button>
      <span role="世界地图视图-缩放比例" className="min-w-[4.5rem] text-center font-mono text-[12px] text-dim">
        {dims ? TEXT.view(dims.w, dims.h) : TEXT.view(current, current)}
      </span>
      <button
        type="button"
        role="世界地图视图-缩小按钮"
        aria-label={TEXT.zoomOut}
        title={size !== null && size >= MAP_ZOOM_MAX ? TEXT.atMax : `${TEXT.zoomOut}（Ctrl+滚轮向下 / - / 双指捏合）`}
        disabled={size === null || size >= MAP_ZOOM_MAX}
        onClick={() => onZoom(current + zoomStep(current))}
        className={btn}
      >
        －
      </button>
      <button
        type="button"
        role="世界地图视图-缩放复位按钮"
        aria-label={TEXT.reset}
        title={TEXT.reset}
        disabled={size === null || size === MAP_ZOOM_DEFAULT}
        onClick={() => onZoom(MAP_ZOOM_DEFAULT)}
        className={`${btn} text-[11px]`}
      >
        ⟲
      </button>
    </div>
  );
}
