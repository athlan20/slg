/** 世界小地图（v58，AISLG-160）：把整张世界缩成一张小图，只画城池点位（本方 / 他方 / NPC / 名城），
 *  野地不画。视野框随主地图的窗口同步移动；点小图任意位置，主地图跳到那里。可收起 / 展开，收起时只剩一个开关。
 *  点位在 canvas 上逐点绘制（城池约万级，不用 DOM 节点）；颜色取主题变量，名城与主地图金色标记同色，NPC 城弱化为灰色。
 *  数据与展开状态来自 mapOverview 会话切片，这里只负责绘制与换算。
 */

import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { MapOverviewResponseData, MapOverviewSide, WorldMapResponseData } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import type { MapOverviewSession } from '../../state/mapOverview';

/** 小图边长（CSS 像素，世界为正方形） */
export const MINIMAP_SIZE_PX = 160;

interface WorldMinimapProps {
  overview: MapOverviewSession;
  /** 主地图当前窗口：画视野框、点击换算目标位置 */
  win: WorldMapResponseData | null;
  /** 点小图跳转：传入窗口左上角（世界格坐标） */
  onPanTo: (x: number, y: number) => void;
}

/** 各归属的绘制参数：颜色取主题变量（缺省用兜底色），边长（像素）。
 *  npc 约万级点位，密集时会连成一片底纹，所以用弱化的灰色，免得把金色的名城淹没（AISLG-163） */
const DOT_STYLE: Record<MapOverviewSide, { cssVar: string; fallback: string; size: number; alpha: number }> = {
  npc: { cssVar: '--text-dim', fallback: '#7c8898', size: 1, alpha: 1 },
  enemy: { cssVar: '--warn', fallback: '#e0653a', size: 2, alpha: 1 },
  famous: { cssVar: '--gold', fallback: '#d9a441', size: 4, alpha: 1 },
  own: { cssVar: '--accent', fallback: '#2dd4bf', size: 3, alpha: 1 },
};
/** 绘制顺序：先画底层的 NPC，本方城池最后盖在最上面 */
const DRAW_ORDER: MapOverviewSide[] = ['npc', 'enemy', 'famous', 'own'];

function themeColor(cssVar: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || fallback;
}

function drawDots(canvas: HTMLCanvasElement, data: MapOverviewResponseData, dpr: number) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  const scale = (MINIMAP_SIZE_PX * dpr) / data.size;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const side of DRAW_ORDER) {
    const style = DOT_STYLE[side];
    ctx.globalAlpha = style.alpha;
    ctx.fillStyle = themeColor(style.cssVar, style.fallback);
    const edge = style.size * dpr;
    for (const [x, y, dotSide] of data.cities) {
      if (dotSide === side) {
        // 点位居中落在格子的像素中心，越界（理论上不会）时画到边缘内；取整到整数像素，
        // 否则小于一格的小数坐标会被抗锯齿成半透明模糊点（AISLG-163 复测）
        const px = Math.min(canvas.width - edge, Math.max(0, Math.round(x * scale - edge / 2)));
        const py = Math.min(canvas.height - edge, Math.max(0, Math.round(y * scale - edge / 2)));
        ctx.fillRect(px, py, edge, edge);
      }
    }
  }
  ctx.globalAlpha = 1;
}

export function WorldMinimap({ overview, win, onPanTo }: WorldMinimapProps) {
  const copy = useCopy();
  const { COPY, MAPUI_COPY } = copy;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const data = overview.overview;
  const { open, setOpen } = overview;
  const worldSize = data?.size ?? win?.size ?? 0;

  // 点位变化（首次展开 / 定时刷新）才重绘；窗口平移只动视野框，不必重画全部点位
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data || worldSize <= 0) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(MINIMAP_SIZE_PX * dpr);
    canvas.height = Math.round(MINIMAP_SIZE_PX * dpr);
    drawDots(canvas, data, dpr);
  }, [data, worldSize, open]);

  const jumpTo = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!win || worldSize <= 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const tileX = ((event.clientX - rect.left) / rect.width) * worldSize;
    const tileY = ((event.clientY - rect.top) / rect.height) * worldSize;
    // 让点击的格子落在主地图视野的中央；越界由 worldSession 与服务端钳制
    onPanTo(Math.floor(tileX - win.w / 2), Math.floor(tileY - win.h / 2));
  };

  const legend: Array<{ key: MapOverviewSide; label: string; swatch: string }> = [
    { key: 'own', label: COPY.worldMap.legendOwnCity, swatch: 'bg-accent' },
    { key: 'enemy', label: COPY.worldMap.legendCity, swatch: 'bg-warn' },
    { key: 'famous', label: MAPUI_COPY.minimapFamous, swatch: 'bg-gold' },
    { key: 'npc', label: COPY.worldMap.legendNpcCity, swatch: 'bg-dim' },
  ];

  return (
    <div role="世界地图视图-小地图区" className="pointer-events-none absolute right-3.5 top-3.5 flex flex-col items-end gap-1">
      <button
        type="button"
        role="世界地图视图-小地图开关"
        aria-pressed={open}
        title={MAPUI_COPY.minimapHint}
        onClick={() => setOpen(!open)}
        className="pointer-events-auto cursor-pointer rounded border border-line-soft bg-panel/90 px-1.5 py-0.5 text-[10.5px] text-dim hover:text-fg"
      >
        {MAPUI_COPY.minimapToggle}
      </button>
      {open ? (
        <div role="世界地图视图-小地图" className="pointer-events-auto flex flex-col gap-1.5 rounded-md border border-line-soft bg-panel/90 p-1.5">
          <div
            role="世界地图视图-小地图-画布"
            title={MAPUI_COPY.minimapHint}
            onClick={jumpTo}
            className="relative cursor-pointer overflow-hidden rounded-sm bg-t-plain"
            style={{ width: MINIMAP_SIZE_PX, height: MINIMAP_SIZE_PX }}
          >
            {data ? (
              <canvas ref={canvasRef} role="世界地图视图-小地图-城池点" style={{ width: MINIMAP_SIZE_PX, height: MINIMAP_SIZE_PX }} />
            ) : (
              <p className="grid h-full place-items-center text-[11px] text-faint">{MAPUI_COPY.minimapLoading}</p>
            )}
            {data && win && worldSize > 0 ? (
              <div
                role="世界地图视图-小地图-视野框"
                className="pointer-events-none absolute border border-fg bg-fg/10 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                style={{
                  left: `${(win.x / worldSize) * 100}%`,
                  top: `${(win.y / worldSize) * 100}%`,
                  width: `max(10px, ${(win.w / worldSize) * 100}%)`,
                  height: `max(10px, ${(win.h / worldSize) * 100}%)`,
                }}
              />
            ) : null}
          </div>
          <ul role="世界地图视图-小地图-图例" className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-dim">
            {legend.map((item) => (
              <li key={item.key} className="flex items-center gap-1 whitespace-nowrap">
                <i className={`inline-block h-2 w-2 rounded-[1px] ${item.swatch}`} aria-hidden="true" />
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
