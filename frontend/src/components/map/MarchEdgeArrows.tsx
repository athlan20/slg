/** 视野外行军箭头（AISLG-216）：图标跑出地图视野时，在边框上离它最近的位置画一个指向它的箭头，
 *  箭头旁带任务字与剩余时间，点一下地图以图标当前位置为中心跳过去。
 *  超过 6 个只留剩余时间最短的 6 个，其余合并成右下角 +N 角标（点开去军队页的行军列表）。
 */

import { useMemo } from 'react';
import { useCopy } from '../../i18n/bundle';
import { EDGE_ARROW_LIMIT, edgeArrow, formatMarchLeft, layerSize, type GridMetrics, type MapMarch } from './marchGeometry';

interface MarchEdgeArrowsProps {
  marches: MapMarch[];
  origin: { x: number; y: number };
  win: { w: number; h: number };
  metrics: GridMetrics;
  /** 箭头点击：地图以该格为中心跳过去 */
  onCenter: (x: number, y: number) => void;
  /** +N 角标点击：打开军队页的行军列表 */
  onOpenMarchList: () => void;
}

/** +N 角标占的右下角范围（像素，含边距与箭头标签余量） */
const OVERFLOW_BOX = { w: 70, h: 36 };

export function MarchEdgeArrows({ marches, origin, win, metrics: m, onCenter, onOpenMarchList }: MarchEdgeArrowsProps) {
  const M = useCopy().EXTRA_MAP.march;
  const { arrows, overflow } = useMemo(() => {
    const outside = marches
      .map((item) => ({ item, arrow: edgeArrow(item.pos, origin, win, m) }))
      .filter((entry): entry is { item: MapMarch; arrow: { px: number; py: number; angle: number } } => entry.arrow !== null)
      .sort((a, b) => a.item.leftMs - b.item.leftMs);
    const overflow = outside.length - EDGE_ARROW_LIMIT;
    const shown = outside.slice(0, EDGE_ARROW_LIMIT);
    if (overflow > 0) {
      // 右下角留给 +N 角标：落在角标范围内的箭头沿所在边挪开，免得角标盖住箭头、点不到
      const size = layerSize(win, m);
      for (const entry of shown) {
        const a = entry.arrow;
        if (a.px > size.w - OVERFLOW_BOX.w && a.py > size.h - OVERFLOW_BOX.h) {
          if (a.py >= size.h - 14) {
            a.px = size.w - OVERFLOW_BOX.w;
          } else {
            a.py = size.h - OVERFLOW_BOX.h;
          }
        }
      }
    }
    return { arrows: shown, overflow };
  }, [marches, origin, win.w, win.h, m]);
  if (arrows.length === 0) {
    return null;
  }
  return (
    <>
      {arrows.map(({ item, arrow }) => {
        const rad = (arrow.angle * Math.PI) / 180;
        return (
          <span key={item.id} className="pointer-events-none absolute" style={{ left: arrow.px, top: arrow.py }}>
            <button
              type="button"
              role="世界地图-行军箭头"
              title={M.arrowHint}
              aria-label={`${M.glyph[item.purpose]} ${M.arrowHint}`}
              onClick={() => onCenter(Math.round(item.pos.x), Math.round(item.pos.y))}
              className="pointer-events-auto absolute grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-full bg-accent text-[10px] leading-none text-bg shadow-[0_0_6px_var(--accent)]"
              style={{ transform: `translate(-50%, -50%) rotate(${arrow.angle}deg)` }}
            >
              <span className="not-italic">▲</span>
            </button>
            <span
              role="世界地图-行军箭头标签"
              className="absolute whitespace-nowrap rounded bg-panel/90 px-0.5 font-mono text-[9.5px] leading-tight text-accent"
              style={{ left: Math.cos(rad) * 22, top: Math.sin(rad) * 22, transform: 'translate(-50%, -50%)' }}
            >
              {M.glyph[item.purpose]} {formatMarchLeft(item.leftMs)}
            </span>
          </span>
        );
      })}
      {overflow > 0 ? (
        <button
          type="button"
          role="世界地图-行军箭头溢出"
          title={M.arrowHint}
          onClick={onOpenMarchList}
          className="pointer-events-auto absolute cursor-pointer rounded bg-panel/90 px-1 py-0.5 font-mono text-[10.5px] text-accent ring-1 ring-accent"
          style={{ right: 4, bottom: 4 }}
        >
          {M.overflow(overflow)}
        </button>
      ) : null}
    </>
  );
}