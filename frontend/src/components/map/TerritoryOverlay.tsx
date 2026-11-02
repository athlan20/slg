/** 领地色块边界层（AISLG-216）：只在一片领地的最外圈画线，格间缝隙铺同色让一片地看起来连成整块。
 *  色块本身铺在格子背景上（WorldMapGrid 里的半透明叠层），这里只画 SVG 边界与缝隙；
 *  贴视野边缘的一侧不画线（视野外不知道是谁的），判定见 territoryBorders。
 */

import { useMemo } from 'react';
import type { GridMetrics } from './marchGeometry';
import { borderEdges, seamEdges, type BorderEdge, type TerritoryCell, type TerritoryRelation, type TerritoryWindow } from './territoryBorders';

/** 关系色（边界 100% 不透明，缝隙与色块 20%） */
export const TERRITORY_STROKE: Record<TerritoryRelation, string> = {
  own: 'var(--accent)',
  ally: 'var(--st-online)',
  hostile: 'var(--st-error)',
  other: 'var(--warn)',
};

/** 格子背景上的半透明色块（Tailwind 类，图例色块也用同一套） */
export const TERRITORY_FILL_CLASS: Record<TerritoryRelation, string> = {
  own: 'bg-accent/20',
  ally: 'bg-st-online/20',
  hostile: 'bg-st-error/20',
  other: 'bg-warn/20',
};

/** 图例色块：半透明铺色 + 关系色描边 */
export const TERRITORY_SWATCH_CLASS: Record<TerritoryRelation, string> = {
  own: 'bg-accent/20 border-accent',
  ally: 'bg-st-online/20 border-st-online',
  hostile: 'bg-st-error/20 border-st-error',
  other: 'bg-warn/20 border-warn',
};

interface TerritoryOverlayProps {
  win: TerritoryWindow;
  metrics: GridMetrics;
  size: { w: number; h: number };
  cells: Map<string, TerritoryCell>;
}

/** 一条外圈边 → 内缩 1px 的线段（相邻两个账号贴在一起时两条线各留 2px，颜色都看得见） */
function edgeLine(edge: BorderEdge, win: TerritoryWindow, m: GridMetrics) {
  const left = (edge.x - win.x) * m.stepW;
  const top = (edge.y - win.y) * m.stepH;
  const inset = 1;
  switch (edge.side) {
    case 'top':
      return { x1: left, y1: top + inset, x2: left + m.cellW, y2: top + inset };
    case 'bottom':
      return { x1: left, y1: top + m.cellH - inset, x2: left + m.cellW, y2: top + m.cellH - inset };
    case 'left':
      return { x1: left + inset, y1: top, x2: left + inset, y2: top + m.cellH };
    default:
      return { x1: left + m.cellW - inset, y1: top, x2: left + m.cellW - inset, y2: top + m.cellH };
  }
}

export function TerritoryOverlay({ win, metrics: m, size, cells }: TerritoryOverlayProps) {
  const edges = useMemo(() => borderEdges(cells, win), [cells, win.w, win.h, win.x, win.y]);
  const seams = useMemo(() => seamEdges(cells, win), [cells, win.w, win.h, win.x, win.y]);
  if (size.w <= 0 || size.h <= 0) {
    return null;
  }
  return (
    <svg role="世界地图-领地边界" aria-hidden="true" width={size.w} height={size.h} className="pointer-events-none absolute inset-0 overflow-hidden">
      <g role="世界地图-领地缝隙">
        {seams.map((seam) => {
          const left = (seam.x - win.x) * m.stepW;
          const top = (seam.y - win.y) * m.stepH;
          const rect =
            seam.side === 'right'
              ? { x: left + m.cellW - 0.5, y: top, width: m.gap + 1, height: m.cellH }
              : { x: left, y: top + m.cellH - 0.5, width: m.cellW, height: m.gap + 1 };
          return <rect key={`${seam.x},${seam.y},${seam.side}`} fill={TERRITORY_STROKE[seam.relation]} fillOpacity={0.2} rx={1} {...rect} />;
        })}
      </g>
      <g role="世界地图-领地边界线" strokeWidth={2} strokeLinecap="round">
        {edges.map((edge) => (
          <line
            key={`${edge.x},${edge.y},${edge.side}`}
            {...edgeLine(edge, win, m)}
            stroke={edge.gold ? 'var(--gold)' : TERRITORY_STROKE[edge.relation]}
          />
        ))}
      </g>
    </svg>
  );
}