/** 行军图层（AISLG-216）：一行军一条从出发城到目标的线 + 沿线移动的任务图标 + 剩余时间；
 *  同一格的部队合并成一个图标（×N 角标，点开选一支看详情）；图标提示先出现、再点一次开行军详情。
 *  线用强调色（红色只留给敌人来袭），去程实线、返程虚线且整体 60% 透明度；整层不挡地块点击。
 */

import { useMemo, useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import { marchLabel } from '../worldPanelText';
import { troopTotal } from '../army/marchDetailText';
import { cellToPx, formatMarchLeft, groupMarchIcons, marchIconSize, type GridMetrics, type MapMarch } from './marchGeometry';

interface MarchOverlayProps {
  marches: MapMarch[];
  /** 每秒推进的本地时钟（图标位置与倒计时跟着走） */
  now: number;
  /** 覆盖层像素尺寸（与网格等大） */
  size: { w: number; h: number };
  metrics: GridMetrics;
  origin: { x: number; y: number };
  onOpenMarch: (id: string) => void;
}

/** 视野外的行军由 MarchEdgeArrows 画箭头，这里只画视野内（或跨越视野）的线与图标 */
export function MarchOverlay({ marches, now, size, metrics: m, origin, onOpenMarch }: MarchOverlayProps) {
  const copy = useCopy();
  const M = copy.EXTRA_MAP.march;
  const [tipId, setTipId] = useState<string | null>(null);
  const [stackKey, setStackKey] = useState<string | null>(null);
  const groups = useMemo(() => groupMarchIcons(marches), [marches]);
  const iconSize = marchIconSize(m);
  const tip = groups.find((group) => group.lead.id === tipId) ?? null;
  const stack = groups.find((group) => group.key === stackKey && group.marches.length > 1) ?? null;
  if (size.w <= 0 || size.h <= 0) {
    return null;
  }
  const tipPx = tip ? cellToPx(tip.lead.pos, origin, m) : null;
  const stackPx = stack ? cellToPx(stack.lead.pos, origin, m) : null;

  return (
    <>
      <svg role="世界地图-行军路线" aria-hidden="true" width={size.w} height={size.h} className="pointer-events-none absolute inset-0 overflow-hidden">
        {marches.map((item) => {
          const from = cellToPx(item.from, origin, m);
          const to = cellToPx(item.to, origin, m);
          const returning = item.purpose === 'return';
          return (
            <line
              key={item.id}
              x1={from.px}
              y1={from.py}
              x2={to.px}
              y2={to.py}
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeDasharray={returning ? '4 4' : undefined}
              opacity={returning ? 0.6 : 1}
            />
          );
        })}
      </svg>

      {groups.map((group) => {
        const p = cellToPx(group.lead.pos, origin, m);
        const ambush = group.lead.ambushing;
        const time = formatMarchLeft(group.lead.leftMs);
        const label = ambush ? M.ambushLeft(time) : time;
        return (
          <span key={group.key} className="pointer-events-none absolute" style={{ left: p.px, top: p.py, transform: 'translate(-50%, -50%)' }}>
            <button
              type="button"
              role="世界地图-行军图标"
              aria-label={`${M.tipTarget(group.lead.march.x, group.lead.march.y)} ${label}`}
              onClick={() => {
                if (group.marches.length > 1) {
                  setStackKey(group.key);
                  setTipId(group.lead.id);
                  return;
                }
                if (tipId === group.lead.id) {
                  onOpenMarch(group.lead.id);
                  return;
                }
                setTipId(group.lead.id);
              }}
              onMouseEnter={() => setTipId(group.lead.id)}
              onFocus={() => setTipId(group.lead.id)}
              className={`pointer-events-auto relative grid cursor-pointer place-items-center rounded-full bg-accent font-semibold leading-none text-bg shadow-[0_0_8px_var(--accent)] ${
                ambush ? 'animate-[slg-breathe_1.6s_ease-in-out_infinite]' : ''
              }`}
              style={{ width: iconSize, height: iconSize, fontSize: Math.round(iconSize * 0.55) }}
            >
              {M.glyph[group.lead.purpose]}
            </button>
            {group.marches.length > 1 ? (
              <em role="世界地图-行军合并角标" className="absolute left-full top-[-4px] -translate-x-1/2 rounded bg-panel px-0.5 text-[9.5px] font-semibold not-italic text-accent ring-1 ring-accent">
                {M.stack(group.marches.length)}
              </em>
            ) : null}
            <span
              role="世界地图-行军倒计时"
              className={`absolute left-1/2 top-full -translate-x-1/2 whitespace-nowrap rounded bg-panel/90 px-0.5 font-mono text-[9.5px] leading-tight tabular-nums ${ambush ? 'text-gold' : 'text-accent'}`}
            >
              {label}
            </span>
          </span>
        );
      })}

      {tip && tipPx ? (
        <div
          role="世界地图-行军提示"
          className="pointer-events-none absolute z-[6] w-[168px] rounded-md border border-accent-dim bg-panel/95 px-2 py-1 text-[11.5px] leading-[1.5] text-fg shadow-lg"
          style={{ left: Math.min(Math.max(4, tipPx.px + iconSize / 2 + 4), Math.max(4, size.w - 172)), top: Math.min(Math.max(4, tipPx.py - 60), Math.max(4, size.h - 70)) }}
        >
          <b className="block truncate text-accent">{marchLabel(tip.lead.march, now)}</b>
          <span className="block text-dim">
            {M.tipTroops(troopTotal(tip.lead.march))} · {M.tipTarget(tip.lead.march.x, tip.lead.march.y)}
          </span>
          <span className="block font-mono text-[11px] text-faint">
            {tip.lead.ambushing ? M.ambushLeft(formatMarchLeft(tip.lead.leftMs)) : M.tipLeft(formatMarchLeft(tip.lead.leftMs))}
          </span>
          {tip.marches.length === 1 ? <span className="mt-0.5 block text-[10.5px] text-faint">{M.detailHint}</span> : null}
        </div>
      ) : null}

      {stack && stackPx ? (
        <div
          role="世界地图-行军选单"
          onMouseLeave={() => setStackKey(null)}
          className="pointer-events-auto absolute z-[7] w-[176px] rounded-md border border-accent-dim bg-panel/95 px-1.5 py-1 text-[11.5px] shadow-lg"
          style={{ left: Math.min(Math.max(4, stackPx.px), Math.max(4, size.w - 180)), top: Math.min(Math.max(4, stackPx.py + 12), Math.max(4, size.h - 22 * stack.marches.length)) }}
        >
          <b className="block px-1 text-[10.5px] text-dim">{M.stackTitle(stack.marches.length)}</b>
          {stack.marches.map((item) => (
            <button
              key={item.id}
              type="button"
              role="世界地图-行军委单条目"
              title={marchLabel(item.march, now)}
              onClick={() => {
                setStackKey(null);
                onOpenMarch(item.id);
              }}
              className="flex w-full cursor-pointer items-baseline justify-between gap-2 rounded px-1 text-left hover:bg-accent-soft"
            >
              <span className="truncate text-accent">
                {M.glyph[item.purpose]} {marchLabel(item.march, now)}
              </span>
              <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-faint">{formatMarchLeft(item.leftMs)}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}