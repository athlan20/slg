/** 敌人来袭标记（AISLG-216）：推送里只有目标格、没有出发地，所以不画线——
 *  在目标格叠一圈红色内描边（呼吸闪烁 1.2 秒）、格子上方挂「来袭 mm:ss」；
 *  悬停 / 轻点显示敌军规模（与现有来袭预警文案同口径）；目标在视野外时在边框上画红色箭头。
 *  来袭红标不受「行军」图层开关影响，始终显示。
 */

import { useMemo, useState } from 'react';
import type { NpcAttackWarningPushData, TroopKind } from '../../api/protocol';
import { useCopy } from '../../i18n/bundle';
import { cellToPx, edgeArrow, formatMarchLeft, type GridMetrics } from './marchGeometry';

interface RaidOverlayProps {
  warnings: NpcAttackWarningPushData[];
  now: number;
  origin: { x: number; y: number };
  win: { x: number; y: number; w: number; h: number };
  metrics: GridMetrics;
  size: { w: number; h: number };
  onCenter: (x: number, y: number) => void;
}

export function RaidOverlay({ warnings, now, origin, win, metrics: m, size, onCenter }: RaidOverlayProps) {
  const copy = useCopy();
  const { COPY, DEFENSE_COPY, EXTRA_MAP } = copy;
  const [tipId, setTipId] = useState<string | null>(null);
  const live = useMemo(() => warnings.filter((warning) => Date.parse(warning.arriveAt) > now), [warnings, now]);
  const tip = live.find((warning) => warning.attackId === tipId) ?? null;
  if (live.length === 0 || size.w <= 0 || size.h <= 0) {
    return null;
  }
  const tipPx = tip ? cellToPx({ x: tip.x, y: tip.y }, origin, m) : null;

  return (
    <>
      {live.map((warning) => {
        const arrow = edgeArrow({ x: warning.x, y: warning.y }, origin, win, m);
        const time = formatMarchLeft(Math.max(0, Date.parse(warning.arriveAt) - now));
        if (arrow) {
          // 目标格在视野外：边框上画红色箭头（不计入行军的 6 个上限）
          return (
            <span key={warning.attackId} className="pointer-events-none absolute" style={{ left: arrow.px, top: arrow.py }}>
              <button
                type="button"
                role="世界地图-来袭箭头"
                title={EXTRA_MAP.raid.arrowHint}
                aria-label={EXTRA_MAP.raid.arrowHint}
                onClick={() => onCenter(warning.x, warning.y)}
                className="pointer-events-auto absolute grid h-[18px] w-[18px] cursor-pointer place-items-center rounded-full bg-st-error text-[10px] leading-none text-bg shadow-[0_0_6px_var(--st-error)]"
                style={{ transform: `translate(-50%, -50%) rotate(${arrow.angle}deg)` }}
              >
                ▲
              </button>
              <span className="absolute whitespace-nowrap rounded bg-panel/90 px-0.5 font-mono text-[9.5px] leading-tight text-st-error" style={{ left: 0, top: 14 }}>
                {EXTRA_MAP.raid.label(time)}
              </span>
            </span>
          );
        }
        const p = cellToPx({ x: warning.x, y: warning.y }, origin, m);
        const left = p.px - m.cellW / 2;
        const top = p.py - m.cellH / 2;
        // 第一行贴地图上沿：标签改挂到格子下方，避免被覆盖层裁掉
        const labelBelow = warning.y <= win.y;
        return (
          <span key={warning.attackId} className="pointer-events-none absolute" style={{ left, top, width: m.cellW, height: m.cellH }}>
            {/* 红圈只是视觉：不挡地块点击，点上方标签才出敌军规模 */}
            <span
              role="世界地图-来袭标记"
              aria-label={EXTRA_MAP.raid.label(time)}
              className="absolute inset-0 rounded border-[3px] border-st-error bg-st-error/10 animate-[slg-breathe_1.2s_ease-in-out_infinite]"
            />
            <button
              type="button"
              role="世界地图-来袭标签"
              onClick={() => setTipId(warning.attackId)}
              onMouseEnter={() => setTipId(warning.attackId)}
              className={`pointer-events-auto absolute left-1/2 -translate-x-1/2 cursor-pointer whitespace-nowrap rounded bg-st-error px-1 font-mono text-[9.5px] leading-tight text-bg ${
                labelBelow ? 'top-full translate-y-[2px]' : 'bottom-full translate-y-[-2px]'
              }`}
            >
              {EXTRA_MAP.raid.label(time)}
            </button>
          </span>
        );
      })}

      {tip && tipPx ? (
        <div
          role="世界地图-来袭提示"
          className="pointer-events-none absolute z-[7] w-[170px] rounded-md border border-st-error bg-panel/95 px-2 py-1 text-[11.5px] leading-[1.5] text-fg shadow-lg"
          style={{ left: Math.min(Math.max(4, tipPx.px + 10), Math.max(4, size.w - 174)), top: Math.min(Math.max(4, tipPx.py - 58), Math.max(4, size.h - 66)) }}
        >
          <b className="block text-st-error">{tip.attacker ? COPY.npcWarning.titlePlayer : COPY.npcWarning.title}</b>
          <span className="block font-mono text-[11px] text-dim">
            {COPY.npcWarning.armyLabel}
            {tip.armyMin}–{tip.armyMax}
          </span>
          {tip.intel === 'kinds' && tip.armyKinds ? (
            <span className="block text-[10.5px] text-warn">
              {DEFENSE_COPY.warning.kindsLabel}
              {(Object.entries(tip.armyKinds) as Array<[TroopKind, { min: number; max: number }]>)
                .map(([kind, range]) => DEFENSE_COPY.warning.kindRange(kind, range.min, range.max))
                .join(' ')}
            </span>
          ) : null}
          {tip.intel === 'exact' && tip.army ? (
            <span className="block text-[10.5px] text-warn">
              {DEFENSE_COPY.warning.exactLabel}
              {(Object.entries(tip.army) as Array<[TroopKind, number]>).map(([kind, count]) => DEFENSE_COPY.warning.exactRow(kind, count)).join(' ')}
            </span>
          ) : null}
          <span className="block font-mono text-[10.5px] text-faint">{DEFENSE_COPY.warning.beaconNote(tip.beaconLevel ?? 0)}</span>
        </div>
      ) : null}
    </>
  );
}