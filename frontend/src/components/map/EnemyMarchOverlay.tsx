/** 他人部队图层（AISLG-230）：别人走进你视野的行军。只画一个按前进方向带短箭头的图标 + 点开的小提示，
 *  不画起点到目标的长线、不打开行军详情、不改变地块选中；配色按与你的关系（来袭红 / 敌对橙 / 中立灰 / 同盟绿），
 *  返程 60% 透明度（和自己的返程一致），规模用图标大小区分。整层默认不挡地块点击。
 *  两次请求之间按 vx / vy 外推位置，最多 6 秒（见 enemyMarchGeometry）；视野外的部队不画边缘箭头。
 */

import { useState } from 'react';
import { useCopy } from '../../i18n/bundle';
import type { VisibleMarchView } from '../../api/protocol';
import { cellToPx, marchIconSize, type GridMetrics } from './marchGeometry';
import { ENEMY_MARCH_TONE_COLOR, enemyMarchHeading, enemyMarchIconSize, enemyMarchPos, enemyMarchTone } from './enemyMarchGeometry';

interface EnemyMarchOverlayProps {
  marches: VisibleMarchView[];
  /** 快照的本地接收时刻（外推基准，毫秒） */
  receivedAt: number;
  /** 每秒推进的本地时钟 */
  now: number;
  /** 覆盖层像素尺寸（与网格等大） */
  size: { w: number; h: number };
  metrics: GridMetrics;
  origin: { x: number; y: number };
  /** 正在来袭自己的行军 id（= 来袭预警的 attackId）：这些图标转红色 */
  incomingIds: ReadonlySet<string>;
}

export function EnemyMarchOverlay({ marches, receivedAt, now, size, metrics: m, origin, incomingIds }: EnemyMarchOverlayProps) {
  const copy = useCopy();
  const M = copy.EXTRA_MAP.enemyMarch;
  const [tipId, setTipId] = useState<string | null>(null);
  if (size.w <= 0 || size.h <= 0 || marches.length === 0) {
    return null;
  }
  const base = marchIconSize(m);
  const placed = marches.map((march) => {
    const pos = enemyMarchPos(march, receivedAt, now);
    return { march, pos, px: cellToPx(pos, origin, m) };
  });
  const tip = placed.find((item) => item.march.id === tipId) ?? null;

  return (
    <>
      {/* 前进方向的短箭头：画在图标中心外侧一小段，不连起点到目标 */}
      <svg role="世界地图-他人部队方向" aria-hidden="true" width={size.w} height={size.h} className="pointer-events-none absolute inset-0 overflow-hidden">
        {placed.map(({ march, px }) => {
          const angle = enemyMarchHeading(march.vx, march.vy);
          if (angle === null) {
            return null;
          }
          const iconPx = enemyMarchIconSize(base, march.scale);
          const start = iconPx / 2 + 2;
          const end = start + Math.max(6, Math.round(iconPx * 0.55));
          const rad = (angle * Math.PI) / 180;
          const tipX = px.px + Math.cos(rad) * end;
          const tipY = px.py + Math.sin(rad) * end;
          const head = Math.max(4, Math.round(iconPx * 0.32));
          const leftX = px.px + Math.cos(rad) * (end - head) + Math.cos(rad + Math.PI / 2) * head * 0.6;
          const leftY = px.py + Math.sin(rad) * (end - head) + Math.sin(rad + Math.PI / 2) * head * 0.6;
          const rightX = px.px + Math.cos(rad) * (end - head) + Math.cos(rad - Math.PI / 2) * head * 0.6;
          const rightY = px.py + Math.sin(rad) * (end - head) + Math.sin(rad - Math.PI / 2) * head * 0.6;
          const color = ENEMY_MARCH_TONE_COLOR[enemyMarchTone(march, incomingIds)];
          return (
            <g key={march.id} opacity={march.returning ? 0.6 : 1}>
              <line x1={px.px + Math.cos(rad) * start} y1={px.py + Math.sin(rad) * start} x2={tipX} y2={tipY} stroke={color} strokeWidth={2} strokeLinecap="round" />
              <polygon points={`${tipX},${tipY} ${leftX},${leftY} ${rightX},${rightY}`} fill={color} />
            </g>
          );
        })}
      </svg>

      {placed.map(({ march, px }) => {
        const iconPx = enemyMarchIconSize(base, march.scale);
        const tone = enemyMarchTone(march, incomingIds);
        const scaleLabel = M.scale[march.scale];
        return (
          <span key={march.id} className="pointer-events-none absolute" style={{ left: px.px, top: px.py, transform: 'translate(-50%, -50%)' }}>
            <button
              type="button"
              role="世界地图-他人部队图标"
              aria-label={M.aria(march.owner.username, scaleLabel, march.returning)}
              onClick={() => setTipId((current) => (current === march.id ? null : march.id))}
              className="pointer-events-auto grid cursor-pointer place-items-center rounded-full font-semibold leading-none text-bg shadow-[0_0_6px_rgba(0,0,0,0.5)]"
              style={{
                width: iconPx,
                height: iconPx,
                fontSize: Math.max(8, Math.round(iconPx * 0.5)),
                background: ENEMY_MARCH_TONE_COLOR[tone],
                opacity: march.returning ? 0.6 : 1,
                outline: tone === 'incoming' ? '1px solid var(--st-error)' : undefined,
              }}
            >
              {M.glyph}
            </button>
          </span>
        );
      })}

      {tip ? (
        <div
          role="世界地图-他人部队提示"
          className="pointer-events-none absolute z-[6] w-[168px] rounded-md border border-line bg-panel/95 px-2 py-1 text-[11.5px] leading-[1.5] text-fg shadow-lg"
          style={{ left: Math.min(Math.max(4, tip.px.px + 12), Math.max(4, size.w - 172)), top: Math.min(Math.max(4, tip.px.py - 62), Math.max(4, size.h - 74)) }}
        >
          <b className="block truncate" style={{ color: ENEMY_MARCH_TONE_COLOR[enemyMarchTone(tip.march, incomingIds)] }}>
            {M.tipOwner(tip.march.owner.username)}
          </b>
          <span className="block truncate text-dim">
            {tip.march.owner.allianceName ? M.tipAlliance(tip.march.owner.allianceName) : M.tipNoAlliance}
          </span>
          <span className="block text-dim">
            {M.tipScale(M.scale[tip.march.scale])} · {tip.march.returning ? M.tipReturning : M.tipOutbound}
          </span>
          <span className="mt-0.5 block text-[10.5px] text-faint">{M.tipNote}</span>
        </div>
      ) : null}
    </>
  );
}
